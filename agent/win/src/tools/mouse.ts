import { getRobot, sleep } from './shared/robot'

function ensurePosition(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    getRobot().moveMouseSmooth(Number(args.x), Number(args.y))
  }
}

export async function mouseMove(args: any) {
  const x = Number(args.x)
  const y = Number(args.y)
  const smooth = args.smooth !== false
  if (smooth) getRobot().moveMouseSmooth(x, y)
  else getRobot().moveMouse(x, y)
  return { success: true, position: { x, y } }
}

export async function mouseClick(args: any) {
  const button = String(args.button || 'left').toLowerCase()
  if (args.x !== undefined && args.y !== undefined) {
    ensurePosition(args); await sleep(50)
  }
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left'
  getRobot().mouseClick(btn)
  return { success: true, button, position: getRobot().getMousePos() }
}

export async function mouseDoubleClick(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    ensurePosition(args); await sleep(50)
  }
  getRobot().mouseClick('left', true)
  return { success: true, double_click: true, position: getRobot().getMousePos() }
}

export async function mouseRightClick(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    ensurePosition(args); await sleep(50)
  }
  getRobot().mouseClick('right')
  return { success: true, right_click: true, position: getRobot().getMousePos() }
}

export async function mouseScroll(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    getRobot().moveMouse(Number(args.x), Number(args.y))
  }
  const amount = Number(args.amount || args.delta || 3)
  const direction = String(args.direction || 'down').toLowerCase()
  getRobot().scrollMouse(0, direction === 'up' ? -amount : amount)
  return { success: true, direction, amount }
}

export async function mouseDrag(args: any) {
  const fromX = Number(args.from_x || args.x1 || 0)
  const fromY = Number(args.from_y || args.y1 || 0)
  const toX = Number(args.to_x || args.x2 || 0)
  const toY = Number(args.to_y || args.y2 || 0)
  const robot = getRobot()
  robot.moveMouseSmooth(fromX, fromY); await sleep(50)
  robot.mouseToggle('down', 'left'); await sleep(50)
  robot.moveMouseSmooth(toX, toY); await sleep(50)
  robot.mouseToggle('up', 'left')
  return { success: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } }
}
