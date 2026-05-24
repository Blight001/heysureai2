// content/index.ts — injected into every web page.
// Wires chrome.runtime messages from the background worker to the page-action
// handlers. All DOM manipulation lives in the sibling modules:
//   actions.ts   — click, type, scroll, extract, … (the bread-and-butter ops)
//   popups.ts    — popup detection + close
//   viewport.ts  — page position reporting (browser_page_info, ctx in click/scroll)
//   dom.ts       — pure DOM helpers (selectors, visibility, text matching)
//   fx.ts        — virtual cursor / visual effects

import {
  doClick, doDoubleClick, doRightClick, doDrag, doPressKey,
  doType, getContent, doScroll, doWait, doEvaluate, doExtract,
  findText, fillForm, doSelect, doHover, storageGet,
} from './actions'
import { doFindPopups, doClosePopup } from './popups'
import { doPageInfo } from './viewport'

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleAction(msg).then(sendResponse).catch(err => sendResponse({ error: err.message || String(err) }))
  return true  // keep message channel open for async response
})

async function handleAction(msg: any): Promise<any> {
  switch (msg.action) {
    case 'click':        return doClick(msg)
    case 'double_click': return doDoubleClick(msg)
    case 'right_click':  return doRightClick(msg)
    case 'drag':         return doDrag(msg)
    case 'press_key':    return doPressKey(msg)
    case 'find_popups':  return doFindPopups(msg)
    case 'close_popup':  return doClosePopup(msg)
    case 'page_info':    return doPageInfo()
    case 'type':         return doType(msg)
    case 'get_content':  return getContent(msg)
    case 'scroll':       return doScroll(msg)
    case 'wait':         return doWait(msg)
    case 'evaluate':     return doEvaluate(msg)
    case 'extract':      return doExtract(msg)
    case 'find_text':    return findText(msg)
    case 'fill_form':    return fillForm(msg)
    case 'select':       return doSelect(msg)
    case 'hover':        return doHover(msg)
    case 'storage_get':  return storageGet(msg)
    default:
      throw new Error(`Unknown content action: ${msg.action}`)
  }
}
