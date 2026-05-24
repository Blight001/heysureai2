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
    description: 'Capture a screenshot of the current tab. Returns a base64 PNG data URL.',
    input_schema: { type: 'object', properties: {} },
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
    description: 'Get the visible text content, URL, title, and meta info of the current page.',
    input_schema: {
      type: 'object',
      properties: {
        selector:     { type: 'string',  description: 'Limit content to this CSS selector (default: body)' },
        include_html: { type: 'boolean', description: 'Also return raw HTML (truncated)' },
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
    description: 'Execute arbitrary JavaScript in the page context and return the result.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript expression or statements to execute' },
      },
      required: ['code'],
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract structured data (text, href, src, etc.) from elements matching a selector.',
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
    description: 'Fill multiple form fields in one call.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'List of {selector, value} pairs to fill',
          items: {
            type: 'object',
            properties: { selector: { type: 'string' }, value: { type: 'string' } },
            required: ['selector', 'value'],
          },
        },
        submit_selector: { type: 'string', description: 'CSS selector of submit button to click after filling' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> dropdown.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the <select> element' },
        value:    { type: 'string', description: 'Option value or visible text to select' },
      },
      required: ['selector', 'value'],
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
    description: 'Drag from a source element/point and drop onto a target element/point. Fires both HTML5 drag-and-drop and pointer events, so it works with most draggable UIs (sliders, sortable lists, file drop zones).',
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
    description: 'Save a sequence of browser steps as a reusable memory card. Each step is { tool, args, note } where note (备注) explains the step in plain language. If a card with the same name exists, mode controls behavior: replace (default), merge (append steps), or new (force a new card).',
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
    description: 'Run a saved card by id or name. Executes its steps in order and returns a per-step result list; on failure it returns failedStep with the index, note and error so you can diagnose and fix it (with card_update_step) then re-run.',
    input_schema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'Card id' },
        name: { type: 'string', description: 'Card name (used if id omitted)' },
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
