import { get } from './http'

/**
 * `/api/chat/files` returns a flat array of file paths inside the configured
 * workspace. It's named "chat/files" for historical reasons (uploaded chat
 * attachments share the same workspace) but every consumer treats it as a
 * generic workspace listing.
 */
export const listWorkspaceFiles = () =>
  get<string[]>('/api/chat/files', { fallbackError: '工作区文件列表加载失败' })
