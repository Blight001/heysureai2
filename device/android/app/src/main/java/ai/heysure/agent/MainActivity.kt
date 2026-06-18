package ai.heysure.agent

import ai.heysure.agent.agent.AgentService
import ai.heysure.agent.agent.DeviceStatus
import ai.heysure.agent.agent.ServerApi
import ai.heysure.agent.agent.Settings
import ai.heysure.agent.databinding.ActivityMainBinding
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
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
    ) { /* notification is best-effort */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        settings = Settings(this)

        binding.serverUrlInput.setText(settings.serverUrl)
        binding.loginButton.setOnClickListener { doLogin() }
        binding.logoutButton.setOnClickListener { doLogout() }
        binding.accessibilityButton.setOnClickListener {
            startActivity(Intent(AndroidSettings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        binding.captureButton.setOnClickListener { requestCapture() }
        binding.batteryButton.setOnClickListener { requestBatteryExemption() }
        binding.stopButton.setOnClickListener {
            startService(Intent(this, AgentService::class.java).apply { action = AgentService.ACTION_STOP })
            renderStatus(DeviceStatus.DISCONNECTED, null)
        }

        binding.keepAwakeSwitch.isChecked = settings.keepScreenAwake
        binding.keepAwakeSwitch.setOnCheckedChangeListener { _, checked ->
            settings.keepScreenAwake = checked
            // The service owns the WakeLock; make sure it is up, then apply.
            AgentService.start(this)
            AgentService.instance?.applyKeepAwake(checked)
            if (checked) toast("已开启保持常亮（较耗电）")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifPermLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        attachAgentServiceListeners()
        binding.batteryButton.isEnabled = !isIgnoringBatteryOptimizations()
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

    private fun doLogout() {
        settings.clearSession()
        startService(Intent(this, AgentService::class.java).apply { action = AgentService.ACTION_STOP })
        renderStatus(DeviceStatus.DISCONNECTED, null)
        appendLog("已退出登录")
    }

    private fun requestCapture() {
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        captureLauncher.launch(mpm.createScreenCaptureIntent())
    }

    private fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun requestBatteryExemption() {
        if (isIgnoringBatteryOptimizations()) {
            toast("已在电池白名单中")
            return
        }
        // Open the system battery-optimization list and let the user whitelist us
        // manually. We deliberately avoid ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
        // (and its restricted permission) to keep the permission profile clean.
        toast("请在列表中找到「HeySure 安卓端」并设为「不优化 / 无限制」")
        try {
            startActivity(Intent(AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        } catch (e: Exception) {
            startActivity(Intent(AndroidSettings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName")))
        }
    }

    private fun renderStatus(status: DeviceStatus, reason: String?) {
        val (label, colorRes) = when (status) {
            DeviceStatus.REGISTERED -> R.string.status_registered to R.color.status_green
            DeviceStatus.CONNECTED -> R.string.status_connected to R.color.status_yellow
            DeviceStatus.CONNECTING -> R.string.status_connecting to R.color.status_yellow
            DeviceStatus.ERROR -> R.string.status_error to R.color.status_red
            DeviceStatus.DISCONNECTED -> R.string.status_disconnected to R.color.status_red
        }
        binding.statusText.text = getString(label) + (reason?.let { "（$it）" } ?: "")
        binding.statusDot.backgroundTintList =
            ColorStateList.valueOf(ContextCompat.getColor(this, colorRes))
    }

    private fun appendLog(msg: String) {
        val ts = android.text.format.DateFormat.format("HH:mm:ss", System.currentTimeMillis())
        binding.logText.text = "[$ts] $msg\n${binding.logText.text}".take(4000)
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
