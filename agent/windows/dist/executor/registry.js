"use strict";
// Tool registry — single source of truth for what the agent can execute.
// Each tool is one entry mapping a stable id (e.g. "desktop.tool") to:
//   - handler: async function that performs the work
//   - platform: which platforms the tool is available on
//
// Adding a new capability means appending one entry — no switch statement
// to touch and no parallel arrays to keep in sync.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTool = registerTool;
exports.registerTools = registerTools;
exports.getTool = getTool;
exports.listToolIds = listToolIds;
exports.listToolDefs = listToolDefs;
exports.clearRegistry = clearRegistry;
const platform_1 = require("../platform");
const registry = new Map();
function registerTool(def) {
    registry.set(def.id, def);
}
function registerTools(defs) {
    for (const def of defs)
        registerTool(def);
}
function getTool(id) {
    return registry.get(id);
}
function listToolIds() {
    return Array.from(registry.values())
        .filter(t => t.platform === 'all' || (t.platform === 'windows' && platform_1.IS_WINDOWS))
        .map(t => t.id);
}
function listToolDefs() {
    return Array.from(registry.values())
        .filter(t => t.platform === 'all' || (t.platform === 'windows' && platform_1.IS_WINDOWS))
        .map(t => ({
        name: t.id,
        description: t.description || `Run desktop tool ${t.id} on the connected Windows agent.`,
        input_schema: t.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
    }));
}
function clearRegistry() {
    registry.clear();
}
