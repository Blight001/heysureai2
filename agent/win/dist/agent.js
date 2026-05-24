"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeySureAgent = void 0;
const socket_io_client_1 = require("socket.io-client");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const executor_1 = require("./executor");
const platform_1 = require("./platform");
const server_url_1 = require("./server-url");
class HeySureAgent {
    constructor(settings, events = {}) {
        this.socket = null;
        this.taskOutcomes = new Map();
        this._status = 'disconnected';
        this.settings = settings;
        this.events = events;
        this.workspaceRoot = settings.workspaceRoot || path_1.default.join(os_1.default.homedir(), 'HeySureWorkspace');
    }
    get status() { return this._status; }
    setStatus(s, reason) {
        this._status = s;
        this.events.onStatusChange?.(s, reason);
    }
    log(level, msg, data) {
        this.events.onLog?.(level, msg, data);
    }
    connect() {
        if (this.socket?.connected)
            return;
        this.setStatus('connecting');
        let serverUrl;
        try {
            serverUrl = (0, server_url_1.normalizeServerUrl)(this.settings.serverUrl);
        }
        catch {
            this.setStatus('error', '服务器 URL 格式无效');
            this.log('error', '连接错误: 服务器 URL 格式无效');
            return;
        }
        this.log('info', `正在连接 ${serverUrl}…`);
        this.socket = (0, socket_io_client_1.io)(serverUrl, {
            transports: ['websocket', 'polling'],
            reconnectionDelay: 2000,
            reconnectionAttempts: Infinity,
        });
        this.socket.on('connect', () => {
            this.setStatus('connected');
            this.log('info', '已连接到服务器');
            this.register();
        });
        this.socket.on('disconnect', (reason) => {
            this.setStatus('disconnected', reason);
            this.log('warn', `连接断开: ${reason}`);
        });
        this.socket.on('connect_error', (err) => {
            this.setStatus('error', err.message);
            this.log('error', `连接错误: ${err.message}`);
        });
        this.socket.on('agent:registered', (data) => {
            this.setStatus('registered');
            this.log('info', `注册成功: ${data?.name || this.settings.agentName}`);
        });
        this.socket.on('agent:register_rejected', (data) => {
            this.setStatus('error', data?.reason || '注册被拒绝');
            this.log('error', `注册失败: ${data?.reason}`);
        });
        this.socket.on('task:dispatch', (task) => {
            void this.handleTask(task);
        });
    }
    disconnect() {
        this.socket?.disconnect();
        this.socket = null;
        this.setStatus('disconnected');
    }
    register() {
        const agentId = this.settings.agentId ||
            `agent-${os_1.default.hostname().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const hasAuth = !!this.settings.authToken;
        const selectedAiConfigId = hasAuth ? this.settings.selectedAiConfigId : null;
        if (!hasAuth && this.settings.selectedAiConfigId) {
            this.log('warn', '未登录，已忽略残留的 AI 成员自动注册选择');
        }
        this.socket?.emit('agent:register', {
            id: agentId,
            name: this.settings.agentName || os_1.default.hostname(),
            group: this.settings.agentGroup || '',
            platform: `win32-desktop (${os_1.default.hostname()})`,
            os: (0, platform_1.getPlatformInfo)(),
            capabilities: (0, executor_1.getAvailableTools)(),
            version: '2.0.0',
            token: this.settings.agentToken || '',
            workspaceRoot: this.workspaceRoot,
            lifecycle: 'registered',
            isWindowsDesktop: true,
            aiConfigId: selectedAiConfigId,
            userId: hasAuth ? this.settings.userId : null,
        });
    }
    async handleTask(task) {
        const taskId = task.taskId;
        if (!taskId)
            return;
        // Idempotency: replay cached outcome for duplicate dispatches
        const cached = this.taskOutcomes.get(taskId);
        if (cached) {
            if (cached.kind === 'result')
                this.socket?.emit('task:result', cached.payload);
            else if (cached.kind === 'error')
                this.socket?.emit('task:error', { taskId, error: cached.error });
            return;
        }
        this.taskOutcomes.set(taskId, { kind: 'running' });
        const tool = task.tool || '(infer)';
        this.events.onTaskStart?.(taskId, tool, task.args || {});
        this.log('info', `任务 [${taskId}] 开始: ${tool}`, task.args);
        this.socket?.emit('task:progress', { taskId, progress: 0, message: `开始执行 ${tool}…` });
        try {
            const outcome = await (0, executor_1.executeTask)(this.workspaceRoot, task);
            const payload = {
                taskId,
                userId: task.userId,
                aiConfigId: task.aiConfigId,
                sessionId: task.sessionId,
                tool: outcome.tool,
                success: outcome.success,
                result: outcome.result,
                summary: outcome.summary,
                workspaceRoot: this.workspaceRoot,
            };
            this.taskOutcomes.set(taskId, { kind: 'result', payload });
            this.socket?.emit('task:result', payload);
            this.events.onTaskResult?.(taskId, outcome.tool, outcome.result, outcome.success);
            this.log(outcome.success ? 'info' : 'warn', `任务 [${taskId}] ${outcome.success ? '完成' : '失败'}: ${outcome.summary}`);
        }
        catch (err) {
            const errMsg = err?.message || String(err);
            this.taskOutcomes.set(taskId, { kind: 'error', error: errMsg });
            this.socket?.emit('task:error', { taskId, userId: task.userId, error: errMsg });
            this.events.onTaskResult?.(taskId, tool, null, false);
            this.log('error', `任务 [${taskId}] 异常: ${errMsg}`);
        }
    }
    updateSettings(newSettings) {
        const wasConnected = this.socket?.connected;
        if (wasConnected)
            this.disconnect();
        this.settings = newSettings;
        this.workspaceRoot = newSettings.workspaceRoot || path_1.default.join(os_1.default.homedir(), 'HeySureWorkspace');
        if (wasConnected)
            this.connect();
    }
}
exports.HeySureAgent = HeySureAgent;
