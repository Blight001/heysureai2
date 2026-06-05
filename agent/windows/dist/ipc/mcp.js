"use strict";
// ipc/mcp.ts — the desktop MCP tool page: list this device's tools (with local
// description edits merged), save a description edit locally, and run one tool
// locally for the tester. Edits are reported to the server via toolDefs on the
// next register, so the server needs no per-tool storage.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMcpIpc = registerMcpIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const agent_runtime_1 = require("../services/agent-runtime");
const executor_1 = require("../executor");
const activity_log_1 = require("../services/activity-log");
function overrides() {
    return store_1.store.get('toolDescOverrides') || {};
}
function enabledMap() {
    return store_1.store.get('toolEnabled') || {};
}
function setEnabled(name, enabled) {
    const all = enabledMap();
    if (enabled)
        delete all[name];
    else
        all[name] = false;
    store_1.store.set('toolEnabled', all);
}
// Tool defs with the saved local description edits applied.
function effectiveDefs(includeDisabled = false) {
    const ov = overrides();
    const defs = includeDisabled ? (0, executor_1.getAllToolDefs)() : (0, executor_1.getToolDefs)();
    return defs.map(def => {
        const o = ov[def.name];
        if (!o)
            return def;
        const desc = String(o.description || '').trim();
        const props = (def.input_schema && def.input_schema.properties) || {};
        let nextProps = props;
        if (o.parameters && Object.keys(o.parameters).length) {
            nextProps = {};
            for (const [k, v] of Object.entries(props)) {
                const pd = String(o.parameters[k] || '').trim();
                nextProps[k] = pd ? { ...v, description: pd } : v;
            }
        }
        return { ...def, description: desc || def.description, input_schema: { ...def.input_schema, properties: nextProps } };
    });
}
function registerMcpIpc() {
    // List effective tool defs + which tools have local edits.
    electron_1.ipcMain.handle('mcp:list', () => ({
        tools: effectiveDefs(true),
        overrides: overrides(),
        enabled: enabledMap(),
    }));
    electron_1.ipcMain.handle('mcp:set-enabled', (_e, payload) => {
        const name = String(payload?.tool || '').trim();
        if (!name)
            return false;
        const known = (0, executor_1.getAllToolDefs)().some(def => def.name === name);
        if (!known)
            return false;
        setEnabled(name, payload?.enabled !== false);
        (0, agent_runtime_1.getAgent)()?.refreshRegistration();
        return true;
    });
    // Save (or clear) a tool's local description / parameter edits.
    electron_1.ipcMain.handle('mcp:save-desc', (_e, payload) => {
        const name = String(payload?.tool || '').trim();
        if (!name)
            return false;
        const all = overrides();
        const desc = String(payload.description || '').trim();
        const params = {};
        for (const [k, v] of Object.entries(payload.parameters || {})) {
            const pn = String(k || '').trim();
            const pv = String(v || '').trim();
            if (pn && pv)
                params[pn] = pv;
        }
        if (!desc && Object.keys(params).length === 0)
            delete all[name];
        else
            all[name] = { description: desc, parameters: params };
        store_1.store.set('toolDescOverrides', all);
        // Re-report toolDefs so the server picks up the edit (no reconnect needed).
        (0, agent_runtime_1.getAgent)()?.refreshRegistration();
        return true;
    });
    // Run one tool locally for the tester.
    electron_1.ipcMain.handle('mcp:test', async (_e, payload) => {
        const tool = String(payload?.tool || '').trim();
        if (!tool)
            return { success: false, error: '工具名为空' };
        if (!(0, executor_1.isToolEnabled)(tool))
            return { success: false, error: '该工具已在本机 MCP 栏目中关闭' };
        const agent = (0, agent_runtime_1.getAgent)();
        if (!agent)
            return { success: false, error: 'agent 未初始化' };
        (0, activity_log_1.sendActivityLog)('task', 'running', `测试: ${tool}`, payload.args);
        try {
            const r = await agent.runToolLocally(tool, payload.args || {});
            (0, activity_log_1.sendActivityLog)('task', r.success ? 'success' : 'error', `测试${r.success ? '完成' : '失败'}: ${tool}`);
            return { success: r.success, result: r.result, summary: r.summary };
        }
        catch (err) {
            (0, activity_log_1.sendActivityLog)('task', 'error', `测试失败: ${tool} — ${err?.message || err}`);
            return { success: false, error: err?.message || String(err) };
        }
    });
}
