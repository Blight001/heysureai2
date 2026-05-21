import { io } from 'socket.io-client';
import os from 'os';
import { AGENT_CAPABILITIES, DispatchedTask, TaskExecutor } from './executor';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const socket = io(SERVER_URL);

const AGENT_ID = process.env.AGENT_ID || 'agent-' + os.hostname();

socket.on('connect', () => {
  console.log('Connected to server:', SERVER_URL);
  socket.emit('agent:register', {
    id: AGENT_ID,
    name: os.hostname(),
    platform: os.platform(),
    capabilities: AGENT_CAPABILITIES,
    version: '2.0.0',
  });
});

socket.on('disconnect', () => {
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

  const executor = new TaskExecutor(task, {
    onProgress: (message: string) =>
      socket.emit('task:progress', { ...echo, message }),
  });

  try {
    const outcome = await executor.run();
    socket.emit('task:result', { ...echo, ...outcome });
    console.log(`Task ${taskId} done: ${outcome.summary}`);
  } catch (err: any) {
    const error = err?.message || String(err);
    socket.emit('task:error', { ...echo, error });
    console.error(`Task ${taskId} failed: ${error}`);
  }
});

// Legacy flow protocol kept for backward compatibility (no-op acknowledgement).
socket.on('flow:run', async () => {
  console.log('Received legacy flow:run (deprecated; ignored by TaskExecutor)');
  socket.emit('flow:log', { agentId: AGENT_ID, type: 'log', content: 'flow:run is deprecated; use task:dispatch' });
});
