// popup/mcp.ts — the popup's main area: the browser MCP tool page.
// Lists this extension's own MCP tools (grouped by namespace); opening one shows
// its description, usage, parameter schema and an editable description form, plus
// a "测试" button that runs the tool locally and shows the raw result.

import { state } from './state'
import * as dom from './dom'
import { esc } from './markdown'
import { BROWSER_TOOLS } from '../lib/tools'
import { AIToolDef } from '../lib/types'
import { getToolDescOverrides, setToolDescOverride, ToolDescOverride } from '../lib/storage'

let overrides: Record<string, ToolDescOverride> = {}

function nsOf(name: string): string {
  if (name.startsWith('card_')) return 'card'
  const i = name.indexOf('_')
  return i > 0 ? name.slice(0, i) : (name.includes('.') ? name.split('.')[0] : 'other')
}

function effDescription(t: AIToolDef): string {
  return overrides[t.name]?.description?.trim() || t.description || ''
}
function effParamDescription(tool: string, param: string, raw: string): string {
  return overrides[tool]?.parameters?.[param]?.trim() || raw || ''
}
function isEdited(name: string): boolean {
  const o = overrides[name]
  return !!(o && (o.description || (o.parameters && Object.keys(o.parameters).length)))
}

// ── List view ──────────────────────────────────────────────────────────────
function showList() {
  state.openToolName = null
  dom.mcpDetailPane.classList.add('hidden')
  dom.mcpListPane.classList.remove('hidden')
}

export async function renderMcpList() {
  overrides = await getToolDescOverrides()
  dom.mcpCount.textContent = `${BROWSER_TOOLS.length} 个`
  dom.mcpList.innerHTML = ''
  const groups = new Map<string, AIToolDef[]>()
  for (const t of BROWSER_TOOLS) {
    const ns = nsOf(t.name)
    if (!groups.has(ns)) groups.set(ns, [])
    groups.get(ns)!.push(t)
  }
  for (const ns of Array.from(groups.keys()).sort()) {
    const title = document.createElement('div')
    title.className = 'ns-title'
    title.textContent = `${ns}/ (${groups.get(ns)!.length})`
    dom.mcpList.appendChild(title)
    for (const t of groups.get(ns)!) {
      const el = document.createElement('div')
      el.className = 'tool-item'
      el.innerHTML = `
        <div class="tool-item-top">
          <span class="tool-name">${esc(t.name)}</span>
          ${isEdited(t.name) ? '<span class="tool-edited">已自定义</span>' : ''}
        </div>
        <div class="tool-desc">${esc((effDescription(t) || '（无描述）').slice(0, 110))}</div>`
      el.addEventListener('click', () => void openTool(t.name))
      dom.mcpList.appendChild(el)
    }
  }
}

// ── Detail view ──────────────────────────────────────────────────────────
async function openTool(name: string) {
  overrides = await getToolDescOverrides()
  const tool = BROWSER_TOOLS.find(t => t.name === name)
  if (!tool) return
  state.openToolName = name
  dom.mcpListPane.classList.add('hidden')
  dom.mcpDetailPane.classList.remove('hidden')
  dom.mcpDetail.scrollTop = 0
  renderDetail(tool)
}

function paramEntries(tool: AIToolDef): Array<{ name: string; type: string; required: boolean; desc: string }> {
  const props = tool.input_schema?.properties || {}
  const required = new Set(tool.input_schema?.required || [])
  return Object.keys(props).map(p => {
    const cfg = (props as any)[p] || {}
    const t = Array.isArray(cfg.type) ? cfg.type.join('|') : (cfg.type || 'any')
    return { name: p, type: String(t), required: required.has(p), desc: String(cfg.description || '') }
  })
}

function renderDetail(tool: AIToolDef) {
  const params = paramEntries(tool)
  const paramHtml = params.length
    ? params.map(p => `
        <div class="param-row">
          <div class="param-head">
            <span class="param-name">${esc(p.name)}</span>
            <span class="param-type">${esc(p.type)}</span>
            ${p.required ? '<span class="param-req">必填</span>' : ''}
          </div>
          <div class="tool-desc">${esc(effParamDescription(tool.name, p.name, p.desc) || '（无说明）')}</div>
          <input type="text" data-param="${esc(p.name)}" class="edit-param" placeholder="自定义参数说明（留空用默认）" value="${esc(overrides[tool.name]?.parameters?.[p.name] || '')}" style="margin-top:4px;"/>
        </div>`).join('')
    : '<div class="empty-note">该工具无参数</div>'

  const argTemplate = JSON.stringify(
    Object.fromEntries(params.filter(p => p.required).map(p => [p.name, ''])),
    null, 2,
  )

  dom.mcpDetail.innerHTML = `
    <div class="card">
      <div class="card-title">${esc(tool.name)}</div>
      <div class="tool-desc" style="font-size:11px;">${esc(effDescription(tool) || '（无描述）')}</div>
    </div>

    <div class="card">
      <div class="card-title">参数说明</div>
      ${paramHtml}
    </div>

    <div class="card">
      <div class="card-title">✏️ 编辑描述（本地保存，随上报同步给服务器）</div>
      <div class="fg"><label>工具描述（用途 + 使用场景）</label>
        <textarea class="ta" id="edit-desc" placeholder="留空使用默认描述">${esc(overrides[tool.name]?.description || '')}</textarea>
      </div>
      <button class="btn btn-primary" id="edit-save">保存描述</button>
      <button class="btn btn-secondary" id="edit-reset" style="margin-top:6px;">恢复默认</button>
      <div class="save-feedback" id="edit-feedback"></div>
    </div>

    <div class="card">
      <div class="card-title">🧪 测试调用 (mcp.test)</div>
      <div class="login-hint">在本浏览器直接执行该工具并返回原始结果。请确保有一个活动标签页。</div>
      <div class="fg"><label>参数 (JSON)</label>
        <textarea class="ta" id="test-args" style="min-height:70px;font-family:'Cascadia Code',Consolas,monospace;">${esc(argTemplate)}</textarea>
      </div>
      <button class="btn btn-primary" id="test-run">▶ 测试</button>
      <div class="test-result" id="test-result" style="display:none;"></div>
    </div>`

  // Save / reset description (and per-param overrides).
  dom.mcpDetail.querySelector('#edit-save')!.addEventListener('click', async () => {
    const description = (dom.mcpDetail.querySelector('#edit-desc') as HTMLTextAreaElement).value
    const parameters: Record<string, string> = {}
    dom.mcpDetail.querySelectorAll<HTMLInputElement>('.edit-param').forEach(inp => {
      parameters[inp.dataset.param!] = inp.value
    })
    await setToolDescOverride(tool.name, { description, parameters })
    overrides = await getToolDescOverrides()
    const fb = dom.mcpDetail.querySelector('#edit-feedback') as HTMLElement
    fb.textContent = '已保存 ✓ 下次连接服务器时同步'; fb.style.color = 'var(--success)'
    // Re-report toolDefs so the server picks up the edit without reconnecting.
    state.port.postMessage({ type: 'agent:connect' })
  })
  dom.mcpDetail.querySelector('#edit-reset')!.addEventListener('click', async () => {
    await setToolDescOverride(tool.name, { description: '', parameters: {} })
    overrides = await getToolDescOverrides()
    renderDetail(tool)
    state.port.postMessage({ type: 'agent:connect' })
  })

  // Test run: dispatch to background which executes the tool locally.
  dom.mcpDetail.querySelector('#test-run')!.addEventListener('click', () => {
    const out = dom.mcpDetail.querySelector('#test-result') as HTMLElement
    let args: Record<string, any> = {}
    const raw = (dom.mcpDetail.querySelector('#test-args') as HTMLTextAreaElement).value.trim()
    if (raw) {
      try { args = JSON.parse(raw) } catch (e: any) {
        out.style.display = 'block'; out.className = 'test-result fail'
        out.textContent = `参数 JSON 解析失败：${e?.message || e}`; return
      }
    }
    out.style.display = 'block'; out.className = 'test-result'; out.textContent = '执行中…'
    const requestId = Math.random().toString(36).slice(2)
    state.pendingTests.set(requestId, (r) => {
      if (r.ok) {
        out.className = 'test-result ok'
        out.textContent = '✓ 成功\n' + safeStringify(r.result)
      } else {
        out.className = 'test-result fail'
        out.textContent = '✗ 失败：' + (r.error || '未知错误')
      }
    })
    state.port.postMessage({ type: 'mcp:test', requestId, tool: tool.name, args })
  })
}

function safeStringify(v: any): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) } catch { return String(v) }
}

// Called by index.ts when an mcp:test:result message arrives.
export function resolveTest(requestId: string, r: { ok: boolean; result?: any; error?: string }) {
  const fn = state.pendingTests.get(requestId)
  if (fn) { fn(r); state.pendingTests.delete(requestId) }
}

export function wireMcp() {
  dom.mcpBack.addEventListener('click', () => showList())
}
