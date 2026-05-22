"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clipboardGet = clipboardGet;
exports.clipboardSet = clipboardSet;
const electron_1 = require("electron");
function clipboardGet(args = {}) {
    const format = String(args.format || 'text').toLowerCase();
    let content;
    if (format === 'html') {
        content = electron_1.clipboard.readHTML();
    }
    else if (format === 'rtf') {
        content = electron_1.clipboard.readRTF();
    }
    else {
        content = electron_1.clipboard.readText();
    }
    return { success: true, format, content, length: content.length };
}
function clipboardSet(args) {
    const text = String(args.text || args.content || '');
    electron_1.clipboard.writeText(text);
    return { success: true, written: text.length };
}
