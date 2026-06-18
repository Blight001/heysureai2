package ai.heysure.agent

import ai.heysure.agent.agent.AgentService
import ai.heysure.agent.agent.DeviceStatus
import ai.heysure.agent.agent.ServerApi
import ai.heysure.agent.agent.Settings
import ai.heysure.agent.databinding.ActivityMainBinding
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var settings: Settings

    private val captureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != RESULT_OK || result.data == null) {
            toast("已取消截屏授权")
            return@registerForActivityResult
        }
        // Hand the grant to the foreground service — getMediaProjection must run
        // after the mediaProjection-typed foreground service is up (Android Q+).
        AgentService.start(this)
        val intent = Intent(this, AgentService::class.java).apply {
            action = AgentService.ACTION_GRANT_CAPTURE
            putExtra(AgentService.EXTRA_RESULT_CODE, result.resultCode)
            putExtra(AgentService.EXTRA_RESULT_DATA, result.data)
        }
        startService(intent)
        toast("截屏/录屏已授权")
    }

    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* result ignored: notification is best-effort */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        settings = Settings(this)

        binding.serverUrlInput.setText(settings.serverUrl)
        binding.loginButton.setOnClickListener { doLogin() }
        binding.accessibilityButton.setOnClickListener {
            startActivity(Intent(AndroidSettings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        binding.captureButton.setOnClickListener { requestCapture() }
        binding.stopButton.setOnClickListener {
            startService(Intent(this, AgentService::class.java).apply { action = AgentService.ACTION_STOP })
            binding.statusText.text = getString(R.string.status_disconnected)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifPermLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        attachAgentServiceListeners()
    }

    private fun doLogin() {
        val serverUrl = binding.serverUrlInput.text.toString()
        val account = binding.accountInput.text.toString()
        val password = binding.passwordInput.text.toString()
        if (serverUrl.isBlank() || account.isBlank() || password.isBlank()) {
            toast("请填写服务器地址、账号和密码")
            return
        }
        binding.loginButton.isEnabled = false
        appendLog("登录中…")
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { ServerApi.login(serverUrl, account, password) }
            }
            binding.loginButton.isEnabled = true
            result.onSuccess { res ->
                settings.serverUrl = ServerApi.normalizeBaseUrl(serverUrl)
                settings.agentSocketUrl = res.agentSocketUrl
                settings.authToken = res.accessToken
                settings.userId = res.userId
                settings.userName = res.userName
                appendLog("登录成功：${res.userName}")
                AgentService.start(this@MainActivity)
                binding.root.postDelayed({
                    attachAgentServiceListeners()
                    AgentService.instance?.reconnect()
                }, 300)
            }.onFailure { e ->
                appendLog("登录失败：${e.message}")
                toast(e.message ?: "登录失败")
            }
        }
    }

    private fun attachAgentServiceListeners() {
        AgentService.instance?.let { svc ->
            svc.statusListener = { status, reason -> runOnUiThread { renderStatus(status, reason) } }
            svc.logListener = { msg -> runOnUiThread { appendLog(msg) } }
            renderStatus(svc.lastStatus, null)
        }
    }

    private fun requestCapture() {
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        captureLauncher.launch(mpm.createScreenCaptureIntent())
    }

    private fun renderStatus(status: DeviceStatus, reason: String?) {
        val (label, color) = when (status) {
            DeviceStatus.REGISTERED -> R.string.status_registered to R.color.status_green
            DeviceStatus.CONNECTED -> R.string.status_connected to R.color.status_yellow
            DeviceStatus.CONNECTING -> R.string.status_connecting to R.color.status_yellow
            DeviceStatus.ERROR -> R.string.status_error to R.color.status_red
            DeviceStatus.DISCONNECTED -> R.string.status_disconnected to R.color.status_red
        }
        binding.statusText.text = getString(label) + (reason?.let { "（$it）" } ?: "")
        binding.statusText.setTextColor(getColor(color))
    }

    private fun appendLog(msg: String) {
        val ts = android.text.format.DateFormat.format("HH:mm:ss", System.currentTimeMillis())
        binding.logText.text = "[$ts] $msg\n${binding.logText.text}".take(4000)
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
