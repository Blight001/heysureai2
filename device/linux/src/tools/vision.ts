import { screenCapture, screenCaptureRegion } from './screen'
import { getRobot } from './shared/robot'

export async function visionCaptureGlobal(args: any = {}) {
  return screenCapture(args)
}

export async function visionCaptureMouse(args: any = {}) {
  const robot = getRobot()
  const { x, y } = robot.getMousePos()
  const radius = Number(args.radius || 50)
  const width = Number(args.width || radius * 2)
  const height = Number(args.height || radius * 2)
  const left = Math.max(0, Math.round(x - width / 2))
  const top = Math.max(0, Math.round(y - height / 2))
  const result = await screenCaptureRegion({
    ...args,
    x: left,
    y: top,
    width,
    height,
  })
  return {
    ...result,
    center: { x, y },
    radius,
  }
}

