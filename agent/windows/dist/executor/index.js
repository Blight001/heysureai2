"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeTask = executeTask;
exports.getAvailableTools = getAvailableTools;
exports.getToolDefs = getToolDefs;
require("./catalog"); // side-effect: register built-in tools
const registry_1 = require("./registry");
const infer_1 = require("./infer");
async function executeTask(workspaceRoot, task) {
    const tool = task.tool || (0, infer_1.inferTool)(task.instruction || '');
    const args = { ...(task.args || {}) };
    // For inferred shell.run, fall back to the raw instruction as the command
    if (!task.tool && task.instruction) {
        args.instruction = task.instruction;
        if (!args.command && tool === 'shell.run')
            args.command = task.instruction;
    }
    const def = (0, registry_1.getTool)(tool);
    if (!def) {
        return {
            success: false,
            tool,
            result: null,
            summary: `Unknown tool: ${tool}. Use one of: ${getAvailableTools().join(', ')}`,
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
    return (0, registry_1.listToolIds)();
}
function getToolDefs() {
    return (0, registry_1.listToolDefs)();
}
