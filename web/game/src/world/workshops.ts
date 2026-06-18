import type { Point } from './layout'
import type { WorldMember, WorldWorkshop } from './store'

export const LIBRARY_DOOR: Point = { x: 880, y: 510 }
export const OFFLINE_KEEP_MS = 60000
export const INTERACT_RANGE = 96

export const workshopSheetForType = (type: WorldWorkshop['type']): string => {
  if (type === 'workshop') return 'building_workshop_knowledge.png'
  if (type === 'desktop') return 'building_workshop_desktop.png'
  return 'building_workshop_browser.png'
}

export const workshopGlowTintForType = (type: WorldWorkshop['type']): number => {
  if (type === 'browser') return 0x72d8ff
  if (type === 'workshop') return 0xc99cff
  return 0xffd36b
}

export const workshopIsActive = (workshop: WorldWorkshop, boundMember: WorldMember | undefined): boolean => {
  return workshop.online && (
    workshop.lifecycle === 'dispatching'
    || boundMember?.taskStatus === 'running'
    || !!(boundMember?.hasActiveTask && boundMember.runtimeStatus === 'running')
  )
}
