package ai.heysure.agent.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.coroutines.resume
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Owns the single MediaProjection grant and turns it into screenshots
 * (ImageReader) and screen recordings (MediaRecorder). The projection is
 * acquired once via the system consent dialog and kept alive by the foreground
 * service so individual tasks don't re-prompt.
 */
class ScreenCaptureManager(private val appContext: Context) {

    @Volatile
    private var projection: MediaProjection? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    val isReady: Boolean get() = projection != null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() { projection = null }
    }

    fun attach(mp: MediaProjection) {
        release()
        // Android 14 (API 34) requires a registered callback before any
        // createVirtualDisplay call, or it throws.
        mp.registerCallback(projectionCallback, mainHandler)
        projection = mp
    }

    fun release() {
        runCatching {
            projection?.unregisterCallback(projectionCallback)
            projection?.stop()
        }
        projection = null
    }

    private fun metrics(): DisplayMetrics {
        val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(dm)
        return dm
    }

    /** Capture one frame and return it as a PNG data URL (key the server's
     *  screenshot pipeline recognises — see device_dispatch `_IMAGE_DATA_URL_KEYS`). */
    suspend fun captureDataUrl(): String {
        val mp = projection ?: throw IllegalStateException("未授权截屏：请先在 App 内点击\"授权截屏/录屏\"")
        val dm = metrics()
        val width = dm.widthPixels
        val height = dm.heightPixels
        val density = dm.densityDpi

        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        val display: VirtualDisplay = mp.createVirtualDisplay(
            "heysure-capture",
            width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface, null, mainHandler,
        )
        try {
            val image = awaitImage(reader)
            val bitmap = imageToBitmap(image, width)
            image.close()
            val cropped = if (bitmap.width != width) {
                Bitmap.createBitmap(bitmap, 0, 0, width, height)
            } else bitmap
            return "data:image/png;base64," + encodePng(cropped)
        } finally {
            display.release()
            reader.close()
        }
    }

    /** Record the screen for [durationMs] into an mp4 and return its file path. */
    suspend fun recordToFile(durationMs: Long, withAudio: Boolean): File {
        val mp = projection ?: throw IllegalStateException("未授权录屏：请先在 App 内点击\"授权截屏/录屏\"")
        val dm = metrics()
        val width = (dm.widthPixels / 2) * 2   // encoder wants even dimensions
        val height = (dm.heightPixels / 2) * 2

        val outFile = File(appContext.cacheDir, "heysure-record-${System.currentTimeMillis()}.mp4")
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(appContext)
        } else {
            @Suppress("DEPRECATION") MediaRecorder()
        }
        recorder.apply {
            if (withAudio) setAudioSource(MediaRecorder.AudioSource.MIC)
            setVideoSource(MediaRecorder.VideoSource.SURFACE)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setOutputFile(outFile.absolutePath)
            setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            if (withAudio) setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setVideoSize(width, height)
            setVideoEncodingBitRate(6_000_000)
            setVideoFrameRate(30)
            prepare()
        }

        val display = mp.createVirtualDisplay(
            "heysure-record",
            width, height, dm.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            recorder.surface, null, mainHandler,
        )
        try {
            recorder.start()
            delay(durationMs.coerceIn(500, 120_000))
        } finally {
            runCatching { recorder.stop() }
            recorder.reset()
            recorder.release()
            display.release()
        }
        return outFile
    }

    private suspend fun awaitImage(reader: ImageReader): Image =
        suspendCancellableCoroutine { cont ->
            reader.setOnImageAvailableListener({ r ->
                val img = r.acquireLatestImage()
                if (img != null && cont.isActive) {
                    r.setOnImageAvailableListener(null, null)
                    cont.resume(img)
                }
            }, mainHandler)
        }

    private fun imageToBitmap(image: Image, width: Int): Bitmap {
        val plane = image.planes[0]
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width
        val bmpWidth = width + rowPadding / pixelStride
        val bitmap = Bitmap.createBitmap(bmpWidth, image.height, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(plane.buffer)
        return bitmap
    }

    private fun encodePng(bitmap: Bitmap): String {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
