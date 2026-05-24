import { post } from './http'

export interface HumanAskEvent {
  requestId: string
  userId: number
  aiConfigId?: number | null
  sessionId?: string | null
  jobId?: string | null
  kind: 'confirm' | 'select' | 'text'
  prompt: string
  options: string[]
  createdAt: number
}

export const answerHumanAsk = (requestId: string, answer: string) =>
  post<void>('/api/human/answer', { request_id: requestId, answer }, {
    fallbackError: '提交失败',
  })

export const cancelHumanAsk = (requestId: string) =>
  post<void>('/api/human/cancel', { request_id: requestId, answer: '' }, {
    fallbackError: '取消失败',
  })
