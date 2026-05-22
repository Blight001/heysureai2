let robot: any = null
function getRobot() {
  if (!robot) {
    try { robot = require('robotjs') } catch (e) {
      throw new Error('robotjs not available — run: npm run rebuild')
    }
  }
  return robot
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function mouseMove(args: any) {
  const x = Number(args.x)
  const y = Number(args.y)
  const smooth = args.smooth !== false
  if (smooth) {
    getRobot().moveMouseSmooth(x, y)
  } else {
    getRobot().moveMouse(x, y)
  }
  return { success: true, position: { x, y } }
}

export async function mouseClick(args: any) {
  const button = String(args.button || 'left').toLowerCase()
  if (args.x !== undefined && args.y !== undefined) {
    getRobot().moveMouseSmooth(Number(args.x), Number(args.y))
    await sleep(50)
  }
  getRobot().mouseClick(button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left')
  const pos = getRobot().getMousePos()
  return { success: true, button, position: pos }
}

export async function mouseDoubleClick(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    getRobot().moveMouseSmooth(Number(args.x), Number(args.y))
    await sleep(50)
  }
  getRobot().mouseClick('left', true)
  const pos = getRobot().getMousePos()
  return { success: true, double_click: true, position: pos }
}

export async function mouseRightClick(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    getRobot().moveMouseSmooth(Number(args.x), Number(args.y))
    await sleep(50)
  }
  getRobot().mouseClick('right')
  const pos = getRobot().getMousePos()
  return { success: true, right_click: true, position: pos }
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
  getRobot().moveMouseSmooth(fromX, fromY)
  await sleep(50)
  getRobot().mouseToggle('down', 'left')
  await sleep(50)
  getRobot().moveMouseSmooth(toX, toY)
  await sleep(50)
  getRobot().mouseToggle('up', 'left')
  return { success: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } }
}
