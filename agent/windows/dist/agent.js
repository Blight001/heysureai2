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
        this._boundAiConfigId = null;
        // Guards against re-login loops: we only kick off one auto re-auth per
        // connection attempt. Reset whenever we (re)connect or register successfully.
        this.reauthRequested = false;
        this.settings = settings;
        this.events = events;
        this.workspaceRoot = settings.workspaceRoot || path_1.default.join(os_1.default.homedir(), 'HeySureWorkspace');
    }
    get status() { return this._status; }
    get boundAiConfigId() { return this._boundAiConfigId; }
    setStatus(s, reason) {
        this._status = s;
        // Losing the connection clears the binding so we don't show green offline;
        // it is re-applied from the next agent:registered.
        if (s !== 'registered' && s !== 'connected')
            this._boundAiConfigId = null;
        this.events.onStatusChange?.(s, reason, this._boundAiConfigId);
    }
    log(level, msg, data) {
        this.events.onLog?.(level, msg, data);
    }
    connect() {
        // A non-null socket means we're already connected or mid-(re)connect
        // (socket.io drives its own retry loop). Bailing here prevents spawning a
        // second, orphaned socket when connect() is called twice in quick
        // succession — e.g. login now reconnects via updateSettings AND the
        // renderer calls connect() right after. disconnect() nulls the socket, so
        // a genuine reconnect still works.
        if (this.socket)
            return;
        if (this.settings.offlineMode) {
            this.setStatus('disconnected');
            this.log('info', '离线模式已启用，跳过服务器连接');
            return;
        }
        // Hard gate: an agent that hasn't logged in cannot talk to the server.
        // Without this guard the socket would open transport-level, the UI would
        // flash "已连接", then the server would reject agent:register a moment
        // later. Refusing here keeps the status honest.
        if (!this.settings.authToken) {
            this.setStatus('disconnected');
            this.log('warn', '未登录，已阻止连接服务器（请先登录账号）');
            return;
        }
        this.setStatus('connecting');
        this.reauthRequested = false;
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
        // Manager-level retry loop: only fires when an established connection was
        // lost and is being re-established, so it's the right trigger for the
        // orange "reconnecting" prompt (the very first connect does not emit it).
        this.socket.io.on('reconnect_attempt', (attempt) => {
            this.events.onReconnecting?.(true, `正在重连服务器（第 ${attempt} 次）…`);
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
            const raw = data?.aiConfigId;
            const n = typeof raw === 'number' ? raw : (raw != null && String(raw).trim() !== '' ? Number(raw) : null);
            this._boundAiConfigId = Number.isFinite(n) ? n : null;
            this.reauthRequested = false;
            this.events.onReconnecting?.(false);
            this.setStatus('registered');
            this.log('info', `注册成功: ${data?.name || this.settings.agentName}${this._boundAiConfigId == null ? '（未分配 AI）' : ''}`);
        });
        this.socket.on('agent:register_rejected', (data) => {
            const reason = data?.reason || '注册被拒绝';
            this.setStatus('error', reason);
            this.log('error', `注册失败: ${reason}`);
            // Only an auth-type rejection (invalid/expired user token) is recoverable
            // by re-logging in. Other reasons — e.g. AI ownership mismatch — must not
            // trigger a re-login, or a valid token would loop forever.
            const isAuthFailure = /token|logged in|登录|未登录|授权|unauthor/i.test(reason);
            if (isAuthFailure && !this.reauthRequested) {
                this.reauthRequested = true;
                this.events.onAuthFailure?.(reason);
            }
        });
        this.socket.on('task:dispatch', (task) => {
            void this.handleTask(task);
        });
    }
    disconnect() {
        this.socket?.disconnect();
        this.socket = null;
        // A deliberate close is not a reconnect — clear the orange prompt so we
        // don't show "reconnecting" for an intentional disconnect/logout.
        this.events.onReconnecting?.(false);
        this.setStatus('disconnected');
    }
    register() {
        const agentId = this.settings.agentId ||
            `agent-${os_1.default.hostname().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const hasAuth = !!this.settings.authToken;
        // The desktop client no longer picks its own AI. It just logs in and
        // connects; an operator assigns a server-side AI to this device from the
        // web Workshop ("作坊") panel. The server re-applies that binding on every
        // register, so we send aiConfigId: null and let the server decide.
        this.log('info', '注册 agent（AI 由服务器作坊分配）');
        this.socket?.emit('agent:register', {
            id: agentId,
            name: this.settings.agentName || os_1.default.hostname(),
            group: this.settings.agentGroup || '',
            platform: `win32-desktop (${os_1.default.hostname()})`,
            os: (0, platform_1.getPlatformInfo)(),
            capabilities: (0, executor_1.getAvailableTools)(),
            // Full self-described tool schemas (with the user's local description edits
            // merged in). The server stores these and surfaces them in mcp.list_tools /
            // describe_tool instead of hardcoding desktop tool schemas, so a tool added
            // to the catalog — or a description edited in the app — needs no server change.
            toolDefs: this.effectiveToolDefs(),
            version: '2.0.0',
            // The server requires a valid user JWT. ``authToken`` is the source
            // of truth; agentToken is kept as a legacy shared-secret fallback.
            token: this.settings.authToken || this.settings.agentToken || '',
            workspaceRoot: this.workspaceRoot,
            lifecycle: 'registered',
            isWindowsDesktop: true,
            aiConfigId: null,
            userId: hasAuth ? this.settings.userId : null,
        });
    }
    refreshRegistration() {
        if (this.socket?.connected)
            this.register();
        else
            this.connect();
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
    // Run a single tool locally for the MCP tester page (no server dispatch).
    async runToolLocally(tool, args) {
        const task = { taskId: `local-${Date.now()}`, tool, args: args || {} };
        return (0, executor_1.executeTask)(this.workspaceRoot, task);
    }
    // getToolDefs() with the user's local description edits merged in.
    effectiveToolDefs() {
        const overrides = this.settings.toolDescOverrides || {};
        return (0, executor_1.getToolDefs)().map(def => {
            const o = overrides[def.name];
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
            return {
                ...def,
                description: desc || def.description,
                input_schema: { ...def.input_schema, properties: nextProps },
            };
        });
    }
    updateSettings(newSettings) {
        this.disconnect();
        this.settings = newSettings;
        this.workspaceRoot = newSettings.workspaceRoot || path_1.default.join(os_1.default.homedir(), 'HeySureWorkspace');
        // Put the agent into the connection state the new settings imply, instead
        // of only reconnecting when it happened to be connected already. connect()
        // self-gates: with no authToken (logged out) or offline mode it just stays
        // disconnected. This fixes "logged in but the server never sees the agent",
        // where a fresh login from a disconnected state updated the token but never
        // opened a socket.
        this.connect();
    }
}
exports.HeySureAgent = HeySureAgent;
