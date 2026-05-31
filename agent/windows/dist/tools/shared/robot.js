"use strict";
// Lazy singleton accessor for the optional native module robotjs.
// Native modules can fail to load on non-Windows / unrebuilt environments;
// we defer the require call until a tool actually needs it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRobot = getRobot;
exports.sleep = sleep;
exports.smoothMoveMouse = smoothMoveMouse;
let robot = null;
function getRobot() {
    if (!robot) {
        try {
            robot = require('robotjs');
        }
        catch (_e) {
            throw new Error('robotjs not available — run: npm run rebuild');
        }
    }
    return robot;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function humanizeOffset(value = 0, noJitterProbability = 0.93) {
    const jitterRoll = Math.random();
    const jitterEdge = (1 - noJitterProbability) / 2;
    const jitter = jitterRoll < jitterEdge ? -1 : jitterRoll > 1 - jitterEdge ? 1 : 0;
    return value + jitter;
}
async function smoothMoveMouse(targetX, targetY, options = {}) {
    const robot = getRobot();
    const current = robot.getMousePos();
    const startX = Number(current.x);
    const startY = Number(current.y);
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance < 1) {
        robot.moveMouse(Math.round(targetX), Math.round(targetY));
        return;
    }
    const speed = Math.max(20, Number(options.speed || 100));
    const minSteps = Math.max(1, Number(options.minSteps || 8));
    const maxSteps = Math.max(minSteps, Number(options.maxSteps || 45));
    const steps = clamp(Math.ceil(distance / speed), minSteps, maxSteps);
    const intervalMs = Math.max(0, Number(options.intervalMs ?? 3));
    const jitter = options.jitter !== false;
    let lastX = startX;
    let lastY = startY;
    for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const speedRatio = 1 - Math.pow(1 - t, 2);
        let nextX = startX + dx * speedRatio;
        let nextY = startY + dy * speedRatio;
        if (jitter && step < steps) {
            nextX += humanizeOffset(0);
            nextY += humanizeOffset(0);
        }
        const roundedX = Math.round(nextX);
        const roundedY = Math.round(nextY);
        if (roundedX !== lastX || roundedY !== lastY || step === steps) {
            robot.moveMouse(roundedX, roundedY);
            lastX = roundedX;
            lastY = roundedY;
        }
        if (intervalMs > 0 && step < steps)
            await sleep(intervalMs);
    }
    robot.moveMouse(Math.round(targetX), Math.round(targetY));
}
