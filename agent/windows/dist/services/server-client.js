"use strict";
// Thin wrapper around Electron's `net.fetch` for talking to the HeySure server.
// Centralizes URL normalization, auth header injection, timeout, and error
// extraction so the IPC handlers don't each reinvent it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerError = void 0;
exports.resolveBaseUrl = resolveBaseUrl;
exports.requireAuth = requireAuth;
exports.requireAuthWithAi = requireAuthWithAi;
exports.serverFetch = serverFetch;
exports.pingServer = pingServer;
const electron_1 = require("electron");
const server_url_1 = require("../server-url");
const auth_state_1 = require("./auth-state");
const DEFAULT_TIMEOUT_MS = 10000;
class ServerError extends Error {
    constructor(message, status, detail) {
        super(message);
        this.status = status;
        this.detail = detail;
    }
}
exports.ServerError = ServerError;
function resolveBaseUrl(rawUrl) {
    return (0, server_url_1.normalizeServerUrl)(rawUrl);
}
// Variant that requires an authenticated session (throws if missing).
function requireAuth(settings) {
    if (!settings.serverUrl || !settings.authToken)
        throw new Error('未登录');
    return { base: resolveBaseUrl(settings.serverUrl), token: settings.authToken };
}
// Variant that also requires a selected AI config (most chat/task endpoints).
function requireAuthWithAi(settings) {
    const { base, token } = requireAuth(settings);
    if (!settings.selectedAiConfigId)
        throw new Error('未选择 AI 成员');
    return { base, token, aiConfigId: Number(settings.selectedAiConfigId) };
}
async function readJson(res, fallback, wasAuthenticated = false) {
    const text = await res.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        }
        catch {
            data = { detail: text };
        }
    }
    if (!res.ok) {
        const message = res.status === 401 && wasAuthenticated
            ? '登录已过期，请重新登录'
            : data?.detail || data?.error || `${fallback} (${res.status})`;
        if (res.status === 401 && wasAuthenticated) {
            (0, auth_state_1.clearStoredAuthSession)();
        }
        throw new ServerError(message, res.status, data);
    }
    return data;
}
async function serverFetch(base, pathname, opts = {}) {
    const method = opts.method || 'GET';
    const headers = {};
    if (opts.token)
        headers['Authorization'] = `Bearer ${opts.token}`;
    if (opts.body !== undefined)
        headers['Content-Type'] = 'application/json';
    const res = await electron_1.net.fetch(`${base}${pathname}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
    return readJson(res, opts.failureMessage || `请求失败`, !!opts.token);
}
// Health-probe used by the "test connection" button. Falls back to the root
// path if /health is not implemented and returns latency in ms.
async function pingServer(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value)
        return { success: false, error: '未配置服务器 URL' };
    let base;
    try {
        base = resolveBaseUrl(value);
    }
    catch {
        return { success: false, error: '服务器 URL 格式无效' };
    }
    try {
        const start = Date.now();
        const res = await electron_1.net.fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
            .catch(() => electron_1.net.fetch(base, { signal: AbortSignal.timeout(5000) }));
        return { success: true, status: res.status, ms: Date.now() - start };
    }
    catch (err) {
        return { success: false, error: err.message || String(err) };
    }
}
