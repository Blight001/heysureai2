"use strict";
// Server-backed AI chat for the desktop main window.
// Drives one long-lived "软件端对话" session per AI config, polls run status
// until the AI finishes producing its reply.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatHistory = getChatHistory;
exports.sendChatMessage = sendChatMessage;
const server_client_1 = require("./server-client");
const POLL_INTERVAL_MS = 800;
const MAX_POLL_COUNT = 600;
const DESKTOP_SESSION_NAME = '软件端对话';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function ensureSession(settings) {
    const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(settings);
    const query = new URLSearchParams({
        ai_kind: 'assistant',
        ai_config_id: String(aiConfigId),
    }).toString();
    const sessions = await (0, server_client_1.serverFetch)(base, `/api/chat/sessions?${query}`, {
        token, failureMessage: '会话列表加载失败',
    });
    if (Array.isArray(sessions) && sessions.length > 0) {
        const preferred = sessions.find((s) => /^软件端对话|^Windows Agent/.test(String(s?.name || ''))) || sessions[0];
        return { id: String(preferred.id), name: String(preferred.name || DESKTOP_SESSION_NAME) };
    }
    const created = await (0, server_client_1.serverFetch)(base, `/api/chat/sessions`, {
        method: 'POST',
        token,
        body: { name: DESKTOP_SESSION_NAME, ai_config_id: aiConfigId, ai_kind: 'assistant' },
        failureMessage: '会话创建失败',
    });
    return { id: String(created?.id || ''), name: String(created?.name || DESKTOP_SESSION_NAME) };
}
async function getChatHistory(settings) {
    const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(settings);
    const session = await ensureSession(settings);
    const query = new URLSearchParams({
        ai_kind: 'assistant',
        ai_config_id: String(aiConfigId),
        session_id: session.id,
    }).toString();
    const rows = await (0, server_client_1.serverFetch)(base, `/api/chat/history?${query}`, {
        token, failureMessage: '会话历史加载失败',
    });
    return Array.isArray(rows) ? rows : [];
}
async function sendChatMessage(settings, content) {
    const text = String(content || '').trim();
    if (!text)
        throw new Error('消息内容不能为空');
    const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(settings);
    const session = await ensureSession(settings);
    const started = await (0, server_client_1.serverFetch)(base, `/api/chat/run/start`, {
        method: 'POST',
        token,
        body: {
            visible_content: text,
            model_content: text,
            session_id: session.id,
            session_name: session.name,
            ai_config_id: aiConfigId,
            ai_kind: 'assistant',
        },
        timeoutMs: 15000,
        failureMessage: '发起对话失败',
    });
    const runId = String(started?.run_id || '');
    if (!runId)
        throw new Error('服务器未返回运行 ID');
    let lastText = '';
    for (let i = 0; i < MAX_POLL_COUNT; i++) {
        await sleep(POLL_INTERVAL_MS);
        const st = await (0, server_client_1.serverFetch)(base, `/api/chat/run/status/${encodeURIComponent(runId)}`, { token, failureMessage: '运行状态查询失败' });
        lastText = String(st?.live_text || lastText || '');
        const status = String(st?.status || '');
        if (status === 'completed')
            return { text: lastText || '完成', sessionId: session.id };
        if (status === 'stopped')
            return { text: lastText || '（已停止）', sessionId: session.id };
        if (status === 'error')
            throw new Error(st?.error_message || 'AI 对话执行失败');
    }
    return { text: lastText || '（超时，未收到完整回复）', sessionId: session.id };
}
