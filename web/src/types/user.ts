type ThemeMode = 'light' | 'dark'
type FontSize = 'sm' | 'md' | 'lg'
export type BrainViewMode = 'sections' | 'all'

export interface ModelPreset {
  id: string
  name: string
  api_key: string
  base_url: string
  model: string
}

export type UserRole = 'owner' | 'admin' | 'member'

export interface User {
  id: number
  name: string
  account: string
  avatar?: string
  role?: UserRole
  ui_theme_mode?: ThemeMode
  ui_font_size?: FontSize
  ui_brain_view_mode?: BrainViewMode
  tavily_api_key?: string
  model_presets?: string
  mcp_max_steps?: number
  mcp_call_method?: string
  mcp_namespace_hints?: string
  mcp_dynamic_rule?: string
  mcp_format_error_hint?: string
  role_mcp_permissions?: string
  prompt_ai_message_notify?: string
  prompt_ai_message_inquiry?: string
  ai_message_inquiry_reminder_seconds?: number
  prompt_ai_message_inquiry_reminder?: string
  prompt_ai_message_reply?: string
  prompt_ai_message_chitchat?: string
  prompt_ai_message_reply_success?: string
  prompt_user_message_notice?: string
}
