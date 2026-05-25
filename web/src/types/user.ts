type ThemeMode = 'light' | 'dark'
type FontSize = 'sm' | 'md' | 'lg'

export interface User {
  id: number
  name: string
  account: string
  avatar?: string
  ui_theme_mode?: ThemeMode
  ui_font_size?: FontSize
  tavily_api_key?: string
  mcp_max_steps?: number
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
