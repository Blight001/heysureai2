import { PythonShell } from 'python-shell'; 
import OpenAI from 'openai'; 
import path from 'path'; 
 
 
export class FlowExecutor { 
  private flow: any; 
  private callbacks: any; 
 
 
  constructor(flow: any, callbacks: any) { 
    this.flow = flow; 
    this.callbacks = callbacks; 
  } 
 
 
  async start() { 
    this.callbacks.onLog('Starting flow execution...'); 
    
    // 简单的顺序执行示例 (实际应为拓扑排序执行) 
    // 这里假设 flow.nodes 已经排序或这是简单演示 
    for (const node of this.flow.nodes) { 
      await this.executeNode(node); 
    } 
  } 
 
 
  async executeNode(node: any) { 
    this.callbacks.onNodeUpdate(node.id, 'running'); 
    
    try { 
      if (node.type === 'python') { 
        await this.runPython(node); 
      } else if (node.type === 'aiChat') { 
        await this.runAI(node); 
      } 
      this.callbacks.onNodeUpdate(node.id, 'completed'); 
    } catch (e) { 
      console.error(e); 
      this.callbacks.onNodeUpdate(node.id, 'error'); 
      this.callbacks.onLog(`Error in node ${node.id}: ${e}`); 
    } 
  } 
 
 
  // 替代原来的 electronAPI.pythonExecute 
  async runPython(node: any) { 
    const scriptPath = path.join(__dirname, '../python_scripts', node.data.scriptName || 'main.py'); 
    
    try {
      const results = await PythonShell.run(scriptPath, { 
        args: [JSON.stringify(node.data.inputs || {})] 
      });
      this.callbacks.onLog(`Python output: ${results}`); 
      return results;
    } catch (err) {
      throw err;
    }
  } 
 
 
  // 替代原来的 electronAPI.ai.chat 
  async runAI(node: any) { 
    // 实际应从 Server 获取 Key 或本地环境变量 
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); 
    
    const completion = await openai.chat.completions.create({ 
      messages: [{ role: 'user', content: node.data.prompt }], 
      model: 'gpt-3.5-turbo', 
    }); 
    
    this.callbacks.onLog(`AI response: ${completion.choices[0].message.content}`); 
  } 
} 
