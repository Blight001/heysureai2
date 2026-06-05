"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mouseMove = mouseMove;
exports.mouseClick = mouseClick;
exports.mouseDoubleClick = mouseDoubleClick;
exports.mouseRightClick = mouseRightClick;
exports.mouseScroll = mouseScroll;
exports.mouseDrag = mouseDrag;
const robot_1 = require("./shared/robot");
const coordinates_1 = require("./shared/coordinates");
const click_confirmation_1 = require("./shared/click-confirmation");
async function ensurePosition(args) {
    if (args.x !== undefined && args.y !== undefined) {
        const point = (0, coordinates_1.toRobotPoint)(Number(args.x), Number(args.y));
        await (0, robot_1.smoothMoveMouse)(point.x, point.y, moveOptions(args));
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
    const inputX = Number(args.x);
    const inputY = Number(args.y);
    const { x, y } = (0, coordinates_1.toRobotPoint)(inputX, inputY);
    const smooth = args.smooth !== false;
    if (smooth)
        await (0, robot_1.smoothMoveMouse)(x, y, moveOptions(args));
    else
        (0, robot_1.getRobot)().moveMouse(x, y);
    return { success: true, input_position: { x: inputX, y: inputY }, position: { x, y } };
}
async function mouseClick(args) {
    const inputPosition = args.x !== undefined && args.y !== undefined
        ? { x: Number(args.x), y: Number(args.y) }
        : undefined;
    const button = String(args.button || 'left').toLowerCase();
    const needsConfirmation = args.confirm_click !== false && args.confirmation !== false;
    const confirmed = args.confirmed === true || args.click_confirmed === true || args.confirmed_click === true;
    let confirmation;
    let confirmationError;
    if (needsConfirmation && !confirmed) {
        try {
            confirmation = await (0, click_confirmation_1.captureClickConfirmation)({
                enabled: true,
                x: inputPosition?.x,
                y: inputPosition?.y,
                display: args.display ?? args.screen,
                radius: args.confirm_radius ?? args.confirmation_radius ?? args.radius,
            });
        }
        catch (err) {
            confirmationError = err?.message || String(err);
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
        };
    }
    if (args.x !== undefined && args.y !== undefined) {
        await ensurePosition(args);
        await (0, robot_1.sleep)(30);
    }
    const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
    (0, robot_1.getRobot)().mouseClick(btn);
    const position = (0, robot_1.getRobot)().getMousePos();
    try {
        confirmation = await (0, click_confirmation_1.captureClickConfirmation)({
            enabled: needsConfirmation,
            x: inputPosition?.x,
            y: inputPosition?.y,
            display: args.display ?? args.screen,
            radius: args.confirm_radius ?? args.confirmation_radius ?? args.radius,
        });
    }
    catch (err) {
        confirmationError = err?.message || String(err);
    }
    return {
        success: true,
        button,
        clicked: true,
        confirmed,
        input_position: inputPosition,
        position,
        confirmation,
        confirmation_error: confirmationError,
    };
}
async function mouseDoubleClick(args) {
    const inputPosition = args.x !== undefined && args.y !== undefined
        ? { x: Number(args.x), y: Number(args.y) }
        : undefined;
    if (args.x !== undefined && args.y !== undefined) {
        await ensurePosition(args);
        await (0, robot_1.sleep)(30);
    }
    (0, robot_1.getRobot)().mouseClick('left', true);
    return { success: true, double_click: true, input_position: inputPosition, position: (0, robot_1.getRobot)().getMousePos() };
}
async function mouseRightClick(args) {
    const inputPosition = args.x !== undefined && args.y !== undefined
        ? { x: Number(args.x), y: Number(args.y) }
        : undefined;
    if (args.x !== undefined && args.y !== undefined) {
        await ensurePosition(args);
        await (0, robot_1.sleep)(30);
    }
    (0, robot_1.getRobot)().mouseClick('right');
    return { success: true, right_click: true, input_position: inputPosition, position: (0, robot_1.getRobot)().getMousePos() };
}
async function mouseScroll(args) {
    if (args.x !== undefined && args.y !== undefined) {
        const point = (0, coordinates_1.toRobotPoint)(Number(args.x), Number(args.y));
        (0, robot_1.getRobot)().moveMouse(point.x, point.y);
    }
    const amount = Number(args.amount || args.delta || 3);
    const direction = String(args.direction || 'down').toLowerCase();
    (0, robot_1.getRobot)().scrollMouse(0, direction === 'up' ? -amount : amount);
    return { success: true, direction, amount };
}
async function mouseDrag(args) {
    const inputFromX = Number(args.from_x || args.x1 || 0);
    const inputFromY = Number(args.from_y || args.y1 || 0);
    const inputToX = Number(args.to_x || args.x2 || 0);
    const inputToY = Number(args.to_y || args.y2 || 0);
    const from = (0, coordinates_1.toRobotPoint)(inputFromX, inputFromY);
    const to = (0, coordinates_1.toRobotPoint)(inputToX, inputToY);
    const robot = (0, robot_1.getRobot)();
    await (0, robot_1.smoothMoveMouse)(from.x, from.y, moveOptions(args));
    await (0, robot_1.sleep)(30);
    robot.mouseToggle('down', 'left');
    await (0, robot_1.sleep)(50);
    await (0, robot_1.smoothMoveMouse)(to.x, to.y, moveOptions(args));
    await (0, robot_1.sleep)(50);
    robot.mouseToggle('up', 'left');
    return {
        success: true,
        input_from: { x: inputFromX, y: inputFromY },
        input_to: { x: inputToX, y: inputToY },
        from,
        to,
    };
}
