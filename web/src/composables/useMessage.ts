import { reactive } from 'vue'

export type MessageType = 'info' | 'success' | 'warning' | 'error'
export type DialogType = 'alert' | 'confirm' | 'prompt'

interface MessageOptions {
  title?: string
  message: string
  type?: MessageType
  confirmText?: string
  cancelText?: string
  defaultValue?: string
  placeholder?: string
}

interface DialogState extends MessageOptions {
  show: boolean
  dialogType: DialogType
  resolve: (value: any) => void
}

const state = reactive<DialogState>({
  show: false,
  dialogType: 'alert',
  title: '',
  message: '',
  type: 'info',
  confirmText: '确定',
  cancelText: '取消',
  defaultValue: '',
  placeholder: '',
  resolve: () => {},
})

export const useMessage = () => {
  const alert = (options: string | MessageOptions) => {
    const opts = typeof options === 'string' ? { message: options } : options
    return new Promise<void>((resolve) => {
      state.dialogType = 'alert'
      state.title = opts.title || '提示'
      state.message = opts.message
      state.type = opts.type || 'info'
      state.confirmText = opts.confirmText || '确定'
      state.show = true
      state.resolve = resolve
    })
  }

  const confirm = (options: string | MessageOptions) => {
    const opts = typeof options === 'string' ? { message: options } : options
    return new Promise<boolean>((resolve) => {
      state.dialogType = 'confirm'
      state.title = opts.title || '确认'
      state.message = opts.message
      state.type = opts.type || 'warning'
      state.confirmText = opts.confirmText || '确定'
      state.cancelText = opts.cancelText || '取消'
      state.show = true
      state.resolve = resolve
    })
  }

  const prompt = (options: string | MessageOptions) => {
    const opts = typeof options === 'string' ? { message: options } : options
    return new Promise<string | null>((resolve) => {
      state.dialogType = 'prompt'
      state.title = opts.title || '输入'
      state.message = opts.message
      state.type = opts.type || 'info'
      state.confirmText = opts.confirmText || '确定'
      state.cancelText = opts.cancelText || '取消'
      state.defaultValue = opts.defaultValue || ''
      state.placeholder = opts.placeholder || '请输入内容'
      state.show = true
      state.resolve = resolve
    })
  }

  return {
    state,
    alert,
    confirm,
    prompt,
  }
}
