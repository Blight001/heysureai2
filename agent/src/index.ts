import { io } from 'socket.io-client';
import os from 'os';
import { AGENT_CAPABILITIES, DispatchedTask, TaskExecutor } from './executor';
import { getPlatformInfo, getPlatformNote, IS_WINDOWS } from './platform';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const socket = io(SERVER_URL);

const AGENT_ID = process.env.AGENT_ID || 'agent-' + os.hostname();
const AGENT_NAME = process.env.AGENT_NAME || os.hostname();
const AGENT_GROUP = process.env.AGENT_GROUP || '';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();

type LifecycleState =
  | 'starting'
  | 'connected'
  | 'registered'
  | 'dispatching'
  | 'degraded'
  | 'disconnected'
  | 'retired';

let lifecycle: LifecycleState = 'starting';

function setLifecycle(state: LifecycleState) {
  lifecycle = state;
  console.log(`[agent] lifecycle -> ${state}`);
}

// taskId -> outcome cache, so a duplicate task:dispatch (e.g. after a reconnect)
// re-emits the original result instead of running the side effect twice.
type CachedOutcome =
  | { kind: 'running' }
  | { kind: 'result'; payload: any }
  | { kind: 'error'; error: string };
const taskOutcomes = new Map<string, CachedOutcome>();

function buildRegisterPayload() {
  return {
    id: AGENT_ID,
    name: AGENT_NAME,
    platform: os.platform(),
    os: getPlatformInfo(),
    capabilities: AGENT_CAPABILITIES,
    version: '2.0.0',
    token: AGENT_TOKEN,
    workspaceRoot: WORKSPACE_ROOT,
    group: AGENT_GROUP,
    lifecycle,
    platformNote: getPlatformNote(),
    isWindowsDesktop: false,
  };
}

if (IS_WINDOWS) {
  console.log('[agent] ' + getPlatformNote());
}

socket.on('connect', () => {
  setLifecycle('connected');
  console.log('Connected to server:', SERVER_URL);
  socket.emit('agent:register', buildRegisterPayload());
});

socket.on('agent:registered', (info: any) => {
  setLifecycle('registered');
  console.log('Agent registration accepted by server', info?.id ? `(${info.id})` : '');
});

socket.on('agent:register_rejected', (info: any) => {
  setLifecycle('disconnected');
  console.error('Agent registration rejected:', info?.reason || 'unknown reason');
});

socket.on('disconnect', () => {
  setLifecycle('disconnected');
  console.log('Disconnected from server');
});

// New task protocol: server dispatches a task, agent executes locally.
socket.on('task:dispatch', async (task: DispatchedTask) => {
  const taskId = task?.taskId || 'unknown';
  console.log(`Received task ${taskId}: tool=${task?.tool || '(infer)'}`);

  const echo = {
    taskId,
    agentId: AGENT_ID,
    userId: task?.userId,
    aiConfigId: task?.aiConfigId,
    sessionId: task?.sessionId,
  };

  // Idempotency: replay the cached outcome for a taskId we have already seen.
  const cached = taskOutcomes.get(taskId);
  if (cached) {
    if (cached.kind === 'result') {
      socket.emit('task:result', { ...echo, ...cached.payload, duplicate: true });
    } else if (cached.kind === 'error') {
      socket.emit('task:error', { ...echo, error: cached.error, duplicate: true });
    } else {
      console.log(`Task ${taskId} already running; ignoring duplicate dispatch`);
    }
    return;
  }
  taskOutcomes.set(taskId, { kind: 'running' });
  setLifecycle('dispatching');

  const executor = new TaskExecutor(task, {
    onProgress: (message: string) =>
      socket.emit('task:progress', { ...echo, message }),
  });

  try {
    const outcome = await executor.run();
    taskOutcomes.set(taskId, { kind: 'result', payload: outcome });
    socket.emit('task:result', { ...echo, ...outcome });
    console.log(`Task ${taskId} done: ${outcome.summary}`);
  } catch (err: any) {
    const error = err?.message || String(err);
    taskOutcomes.set(taskId, { kind: 'error', error });
    socket.emit('task:error', { ...echo, error });
    console.error(`Task ${taskId} failed: ${error}`);
  } finally {
    setLifecycle('registered');
  }
});

// Legacy flow protocol kept for backward compatibility (no-op acknowledgement).
socket.on('flow:run', async () => {
  console.log('Received legacy flow:run (deprecated; ignored by TaskExecutor)');
  socket.emit('flow:log', { agentId: AGENT_ID, type: 'log', content: 'flow:run is deprecated; use task:dispatch' });
});
