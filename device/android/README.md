# HeySure 安卓端 Agent（device/android）

手机上的端侧执行器：和其它设备一样，登录后连接后端、注册为 endpoint，接收服务端
下发的任务并在本机执行。能力聚焦在**手机操控**：点击、滑动、长按、返回/主屏/最近任务、
向输入框输入文本、屏幕截图、屏幕录制。

> 方案选型：**手机上的原生 Kotlin App**（自包含 endpoint），不依赖电脑/ADB/root。
> 这与桌面壳"壳运行在它所控制的设备上"的心智模型一致。点击/滑动用
> `AccessibilityService.dispatchGesture()`，截屏/录屏用 `MediaProjection`。

## 与服务端的契约（与桌面壳完全一致）

通过 **Socket.IO** 连接 connector_runtime，讲的是和 Electron/扩展壳同一套协议：

| 方向 | 事件 | 载荷要点 |
| --- | --- | --- |
| agent → server | `device:register` | `id / name / platform("android-mobile …") / capabilities / toolDefs / token / isAndroid:true` |
| server → agent | `task:dispatch` | `taskId / tool / args / allowedTools` |
| agent → server | `task:progress` / `task:result` / `task:error` | 执行回执（idempotent，按 taskId 去重） |

服务端把 `isAndroid` 的 endpoint 识别为独立设备类型 `android`（见
`server/main/connector_runtime/dispatch/desktop_device_tools.py::device_type_of`），
有自己的标签"安卓端Agent"与 MCP 权限分组；但在**任务派发**上归为桌面类执行器，
因此点击/截屏等工具走 `get_connected_desktop_agent` 通道。`screen.capture` 返回
`dataUrl`，会被服务端截图管线自动落盘并转发给用户。

## 工具表（self-described，注册时上报 toolDefs）

| 工具 | 作用 | 实现 |
| --- | --- | --- |
| `touch.tap` | 坐标单击 | `dispatchGesture` |
| `touch.long_press` | 坐标长按 | `dispatchGesture` |
| `touch.swipe` | 两点滑动/拖拽 | `dispatchGesture` |
| `touch.back` / `touch.home` / `touch.recents` | 系统返回/主屏/最近任务 | `performGlobalAction` |
| `input.text` | 向聚焦输入框写文本 | `AccessibilityNodeInfo.ACTION_SET_TEXT` |
| `screen.capture` | 截屏（PNG dataUrl） | `MediaProjection` + `ImageReader` |
| `screen.record` | 录屏（mp4） | `MediaProjection` + `MediaRecorder` |

新增工具：在 `executor/ToolCatalog.kt` 注册一个 `Tool`（name/description/inputSchema/run），
其 schema 会随 `device:register` 自动上报给服务端，无需改后端。

## 工程结构

```
app/src/main/java/ai/heysure/agent/
  MainActivity.kt              登录 / 引导开启无障碍 / 授权截屏 / 状态显示
  agent/Settings.kt            SharedPreferences（serverUrl / token / deviceId）
  agent/ServerApi.kt           REST：POST /api/auth/login
  agent/SocketAgent.kt         Socket.IO 客户端 + register + 任务循环（对标 device.ts）
  agent/AgentService.kt        前台服务：持有 socket 与 MediaProjection 授权，保活
  executor/Tool.kt             工具接口 + schema helper
  executor/ToolCatalog.kt      工具目录（tap/swipe/screen/record/...）
  executor/TaskExecutor.kt     校验 allowedTools 并执行
  accessibility/GestureAccessibilityService.kt  注入手势 / 全局动作
  capture/ScreenCaptureManager.kt               截屏 + 录屏
```

## 构建与运行

```bash
# 推荐：用 Android Studio 打开 device/android，它会自动补齐 Gradle Wrapper 并构建/运行到真机。
# 命令行方式（首次需生成 wrapper 脚本/jar，仓库只 pin 了版本 gradle-wrapper.properties）：
cd device/android
gradle wrapper                   # 生成 gradlew / gradle-wrapper.jar（需本机已装 Gradle 8.7）
./gradlew assembleDebug          # 产物 app/build/outputs/apk/debug/
```

首次使用需在手机上完成三步授权：

1. App 内填写**服务器地址 + 账号密码**，点击「登录并连接」。
2. 「开启无障碍」→ 系统设置里启用 HeySure 安卓端（点击/滑动依赖它）。
3. 「授权截屏/录屏」→ 同意系统投屏弹窗（截屏/录屏依赖它）。

授权后会启动前台服务长连，状态栏显示运行中；之后由 Web「作坊」面板把某个 AI 分配给该设备。

## 注意点

- **本 CI/远程环境无法编译/运行 Android**（无 Android SDK、需真机授予无障碍与投屏权限）。
  这里只能完成静态编写，实际行为需在真机验证。
- `minSdk = 26`（Android 8.0）——`dispatchGesture` 与前台服务投屏类型所需。
- Android 14（API 34）要求投屏前台服务声明 `FOREGROUND_SERVICE_MEDIA_PROJECTION` 且
  在 `startForeground` 时带 `mediaProjection` 类型，本工程已处理。
- `build/`、`.gradle/`、`local.properties` 等已在根 `.gitignore` 忽略。
