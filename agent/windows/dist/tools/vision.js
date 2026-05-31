"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visionCaptureGlobal = visionCaptureGlobal;
exports.visionCaptureMouse = visionCaptureMouse;
const screen_1 = require("./screen");
const robot_1 = require("./shared/robot");
async function visionCaptureGlobal(args = {}) {
    return (0, screen_1.screenCapture)(args);
}
async function visionCaptureMouse(args = {}) {
    const robot = (0, robot_1.getRobot)();
    const { x, y } = robot.getMousePos();
    const radius = Number(args.radius || 50);
    const width = Number(args.width || radius * 2);
    const height = Number(args.height || radius * 2);
    const left = Math.max(0, Math.round(x - width / 2));
    const top = Math.max(0, Math.round(y - height / 2));
    const result = await (0, screen_1.screenCaptureRegion)({
        ...args,
        x: left,
        y: top,
        width,
        height,
    });
    return {
        ...result,
        center: { x, y },
        radius,
    };
}
