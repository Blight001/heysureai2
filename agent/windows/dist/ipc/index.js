"use strict";
// IPC registration entry point. Each module registers its own ipcMain
// handlers, keeping wire-protocol concerns close to the business logic.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAllIpc = registerAllIpc;
const settings_1 = require("./settings");
const agent_1 = require("./agent");
const auth_1 = require("./auth");
const ai_config_1 = require("./ai-config");
const mcp_1 = require("./mcp");
const offline_chat_1 = require("./offline-chat");
function registerAllIpc() {
    (0, settings_1.registerSettingsIpc)();
    (0, agent_1.registerAgentIpc)();
    (0, auth_1.registerAuthIpc)();
    (0, ai_config_1.registerAiConfigIpc)();
    (0, mcp_1.registerMcpIpc)();
    (0, offline_chat_1.registerOfflineChatIpc)();
}
