import { getRobot, sleep, smoothMoveMouse } from './shared/robot'
import { toRobotPoint } from './shared/coordinates'
import { captureClickConfirmation } from './shared/click-confirmation'

async function ensurePosition(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    const point = toRobotPoint(Number(args.x), Number(args.y))
    await smoothMoveMouse(point.x, point.y, moveOptions(args))
  }
}

function moveOptions(args: any) {
  return {
    speed: args.speed !== undefined ? Number(args.speed) : undefined,
    minSteps: args.min_steps !== undefined ? Number(args.min_steps) : undefined,
    maxSteps: args.max_steps !== undefined ? Number(args.max_steps) : undefined,
    intervalMs: args.interval_ms !== undefined ? Number(args.interval_ms) : undefined,
    jitter: args.jitter,
  }
}

export async function mouseMove(args: any) {
  const inputX = Number(args.x)
  const inputY = Number(args.y)
  const { x, y } = toRobotPoint(inputX, inputY)
  const smooth = args.smooth !== false
  if (smooth) await smoothMoveMouse(x, y, moveOptions(args))
  else getRobot().moveMouse(x, y)
  return { success: true, input_position: { x: inputX, y: inputY }, position: { x, y } }
}

export async function mouseClick(args: any) {
  const inputPosition = args.x !== undefined && args.y !== undefined
    ? { x: Number(args.x), y: Number(args.y) }
    : undefined
  const button = String(args.button || 'left').toLowerCase()
  const needsConfirmation = args.confirm_click !== false
  const confirmed = args.confirmed === true

  // 截取目标点周边并画红点标注。pre = 点击前确认，post = 点击后核对，话术不同。
  const capture = (phase: 'pre' | 'post') => captureClickConfirmation({
    enabled: true,
    phase,
    x: inputPosition?.x,
    y: inputPosition?.y,
    display: args.display,
    radius: args.confirm_radius,
  })

  // 第一阶段：尚未确认时只返回确认图，不执行点击。
  if (needsConfirmation && !confirmed) {
    let confirmation: any
    let confirmationError: string | undefined
    try {
      confirmation = await capture('pre')
    } catch (err: any) {
      confirmationError = err?.message || String(err)
    }
    return {
      success: !confirmationError,
      button,
      clicked: false,
      pending_confirmation: true,
      requires_confirmed_click: true,
      input_position: inputPosition,
      confirmation,
      confirmation_error: confirmationError,
      summary: confirmationError
        ? `click confirmation failed: ${confirmationError}`
        : 'Click not executed yet. Inspect confirmation image, then call mouse.click with corrected x/y or confirmed:true.',
    }
  }

  // 第二阶段：已确认（或显式跳过确认），执行真正的点击。
  if (args.x !== undefined && args.y !== undefined) {
    await ensurePosition(args); await sleep(30)
  }
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left'
  getRobot().mouseClick(btn)
  const position = getRobot().getMousePos()

  // 点击后核对图：仅在启用确认时回传，话术为"已点击、请核对结果"。
  let verification: any
  let verificationError: string | undefined
  if (needsConfirmation) {
    try {
      verification = await capture('post')
    } catch (err: any) {
      verificationError = err?.message || String(err)
    }
  }
  return {
    success: true,
    button,
    clicked: true,
    confirmed,
    input_position: inputPosition,
    position,
    confirmation: verification,
    confirmation_error: verificationError,
  }
}

export async function mouseDoubleClick(args: any) {
  const inputPosition = args.x !== undefined && args.y !== undefined
    ? { x: Number(args.x), y: Number(args.y) }
    : undefined
  if (args.x !== undefined && args.y !== undefined) {
    await ensurePosition(args); await sleep(30)
  }
  getRobot().mouseClick('left', true)
  return { success: true, double_click: true, input_position: inputPosition, position: getRobot().getMousePos() }
}

export async function mouseRightClick(args: any) {
  const inputPosition = args.x !== undefined && args.y !== undefined
    ? { x: Number(args.x), y: Number(args.y) }
    : undefined
  if (args.x !== undefined && args.y !== undefined) {
    await ensurePosition(args); await sleep(30)
  }
  getRobot().mouseClick('right')
  return { success: true, right_click: true, input_position: inputPosition, position: getRobot().getMousePos() }
}

export async function mouseScroll(args: any) {
  if (args.x !== undefined && args.y !== undefined) {
    const point = toRobotPoint(Number(args.x), Number(args.y))
    getRobot().moveMouse(point.x, point.y)
  }
  const amount = Number(args.amount || args.delta || 3)
  const direction = String(args.direction || 'down').toLowerCase()
  getRobot().scrollMouse(0, direction === 'up' ? -amount : amount)
  return { success: true, direction, amount }
}

export async function mouseDrag(args: any) {
  const inputFromX = Number(args.from_x || args.x1 || 0)
  const inputFromY = Number(args.from_y || args.y1 || 0)
  const inputToX = Number(args.to_x || args.x2 || 0)
  const inputToY = Number(args.to_y || args.y2 || 0)
  const from = toRobotPoint(inputFromX, inputFromY)
  const to = toRobotPoint(inputToX, inputToY)
  const robot = getRobot()
  await smoothMoveMouse(from.x, from.y, moveOptions(args)); await sleep(30)
  robot.mouseToggle('down', 'left'); await sleep(50)
  await smoothMoveMouse(to.x, to.y, moveOptions(args)); await sleep(50)
  robot.mouseToggle('up', 'left')
  return {
    success: true,
    input_from: { x: inputFromX, y: inputFromY },
    input_to: { x: inputToX, y: inputToY },
    from,
    to,
  }
}
