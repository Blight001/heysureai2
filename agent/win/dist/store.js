"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.store = void 0;
const electron_store_1 = __importDefault(require("electron-store"));
const defaults = {
    serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:3000',
    agentToken: process.env.AGENT_TOKEN || '',
    agentId: process.env.AGENT_ID || '',
    agentName: process.env.AGENT_NAME || 'Windows Agent',
    agentGroup: process.env.AGENT_GROUP || '',
    workspaceRoot: process.env.WORKSPACE_ROOT || '',
    autoStart: false,
    theme: 'dark',
    windowBounds: null,
    aiKey: process.env.AI_KEY || '',
    aiBaseUrl: process.env.AI_BASE_URL || 'https://api.anthropic.com',
    aiModel: process.env.AI_MODEL || 'claude-sonnet-4-5',
    userAccount: '',
    authToken: '',
    userId: null,
    selectedAiConfigId: null,
    selectedAiConfigName: '',
    selectedAiConfigRole: 'member',
    selectedAiConfigLifecycle: 'working',
    selectedAiConfigProject: '',
};
exports.store = new electron_store_1.default({ defaults });
