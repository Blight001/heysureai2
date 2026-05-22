"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeServerUrl = normalizeServerUrl;
function normalizeServerUrl(raw) {
    const value = String(raw || '').trim();
    if (!value)
        return value;
    const url = new URL(value);
    if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1';
    }
    return url.href.replace(/\/$/, '');
}
