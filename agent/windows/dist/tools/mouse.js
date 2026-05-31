"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mouseMove = mouseMove;
exports.mouseClick = mouseClick;
exports.mouseDoubleClick = mouseDoubleClick;
exports.mouseRightClick = mouseRightClick;
exports.mouseScroll = mouseScroll;
exports.mouseDrag = mouseDrag;
const robot_1 = require("./shared/robot");
async function ensurePosition(args) {
    if (args.x !== undefined && args.y !== undefined) {
        await (0, robot_1.smoothMoveMouse)(Number(args.x), Number(args.y), moveOptions(args));
    }
}
function moveOptions(args) {
    return {
        speed: args.speed !== undefined ? Number(args.speed) : undefined,
        minSteps: args.min_steps !== undefined ? Number(args.min_steps) : undefined,
        maxSteps: args.max_steps !== undefined ? Number(args.max_steps) : undefined,
        intervalMs: args.interval_ms !== undefined ? Number(args.interval_ms) : undefined,
        jitter: args.jitter,
    };
}
async function mouseMove(args) {
    const x = Number(args.x);
    const y = Number(args.y);
    const smooth = args.smooth !== false;
    if (smooth)
        await (0, robot_1.smoothMoveMouse)(x, y, moveOptions(args));
    else
        (0, robot_1.getRobot)().moveMouse(x, y);
    return { success: true, position: { x, y } };
}
async function mouseClick(args) {
    const button = String(args.button || 'left').toLowerCase();
    if (args.x !== undefined && args.y !== undefined) {
        await ensurePosition(args);
        await (0, robot_1.sleep)(30);
    }
    const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
    (0, robot_1.getRobot)().mouseClick(btn);
    return { success: true, button, position: (0, robot_1.getRobot)().getMousePos() };
}
async function mouseDoubleClick(args) {
    if (args.x !== undefined && args.y !== undefined) {
        await ensurePosition(args);
        await (0, robot_1.sleep)(30);
    }
    (0, robot_1.getRobot)().mouseClick('left', true);
    return { success: true, double_click: true, position: (0, robot_1.getRobot)().getMousePos() };
}
async function mouseRightClick(args) {
    if (args.x !== undefined && args.y !== undefined) {
        await ensurePosition(args);
        await (0, robot_1.sleep)(30);
    }
    (0, robot_1.getRobot)().mouseClick('right');
    return { success: true, right_click: true, position: (0, robot_1.getRobot)().getMousePos() };
}
async function mouseScroll(args) {
    if (args.x !== undefined && args.y !== undefined) {
        (0, robot_1.getRobot)().moveMouse(Number(args.x), Number(args.y));
    }
    const amount = Number(args.amount || args.delta || 3);
    const direction = String(args.direction || 'down').toLowerCase();
    (0, robot_1.getRobot)().scrollMouse(0, direction === 'up' ? -amount : amount);
    return { success: true, direction, amount };
}
async function mouseDrag(args) {
    const fromX = Number(args.from_x || args.x1 || 0);
    const fromY = Number(args.from_y || args.y1 || 0);
    const toX = Number(args.to_x || args.x2 || 0);
    const toY = Number(args.to_y || args.y2 || 0);
    const robot = (0, robot_1.getRobot)();
    await (0, robot_1.smoothMoveMouse)(fromX, fromY, moveOptions(args));
    await (0, robot_1.sleep)(30);
    robot.mouseToggle('down', 'left');
    await (0, robot_1.sleep)(50);
    await (0, robot_1.smoothMoveMouse)(toX, toY, moveOptions(args));
    await (0, robot_1.sleep)(50);
    robot.mouseToggle('up', 'left');
    return { success: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
}
