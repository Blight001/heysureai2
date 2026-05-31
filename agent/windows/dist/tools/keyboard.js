"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyboardType = keyboardType;
exports.keyboardPress = keyboardPress;
const robot_1 = require("./shared/robot");
const KEY_MAP = {
    ctrl: 'control', cmd: 'command', win: 'command',
    del: 'delete', ins: 'insert', esc: 'escape',
    pgup: 'pageup', pgdn: 'pagedown',
    enter: 'enter', return: 'enter', tab: 'tab', space: 'space',
    backspace: 'backspace', caps: 'caps_lock',
    up: 'up', down: 'down', left: 'left', right: 'right',
    home: 'home', end: 'end',
    f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', f5: 'f5',
    f6: 'f6', f7: 'f7', f8: 'f8', f9: 'f9', f10: 'f10',
    f11: 'f11', f12: 'f12',
};
function normalizeKey(key) {
    return KEY_MAP[key.toLowerCase()] || key.toLowerCase();
}
async function keyboardType(args) {
    const text = String(args.text || args.string || '');
    if (!text)
        throw new Error('text is required');
    const delay = Number(args.delay_ms || 0);
    if (delay > 0) {
        (0, robot_1.getRobot)().typeStringDelayed(text, delay);
    }
    else {
        (0, robot_1.getRobot)().typeString(text);
    }
    return { success: true, typed: text, length: text.length };
}
async function keyboardPress(args) {
    const raw = args.keys || args.shortcut || args.key || args.combo || '';
    const parts = Array.isArray(raw)
        ? raw.map(String)
        : String(raw).split('+').map((s) => s.trim());
    if (parts.length === 0)
        throw new Error('keys is required');
    const normalized = parts.map(normalizeKey);
    if (normalized.length === 1) {
        (0, robot_1.getRobot)().keyTap(normalized[0]);
    }
    else {
        const main = normalized[normalized.length - 1];
        const mods = normalized.slice(0, -1);
        (0, robot_1.getRobot)().keyTap(main, mods);
    }
    return { success: true, pressed: parts.join('+') };
}
