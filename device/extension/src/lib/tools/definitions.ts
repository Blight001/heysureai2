// tools/definitions.ts — pure constants: search engines + MCP tool schemas.
// No runtime dependencies; safe to import from any module.
//
// 描述规范（中文为主 + 英文术语）：每个工具的 description 说明「用途 + 典型使用
// 场景」，每个参数的 description 说明「含义 + 取值/默认」。这些文案随 device:register
// 的 toolDefs 上报给服务器，是 AI 在 mcp.list_tools / mcp.describe_tool 中看到的
// 权威说明——服务器不再硬编码浏览器工具的描述与 schema。
//
// 分类：工具按 BROWSER_TOOL_CATEGORIES 归到 5 个大类（导航/观察/交互/数据/状态）。
// 这是分组的唯一来源——popup、服务器、Web 端都应按它归类，不要再各写一份名单。
//
// 状态管理类（tab/cookie/storage/session/profile/history）此前按「资源 × 动作」拆成
// 一堆同质工具，现在收敛为「单工具 + action 参数」。在此基础上进一步聚合：
//   · browser_action —— 把点击/双击/右键/滚动/输入文本/键盘按键这些「页面交互」
//     动作合并为单工具 + action 参数（click/double_click/right_click/scroll/type/press_key）。
//   · browser_tab    —— 把「页面级操作」并入标签页管理：在原 list/open/close 之外
//     新增 navigate（跳转 URL）、back/forward（前进后退），即「获取已开页面 + 跳转 +
//     前进后退」一站式。
// 旧的独立工具名（browser_click / browser_navigate / browser_history …）仍可被调用，
// 经 browser.ts 的 LEGACY_ALIASES 翻译到合并后的「工具 + action」形式，行为不变。
//
// 感知精简：新增 browser_observe 作为「点击前的主感知」——只返回用户当前能看到、未被
// 遮挡的可交互元素（带编号 id + 中心坐标），配合 browser_screenshot 形成「看图按编号点」
// 的稳定闭环。同时把若干低频/重叠的观察工具（find_text / performance / network_log /
// iframe_list / profile）从对 AI 暴露的列表中移除，收窄工具面、减少信息模糊；它们的
// 实现仍保留在 browser.ts 的 HANDLERS 中，旧的直接/兼容调用不受影响。

import { AIToolDef } from '../types'

// ── Search engine registry ────────────────────────────────────────────────
export const SEARCH_ENGINES: Record<string, string> = {
  google:        'https://www.google.com/search?q=',
  bing:          'https://www.bing.com/search?q=',
  duckduckgo:    'https://duckduckgo.com/?q=',
  baidu:         'https://www.baidu.com/s?wd=',
  github:        'https://github.com/search?q=',
  youtube:       'https://www.youtube.com/results?search_query=',
  wikipedia:     'https://en.wikipedia.org/wiki/Special:Search?search=',
  stackoverflow: 'https://stackoverflow.com/search?q=',
  npm:           'https://www.npmjs.com/search?q=',
  pypi:          'https://pypi.org/search/?q=',
  mdn:           'https://developer.mozilla.org/en-US/search?q=',
}

// ── Tool definitions (MCP / Anthropic tool-use format) ────────────────────
// 顺序即展示顺序，已按分类编排（见文件底部 BROWSER_TOOL_CATEGORIES）。
export const BROWSER_TOOLS: AIToolDef[] = [
  // ───── 导航与搜索 ─────────────────────────────────────────────────────
  // 注意：跳转 URL（navigate）、前进/后退（back/forward）、列出已打开标签（list）等
  // 「页面级操作」已并入 browser_tab（见文件下方「浏览器状态/标签页」）。
  {
    name: 'browser_search',
    description: '用主流搜索引擎检索网络。用途：在浏览器内发起一次站点搜索。场景：用 Google/Bing/百度等查资料；注意这会真正打开搜索结果页（与服务器端 workspace.search 的纯数据检索不同）。',
    input_schema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: '搜索关键词。' },
        engine: {
          type: 'string',
          enum: Object.keys(SEARCH_ENGINES),
          description: '搜索引擎，默认 google；可选 bing、baidu、duckduckgo、github 等。',
        },
      },
      required: ['query'],
    },
  },

  // ───── 页面观察 ───────────────────────────────────────────────────────
  {
    name: 'browser_observe',
    description: '感知当前视口里「用户能看到且可点击」的元素：只返回最顶层、未被遮挡的可交互元素（按钮/链接/输入框/下拉/菜单项等），每个带编号 id、角色 role、文本和中心坐标 center，并默认在页面上画出对应编号标记。用途：作为点击/输入前的首选观察手段，配合 browser_screenshot 形成「看图—按编号点击」闭环，避免点到背景或被弹窗遮挡的元素。场景：操作任意元素前先 observe，再用 browser_click {ref:id} 精确点击；页面变化（滚动/弹窗/路由切换）后重新 observe 以刷新编号。',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多返回的可交互元素数。默认 120，最大 200。' },
        mark:  { type: 'boolean', description: '是否在页面上绘制编号标记，便于随后截图查看。默认 true；传 false 仅返回列表并清除已有标记。标记仅为视觉叠加，不影响 get_content/截图以外的取数，也不拦截点击。' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: '对当前标签页截图：可截可视区、整页、某个 CSS/文本匹配的元素，或一块矩形区域，默认返回完整 base64 图片 dataUrl，并保存到服务器用于发送给用户；传 send_to_user:false 可只给 AI 使用（截图被禁用或无权限时返回可读的错误说明）。用途：让 AI「看见」页面。场景：核对页面状态、在无法读取文本时改用视觉理解。',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '要截图的元素 CSS selector。' },
        text: { type: 'string', description: '当不传 selector 时，用可见文本定位要截图的元素。' },
        full_page: { type: 'boolean', description: '截取整个可滚动页面。' },
        x: { type: 'number', description: '区域左上角 X 坐标；除非 coordinate_space 设为 page，否则按视口坐标。' },
        y: { type: 'number', description: '区域左上角 Y 坐标；除非 coordinate_space 设为 page，否则按视口坐标。' },
        width: { type: 'number', description: '区域宽度（CSS 像素）。' },
        height: { type: 'number', description: '区域高度（CSS 像素）。' },
        clip: { type: 'object', description: '区域对象写法：{x,y,width,height,coordinate_space?}，与 x/y/width/height 二选一。' },
        coordinate_space: { type: 'string', enum: ['viewport', 'page'], description: 'x/y/clip 的坐标系：viewport 视口或 page 整页。默认 viewport。' },
        margin: { type: 'number', description: '按 selector/text 截元素时，向四周扩展的额外 CSS 像素。' },
        scroll_into_view: { type: 'boolean', description: '测量前先把目标元素滚动进视口。默认 true。' },
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: '图片格式。默认 png。' },
        quality: { type: 'number', description: 'JPEG/WebP 质量，0-100。' },
        scale: { type: 'number', description: 'CDP 截图的缩放比例。默认 1。' },
        max_area: { type: 'number', description: '允许的最大截图面积（CSS 像素）。默认 25000000。' },
        retries: { type: 'number', description: '可视区截图遇到活动标签/限流等临时失败时的重试次数。默认 1。' },
        timeout_ms: { type: 'number', description: '单阶段截图总超时（毫秒）。可视截图默认 8000，CDP 默认 12000。' },
        visible_timeout_ms: { type: 'number', description: 'chrome.tabs.captureVisibleTab 的超时（毫秒）。默认 8000。' },
        cdp_timeout_ms: { type: 'number', description: '每条 Chrome DevTools Protocol 截图命令的超时（毫秒）。默认 12000。' },
        content_timeout_ms: { type: 'number', description: '在页面中测量 selector/text 目标的超时（毫秒）。默认 5000。' },
        max_data_url_chars: { type: 'number', description: '经 Socket.IO 返回的 data URL 最大长度。默认 8000000。' },
        allow_large_data_url: { type: 'boolean', description: '允许返回超过 max_data_url_chars 的截图。默认 false。' },
        send_to_user: { type: 'boolean', description: '是否把截图通过当前 AI 的机器人发送给用户。默认 true；传 false 时只返回给 AI，不主动发送。' },
        bot_send_to_user: { type: 'boolean', description: 'send_to_user 的兼容别名。默认 true。' },
        deliver_to_user: { type: 'boolean', description: 'send_to_user 的兼容别名。默认 true。' },
        save_to_server: { type: 'boolean', description: '是否把截图保存到服务器并返回服务器路径/URL。默认跟随 send_to_user；send_to_user:true 时会自动保存。' },
        upload_to_server: { type: 'boolean', description: 'save_to_server 的兼容别名。默认跟随 send_to_user。' },
        task_timeout_ms: { type: 'number', description: '本次截图任务在端点 agent 上的硬超时（毫秒）。默认 35000。' },
        fallback_visible: { type: 'boolean', description: '元素/区域/整页截图时，若精确 CDP 截图失败则回退为可视区截图。默认 false。' },
      },
    },
  },
  {
    name: 'browser_get_content',
    description: '读取当前页面的可见文本、URL、标题、链接、meta 信息和归一化条目。用途：以文本方式理解页面内容。场景：抓取文章正文、读取列表、在不截图时获取页面信息。',
    input_schema: {
      type: 'object',
      properties: {
        selector:     { type: 'string',  description: '只取该 CSS selector 范围内的内容。默认 body。' },
        include_html: { type: 'boolean', description: '同时返回（截断后的）原始 HTML。' },
        max_chars:    { type: 'number',  description: '返回可见文本的最大字符数。默认 8000，最大 50000。需要长正文时再调大，避免信息过载。' },
      },
    },
  },
  {
    name: 'browser_dom_snapshot',
    description: '返回结构化的 DOM 树快照，作为截图被禁用或不可用时的文本替代方案。用途：以层级结构理解页面。场景：分析复杂布局、定位元素、为后续操作找 selector。',
    input_schema: {
      type: 'object',
      properties: {
        selector:  { type: 'string',  description: '只快照该 CSS selector 子树。默认整页。' },
        max_depth: { type: 'number',  description: 'DOM 树最大遍历深度。' },
        max_nodes: { type: 'number',  description: '返回的最大节点数。' },
        trace:     { type: 'boolean', description: '失败时返回结构化的错误诊断信息。' },
      },
    },
  },
  {
    name: 'browser_page_info',
    description: '获取你当前在页面上的位置信息：滚动位置（scrollY、百分比、是否到顶/到底）、视口尺寸、整页高度、当前小节标题、视口内所有标题、元素计数。用途：自我定位。场景：滚动或交互前后调用，确认落点和页面结构。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_find_popups',
    description: '检测页面上可见的弹窗、模态框、对话框、抽屉、遮罩以及它们可能的关闭按钮。用途：发现挡住操作的弹层。场景：自动化卡住时先排查弹窗，再决定如何关闭。',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多返回的弹窗数。默认 10。' },
      },
    },
  },

  // ───── 页面交互 ───────────────────────────────────────────────────────
  {
    name: 'browser_action',
    description: '页面交互聚合工具：用 action 指定要做的动作——点击 click（单击）、双击 double_click、右键 right_click、滚动 scroll、输入文本 type、键盘按键 press_key。各动作的参数与原 browser_click/double_click/right_click/scroll/type/press_key 一致，按 action 取用对应字段即可。\n' +
      '· click：派发完整指针+鼠标事件序列，兼容自定义组件；定位优先级 ref（browser_observe 编号，最稳）> selector > text > 坐标；非坐标点击会先做遮挡检测，被弹窗/遮罩盖住时返回 occluded 诊断（需穿透点击传 force:true）。\n' +
      '· double_click / right_click：双击、右键（上下文菜单），用 selector / text / 坐标定位。\n' +
      '· scroll：滚动页面，返回滚动后的位置、移动像素数与进入视野的小节/标题。\n' +
      '· type：向 input/textarea 输入文本（单字段；多字段用 browser_fill_form）。\n' +
      '· press_key：在焦点元素或指定 selector 上按键，可带 Ctrl/Shift/Alt/Meta 修饰键。\n' +
      '用途：统一的点击/滚动/输入/键盘入口。场景：先 browser_observe 拿到编号，再 browser_action {action:"click", ref:id} 点击；输入用 {action:"type"}；快捷键用 {action:"press_key"}。',
    input_schema: {
      type: 'object',
      properties: {
        action:      { type: 'string', enum: ['click', 'double_click', 'right_click', 'scroll', 'type', 'press_key'], description: '要执行的交互动作。' },
        // 通用定位（click/double_click/right_click 用；type/press_key 可用 selector 聚焦）
        ref:         { type: 'number',  description: 'action=click 时 browser_observe 返回的元素编号 id，最稳的定位方式，优先使用。' },
        selector:    { type: 'string',  description: '目标元素的 CSS selector（click/double_click/right_click 定位；type 指定输入框；press_key 指定先聚焦的元素；scroll 可指定滚动进视口的元素）。' },
        text:        { type: 'string',  description: 'action=click/double_click/right_click 时用可见文本定位元素；action=type 时为「要输入的文本」。' },
        x:           { type: 'number',  description: 'click/double_click/right_click 的 X 坐标（像素，视口坐标）。' },
        y:           { type: 'number',  description: 'click/double_click/right_click 的 Y 坐标（像素，视口坐标）。' },
        force:       { type: 'boolean', description: 'action=click 时为 true 即使被遮挡也强制点击；默认 false：被遮挡返回 occluded 诊断。' },
        // scroll
        direction:   { type: 'string',  enum: ['up', 'down', 'top', 'bottom'], description: 'action=scroll 的方向：up 上、down 下、top 到顶、bottom 到底。' },
        amount:      { type: 'number',  description: 'action=scroll 的滚动像素数。默认 400。' },
        // type
        clear_first: { type: 'boolean', description: 'action=type 时输入前先清空字段。默认 true。' },
        submit:      { type: 'boolean', description: 'action=type 时输入后按回车提交。' },
        // press_key
        key:         { type: 'string',  description: 'action=press_key 的键名，如 "Enter"、"Escape"、"Tab"、"ArrowDown"、"a"。' },
        ctrl:        { type: 'boolean', description: 'action=press_key 时按住 Ctrl。' },
        shift:       { type: 'boolean', description: 'action=press_key 时按住 Shift。' },
        alt:         { type: 'boolean', description: 'action=press_key 时按住 Alt。' },
        meta:        { type: 'boolean', description: 'action=press_key 时按住 Meta/Cmd。' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser_hover',
    description: '把鼠标悬停 hover 到某个元素上，以显示 tooltip 或下拉菜单。用途：触发悬停才出现的内容。场景：展开悬停菜单、显示提示气泡后再操作。',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string', description: '要悬停元素的 CSS selector。' } },
      required: ['selector'],
    },
  },
  {
    name: 'browser_wait',
    description: '等待某个 CSS selector 出现，或固定等待一段时间。用途：等待页面/元素就绪后再操作。场景：等异步加载的按钮出现、等动画结束、给页面留出渲染时间。',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '等待出现的 CSS 元素。' },
        ms:       { type: 'number', description: '固定等待的毫秒数。' },
      },
    },
  },
  {
    name: 'browser_drag',
    description: '从源元素/点拖拽 drag 到目标元素/点并放下，触发 HTML5、pointer 和 mouse 事件，并返回源是否明显移动的诊断信息。用途：拖放交互。场景：拖动排序、把元素拖入投放区、滑块操作。',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string', description: '源元素 CSS selector。' },
        text:        { type: 'string', description: '源元素可见文本。' },
        x:           { type: 'number', description: '源点 X 坐标（像素）。' },
        y:           { type: 'number', description: '源点 Y 坐标（像素）。' },
        to_selector: { type: 'string', description: '目标元素 CSS selector。' },
        to_text:     { type: 'string', description: '目标元素可见文本。' },
        to_x:        { type: 'number', description: '目标点 X 坐标（像素）。' },
        to_y:        { type: 'number', description: '目标点 Y 坐标（像素）。' },
      },
    },
  },
  {
    name: 'browser_fill_form',
    description: '一次性填写多个表单字段，可按 selector、name、label、placeholder 或对象映射定位控件。用途：批量填表。场景：登录/注册/结算等需要填多个字段并提交的表单。',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: '字段列表。示例：[{selector:"input[name=email]", value:"me@example.com"}, {label:"Password", value:"secret"}, {selector:"#remember", action:"check"}]；运行时也接受对象映射写法。',
          items: {
            type: 'object',
            properties: {
              selector:    { type: 'string', description: '输入框/下拉/文本域的 CSS selector。' },
              name:        { type: 'string', description: '表单控件的 name 或 id（兜底定位）。' },
              label:       { type: 'string', description: '字段附近的可见 label 文本。' },
              placeholder: { type: 'string', description: '用于匹配的 placeholder 文本。' },
              value:       { type: ['string', 'number', 'boolean'], description: '要设置的值。' },
              action:      { type: 'string', enum: ['set', 'type', 'select', 'check', 'uncheck', 'click'], description: '如何应用值：set 设值、type 模拟输入、select 选择、check/uncheck 勾选、click 点击。默认 set。' },
            },
          },
        },
        submit_selector: { type: 'string', description: '填完后要点击的提交按钮 CSS selector。' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'browser_select',
    description: '在原生 <select> 下拉或常见自定义下拉/列表框中选择某项：通过点击控件并按选项文本/值匹配。用途：处理下拉选择。场景：选择国家、城市、数量等下拉项。',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string', description: '下拉/自定义下拉控件的 CSS selector。' },
        value:       { type: 'string', description: '要选择的选项值或可见文本。' },
        text:        { type: 'string', description: 'value 的别名。' },
        option_text: { type: 'string', description: 'value 的别名。' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_close_popup',
    description: '关闭可见的弹窗/模态框/对话框：优先点检测到的关闭按钮，再回退到 Escape/点遮罩。需要先查看候选时请先调用 browser_find_popups。用途：清除遮挡。场景：关闭 cookie 同意条、订阅弹窗、登录引导层。',
    input_schema: {
      type: 'object',
      properties: {
        selector:     { type: 'string', description: '可选：要关闭弹窗的 CSS selector。' },
        text:         { type: 'string', description: '可选：弹窗内包含的文本，用于定位它。' },
        index:        { type: 'number', description: 'browser_find_popups 返回的弹窗序号。默认 0。' },
        strategy:     { type: 'string', enum: ['auto', 'close_button', 'escape', 'backdrop'], description: '关闭策略：auto 自动、close_button 关闭按钮、escape 按 Esc、backdrop 点遮罩。默认 auto。' },
        force_remove: { type: 'boolean', description: '为 true 时作为最后手段直接移除弹窗 DOM 节点。' },
      },
    },
  },

  // ───── 数据与脚本 ─────────────────────────────────────────────────────
  {
    name: 'browser_evaluate',
    description: '在页面上下文中执行任意 JavaScript 并返回结果；可用时走 Chrome DevTools Protocol，因此在 CSP 受限页面上也能运行。用途：高级取数/操作的兜底手段。场景：内置工具无法满足时读取复杂数据或触发特殊行为（请谨慎使用）。',
    input_schema: {
      type: 'object',
      properties: {
        code:       { type: 'string', description: '要执行的 JavaScript 表达式或语句。' },
        function:   { type: 'string', description: 'code 的别名，保留兼容。' },
        fn:         { type: 'string', description: 'code 的别名。' },
        expression: { type: 'string', description: 'code 的别名。' },
        trace:      { type: 'boolean', description: '失败时返回结构化的 {error, code, suggestion, trace}。' },
      },
    },
  },
  {
    name: 'browser_extract',
    description: '从匹配 selector 的元素中提取结构化数据，返回带 tag、selector、文本、属性及常用属性别名的归一化条目。用途：批量抓取列表/表格。场景：抓取搜索结果、商品列表、表格行。',
    input_schema: {
      type: 'object',
      properties: {
        selector:   { type: 'string', description: '要查询的 CSS selector。' },
        attributes: { type: 'array', items: { type: 'string' }, description: '每个元素需要采集的属性名列表。' },
        limit:      { type: 'number', description: '最多提取的元素数。默认 50。' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_clipboard_write',
    description: '把文本写入系统剪贴板。用途：复制内容供其他程序粘贴。场景：复制提取到的结果、复制生成的链接。',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要复制到剪贴板的文本。' } },
      required: ['text'],
    },
  },
  {
    name: 'browser_file_upload',
    description: '用内存中的文件内容填充 <input type=file>。注意：扩展无法读取本机文件系统路径，必须直接提供内容。用途：上传文件。场景：把一段文本/base64 内容作为文件上传到网页。',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '文件输入框的 CSS selector。默认 input[type=file]。' },
        files: {
          type: 'array',
          description: '要合成的文件，例如 [{name:"a.txt", content:"hello", type:"text/plain"}]，或设置 encoding:"base64"。',
          items: {
            type: 'object',
            properties: {
              name:     { type: 'string', description: '文件名。' },
              content:  { type: 'string', description: '文件内容（按 encoding 解释）。' },
              type:     { type: 'string', description: 'MIME 类型，如 text/plain。' },
              encoding: { type: 'string', enum: ['text', 'base64'], description: 'content 的编码：text 纯文本或 base64。' },
            },
            required: ['name', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'browser_download',
    description: '通过 chrome.downloads 从某个 URL 发起浏览器下载。用途：保存文件到本地下载目录。场景：下载导出文件、图片、附件。',
    input_schema: {
      type: 'object',
      properties: {
        url:      { type: 'string', description: '要下载的 URL。' },
        filename: { type: 'string', description: '可选：下载目录下的相对文件名。' },
        save_as:  { type: 'boolean', description: '显示「另存为」对话框。' },
      },
      required: ['url'],
    },
  },

  // ───── 浏览器状态（资源 + action）────────────────────────────────────
  {
    name: 'browser_tab',
    description: '浏览器标签页与页面级导航聚合工具：列出已打开页面、新开/关闭标签，以及在当前标签内跳转 URL、前进、后退。用途：组织多标签并完成页面跳转。场景：查看有哪些标签（list）、并行打开网址（open）、完成后关闭标签（close）、跳到目标网址开始任务（navigate）、在浏览历史里回退/前进（back/forward）。',
    input_schema: {
      type: 'object',
      properties: {
        action:  { type: 'string', enum: ['list', 'open', 'close', 'navigate', 'back', 'forward'], description: '动作：list 列出所有标签、open 用 url 新开标签、close 关闭 tab_id（不传则当前标签）、navigate 在当前标签打开 url（new_tab:true 则新开）、back 后退一步、forward 前进一步。' },
        url:     { type: 'string',  description: 'action=open / navigate 时要打开的 URL（navigate 需为绝对地址，缺协议时按 https 补全）。' },
        new_tab: { type: 'boolean', description: 'action=navigate 时为 true 在新标签页打开，而不是替换当前页。' },
        tab_id:  { type: 'number',  description: 'action=close 时要关闭的标签 ID；不传则关闭当前活动标签。' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser_cookie',
    description: '管理当前标签页 URL 或指定 URL/域名的 cookie：列出、读取、写入、删除。用途：查看或操作会话状态。场景：检查登录态（list/get）、注入登录/偏好 cookie（set，写入）、退出登录（delete，写入）。',
    input_schema: {
      type: 'object',
      properties: {
        action:          { type: 'string', enum: ['list', 'get', 'set', 'delete'], description: '动作：list 列出、get 按 name 取单个、set 写入、delete 删除。' },
        url:             { type: 'string', description: 'cookie 所属 URL。默认当前标签页 URL。' },
        domain:          { type: 'string', description: 'action=list 时可按域名过滤。' },
        name:            { type: 'string', description: 'cookie 名称（get/set/delete 必填）。' },
        value:           { type: 'string', description: 'action=set 时的 cookie 值。' },
        path:            { type: 'string', description: 'action=set 时的 cookie 路径。' },
        secure:          { type: 'boolean', description: 'action=set 时是否仅 HTTPS 传输。' },
        http_only:       { type: 'boolean', description: 'action=set 时是否标记 HttpOnly。' },
        expiration_date: { type: 'number', description: 'action=set 时的过期时间（Unix 秒）。' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser_storage',
    description: '读写当前页面的 localStorage / sessionStorage：读取、写入、删除、列出 key。用途：查看或操作前端存储状态。场景：读取 token/偏好（get/list）、注入标记位（set，写入）、清除缓存项（remove，写入）。',
    input_schema: {
      type: 'object',
      properties: {
        action:         { type: 'string', enum: ['get', 'set', 'remove', 'list'], description: '动作：get 读取 key、set 写入 key、remove 删除 key、list 列出 key。' },
        type:           { type: 'string', enum: ['local', 'session'], description: '存储类型：local 或 session。默认 local。' },
        key:            { type: 'string', description: '存储键名（get/set/remove 必填）。' },
        value:          { type: 'string', description: 'action=set 时要存储的值。' },
        prefix:         { type: 'string', description: 'action=list 时按键名前缀过滤。' },
        include_values: { type: 'boolean', description: 'action=list 时在结果中包含 value。' },
        limit:          { type: 'number', description: 'action=list 时最多返回的 key/条目数。默认 100。' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser_session',
    description: '管理轻量浏览器上下文快照（当前 URL/标题 + 该页 localStorage/sessionStorage）：保存、列出、恢复、删除。用途：留存并回到此前的会话现场。场景：保存登录态稍后恢复（save/restore）、查看可恢复会话（list）、清理过期快照（delete）。',
    input_schema: {
      type: 'object',
      properties: {
        action:  { type: 'string', enum: ['save', 'list', 'restore', 'delete'], description: '动作：save 保存当前现场、list 列出快照、restore 恢复快照、delete 删除快照。' },
        id:      { type: 'string', description: '会话 id（restore/delete 用，save 可选）。' },
        name:    { type: 'string', description: '便于识别的会话名称（restore/delete 也可按 name 定位）。' },
        new_tab: { type: 'boolean', description: 'action=restore 时在新标签页中恢复。' },
      },
      required: ['action'],
    },
  },
]

export const BROWSER_CAPABILITIES = BROWSER_TOOLS.map(t => t.name)

// ── Tool categories (single source of truth for grouping) ─────────────────
// popup / 服务器 / Web 端都应按这里归类，不要再各自维护一份 browser_* 名单。
//
// 大类（kind）：每个分类再归到「基础类 basic」或「特殊类 special」两个大组。所有工具
// 默认开启，用户可在浏览器插件里逐个取消勾选；未勾选的工具不会随 device:register 的
// capabilities/toolDefs 上报给服务器，因此服务器拿不到对应 MCP 数据，AI 也无法调用。
export type BrowserToolKind = 'basic' | 'special'

export const BROWSER_TOOL_KIND_LABELS: Record<BrowserToolKind, string> = {
  basic:   '基础类',
  special: '特殊类',
}

export interface BrowserToolCategory {
  /** 中文分类名，用于展示。 */
  title: string
  /** 所属大类：basic 基础类 / special 特殊类。 */
  kind: BrowserToolKind
  /** 该分类下的工具名（顺序即展示顺序）。 */
  tools: string[]
}

export const BROWSER_TOOL_CATEGORIES: BrowserToolCategory[] = [
  {
    title: '导航与搜索',
    kind: 'basic',
    // browser_tab 现已涵盖跳转 URL / 前进后退 / 列出标签等页面级导航，归入此类。
    tools: ['browser_tab', 'browser_search'],
  },
  {
    title: '页面观察',
    kind: 'basic',
    tools: [
      'browser_observe', 'browser_screenshot', 'browser_get_content',
      'browser_dom_snapshot', 'browser_page_info', 'browser_find_popups',
    ],
  },
  {
    title: '页面交互',
    kind: 'basic',
    // browser_action 聚合了点击/双击/右键/滚动/输入/键盘按键。
    tools: [
      'browser_action', 'browser_hover', 'browser_wait', 'browser_drag',
      'browser_fill_form', 'browser_select', 'browser_close_popup',
    ],
  },
  {
    title: '数据与脚本',
    kind: 'special',
    tools: [
      'browser_evaluate', 'browser_extract', 'browser_clipboard_write',
      'browser_file_upload', 'browser_download',
    ],
  },
  {
    title: '浏览器状态',
    kind: 'special',
    tools: ['browser_cookie', 'browser_storage', 'browser_session'],
  },
]

/** name → 中文分类名。未归类时返回空串。 */
export function browserToolCategory(name: string): string {
  const tool = String(name || '').trim()
  for (const cat of BROWSER_TOOL_CATEGORIES) {
    if (cat.tools.includes(tool)) return cat.title
  }
  return ''
}

/** name → 大类。未归类的工具按 basic 处理。 */
export function browserToolKind(name: string): BrowserToolKind {
  const tool = String(name || '').trim()
  for (const cat of BROWSER_TOOL_CATEGORIES) {
    if (cat.tools.includes(tool)) return cat.kind
  }
  return 'basic'
}

/** 工具的默认开启状态：全部默认开启。 */
export function isToolEnabledByDefault(_name: string): boolean {
  return true
}
