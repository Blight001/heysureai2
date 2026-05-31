// popup/mcp.ts — the popup's main area: the browser MCP tool page.
// Lists this extension's own MCP tools; opening one shows description, params,
// editable local descriptions and a direct local test runner.

import { BROWSER_TOOLS, BROWSER_TOOL_CATEGORIES } from '../lib/tools'
import { AIToolDef } from '../lib/types'
import { getToolDescOverrides, setToolDescOverride } from '../lib/storage'
import * as dom from './dom'
import { state } from './state'

let overrides: Record<string, { description?: string; parameters?: Record<string, string> }> = {}

function esc(str: string) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function isEdited(name: string) {
  const o = overrides[name]
  return !!(o && (o.description || (o.parameters && Object.keys(o.parameters).length)))
}

function effDescription(t: AIToolDef) {
  return overrides[t.name]?.description?.trim() || t.description || ''
}

function effParamDesc(tool: string, param: string, raw: string) {
  return overrides[tool]?.parameters?.[param]?.trim() || raw || ''
}

function paramEntries(t: AIToolDef) {
  const props = t.input_schema?.properties || {}
  const required = new Set(t.input_schema?.required || [])
  return Object.keys(props).map(p => {
    const cfg = (props as any)[p] || {}
    const ty = Array.isArray(cfg.type) ? cfg.type.join('|') : (cfg.type || 'any')
    return { name: p, type: String(ty), required: required.has(p), desc: String(cfg.description || '') }
  })
}

function renderIntroHtml() {
  return `
    <div class="mcp-intro">
      <div class="mcp-intro-title">
        <span>基础 MCP 介绍</span>
        <span class="pane-sub">先看概念，再看工具</span>
      </div>
      <div class="mcp-intro-list">
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">MCP</div>
          <div class="mcp-intro-text">模型上下文协议。这里展示的是浏览器插件对外提供的工具能力，AI 可以按名称调用这些工具完成浏览器操作。</div>
        </div>
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">list_tools</div>
          <div class="mcp-intro-text">用于查看当前可用工具列表。先看列表，再决定要不要展开具体工具详情。</div>
        </div>
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">describe_tool</div>
          <div class="mcp-intro-text">用于读取某个工具的用途、参数和说明。需要知道怎么传参时，先看这里。</div>
        </div>
        <div class="mcp-intro-item">
          <div class="mcp-intro-key">test</div>
          <div class="mcp-intro-text">用于在当前浏览器环境中直接测试一个工具，便于验证描述和参数是否正确。</div>
        </div>
      </div>
    </div>`
}

export async function renderMcpList() {
  state.openToolName = null
  dom.mcpDetailPane.classList.add('hidden')
  dom.mcpListPane.classList.remove('hidden')
  overrides = await getToolDescOverrides()
  dom.mcpCount.textContent = `${BROWSER_TOOLS.length} 个`
  dom.mcpList.innerHTML = renderIntroHtml()
  const byName = new Map(BROWSER_TOOLS.map(t => [t.name, t]))
  for (const cat of BROWSER_TOOL_CATEGORIES) {
    const tools = cat.tools.map(n => byName.get(n)).filter((t): t is AIToolDef => !!t)
    if (!tools.length) continue
    const head = document.createElement('div')
    head.className = 'tool-cat-head'
    head.innerHTML = `<span>${esc(cat.title)}</span><span class="pane-sub">${tools.length}</span>`
    dom.mcpList.appendChild(head)
    for (const t of tools) {
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

async function openTool(name: string) {
  const tool = BROWSER_TOOLS.find(t => t.name === name)
  if (!tool) return
  state.openToolName = name
  dom.mcpListPane.classList.add('hidden')
  dom.mcpDetailPane.classList.remove('hidden')
  dom.mcpDetail.scrollTop = 0
  await renderDetail(tool)
}

async function renderDetail(tool: AIToolDef) {
  overrides = await getToolDescOverrides()
  const params = paramEntries(tool)
  const paramHtml = params.length
    ? params.map(p => `
        <div class="param-row">
          <div class="param-head">
            <span class="param-name">${esc(p.name)}</span>
            <span class="param-type">${esc(p.type)}</span>
            ${p.required ? '<span class="param-req">必填</span>' : ''}
          </div>
          <div class="tool-desc">${esc(effParamDesc(tool.name, p.name, p.desc) || '（无说明）')}</div>
          <input type="text" data-param="${esc(p.name)}" class="edit-param" placeholder="自定义参数说明（留空用默认）" value="${esc(overrides[tool.name]?.parameters?.[p.name] || '')}" style="margin-top:5px;"/>
        </div>`).join('')
    : '<div class="empty-note">该工具无参数</div>'
  const argTemplate = JSON.stringify(Object.fromEntries(params.filter(p => p.required).map(p => [p.name, ''])), null, 2)

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
      <div class="card-title">编辑描述（本地保存，随上报同步给服务器）</div>
      <div class="fg"><label>工具描述（用途 + 使用场景）</label>
        <textarea class="ta" id="edit-desc" placeholder="留空使用默认描述">${esc(overrides[tool.name]?.description || '')}</textarea>
      </div>
      <button class="btn btn-primary" id="edit-save">保存描述</button>
      <button class="btn btn-secondary" id="edit-reset">恢复默认</button>
      <div class="save-feedback" id="edit-feedback"></div>
    </div>
    <div class="card">
      <div class="card-title">测试调用 (mcp.test)</div>
      <div class="login-hint">在当前浏览器环境直接执行该工具并返回原始结果。</div>
      <div class="fg"><label>参数 (JSON)</label>
        <textarea class="ta" id="test-args" style="min-height:70px;font-family:'Cascadia Code',Consolas,monospace;">${esc(argTemplate)}</textarea>
      </div>
      <button class="btn btn-primary" id="test-run">测试</button>
      <div class="test-result" id="test-result" style="display:none;"></div>
    </div>`

  dom.mcpDetail.querySelector('#edit-save')!.addEventListener('click', async () => {
    const description = (dom.mcpDetail.querySelector('#edit-desc') as HTMLTextAreaElement).value
    const parameters: Record<string, string> = {}
    dom.mcpDetail.querySelectorAll<HTMLInputElement>('.edit-param').forEach(inp => {
      parameters[inp.dataset.param!] = inp.value
    })
    await setToolDescOverride(tool.name, { description, parameters })
    // Re-report toolDefs so the server picks up the edit without reconnecting.
    state.port.postMessage({ type: 'agent:connect' })
    const fb = dom.mcpDetail.querySelector('#edit-feedback') as HTMLElement
    fb.textContent = '已保存，稍后同步给服务器'
    fb.style.color = 'var(--success)'
    await renderDetail(tool)
  })

  dom.mcpDetail.querySelector('#edit-reset')!.addEventListener('click', async () => {
    await setToolDescOverride(tool.name, { description: '', parameters: {} })
    state.port.postMessage({ type: 'agent:connect' })
    await renderDetail(tool)
  })

  dom.mcpDetail.querySelector('#test-run')!.addEventListener('click', () => {
    const out = dom.mcpDetail.querySelector('#test-result') as HTMLElement
    let args: Record<string, any> = {}
    const raw = (dom.mcpDetail.querySelector('#test-args') as HTMLTextAreaElement).value.trim()
    if (raw) {
      try { args = JSON.parse(raw) } catch (e: any) {
        out.style.display = 'block'; out.className = 'test-result fail'; out.textContent = `参数 JSON 解析失败：${e?.message || e}`; return
      }
    }
    out.style.display = 'block'; out.className = 'test-result'; out.textContent = '执行中…'
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    state.pendingTests.set(requestId, r => {
      if (r.ok) {
        out.className = 'test-result ok'
        out.textContent = '成功\n' + safeStringify(r.result)
      } else {
        out.className = 'test-result fail'
        out.textContent = '失败：' + (r.error || '未知错误')
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
  if (!fn) return
  state.pendingTests.delete(requestId)
  fn(r)
}

export function wireMcp() {
  dom.mcpBack.addEventListener('click', () => void renderMcpList())
}
