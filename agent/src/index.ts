import { io } from 'socket.io-client'; 
import { FlowExecutor } from './executor'; 
import os from 'os'; 
 
 
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const socket = io(SERVER_URL); 
 
 
const AGENT_ID = 'agent-' + os.hostname(); 
 
 
socket.on('connect', () => { 
  console.log('Connected to server'); 
  // 注册自己 
  socket.emit('agent:register', { 
    id: AGENT_ID, 
    name: os.hostname(), 
    platform: os.platform() 
  }); 
}); 
 
 
// 监听执行指令 
socket.on('flow:run', async (flowData) => { 
  console.log('Received flow execution task'); 
  
  const executor = new FlowExecutor(flowData, { 
    onLog: (msg: string) => socket.emit('flow:log', { agentId: AGENT_ID, type: 'log', content: msg }), 
    onNodeUpdate: (nodeId: string, status: string) => socket.emit('flow:log', { agentId: AGENT_ID, type: 'node', nodeId, status }) 
  }); 
  
  await executor.start(); 
}); 
