// Default tool catalog — registers every built-in tool with the registry.
// Imported once for its side effects via executor/index.ts.
//
// 描述规范（中文为主 + 英文术语）：每个工具的 description 说明「用途 + 典型使用
// 场景」，每个参数的 description 说明「含义 + 取值/默认」。这些文案随 agent:register
// 的 toolDefs 上报给服务器，是 AI 在 mcp.list_tools / mcp.describe_tool 中看到的
// 权威说明——服务器不再硬编码桌面工具的描述与 schema。新增工具只需在此追加一条。

import { runCommand } from '../tools/shell'
import { keyboardType, keyboardPress } from '../tools/keyboard'
import {
  mouseMove, mouseClick, mouseDoubleClick, mouseRightClick, mouseScroll, mouseDrag,
} from '../tools/mouse'
import { displayBox, displayClear } from '../tools/display'
import { clipboardGet, clipboardSet } from '../tools/clipboard'
import { windowList, windowFocus, windowClose } from '../tools/window'
import { mouthSpeak } from '../tools/mouth'
import { visionCaptureGlobal, visionCaptureMouse } from '../tools/vision'
import { handsStart, handsStop, handsSnapshot, handsEvents, handsMouse } from '../tools/hands'
import { uiInspect, uiClick } from '../tools/uia'
import { earStart, earStop, earLatest } from '../tools/ear'
import { cardExecute } from './card-replay'
import { registerTools } from './registry'

const OBJ = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: true,
})

registerTools([
  // Shell (cross-platform)
  {
    id: 'shell.run', platform: 'all',
    description: '执行一条 shell 命令并返回输出。默认在 agent 工作区中运行；cwd 可传工作区内相对路径或绝对路径。用途：构建、测试、安装依赖、调用脚本（属高权限操作，请谨慎）。',
    inputSchema: OBJ({
      command: { type: 'string', description: '要执行的命令行。' },
      cwd: { type: 'string', description: '工作目录；相对路径按 agent 工作区解析，也可传绝对路径。' },
      shell: { type: 'string', enum: ['cmd', 'powershell', 'pwsh'], description: 'Windows 下选择命令解释器。默认 cmd；PowerShell 脚本传 powershell。' },
      timeout_ms: { type: 'number', description: '硬超时（毫秒）。' },
    }, ['command']),
    handler: ({ workspaceRoot, args }) => runCommand(workspaceRoot, args),
  },

  // Keyboard (windows-only via robotjs)
  {
    id: 'keyboard.type', platform: 'windows',
    description: '在桌面当前焦点处输入文本（模拟真实键盘）。用途：向任意应用输入文字。场景：在记事本、聊天框、表单等当前光标处打字。',
    inputSchema: OBJ({
      text: { type: 'string', description: '要输入的文本。' },
      delay_ms: { type: 'number', description: '每个字符之间的间隔（毫秒）。' },
    }, ['text']),
    handler: ({ args }) => keyboardType(args),
  },
  {
    id: 'keyboard.press', platform: 'windows',
    description: '按下单个按键或组合键（如 "ctrl+c"、"enter"）。用途：触发快捷键或控制键。场景：复制粘贴、保存、回车确认、Alt+Tab 切换。',
    inputSchema: OBJ({ keys: { type: 'string', description: '按键或用 "+" 连接的组合键，如 "ctrl+shift+esc"。' } }, ['keys']),
    handler: ({ args }) => keyboardPress(args),
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
    handler: ({ args }) => mouseMove(args),
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
    handler: ({ args }) => mouseClick(args),
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
    handler: ({ args }) => mouseDoubleClick(args),
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
    handler: ({ args }) => mouseRightClick(args),
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
    handler: ({ args }) => mouseScroll(args),
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
    handler: ({ args }) => mouseDrag(args),
  },

  // UI Automation — read the desktop accessibility tree (类似桌面版 DOM) and act on
  // real controls instead of guessing pixel coordinates from a screenshot.
  {
    id: 'ui.inspect', platform: 'windows',
    description: '读取当前前台窗口（或按标题匹配的窗口）的 UI Automation 无障碍树，返回每个可交互控件的名称、控件类型、AutomationId、精确包围盒和可执行动作（invoke/toggle/select/expand/value）。用途：在点击前用结构化方式精确定位控件，避免靠截图猜坐标。场景：原生 Win32/WPF/UWP 程序、浏览器、office 等支持无障碍的应用；游戏/自绘 UI/远程桌面读不到时再退回 vision.capture 视觉方案。返回的元素可直接交给 ui.click 点击。',
    inputSchema: OBJ({
      title: { type: 'string', description: '可选：按窗口标题子串匹配目标顶层窗口；不传则使用当前前台窗口。' },
      interactable_only: { type: 'boolean', description: '是否只返回可交互控件（按钮/菜单项/输入框等）。默认 true；传 false 返回更全的元素含静态文本。' },
      max: { type: 'number', description: '最多返回多少个元素。默认 150。' },
      max_depth: { type: 'number', description: '遍历树的最大深度，越大越全但越慢。默认 40。' },
    }),
    handler: ({ args }) => uiInspect(args),
  },
  {
    id: 'ui.click', platform: 'windows',
    description: '按 UI Automation 控件定位并点击，优先用 InvokePattern 直接触发控件（不移动真实光标、不受遮挡/坐标误差影响，最稳），不支持 Invoke 时自动回退到在控件中心做真实鼠标点击。用途：精准点击按钮/菜单项/链接/列表项等。场景：先用 ui.inspect 拿到目标控件的 name/control_type/automation_id 再调用本工具；比 mouse.click 猜坐标准确得多。右键或双击会强制走真实鼠标点击。',
    inputSchema: OBJ({
      title: { type: 'string', description: '可选：目标顶层窗口标题子串；不传则用当前前台窗口。需与 ui.inspect 一致。' },
      name: { type: 'string', description: '控件名称（ui.inspect 返回的 name）。优先精确匹配，无精确匹配时按包含匹配。' },
      automation_id: { type: 'string', description: '控件 AutomationId（ui.inspect 返回的 automation_id），最稳定的定位方式。' },
      control_type: { type: 'string', description: '控件类型，如 Button、MenuItem、CheckBox、ListItem、Hyperlink（ui.inspect 返回的 control_type）。' },
      index: { type: 'number', description: '当 name/control_type 匹配到多个时，选择第几个（从 0 开始）。默认 0。' },
      method: { type: 'string', enum: ['auto', 'invoke', 'mouse'], description: '点击方式：auto（默认，能 Invoke 就 Invoke，否则真实点击）、invoke（强制走无障碍触发）、mouse（强制真实鼠标点击控件中心）。' },
      button: { type: 'string', description: '鼠标键 left 或 right。right 会强制使用真实鼠标点击。默认 left。' },
      double: { type: 'boolean', description: '是否双击（强制使用真实鼠标点击）。默认 false。' },
      max_depth: { type: 'number', description: '遍历树的最大深度。默认 40。' },
    }),
    handler: ({ args }) => uiClick(args),
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
    handler: ({ args }) => displayBox(args),
  },
  {
    id: 'display.clear', platform: 'windows',
    description: '清除当前所有桌面高亮框。用途：移除 display.box 创建的 overlay。场景：任务结束或重新标记前清屏。',
    inputSchema: OBJ({}),
    handler: ({ args }) => displayClear(args),
  },

  // Clipboard (Electron clipboard is cross-platform but our app is Windows-targeted)
  {
    id: 'clipboard.get', platform: 'windows',
    description: '读取系统剪贴板。用途：获取用户/程序刚复制的内容。场景：读取剪贴板里的文本或 HTML 再处理。',
    inputSchema: OBJ({ format: { type: 'string', description: '读取格式：text 或 html。默认 text。' } }),
    handler: ({ args }) => clipboardGet(args),
  },
  {
    id: 'clipboard.set', platform: 'windows',
    description: '把文本写入系统剪贴板。用途：供其他应用粘贴。场景：把生成结果放进剪贴板让用户直接 Ctrl+V。',
    inputSchema: OBJ({ text: { type: 'string', description: '要放入剪贴板的文本。' } }, ['text']),
    handler: ({ args }) => clipboardSet(args),
  },

  // Window management (windows-only — uses PowerShell)
  {
    id: 'window.list', platform: 'windows',
    description: '列出可见的顶层窗口及其标题和进程 PID。用途：了解当前打开了哪些窗口。场景：切换或关闭窗口前先查标题/PID。',
    inputSchema: OBJ({}),
    handler: ({ workspaceRoot, args }) => windowList(workspaceRoot, args),
  },
  {
    id: 'window.focus', platform: 'windows',
    description: '把标题匹配的窗口切换到前台。用途：激活某个应用窗口。场景：在操作前先把目标窗口置顶聚焦。',
    inputSchema: OBJ({ title: { type: 'string', description: '要匹配的窗口标题子串。' } }, ['title']),
    handler: ({ workspaceRoot, args }) => windowFocus(workspaceRoot, args),
  },
  {
    id: 'window.close', platform: 'windows',
    description: '按标题或进程 id 关闭窗口。用途：关掉某个窗口。场景：完成任务后关闭对话框或应用窗口（属写入/变更操作）。',
    inputSchema: OBJ({
      title: { type: 'string', description: '要匹配的窗口标题子串。' },
      hwnd: { type: 'number', description: '要关闭的窗口句柄。优先用于精确关闭 window.list 返回的窗口。' },
      pid: { type: 'number', description: '要关闭其窗口的进程 id。' },
    }),
    handler: ({ workspaceRoot, args }) => windowClose(workspaceRoot, args),
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
    handler: ({ args }) => mouthSpeak(args),
  },
  {
    id: 'vision.capture', platform: 'windows',
    description: '采集整屏画面用于视觉理解，默认只返回完整 base64 图片 dataUrl，不保存到服务器。用途：让 AI「看」屏幕做理解。场景：分析当前界面、识别画面内容；需要留存证据时传 save_to_server:true。',
    inputSchema: OBJ({
      display: { type: 'number', description: '要截图的显示器序号。默认 0。' },
      screen: { type: 'number', description: 'display 的别名。默认 0。' },
      save_to_server: { type: 'boolean', description: '是否把截图保存到服务器并返回服务器路径/URL。默认 false，不保存且保留完整 dataUrl。' },
      upload_to_server: { type: 'boolean', description: 'save_to_server 的兼容别名。默认 false。' },
      path: { type: 'string', description: '可选本机保存路径；传入时会在桌面端本地写入该 PNG 文件。' },
      save_local: { type: 'boolean', description: '是否保存到桌面端本机临时目录。默认 false。' },
    }),
    handler: ({ args }) => visionCaptureGlobal(args),
  },
  {
    id: 'vision.capture_mouse', platform: 'windows',
    description: '采集鼠标光标周围的一块区域用于视觉理解，默认只返回完整 base64 图片 dataUrl，不保存到服务器。用途：聚焦看光标附近。场景：识别光标所指的小图标、局部内容；需要留存证据时传 save_to_server:true。',
    inputSchema: OBJ({
      radius: { type: 'number', description: '采集框的半径（像素）。默认 50。' },
      width: { type: 'number', description: '采集框宽度（像素）。' },
      height: { type: 'number', description: '采集框高度（像素）。' },
      save_to_server: { type: 'boolean', description: '是否把截图保存到服务器并返回服务器路径/URL。默认 false，不保存且保留完整 dataUrl。' },
      upload_to_server: { type: 'boolean', description: 'save_to_server 的兼容别名。默认 false。' },
      path: { type: 'string', description: '可选本机保存路径；传入时会在桌面端本地写入该 PNG 文件。' },
      save_local: { type: 'boolean', description: '是否保存到桌面端本机临时目录。默认 false。' },
    }),
    handler: ({ args }) => visionCaptureMouse(args),
  },
  {
    id: 'hands.start', platform: 'windows',
    description: '开始采集桌面的实时输入（鼠标/键盘）事件。用途：监听用户操作。场景：观察并学习用户的操作序列。',
    inputSchema: OBJ({ interval_ms: { type: 'number', description: '采样间隔（毫秒）。默认 120。' } }),
    handler: ({ args }) => handsStart(args),
  },
  {
    id: 'hands.stop', platform: 'windows',
    description: '停止采集实时输入事件。用途：结束监听。场景：采集完成后关闭以释放资源。',
    inputSchema: OBJ({}),
    handler: () => handsStop(),
  },
  {
    id: 'hands.snapshot', platform: 'windows',
    description: '返回当前输入状态快照（鼠标位置、按下的键）。用途：取一次即时输入状态。场景：判断此刻鼠标在哪、哪些键被按住。',
    inputSchema: OBJ({}),
    handler: () => handsSnapshot(),
  },
  {
    id: 'hands.events', platform: 'windows',
    description: '返回 id 大于给定值的缓冲输入事件。用途：增量拉取输入事件。场景：轮询自上次以来发生的鼠标/键盘事件。',
    inputSchema: OBJ({ since_id: { type: 'number', description: '只返回 id 大于该值的事件。默认 0。' } }),
    handler: ({ args }) => handsEvents(args),
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
    handler: ({ args }) => handsMouse(args),
  },
  {
    id: 'ear.start', platform: 'windows',
    description: '开始监听麦克风进行语音识别。用途：开启听觉输入。场景：等待并转写用户的语音指令。',
    inputSchema: OBJ({}),
    handler: () => earStart(),
  },
  {
    id: 'ear.stop', platform: 'windows',
    description: '停止监听麦克风。用途：结束听觉输入。场景：语音交互结束后关闭麦克风。',
    inputSchema: OBJ({}),
    handler: () => earStop(),
  },
  {
    id: 'ear.latest', platform: 'windows',
    description: '返回最近一次识别到的语音转写结果。用途：取最新听到的内容。场景：读取用户刚说的话再做处理。',
    inputSchema: OBJ({}),
    handler: () => earLatest(),
  },

  // Skill-card local replay（S2，沉淀技能卡片 §4.2/§4.3）
  {
    id: 'card.execute', platform: 'windows',
    description: '在本端一口气重放一张已沉淀的技能卡片（确定性回放，不逐步过 LLM）。用途：复用已验证的动作序列。场景：先用 skill_card.prepare_execution 在服务端做权限交集+参数代入拿到 resolved 卡片，再用本工具重放；任一步定位歧义/断言不过会停在该步并回传失败现场（failed_step + 期望/实际 + 截图）供 AI 改卡并从失败步续跑。',
    inputSchema: OBJ({
      resolved: { type: 'object', description: 'skill_card.prepare_execution 返回的 resolved：已代入参数的 steps + app_scope + pre/postconditions。' },
      card: { type: 'object', description: 'resolved 的别名，可直接传卡片主体。' },
      resume_from: { type: 'number', description: '从该步号续跑（自愈用），小于此步号的步骤跳过。默认 0。' },
      dry_run: { type: 'boolean', description: '只走流程不真正执行动作，用于 teach 卡「查看学习效果」（§4.0）。默认 false。' },
    }),
    handler: ({ workspaceRoot, args }) => cardExecute({ workspaceRoot, args }),
  },
])
