"use strict";
// Default tool catalog — registers every built-in tool with the registry.
// Imported once for its side effects via executor/index.ts.
//
// 描述规范（中文为主 + 英文术语）：每个工具的 description 说明「用途 + 典型使用
// 场景」，每个参数的 description 说明「含义 + 取值/默认」。这些文案随 agent:register
// 的 toolDefs 上报给服务器，是 AI 在 mcp.list_tools / mcp.describe_tool 中看到的
// 权威说明——服务器不再硬编码桌面工具的描述与 schema。新增工具只需在此追加一条。
Object.defineProperty(exports, "__esModule", { value: true });
const filesystem_1 = require("../tools/filesystem");
const shell_1 = require("../tools/shell");
const git_1 = require("../tools/git");
const keyboard_1 = require("../tools/keyboard");
const mouse_1 = require("../tools/mouse");
const screen_1 = require("../tools/screen");
const display_1 = require("../tools/display");
const clipboard_1 = require("../tools/clipboard");
const window_1 = require("../tools/window");
const process_1 = require("../tools/process");
const mouth_1 = require("../tools/mouth");
const vision_1 = require("../tools/vision");
const hands_1 = require("../tools/hands");
const ear_1 = require("../tools/ear");
const registry_1 = require("./registry");
const OBJ = (properties, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: true,
});
(0, registry_1.registerTools)([
    // Filesystem (cross-platform)
    {
        id: 'fs.list', platform: 'all',
        description: '列出 agent 工作区某个路径下的文件和子目录。用途：浏览工作区结构。场景：操作文件前先看目录里有什么。',
        inputSchema: OBJ({ path: { type: 'string', description: '相对工作区根目录的目录路径。默认 "."。' } }),
        handler: ({ workspaceRoot, args }) => (0, filesystem_1.listFiles)(workspaceRoot, args),
    },
    {
        id: 'fs.read', platform: 'all',
        description: '读取 agent 工作区中某个文件的内容。用途：查看文件正文。场景：读取配置、日志、代码或数据文件。',
        inputSchema: OBJ({
            path: { type: 'string', description: '相对工作区根目录的文件路径。' },
            maxBytes: { type: 'number', description: '截断前最多读取的字节数。' },
        }, ['path']),
        handler: ({ workspaceRoot, args }) => (0, filesystem_1.readFile)(workspaceRoot, args),
    },
    {
        id: 'fs.write', platform: 'all',
        description: '在 agent 工作区中创建或覆盖一个文件。用途：写入文件内容（属写入操作）。场景：保存生成结果、写配置、落地导出数据。',
        inputSchema: OBJ({
            path: { type: 'string', description: '相对工作区根目录的文件路径。' },
            content: { type: 'string', description: '要写入的完整文件内容。' },
        }, ['path', 'content']),
        handler: ({ workspaceRoot, args }) => (0, filesystem_1.writeFile)(workspaceRoot, args),
    },
    // Shell & git (cross-platform)
    {
        id: 'shell.run', platform: 'all',
        description: '在 agent 工作区中执行一条 shell 命令并返回输出。用途：运行命令行工具。场景：构建、测试、安装依赖、调用脚本（属高权限操作，请谨慎）。',
        inputSchema: OBJ({
            command: { type: 'string', description: '要执行的命令行。' },
            cwd: { type: 'string', description: '相对工作区根目录的工作目录。' },
            timeout_ms: { type: 'number', description: '硬超时（毫秒）。' },
        }, ['command']),
        handler: ({ workspaceRoot, args }) => (0, shell_1.runCommand)(workspaceRoot, args),
    },
    {
        id: 'git.diff', platform: 'all',
        description: '查看工作区（或某个子目录）当前的 git diff。用途：了解代码改动。场景：提交前检查改了什么、向用户汇报变更。',
        inputSchema: OBJ({ cwd: { type: 'string', description: '相对工作区根目录的仓库目录。' } }),
        handler: ({ workspaceRoot, args }) => (0, git_1.gitDiff)(workspaceRoot, args),
    },
    // Keyboard (windows-only via robotjs)
    {
        id: 'keyboard.type', platform: 'windows',
        description: '在桌面当前焦点处输入文本（模拟真实键盘）。用途：向任意应用输入文字。场景：在记事本、聊天框、表单等当前光标处打字。',
        inputSchema: OBJ({
            text: { type: 'string', description: '要输入的文本。' },
            delay_ms: { type: 'number', description: '每个字符之间的间隔（毫秒）。' },
        }, ['text']),
        handler: ({ args }) => (0, keyboard_1.keyboardType)(args),
    },
    {
        id: 'keyboard.press', platform: 'windows',
        description: '按下单个按键或组合键（如 "ctrl+c"、"enter"）。用途：触发快捷键或控制键。场景：复制粘贴、保存、回车确认、Alt+Tab 切换。',
        inputSchema: OBJ({ keys: { type: 'string', description: '按键或用 "+" 连接的组合键，如 "ctrl+shift+esc"。' } }, ['keys']),
        handler: ({ args }) => (0, keyboard_1.keyboardPress)(args),
    },
    // Mouse (windows-only via robotjs)
    {
        id: 'mouse.move', platform: 'windows',
        description: '把鼠标光标移动到屏幕坐标。用途：定位光标。场景：移动到某个位置后再点击或悬停。',
        inputSchema: OBJ({
            x: { type: 'number', description: '目标 X 坐标（像素）。' },
            y: { type: 'number', description: '目标 Y 坐标（像素）。' },
            smooth: { type: 'boolean', description: '是否平滑移动。默认 true。' },
            speed: { type: 'number', description: '平滑移动速度，表示每步大约移动的像素数；越大越快。默认 100。' },
            interval_ms: { type: 'number', description: '平滑移动每步间隔毫秒数；越小越快。默认 3。' },
            jitter: { type: 'boolean', description: '是否加入轻微拟人抖动。默认 true。' },
        }, ['x', 'y']),
        handler: ({ args }) => (0, mouse_1.mouseMove)(args),
    },
    {
        id: 'mouse.click', platform: 'windows',
        description: '点击鼠标，可先移动到指定坐标。用途：在桌面任意位置点击。场景：点桌面图标、应用按钮、任务栏。',
        inputSchema: OBJ({
            x: { type: 'number', description: '点击前移动到的 X 坐标（像素）。' },
            y: { type: 'number', description: '点击前移动到的 Y 坐标（像素）。' },
            button: { type: 'string', description: '鼠标键：left、right 或 middle。默认 left。' },
            speed: { type: 'number', description: '移动到点击点的平滑速度；越大越快。默认 100。' },
            interval_ms: { type: 'number', description: '移动到点击点时每步间隔毫秒数。默认 3。' },
        }),
        handler: ({ args }) => (0, mouse_1.mouseClick)(args),
    },
    {
        id: 'mouse.double_click', platform: 'windows',
        description: '双击鼠标，可先移动到指定坐标。用途：需要双击才生效的操作。场景：双击打开文件/图标、双击选词。',
        inputSchema: OBJ({
            x: { type: 'number', description: '双击前移动到的 X 坐标（像素）。' },
            y: { type: 'number', description: '双击前移动到的 Y 坐标（像素）。' },
            speed: { type: 'number', description: '移动到双击点的平滑速度；越大越快。默认 100。' },
            interval_ms: { type: 'number', description: '移动到双击点时每步间隔毫秒数。默认 3。' },
        }),
        handler: ({ args }) => (0, mouse_1.mouseDoubleClick)(args),
    },
    {
        id: 'mouse.right_click', platform: 'windows',
        description: '右键单击鼠标，可先移动到指定坐标。用途：打开右键菜单。场景：在桌面或应用中调出上下文菜单。',
        inputSchema: OBJ({
            x: { type: 'number', description: '右键前移动到的 X 坐标（像素）。' },
            y: { type: 'number', description: '右键前移动到的 Y 坐标（像素）。' },
            speed: { type: 'number', description: '移动到右键点的平滑速度；越大越快。默认 100。' },
            interval_ms: { type: 'number', description: '移动到右键点时每步间隔毫秒数。默认 3。' },
        }),
        handler: ({ args }) => (0, mouse_1.mouseRightClick)(args),
    },
    {
        id: 'mouse.scroll', platform: 'windows',
        description: '在当前或指定位置滚动鼠标滚轮。用途：滚动桌面应用内容。场景：在不支持页面滚动工具的原生应用里上下滚动。',
        inputSchema: OBJ({
            x: { type: 'number', description: '滚动前移动到的 X 坐标（像素）。' },
            y: { type: 'number', description: '滚动前移动到的 Y 坐标（像素）。' },
            amount: { type: 'number', description: '滚动步数。默认 3。' },
            direction: { type: 'string', description: '滚动方向：up 或 down。默认 down。' },
        }),
        handler: ({ args }) => (0, mouse_1.mouseScroll)(args),
    },
    {
        id: 'mouse.drag', platform: 'windows',
        description: '在一点按下、拖到另一点再松开。用途：桌面拖放。场景：拖动文件、拖动窗口、拖动滑块。',
        inputSchema: OBJ({
            from_x: { type: 'number', description: '起点 X 坐标（像素）。' },
            from_y: { type: 'number', description: '起点 Y 坐标（像素）。' },
            to_x: { type: 'number', description: '终点 X 坐标（像素）。' },
            to_y: { type: 'number', description: '终点 Y 坐标（像素）。' },
            speed: { type: 'number', description: '平滑拖动速度，表示每步大约移动的像素数；越大越快。默认 100。' },
            interval_ms: { type: 'number', description: '平滑拖动每步间隔毫秒数；越小越快。默认 3。' },
        }, ['from_x', 'from_y', 'to_x', 'to_y']),
        handler: ({ args }) => (0, mouse_1.mouseDrag)(args),
    },
    // Display overlay (windows-only via Electron transparent BrowserWindow)
    {
        id: 'display.box', platform: 'windows',
        description: '在桌面最上层短暂显示矩形框。用途：高亮 AI 识别到的屏幕区域。场景：标记 OCR/视觉定位到的按钮、文字、图片区域。',
        inputSchema: OBJ({
            top: { type: 'number', description: '矩形框左上角 Y 坐标（像素）。' },
            left: { type: 'number', description: '矩形框左上角 X 坐标（像素）。' },
            x: { type: 'number', description: 'left 的别名。' },
            y: { type: 'number', description: 'top 的别名。' },
            width: { type: 'number', description: '矩形框宽度（像素）。' },
            height: { type: 'number', description: '矩形框高度（像素）。' },
            duration: { type: 'number', description: '显示持续时间（毫秒）。默认 1000。' },
            duration_ms: { type: 'number', description: 'duration 的别名。' },
            color: { type: 'string', description: '主框颜色。默认 red。' },
            label: { type: 'string', description: '可选标签，会显示在框左上方。' },
            sub_boxes: { type: 'array', description: '子框列表。可传 BoxDisplay.py 风格的四点数组，坐标相对主框；也可传 {left, top, width, height, color}。' },
        }, ['width', 'height']),
        handler: ({ args }) => (0, display_1.displayBox)(args),
    },
    {
        id: 'display.clear', platform: 'windows',
        description: '清除当前所有桌面高亮框。用途：移除 display.box 创建的 overlay。场景：任务结束或重新标记前清屏。',
        inputSchema: OBJ({}),
        handler: ({ args }) => (0, display_1.displayClear)(args),
    },
    // Screen (windows-only via Electron desktopCapturer + robotjs)
    {
        id: 'screen.capture', platform: 'windows',
        description: '对某个桌面显示器整屏截图。默认服务器会把图片存到用户的 Screenshots 工作区目录。用途：让 AI 看见整个屏幕。场景：核对桌面状态、保存当前画面。',
        inputSchema: OBJ({
            display: { type: 'number', description: '要截图的显示器序号。默认 0。' },
            screen: { type: 'number', description: 'display 的别名。' },
            upload_to_server: { type: 'boolean', description: '默认 true：存到服务器并返回其工作区路径。' },
        }),
        handler: ({ args }) => (0, screen_1.screenCapture)(args),
    },
    {
        id: 'screen.capture_region', platform: 'windows',
        description: '截取桌面上的一块矩形区域。用途：只看屏幕的某一部分。场景：截取某个窗口区域、某块状态信息。',
        inputSchema: OBJ({
            x: { type: 'number', description: '区域左上角 X 坐标（像素）。' },
            y: { type: 'number', description: '区域左上角 Y 坐标（像素）。' },
            width: { type: 'number', description: '区域宽度（像素）。' },
            height: { type: 'number', description: '区域高度（像素）。' },
            upload_to_server: { type: 'boolean', description: '默认 true：存到服务器并返回其工作区路径。' },
        }, ['width', 'height']),
        handler: ({ args }) => (0, screen_1.screenCaptureRegion)(args),
    },
    {
        id: 'screen.info', platform: 'windows',
        description: '列出桌面的显示器及其分辨率。用途：了解屏幕布局。场景：多屏环境下确定要操作哪块屏、换算坐标。',
        inputSchema: OBJ({}),
        handler: ({ args }) => (0, screen_1.screenInfo)(args),
    },
    // Clipboard (Electron clipboard is cross-platform but our app is Windows-targeted)
    {
        id: 'clipboard.get', platform: 'windows',
        description: '读取系统剪贴板。用途：获取用户/程序刚复制的内容。场景：读取剪贴板里的文本或 HTML 再处理。',
        inputSchema: OBJ({ format: { type: 'string', description: '读取格式：text 或 html。默认 text。' } }),
        handler: ({ args }) => (0, clipboard_1.clipboardGet)(args),
    },
    {
        id: 'clipboard.set', platform: 'windows',
        description: '把文本写入系统剪贴板。用途：供其他应用粘贴。场景：把生成结果放进剪贴板让用户直接 Ctrl+V。',
        inputSchema: OBJ({ text: { type: 'string', description: '要放入剪贴板的文本。' } }, ['text']),
        handler: ({ args }) => (0, clipboard_1.clipboardSet)(args),
    },
    // Window management (windows-only — uses PowerShell)
    {
        id: 'window.list', platform: 'windows',
        description: '列出可见的顶层窗口及其标题和进程 PID。用途：了解当前打开了哪些窗口。场景：切换或关闭窗口前先查标题/PID。',
        inputSchema: OBJ({}),
        handler: ({ workspaceRoot, args }) => (0, window_1.windowList)(workspaceRoot, args),
    },
    {
        id: 'window.focus', platform: 'windows',
        description: '把标题匹配的窗口切换到前台。用途：激活某个应用窗口。场景：在操作前先把目标窗口置顶聚焦。',
        inputSchema: OBJ({ title: { type: 'string', description: '要匹配的窗口标题子串。' } }, ['title']),
        handler: ({ workspaceRoot, args }) => (0, window_1.windowFocus)(workspaceRoot, args),
    },
    {
        id: 'window.close', platform: 'windows',
        description: '按标题或进程 id 关闭窗口。用途：关掉某个窗口。场景：完成任务后关闭对话框或应用窗口（属写入/变更操作）。',
        inputSchema: OBJ({
            title: { type: 'string', description: '要匹配的窗口标题子串。' },
            hwnd: { type: 'number', description: '要关闭的窗口句柄。优先用于精确关闭 window.list 返回的窗口。' },
            pid: { type: 'number', description: '要关闭其窗口的进程 id。' },
        }),
        handler: ({ workspaceRoot, args }) => (0, window_1.windowClose)(workspaceRoot, args),
    },
    // Process management (windows-only — uses PowerShell)
    {
        id: 'process.list', platform: 'windows',
        description: '列出正在运行的进程，可按名称过滤。用途：查看进程状态。场景：确认某程序是否在运行、找到要结束的进程。',
        inputSchema: OBJ({ filter: { type: 'string', description: '按进程名子串过滤。' } }),
        handler: ({ workspaceRoot, args }) => (0, process_1.processList)(workspaceRoot, args),
    },
    {
        id: 'process.kill', platform: 'windows',
        description: '按名称或进程 id 结束一个进程。用途：终止程序（属高风险操作）。场景：关闭卡死或多余的进程。',
        inputSchema: OBJ({
            name: { type: 'string', description: '要结束的进程名。' },
            pid: { type: 'number', description: '要结束的进程 id。' },
        }),
        handler: ({ workspaceRoot, args }) => (0, process_1.processKill)(workspaceRoot, args),
    },
    // AI voice / vision / hands / ear helpers (windows-only)
    {
        id: 'speech.speak', platform: 'windows',
        description: '用桌面的文字转语音 TTS 把文本朗读出来。用途：语音输出。场景：语音播报提醒、与用户进行语音交互。',
        inputSchema: OBJ({
            text: { type: 'string', description: '要朗读的文本。' },
            rate: { type: 'number', description: '语速，-10 到 10。' },
            volume: { type: 'number', description: '音量 0-100。' },
            voice: { type: 'string', description: '使用的语音名称。' },
        }, ['text']),
        handler: ({ args }) => (0, mouth_1.mouthSpeak)(args),
    },
    {
        id: 'vision.capture', platform: 'windows',
        description: '采集整屏画面用于视觉理解。用途：让 AI「看」屏幕做理解。场景：分析当前界面、识别画面内容。',
        inputSchema: OBJ({}),
        handler: ({ args }) => (0, vision_1.visionCaptureGlobal)(args),
    },
    {
        id: 'vision.capture_mouse', platform: 'windows',
        description: '采集鼠标光标周围的一块区域用于视觉理解。用途：聚焦看光标附近。场景：识别光标所指的小图标、局部内容。',
        inputSchema: OBJ({
            radius: { type: 'number', description: '采集框的半径（像素）。默认 50。' },
            width: { type: 'number', description: '采集框宽度（像素）。' },
            height: { type: 'number', description: '采集框高度（像素）。' },
        }),
        handler: ({ args }) => (0, vision_1.visionCaptureMouse)(args),
    },
    {
        id: 'hands.start', platform: 'windows',
        description: '开始采集桌面的实时输入（鼠标/键盘）事件。用途：监听用户操作。场景：观察并学习用户的操作序列。',
        inputSchema: OBJ({ interval_ms: { type: 'number', description: '采样间隔（毫秒）。默认 120。' } }),
        handler: ({ args }) => (0, hands_1.handsStart)(args),
    },
    {
        id: 'hands.stop', platform: 'windows',
        description: '停止采集实时输入事件。用途：结束监听。场景：采集完成后关闭以释放资源。',
        inputSchema: OBJ({}),
        handler: () => (0, hands_1.handsStop)(),
    },
    {
        id: 'hands.snapshot', platform: 'windows',
        description: '返回当前输入状态快照（鼠标位置、按下的键）。用途：取一次即时输入状态。场景：判断此刻鼠标在哪、哪些键被按住。',
        inputSchema: OBJ({}),
        handler: () => (0, hands_1.handsSnapshot)(),
    },
    {
        id: 'hands.events', platform: 'windows',
        description: '返回 id 大于给定值的缓冲输入事件。用途：增量拉取输入事件。场景：轮询自上次以来发生的鼠标/键盘事件。',
        inputSchema: OBJ({ since_id: { type: 'number', description: '只返回 id 大于该值的事件。默认 0。' } }),
        handler: ({ args }) => (0, hands_1.handsEvents)(args),
    },
    {
        id: 'hands.mouse', platform: 'windows',
        description: '通过实时输入通道回放或注入一次鼠标动作。用途：以事件流方式驱动鼠标。场景：复现录制的鼠标操作。',
        inputSchema: OBJ({
            x: { type: 'number', description: '动作 X 坐标（像素）。' },
            y: { type: 'number', description: '动作 Y 坐标（像素）。' },
            button: { type: 'string', description: '鼠标键：left/right/middle。' },
            action: { type: 'string', description: '动作类型，如 move/down/up/click。' },
        }),
        handler: ({ args }) => (0, hands_1.handsMouse)(args),
    },
    {
        id: 'ear.start', platform: 'windows',
        description: '开始监听麦克风进行语音识别。用途：开启听觉输入。场景：等待并转写用户的语音指令。',
        inputSchema: OBJ({}),
        handler: () => (0, ear_1.earStart)(),
    },
    {
        id: 'ear.stop', platform: 'windows',
        description: '停止监听麦克风。用途：结束听觉输入。场景：语音交互结束后关闭麦克风。',
        inputSchema: OBJ({}),
        handler: () => (0, ear_1.earStop)(),
    },
    {
        id: 'ear.latest', platform: 'windows',
        description: '返回最近一次识别到的语音转写结果。用途：取最新听到的内容。场景：读取用户刚说的话再做处理。',
        inputSchema: OBJ({}),
        handler: () => (0, ear_1.earLatest)(),
    },
]);
