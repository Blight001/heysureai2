import { ChatMessage, AIToolDef, AIToolUse } from './types'

export interface AIResponse {
  text?:      string
  toolUses?:  AIToolUse[]
  stopReason?: string
}

export async function callAI(
  baseUrl:      string,
  apiKey:       string,
  model:        string,
  messages:     ChatMessage[],
  tools?:       AIToolDef[],
  systemPrompt?: string,
): Promise<AIResponse> {
  if (!apiKey) throw new Error('AI Key is not configured')
  const isAnthropic = baseUrl.includes('anthropic.com')
  const endpoint    = isAnthropic
    ? `${baseUrl.replace(/\/$/, '')}/v1/messages`
    : `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key']          = apiKey
    headers['anthropic-version']  = '2023-06-01'
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  let body: any
  if (isAnthropic) {
    body = { model, max_tokens: 4096, messages }
    if (tools?.length)  body.tools  = tools
    if (systemPrompt)   body.system = systemPrompt
  } else {
    // OpenAI-compatible: inject system as first message
    const openAiMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages
    body = { model, max_tokens: 4096, messages: openAiMessages }
    if (tools?.length) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    }
  }

  const res  = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  const data: any = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `AI API error ${res.status}`)

  if (isAnthropic) {
    const textBlock    = data.content?.find((b: any) => b.type === 'text')
    const toolUseBlocks: AIToolUse[] = (data.content || []).filter((b: any) => b.type === 'tool_use')
    return {
      text:       textBlock?.text,
      toolUses:   toolUseBlocks.length ? toolUseBlocks : undefined,
      stopReason: data.stop_reason,
    }
  } else {
    const choice = data.choices?.[0]
    if (choice?.message?.tool_calls?.length) {
      const toolUses: AIToolUse[] = choice.message.tool_calls.map((tc: any) => ({
        type:  'tool_use',
        id:    tc.id,
        name:  tc.function.name,
        input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })(),
      }))
      return { toolUses, stopReason: choice.finish_reason }
    }
    return { text: choice?.message?.content || '', stopReason: choice?.finish_reason }
  }
}
