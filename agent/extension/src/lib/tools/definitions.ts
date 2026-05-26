// tools/definitions.ts — pure constants: search engines + MCP tool schemas.
// No runtime dependencies; safe to import from any module.

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
export const BROWSER_TOOLS: AIToolDef[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the active browser tab to a URL. Returns when the page has loaded.',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string',  description: 'Absolute URL to navigate to' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of current' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the current tab, full page, a CSS/text-matched element, or a rectangular region. Returns a base64 image data URL, or a readable disabled/permission error if screenshots are not allowed.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of an element to screenshot.' },
        text: { type: 'string', description: 'Visible text used to find an element to screenshot when selector is omitted.' },
        full_page: { type: 'boolean', description: 'Capture the full scrollable page.' },
        x: { type: 'number', description: 'Region left coordinate. Defaults to viewport coordinates unless coordinate_space is page.' },
        y: { type: 'number', description: 'Region top coordinate. Defaults to viewport coordinates unless coordinate_space is page.' },
        width: { type: 'number', description: 'Region width in CSS pixels.' },
        height: { type: 'number', description: 'Region height in CSS pixels.' },
        clip: { type: 'object', description: 'Alternative region object: {x,y,width,height,coordinate_space?}.' },
        coordinate_space: { type: 'string', enum: ['viewport', 'page'], description: 'Coordinate space for x/y/clip. Default viewport.' },
        margin: { type: 'number', description: 'Extra CSS pixels around selector/text element screenshots.' },
        scroll_into_view: { type: 'boolean', description: 'Scroll selector/text target into view before measuring it. Default true.' },
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image format. Default png.' },
        quality: { type: 'number', description: 'JPEG/WebP quality, 0-100.' },
        scale: { type: 'number', description: 'CDP clip scale. Default 1.' },
        max_area: { type: 'number', description: 'Maximum screenshot area in CSS pixels. Default 25000000.' },
        retries: { type: 'number', description: 'Retry count for simple visible-tab capture on transient active-tab/rate-limit failures. Default 1.' },
        timeout_ms: { type: 'number', description: 'Overall per-stage screenshot timeout in milliseconds. Default 8000 for visible capture and 12000 for CDP.' },
        visible_timeout_ms: { type: 'number', description: 'Timeout for chrome.tabs.captureVisibleTab in milliseconds. Default 8000.' },
        cdp_timeout_ms: { type: 'number', description: 'Timeout for each Chrome DevTools Protocol screenshot command in milliseconds. Default 12000.' },
        content_timeout_ms: { type: 'number', description: 'Timeout for measuring selector/text target in the page. Default 5000.' },
        max_data_url_chars: { type: 'number', description: 'Maximum data URL payload length returned over Socket.IO. Default 8000000.' },
        allow_large_data_url: { type: 'boolean', description: 'Allow returning a screenshot payload larger than max_data_url_chars. Default false.' },
        task_timeout_ms: { type: 'number', description: 'Endpoint agent hard timeout for this dispatched screenshot task. Default 35000.' },
        fallback_visible: { type: 'boolean', description: 'For element/region/full-page screenshots, fall back to visible-tab screenshot if precise CDP capture fails. Default false.' },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page by CSS selector, visible text, or coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text:     { type: 'string', description: 'Visible text of the element to click' },
        x:        { type: 'number', description: 'X coordinate (px)' },
        y:        { type: 'number', description: 'Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input field or textarea.',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string',  description: 'CSS selector of the input' },
        text:        { type: 'string',  description: 'Text to type' },
        clear_first: { type: 'boolean', description: 'Clear the field before typing (default true)' },
        submit:      { type: 'boolean', description: 'Press Enter after typing' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_get_content',
    description: 'Get the visible text content, URL, title, links, meta info, and normalized items from the current page.',
    input_schema: {
      type: 'object',
      properties: {
        selector:     { type: 'string',  description: 'Limit content to this CSS selector (default: body)' },
        include_html: { type: 'boolean', description: 'Also return raw HTML (truncated)' },
      },
    },
  },
  {
    name: 'browser_dom_snapshot',
    description: 'Return a structured DOM tree snapshot as a text-friendly alternative when screenshots are disabled or unavailable.',
    input_schema: {
      type: 'object',
      properties: {
        selector:  { type: 'string', description: 'Root selector (default body)' },
        max_depth: { type: 'number', description: 'Maximum DOM depth (default 4, max 8)' },
        max_nodes: { type: 'number', description: 'Maximum nodes to return (default 120, max 1000)' },
        trace:     { type: 'boolean', description: 'Return structured error trace instead of throwing' },
      },
    },
  },
  {
    name: 'browser_search',
    description: 'Search the web using a popular search engine.',
    input_schema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: 'Search query' },
        engine: {
          type: 'string',
          enum: Object.keys(SEARCH_ENGINES),
          description: 'Search engine (default: google)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the current page. Returns the resulting scroll position (scrollY, percent, atTop/atBottom), how many pixels actually moved, and which section/headings are now in view — so you know where you landed and what changed.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction' },
        amount:    { type: 'number', description: 'Pixels to scroll (default 400)' },
        selector:  { type: 'string', description: 'Optional: scroll this element into view instead of by amount' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a CSS selector to appear or for a fixed duration.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Wait for this CSS element to appear' },
        ms:       { type: 'number', description: 'Wait for this many milliseconds' },
      },
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute arbitrary JavaScript in the page context and return the result. Uses Chrome DevTools Protocol when available so it works on CSP-restricted pages.',
    input_schema: {
      type: 'object',
      properties: {
        code:       { type: 'string', description: 'JavaScript expression or statements to execute' },
        function:   { type: 'string', description: 'Alias for code, kept for compatibility' },
        fn:         { type: 'string', description: 'Alias for code' },
        expression: { type: 'string', description: 'Alias for code' },
        trace:      { type: 'boolean', description: 'Return structured {error, code, suggestion, trace} on failure' },
      },
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract structured data from elements matching a selector. Returns normalized items with tag, selector, text, attributes, and common attribute aliases.',
    input_schema: {
      type: 'object',
      properties: {
        selector:   { type: 'string', description: 'CSS selector to query' },
        attributes: { type: 'array', items: { type: 'string' }, description: 'Attributes to collect per element' },
        limit:      { type: 'number', description: 'Max number of elements (default 50)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_find_text',
    description: 'Find all elements that contain specific text on the page.',
    input_schema: {
      type: 'object',
      properties: {
        text:  { type: 'string',  description: 'Text to search for' },
        exact: { type: 'boolean', description: 'Exact match only' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_find_popups',
    description: 'Detect visible popups, modals, dialogs, drawers, overlays, and their likely close buttons on the current page.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum popups to return (default 10)' },
      },
    },
  },
  {
    name: 'browser_close_popup',
    description: 'Close a visible popup/modal/dialog. Uses detected close buttons first, then Escape/backdrop fallback. Call browser_find_popups first when you need to inspect candidates.',
    input_schema: {
      type: 'object',
      properties: {
        selector:     { type: 'string', description: 'Optional CSS selector of the popup to close' },
        text:         { type: 'string', description: 'Optional text contained by the popup to identify it' },
        index:        { type: 'number', description: 'Popup index from browser_find_popups (default 0)' },
        strategy:     { type: 'string', enum: ['auto', 'close_button', 'escape', 'backdrop'], description: 'Close strategy (default auto)' },
        force_remove: { type: 'boolean', description: 'If true, remove the popup DOM node as a last resort' },
      },
    },
  },
  {
    name: 'browser_fill_form',
    description: 'Fill multiple form fields in one call. Fields can target controls by selector, name, label, placeholder, or an object map.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'List of fields. Examples: [{selector:"input[name=email]", value:"me@example.com"}, {label:"Password", value:"secret"}, {selector:"#remember", action:"check"}]. Object map form is also accepted by the runtime.',
          items: {
            type: 'object',
            properties: {
              selector:    { type: 'string', description: 'CSS selector for the input/select/textarea' },
              name:        { type: 'string', description: 'Form control name or id fallback' },
              label:       { type: 'string', description: 'Visible label text near the field' },
              placeholder: { type: 'string', description: 'Placeholder text to match' },
              value:       { type: ['string', 'number', 'boolean'], description: 'Value to set' },
              action:      { type: 'string', enum: ['set', 'type', 'select', 'check', 'uncheck', 'click'], description: 'How to apply the value (default set)' },
            },
          },
        },
        submit_selector: { type: 'string', description: 'CSS selector of submit button to click after filling' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a native <select> dropdown or a common custom dropdown/listbox by clicking the control and matching option text/value.',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string', description: 'CSS selector of the select/custom dropdown control' },
        value:       { type: 'string', description: 'Option value or visible text to select' },
        text:        { type: 'string', description: 'Alias for value' },
        option_text: { type: 'string', description: 'Alias for value' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_iframe_list',
    description: 'List iframe/frame elements on the current page, including src/name/title/accessibility and viewport rect.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_performance',
    description: 'Read page performance metrics and slow resources from PerformanceNavigationTiming and ResourceTiming.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_network_log',
    description: 'Return passive resource timing entries as a lightweight network log. This is not active request interception.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum request/resource entries to return (default 20)' },
      },
    },
  },
  {
    name: 'browser_file_upload',
    description: 'Populate an <input type=file> using in-memory file contents. Local filesystem paths cannot be read by the extension.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of file input (default input[type=file])' },
        files: {
          type: 'array',
          description: 'Files to synthesize, e.g. [{name:"a.txt", content:"hello", type:"text/plain"}] or encoding:"base64"',
          items: {
            type: 'object',
            properties: {
              name:     { type: 'string' },
              content:  { type: 'string' },
              type:     { type: 'string' },
              encoding: { type: 'string', enum: ['text', 'base64'] },
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
    description: 'Start a browser download from a URL using chrome.downloads.',
    input_schema: {
      type: 'object',
      properties: {
        url:      { type: 'string', description: 'URL to download' },
        filename: { type: 'string', description: 'Optional relative filename under the downloads folder' },
        save_as:  { type: 'boolean', description: 'Show Save As dialog' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_cookie_list',
    description: 'List cookies for the active tab URL or a given domain.',
    input_schema: {
      type: 'object',
      properties: {
        url:    { type: 'string', description: 'Cookie URL (default active tab URL)' },
        domain: { type: 'string', description: 'Optional domain filter' },
      },
    },
  },
  {
    name: 'browser_cookie_get',
    description: 'Get one cookie by name for the active tab URL or a provided URL.',
    input_schema: {
      type: 'object',
      properties: {
        url:  { type: 'string', description: 'Cookie URL (default active tab URL)' },
        name: { type: 'string', description: 'Cookie name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'browser_cookie_set',
    description: 'Set one cookie for the active tab URL or a provided URL.',
    input_schema: {
      type: 'object',
      properties: {
        url:             { type: 'string', description: 'Cookie URL (default active tab URL)' },
        name:            { type: 'string', description: 'Cookie name' },
        value:           { type: 'string', description: 'Cookie value' },
        domain:          { type: 'string' },
        path:            { type: 'string' },
        secure:          { type: 'boolean' },
        http_only:       { type: 'boolean' },
        expiration_date: { type: 'number', description: 'Unix seconds' },
      },
      required: ['name'],
    },
  },
  {
    name: 'browser_cookie_delete',
    description: 'Delete one cookie by name for the active tab URL or a provided URL.',
    input_schema: {
      type: 'object',
      properties: {
        url:  { type: 'string', description: 'Cookie URL (default active tab URL)' },
        name: { type: 'string', description: 'Cookie name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'browser_tab_list',
    description: 'List all open browser tabs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_tab_open',
    description: 'Open a new tab with the given URL.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL for the new tab' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_tab_close',
    description: 'Close a tab by its ID, or the active tab if no ID given.',
    input_schema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'Tab ID to close' } },
    },
  },
  {
    name: 'browser_history_back',
    description: 'Navigate the current tab back in history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_history_forward',
    description: 'Navigate the current tab forward in history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_clipboard_write',
    description: 'Write text to the system clipboard.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to copy' } },
      required: ['text'],
    },
  },
  {
    name: 'browser_storage_get',
    description: 'Read a key from the page\'s localStorage or sessionStorage.',
    input_schema: {
      type: 'object',
      properties: {
        key:  { type: 'string', description: 'Storage key' },
        type: { type: 'string', enum: ['local', 'session'], description: 'Storage type (default: local)' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_storage_set',
    description: 'Set a key in the page localStorage or sessionStorage.',
    input_schema: {
      type: 'object',
      properties: {
        key:   { type: 'string', description: 'Storage key' },
        value: { type: 'string', description: 'Value to store' },
        type:  { type: 'string', enum: ['local', 'session'], description: 'Storage type (default: local)' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_storage_remove',
    description: 'Remove a key from the page localStorage or sessionStorage.',
    input_schema: {
      type: 'object',
      properties: {
        key:  { type: 'string', description: 'Storage key' },
        type: { type: 'string', enum: ['local', 'session'], description: 'Storage type (default: local)' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_storage_list',
    description: 'List keys from the page localStorage or sessionStorage, optionally including values.',
    input_schema: {
      type: 'object',
      properties: {
        prefix:         { type: 'string', description: 'Optional key prefix filter' },
        include_values: { type: 'boolean', description: 'Include values in the response' },
        limit:          { type: 'number', description: 'Maximum keys/items (default 100)' },
        type:           { type: 'string', enum: ['local', 'session'], description: 'Storage type (default: local)' },
      },
    },
  },
  {
    name: 'browser_session_save',
    description: 'Save a lightweight browser context snapshot: current URL/title plus localStorage/sessionStorage for the page.',
    input_schema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'Optional session id' },
        name: { type: 'string', description: 'Friendly session name' },
      },
    },
  },
  {
    name: 'browser_session_list',
    description: 'List saved lightweight browser context snapshots.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_session_restore',
    description: 'Restore a saved lightweight browser context snapshot by navigating to its URL and restoring storage.',
    input_schema: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'Session id' },
        name:    { type: 'string', description: 'Session name' },
        new_tab: { type: 'boolean', description: 'Restore into a new tab' },
      },
    },
  },
  {
    name: 'browser_session_delete',
    description: 'Delete a saved lightweight browser context snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'Session id' },
        name: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_profile_info',
    description: 'Return the current extension logical profile marker. This does not switch Chrome user profiles.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_profile_set',
    description: 'Set an extension logical profile marker for grouping state. Chrome user-profile switching is not available to extensions.',
    input_schema: {
      type: 'object',
      properties: {
        name:    { type: 'string', description: 'Logical profile name' },
        profile: { type: 'string', description: 'Alias for name' },
      },
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover the mouse over an element to reveal tooltips or dropdowns.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector of element to hover' } },
      required: ['selector'],
    },
  },
  {
    name: 'browser_page_info',
    description: 'Get where you currently are on the page: scroll position (scrollY, percent, atTop/atBottom), viewport size, full page height, the current section heading, all headings now visible in the viewport, and element counts. Call this to orient yourself before/after scrolling or interacting.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_right_click',
    description: 'Right-click (open the context menu) on an element by CSS selector, visible text, or coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text:     { type: 'string', description: 'Visible text of the element' },
        x:        { type: 'number', description: 'X coordinate (px)' },
        y:        { type: 'number', description: 'Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_double_click',
    description: 'Double-click an element by CSS selector, visible text, or coordinates (e.g. to select a word or open an item).',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text:     { type: 'string', description: 'Visible text of the element' },
        x:        { type: 'number', description: 'X coordinate (px)' },
        y:        { type: 'number', description: 'Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_drag',
    description: 'Drag from a source element/point and drop onto a target element/point. Fires HTML5, pointer, and mouse events, and returns diagnostics showing whether the source visibly moved.',
    input_schema: {
      type: 'object',
      properties: {
        selector:    { type: 'string', description: 'Source CSS selector' },
        text:        { type: 'string', description: 'Source visible text' },
        x:           { type: 'number', description: 'Source X coordinate (px)' },
        y:           { type: 'number', description: 'Source Y coordinate (px)' },
        to_selector: { type: 'string', description: 'Target CSS selector' },
        to_text:     { type: 'string', description: 'Target visible text' },
        to_x:        { type: 'number', description: 'Target X coordinate (px)' },
        to_y:        { type: 'number', description: 'Target Y coordinate (px)' },
      },
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key (optionally with modifiers) on the focused element or a given selector. Useful for Enter, Escape, Tab, Arrow keys, or shortcuts like Ctrl+A.',
    input_schema: {
      type: 'object',
      properties: {
        key:      { type: 'string', description: 'Key name, e.g. "Enter", "Escape", "Tab", "ArrowDown", "a"' },
        selector: { type: 'string', description: 'Optional CSS selector to focus before pressing' },
        ctrl:     { type: 'boolean', description: 'Hold Ctrl' },
        shift:    { type: 'boolean', description: 'Hold Shift' },
        alt:      { type: 'boolean', description: 'Hold Alt' },
        meta:     { type: 'boolean', description: 'Hold Meta/Cmd' },
      },
      required: ['key'],
    },
  },
  {
    name: 'card_list',
    description: 'List saved memory cards (automation workflows). Returns each card id, name, description and step count.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'card_get',
    description: 'Get the full steps of a saved card by id or name. Use this to inspect a card before running or fixing it.',
    input_schema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'Card id' },
        name: { type: 'string', description: 'Card name (used if id omitted)' },
      },
    },
  },
  {
    name: 'card_save',
    description: 'Save a sequence of browser steps as a reusable memory card. Steps support args templates like {{name}}, optional if conditions, save_as variables, and var_set pseudo steps.',
    input_schema: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Card name' },
        description: { type: 'string', description: 'What this workflow does' },
        mode:        { type: 'string', enum: ['replace', 'merge', 'new'], description: 'On name conflict (default replace)' },
        steps: {
          type: 'array',
          description: 'Ordered steps to perform',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'A browser_* tool name, e.g. browser_navigate' },
              args: { type: 'object', description: 'Arguments for that tool' },
              note: { type: 'string', description: '备注：plain-language description of this step' },
              if:   { type: ['string', 'object', 'boolean'], description: 'Optional condition, e.g. "item.enabled" or {var:"last.success", equals:true}' },
              save_as: { type: 'string', description: 'Save this step result into a variable name' },
            },
            required: ['tool'],
          },
        },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'card_update_step',
    description: 'Fix one step of an existing card by index — change its tool, args, or note. Use this to repair a card after card_run reports a failed step.',
    input_schema: {
      type: 'object',
      properties: {
        id:    { type: 'string', description: 'Card id' },
        name:  { type: 'string', description: 'Card name (used if id omitted)' },
        index: { type: 'number', description: '0-based index of the step to update' },
        tool:  { type: 'string', description: 'New tool name (optional)' },
        args:  { type: 'object', description: 'New arguments (optional)' },
        note:  { type: 'string', description: 'New 备注 (optional)' },
      },
      required: ['index'],
    },
  },
  {
    name: 'card_run',
    description: 'Run a saved card by id or name. Supports variables for {{name}} templates and conditional steps.',
    input_schema: {
      type: 'object',
      properties: {
        id:        { type: 'string', description: 'Card id' },
        name:      { type: 'string', description: 'Card name (used if id omitted)' },
        variables: { type: 'object', description: 'Variables available to step templates and conditions' },
        vars:      { type: 'object', description: 'Alias for variables' },
      },
    },
  },
  {
    name: 'card_run_batch',
    description: 'Run a saved card once per item. Each run receives variables {item, index, ...variables}.',
    input_schema: {
      type: 'object',
      properties: {
        id:            { type: 'string', description: 'Card id' },
        name:          { type: 'string', description: 'Card name (used if id omitted)' },
        items:         { type: 'array', description: 'Batch items' },
        variables:     { type: 'object', description: 'Shared variables for every run' },
        stop_on_error: { type: 'boolean', description: 'Stop at first failed item (default true)' },
      },
      required: ['items'],
    },
  },
  {
    name: 'card_schedule',
    description: 'Schedule a card with interval_minutes, run_at, or simple cron like "*/15 * * * *". Uses Chrome alarms.',
    input_schema: {
      type: 'object',
      properties: {
        id:               { type: 'string', description: 'Card id' },
        name:             { type: 'string', description: 'Card name (used if id omitted)' },
        schedule_id:      { type: 'string', description: 'Optional schedule id' },
        interval_minutes: { type: 'number', description: 'Recurring interval' },
        run_at:           { type: 'string', description: 'One-shot ISO datetime' },
        cron:             { type: 'string', description: 'Only simple every-N-minutes syntax is supported, e.g. */15 * * * *' },
        variables:        { type: 'object', description: 'Variables passed to the scheduled run' },
      },
    },
  },
  {
    name: 'card_schedule_list',
    description: 'List scheduled card runs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'card_schedule_delete',
    description: 'Delete a scheduled card run.',
    input_schema: {
      type: 'object',
      properties: {
        schedule_id: { type: 'string', description: 'Schedule id' },
        id:          { type: 'string', description: 'Alias for schedule_id' },
      },
    },
  },
  {
    name: 'card_delete',
    description: 'Delete a saved card by id or name.',
    input_schema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'Card id' },
        name: { type: 'string', description: 'Card name (used if id omitted)' },
      },
    },
  },
]

export const BROWSER_CAPABILITIES = BROWSER_TOOLS.map(t => t.name)
