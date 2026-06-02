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
    userPassword: '',
    rememberLogin: false,
    userName: '',
    userAvatar: '',
    userAvatarDataUrl: '',
    authToken: '',
    userId: null,
    selectedAiConfigId: null,
    selectedAiConfigName: '',
    selectedAiConfigRole: 'member',
    selectedAiConfigLifecycle: 'working',
    selectedAiConfigProject: '',
    mouseFx: true,
    mouseCoordinateScaleX: 1,
    mouseCoordinateScaleY: 1,
    mouseCoordinateOffsetX: 0,
    mouseCoordinateOffsetY: 0,
    offlineMode: false,
    offlinePrompt: '你是 HeySure AI，运行在 Windows 桌面端的离线模式中。你可以直接回答用户，也可以调用本机 MCP 工具完成文件、窗口、键鼠、剪贴板、终端等桌面任务。需要操作电脑时优先使用工具，并用和用户相同的语言回复。',
    toolDescOverrides: {},
};
exports.store = new electron_store_1.default({ defaults });
