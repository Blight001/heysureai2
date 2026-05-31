import { store } from '../store'
import { getAgent } from './agent-runtime'
import { getToolDefs } from '../executor'
import { sendActivityLog } from './activity-log'

type Role = 'user' | 'assistant'
export interface OfflineChatMessage {
  role: Role
  content: string
}

export interface OfflineToolEvent {
  tool: string
  arguments: Record<string, any>
  success: boolean
  result: any
  summary: string
}

export interface OfflineChatResult {
  text: string
  think?: string
  toolsUsed: string[]
  toolEvents: OfflineToolEvent[]
}

export type OfflineChatProgress =
  | { type: 'think_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; tool: string; arguments: Record<string, any> }
  | { type: 'tool_result'; event: OfflineToolEvent }

interface AIToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, any>
}

interface AIResponse {
  text?: string
  think?: string
  toolUses?: AIToolUse[]
}

function stringifyContent(content: any): string {
  if (typeof content === 'string') return content
  try { return JSON.stringify(content) } catch { return String(content) }
}

function providerToolName(name: string, nameMap: Map<string, string>): string {
  const safe = toolNameForProvider(name)
  nameMap.set(safe, name)
  return safe
}

function providerMessages(messages: any[], nameMap: Map<string, string>): any[] {
  return messages.map(msg => {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((b: any) => b?.type === 'tool_use' ? { ...b, name: providerToolName(b.name, nameMap) } : b),
      }
    }
    return msg
  })
}

function openAiMessages(messages: any[], nameMap: Map<string, string>): any[] {
  const out: any[] = []
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolCalls = msg.content
        .filter((b: any) => b?.type === 'tool_use')
        .map((tu: any) => ({
          id: tu.id,
          type: 'function',
          function: { name: providerToolName(tu.name, nameMap), arguments: JSON.stringify(tu.input || {}) },
        }))
      if (toolCalls.length) {
        out.push({ role: 'assistant', content: null, tool_calls: toolCalls })
        continue
      }
    }
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const tr of msg.content) {
        if (tr?.type !== 'tool_result') continue
        out.push({ role: 'tool', tool_call_id: tr.tool_use_id || 'call_0', content: stringifyContent(tr.content) })
      }
      continue
    }
    out.push({ role: msg.role, content: stringifyContent(msg.content) })
  }
  return out
}

function toolNameForProvider(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '__')
}

function toolNameFromProvider(name: string, nameMap: Map<string, string>): string {
  return nameMap.get(name) || name
}

function splitThink(text: string): { text: string; think?: string } {
  const raw = String(text || '')
  const match = raw.match(/<think>\s*([\s\S]*?)\s*<\/think>/i)
  if (!match) return { text: raw.trim() }
  return {
    think: String(match[1] || '').trim(),
    text: raw.replace(/<think>\s*[\s\S]*?\s*<\/think>/gi, '').trim(),
  }
}

async function streamOpenAiResponse(res: Response, nameMap: Map<string, string>, onProgress?: (event: OfflineChatProgress) => void): Promise<AIResponse> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('AI API did not return a readable stream')

  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let think = ''
  const calls = new Map<number, { id: string; name: string; arguments: string }>()

  const handlePayload = (payload: string) => {
    const raw = payload.trim()
    if (!raw || raw === '[DONE]') return
    let data: any
    try { data = JSON.parse(raw) } catch { return }
    const delta = data.choices?.[0]?.delta || {}
    const reasoning = delta.reasoning_content || delta.reasoning || delta.reasoning_text
    if (reasoning) {
      think += String(reasoning)
      onProgress?.({ type: 'think_delta', text: String(reasoning) })
    }
    if (delta.content) {
      text += String(delta.content)
      onProgress?.({ type: 'text_delta', text: String(delta.content) })
    }
    for (const tc of delta.tool_calls || []) {
      const idx = Number.isFinite(tc.index) ? tc.index : calls.size
      const current = calls.get(idx) || { id: '', name: '', arguments: '' }
      if (tc.id) current.id = tc.id
      if (tc.function?.name) current.name += String(tc.function.name)
      if (tc.function?.arguments) current.arguments += String(tc.function.arguments)
      calls.set(idx, current)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      for (const line of part.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) handlePayload(trimmed.slice(5))
      }
    }
  }
  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data:')) handlePayload(trimmed.slice(5))
    }
  }

  const toolUses = Array.from(calls.values())
    .filter(tc => tc.name)
    .map((tc, idx) => ({
      type: 'tool_use' as const,
      id: tc.id || `call_${idx}`,
      name: toolNameFromProvider(tc.name, nameMap),
      input: (() => { try { return JSON.parse(tc.arguments || '{}') } catch { return {} } })(),
    }))
  return { text, think: think.trim() || undefined, toolUses: toolUses.length ? toolUses : undefined }
}

async function callAI(
  messages: any[],
  systemPrompt: string,
  allowedTools?: string[],
  onProgress?: (event: OfflineChatProgress) => void,
): Promise<AIResponse> {
  const s = store.store
  const baseUrl = String(s.aiBaseUrl || '').replace(/\/+$/, '')
  const apiKey = String(s.aiKey || '').trim()
  const model = String(s.aiModel || '').trim()
  if (!apiKey) throw new Error('未配置 AI Key')
  if (!baseUrl) throw new Error('未配置 Base URL')
  if (!model) throw new Error('未配置模型')

  const isAnthropic = baseUrl.includes('anthropic.com')
  const endpoint = isAnthropic ? `${baseUrl}/v1/messages` : `${baseUrl}/v1/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const allowed = Array.isArray(allowedTools)
    ? new Set(allowedTools.map(t => String(t || '').trim()).filter(Boolean))
    : null
  const nameMap = new Map<string, string>()
  const tools = getToolDefs()
    .filter(t => !allowed || allowed.has(t.name))
    .map(t => ({
      ...t,
      name: providerToolName(t.name, nameMap),
      description: `${t.description}\n\n原始 MCP 工具名: ${t.name}`,
    }))
  const body: any = isAnthropic
    ? {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: providerMessages(messages, nameMap),
        ...(tools.length ? { tools } : {}),
      }
    : {
        model,
        max_tokens: 4096,
        stream: true,
        messages: [{ role: 'system', content: systemPrompt }, ...openAiMessages(messages, nameMap)],
        ...(tools.length ? { tools: tools.map(t => {
          return {
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          }
        }) } : {}),
      }

  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}))
    throw new Error(data?.error?.message || `AI API error ${res.status}`)
  }
  if (!isAnthropic) return streamOpenAiResponse(res, nameMap, onProgress)

  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `AI API error ${res.status}`)

  if (isAnthropic) {
    const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text || '').join('\n').trim()
    const toolUses = (data.content || [])
      .filter((b: any) => b.type === 'tool_use')
      .map((tu: any) => ({ ...tu, name: toolNameFromProvider(tu.name, nameMap) }))
    return { text, toolUses: toolUses.length ? toolUses : undefined }
  }

  const choice = data.choices?.[0]
  const calls = choice?.message?.tool_calls || []
  if (calls.length) {
    return {
      toolUses: calls.map((tc: any) => ({
        type: 'tool_use',
        id: tc.id,
        name: toolNameFromProvider(tc.function?.name || '', nameMap),
        input: (() => { try { return JSON.parse(tc.function?.arguments || '{}') } catch { return {} } })(),
      })),
    }
  }
  return { text: choice?.message?.content || '', think: choice?.message?.reasoning_content || undefined }
}

export async function runOfflineChat(
  userMessages: OfflineChatMessage[],
  prompt?: string,
  allowedTools?: string[],
  onProgress?: (event: OfflineChatProgress) => void,
): Promise<OfflineChatResult> {
  const basePrompt = String(prompt || store.get('offlinePrompt') || '').trim()
  const systemPrompt = `${basePrompt}\n\n如果任务需要说明处理思路，可用 <think>...</think> 输出简短、可公开的思考摘要；不要在其中输出敏感信息、密钥或冗长推理。`
  const messages: any[] = userMessages.map(m => ({ role: m.role, content: m.content }))
  const toolsUsed: string[] = []
  const toolEvents: OfflineToolEvent[] = []
  const maxTurns = 12

  for (let i = 0; i < maxTurns; i++) {
    const resp = await callAI(messages, systemPrompt, allowedTools, onProgress)
    if (!resp.toolUses?.length) {
      const parsed = splitThink(resp.text || '完成')
      return { text: parsed.text || '完成', think: resp.think || parsed.think, toolsUsed, toolEvents }
    }

    messages.push({ role: 'assistant', content: resp.toolUses })
    const toolResults: any[] = []
    for (const tu of resp.toolUses) {
      toolsUsed.push(tu.name)
      onProgress?.({ type: 'tool_start', tool: tu.name, arguments: tu.input || {} })
      sendActivityLog('task', 'running', `[离线AI工具] ${tu.name}`, tu.input)
      try {
        const r = await getAgent()?.runToolLocally(tu.name, tu.input || {})
        const content = r?.success ? r.result : `Error: ${r?.summary || '工具执行失败'}`
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content, is_error: !r?.success })
        const event = {
          tool: tu.name,
          arguments: tu.input || {},
          success: !!r?.success,
          result: r?.result ?? null,
          summary: r?.summary || '',
        }
        toolEvents.push(event)
        onProgress?.({ type: 'tool_result', event })
        sendActivityLog('task', r?.success ? 'success' : 'error', `离线工具${r?.success ? '完成' : '失败'}: ${tu.name}`)
      } catch (err: any) {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${err?.message || err}`, is_error: true })
        const event = {
          tool: tu.name,
          arguments: tu.input || {},
          success: false,
          result: null,
          summary: err?.message || String(err),
        }
        toolEvents.push(event)
        onProgress?.({ type: 'tool_result', event })
        sendActivityLog('task', 'error', `离线工具异常: ${tu.name} - ${err?.message || err}`)
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return { text: '已达到最大工具调用轮次。', toolsUsed, toolEvents }
}
