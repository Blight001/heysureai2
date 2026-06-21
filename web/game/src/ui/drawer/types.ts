import type { WorldMember } from '../../world/store'
import type { PortraitSpec } from '../portrait'

export interface DeviceMcpScopeView {
  capabilities: string[]
  allowed: string[]
  hasRecord: boolean
}

export interface PanelTab {
  name: string
  build: (host: HTMLElement) => void
}

/** 外观草稿：与 WorldActorMeta 字段一一对应 */
export interface AppearanceDraft {
  skin: string
  tint: string
  scale: number
  aura: string
}

export interface DrawerActions {
  toggleRun(aiConfigId: number): Promise<void>
  assignAgent(deviceId: string, aiConfigId: number | null): Promise<void>
  loadDeviceMcpScope(deviceId: string): Promise<DeviceMcpScopeView>
  saveDeviceMcpScope(deviceId: string, tools: string[]): Promise<void>
  setAppearance(aiConfigId: number, meta: AppearanceDraft): Promise<void>
  /** 调参时所见即所得（仅本地，不落库；下次快照刷新自动回到已保存值） */
  previewAppearance(aiConfigId: number, meta: AppearanceDraft): void
  createTask(aiConfigId: number, title: string, instruction: string): Promise<void>
  openChat(aiConfigId: number): void
  focusMember(aiConfigId: number): void
}

export interface PanelController {
  readonly actions: DrawerActions
  readonly memberInfoHost: HTMLElement
  openPanel(opts: { title: string; subtitle?: string; portrait?: PortraitSpec | null; tabs: PanelTab[] }): void
  setActiveMemberId(id: WorldMember['id'] | null): void
  section(titleText: string): HTMLDivElement
  rows(sec: HTMLElement, rows: Array<[string, string]>): void
  feedback(sec: HTMLElement): HTMLDivElement
  runAction(
    btn: HTMLButtonElement | null,
    fb: HTMLElement,
    fn: () => Promise<void>,
    okMsg?: string,
  ): Promise<boolean>
}
