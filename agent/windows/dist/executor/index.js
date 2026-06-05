"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isToolEnabled = isToolEnabled;
exports.executeTask = executeTask;
exports.getAvailableTools = getAvailableTools;
exports.getToolDefs = getToolDefs;
exports.getAllToolDefs = getAllToolDefs;
require("./catalog"); // side-effect: register built-in tools
const registry_1 = require("./registry");
const infer_1 = require("./infer");
const store_1 = require("../store");
function toolEnabledMap() {
    return store_1.store.get('toolEnabled') || {};
}
function isToolEnabled(tool) {
    const value = toolEnabledMap()[tool];
    return value !== false;
}
function enabledToolIds() {
    return (0, registry_1.listToolIds)().filter(isToolEnabled);
}
async function executeTask(workspaceRoot, task) {
    const tool = task.tool || (0, infer_1.inferTool)(task.instruction || '');
    const args = { ...(task.args || {}) };
    // For inferred shell.run, fall back to the raw instruction as the command
    if (!task.tool && task.instruction) {
        args.instruction = task.instruction;
        if (!args.command && tool === 'shell.run')
            args.command = task.instruction;
    }
    const allowed = Array.isArray(task.allowedTools)
        ? new Set(task.allowedTools.map(t => String(t || '').trim()).filter(Boolean))
        : null;
    const def = (0, registry_1.getTool)(tool);
    if (!def || !isToolEnabled(tool) || (allowed && !allowed.has(tool))) {
        return {
            success: false,
            tool,
            result: null,
            summary: !def
                ? `Unknown tool: ${tool}. Use one of: ${getAvailableTools().join(', ')}`
                : !isToolEnabled(tool)
                    ? `Tool disabled locally: ${tool}. Enable it in the desktop MCP tools page first.`
                    : `Tool not allowed for this task: ${tool}.`,
        };
    }
    try {
        const result = await def.handler({ workspaceRoot, args });
        return { success: true, tool, result, summary: `${tool} completed successfully` };
    }
    catch (err) {
        return { success: false, tool, result: null, summary: err?.message || String(err) };
    }
}
function getAvailableTools() {
    return enabledToolIds();
}
function getToolDefs() {
    return (0, registry_1.listToolDefs)().filter(def => isToolEnabled(def.name));
}
function getAllToolDefs() {
    return (0, registry_1.listToolDefs)();
}
