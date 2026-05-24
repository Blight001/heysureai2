export interface ActionBlock {
  id: string;
  type: 'edit' | 'create' | 'delete' | 'run' | 'mcp';
  filename?: string;
  command?: string;
  search?: string;
  replace?: string;
  content?: string;
  tool?: string;
  arguments?: Record<string, any>;
}

export interface InlineContent {
  type: 'text' | 'block';
  content?: string;
  block?: ActionBlock;
}

const parseMcpPayload = (raw: string): { tool: string; arguments: Record<string, any> } | null => {
  const body = (raw || '').trim();
  if (!body) return null;

  try {
    const payload = JSON.parse(body);
    const tool = String(payload?.tool || '').trim();
    if (!tool) return null;
    const args = payload?.arguments && typeof payload.arguments === 'object' ? payload.arguments : {};
    return { tool, arguments: args };
  } catch {
    // fallback to XML-like payload:
    // <tool>workspace.read_files</tool>
    // <arguments>{"paths":["a.txt"]}</arguments>
  }

  const toolMatch = body.match(/<tool>\s*([\s\S]*?)\s*<\/tool>/i);
  if (!toolMatch) return null;
  const tool = String(toolMatch[1] || '').trim();
  if (!tool) return null;

  const argsMatch = body.match(/<arguments>\s*([\s\S]*?)\s*<\/arguments>/i);
  if (!argsMatch) return { tool, arguments: {} };
  const argsRaw = String(argsMatch[1] || '').trim();
  if (!argsRaw) return { tool, arguments: {} };
  try {
    const parsedArgs = JSON.parse(argsRaw);
    if (parsedArgs && typeof parsedArgs === 'object') return { tool, arguments: parsedArgs };
  } catch {
    return null;
  }
  return { tool, arguments: {} };
};

const mcpCallBlockPattern = () =>
  /<mcp[-_]call>\s*([\s\S]*?)\s*<\/\s*(?:mcp[-_]call|[｜|]*\s*DSML\s*[｜|]*\s*invoke)\s*>/gi;

export function parseChatResponse(text: string) {
  const thinkPattern = /<think>\s*([\s\S]*?)\s*<\/think>/gi;
  const legacyThinkPattern = /<\/think>([\s\S]*?)<\/think>/gi;
  const thinkMatch = thinkPattern.exec(text);
  const legacyThinkMatch = legacyThinkPattern.exec(text);
  const think = thinkMatch?.[1]?.trim() || legacyThinkMatch?.[1]?.trim() || undefined;
  
  let cleanedText = text.replace(thinkPattern, '').replace(legacyThinkPattern, '').trim();

  const blocks: ActionBlock[] = [];

  const cleanContent = (content: string): string => {
    return content.replace(/\n?={3,}$/, '').replace(/\n?>={3,}$/, '').trim();
  };

  const mcpPattern = mcpCallBlockPattern();
  let mcpMatch;
  while ((mcpMatch = mcpPattern.exec(cleanedText)) !== null) {
    const payload = parseMcpPayload(mcpMatch[1]);
    if (!payload) continue;
    blocks.push({ type: 'mcp', id: `mcp-${payload.tool}-${blocks.length}`, tool: payload.tool, arguments: payload.arguments });
  }

  const editPattern = /(?:File:?\s*[`]?([^\s`]+)[`]?\s*\n)?<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match;
  while ((match = editPattern.exec(cleanedText)) !== null) {
    const filename = match[1] || '';
    const search = match[2];
    const replace = cleanContent(match[3]);
    
    if (!search || !search.trim()) {
      if (filename && replace && replace.trim()) {
        const blockId = `create-${filename}-${replace.length}-${blocks.length}`;
        blocks.push({ type: 'create', id: blockId, filename, content: replace });
      }
    } else {
      const blockId = `edit-${filename}-${search.length}-${replace.length}-${blocks.length}`;
      blocks.push({ type: 'edit', id: blockId, filename, search, replace });
    }
  }
  let displayText = cleanedText.replace(mcpPattern, '').replace(editPattern, '').trim();

  const createPattern = /(?:Create File:?\s*[`]?([^\s`]+)[`]?\s*\n)?<<<<<<< CREATE\n([\s\S]*?)\n>>>>>>> CREATE/g;
  while ((match = createPattern.exec(displayText)) !== null) {
    const filename = match[1] || '';
    const content = cleanContent(match[2]);
    const blockId = `create-${filename}-${content.length}-${blocks.length}`;
    blocks.push({ type: 'create', id: blockId, filename, content });
  }
  displayText = displayText.replace(createPattern, '').trim();

  const deletePattern = /Delete File:?\s*[`]?([^\s`]+)[`]?/g;
  while ((match = deletePattern.exec(displayText)) !== null) {
    const filename = match[1] || '';
    const blockId = `delete-${filename}-${blocks.length}`;
    blocks.push({ type: 'delete', id: blockId, filename });
  }
  displayText = displayText.replace(deletePattern, '').trim();

  const runPattern = /Run Command:?\s*[`]?([^\n`]+)[`]?/g;
  while ((match = runPattern.exec(displayText)) !== null) {
    const command = match[1] || '';
    const blockId = `run-${command.length}-${blocks.length}`;
    blocks.push({ type: 'run', id: blockId, command });
  }
  displayText = displayText.replace(runPattern, '').trim();

  displayText = displayText.replace(/\n(?:File|Create File|Delete File|Run Command):?\s*[`]?[^\s`]+[`]?\s*$/g, '').trim();

  return { think, displayText, blocks };
}

export const SYSTEM_PROMPT = `You are the HeySure admin brain with access to MCP tools exposed by the server.
Prefer MCP tool calls over raw file patches whenever you need to inspect files, edit files, run commands, or control connected agents.
All file paths must be relative to the user's workspace root.

When you want to call a tool, output one or more blocks using EXACTLY this format and do not wrap them in markdown code fences:
<mcp-call>
{"tool":"workspace.read_files","arguments":{"paths":["README.md"]}}
</mcp-call>

Available MCP tools include:
- workspace.list_files
- workspace.get_file_tree
- workspace.read_files
- workspace.write_file
- workspace.edit_file
- workspace.delete_path
- workspace.run_command
- admin.list_agents
- admin.get_overview
- admin.dispatch_flow
- project.list_projects
- project.create_project
- project.update_project
- project.delete_project
- task.create_immediate
- task.create_scheduled
- task.create_recurring
- task.list
- task.get_current
- task.inherit
- task.complete

Rules:
- Explain your intent in normal text first when helpful, then emit the MCP call block.
- For workspace.write_file and workspace.edit_file, prefer structured arguments: target + content/edits + options.
- Use workspace.edit_file for targeted edits to existing files.
- Use workspace.write_file for new files or full rewrites.
- Use admin.* tools when managing connected agents.
- Only fall back to legacy File/Create File/Delete File/Run Command formats if MCP is unavailable.`;

export function parseChatResponseInline(text: string) {
  const thinkPattern = /<think>\s*([\s\S]*?)\s*<\/think>/gi;
  const legacyThinkPattern = /<\/think>([\s\S]*?)<\/think>/gi;
  const thinkMatch = thinkPattern.exec(text);
  const legacyThinkMatch = legacyThinkPattern.exec(text);
  const think = thinkMatch?.[1]?.trim() || legacyThinkMatch?.[1]?.trim() || undefined;
  
  let cleanedText = text.replace(thinkPattern, '').replace(legacyThinkPattern, '').trim();

  const inlineContent: InlineContent[] = [];
  const allBlocks: ActionBlock[] = [];

  const cleanContent = (content: string): string => {
    return content.replace(/\n?={3,}$/, '').replace(/\n?>={3,}$/, '').trim();
  };

  const matches: { index: number; length: number; block: ActionBlock }[] = [];
  const mcpPattern = mcpCallBlockPattern();

  let mcpMatch;
  while ((mcpMatch = mcpPattern.exec(cleanedText)) !== null) {
    const payload = parseMcpPayload(mcpMatch[1]);
    if (!payload) continue;
    const blockId = `mcp-${payload.tool}-${allBlocks.length}`;
    allBlocks.push({ type: 'mcp', id: blockId, tool: payload.tool, arguments: payload.arguments });
    matches.push({ index: mcpMatch.index, length: mcpMatch[0].length, block: allBlocks[allBlocks.length - 1] });
  }

  const editPattern = /(?:File:?\s*[`]?([^\s`]+)[`]?\s*\n)?<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match;
  while ((match = editPattern.exec(cleanedText)) !== null) {
    const filename = match[1] || '';
    const search = match[2];
    const replace = cleanContent(match[3]);
    
    if (!search || !search.trim()) {
      if (filename && replace && replace.trim()) {
        const blockId = `create-${filename}-${replace.length}-${allBlocks.length}`;
        allBlocks.push({ type: 'create', id: blockId, filename, content: replace });
        matches.push({ index: match.index, length: match[0].length, block: allBlocks[allBlocks.length - 1] });
      }
    } else {
      const blockId = `edit-${filename}-${search.length}-${replace.length}-${allBlocks.length}`;
      allBlocks.push({ type: 'edit', id: blockId, filename, search, replace });
      matches.push({ index: match.index, length: match[0].length, block: allBlocks[allBlocks.length - 1] });
    }
  }

  const createPattern = /(?:Create File:?\s*[`]?([^\s`]+)[`]?\s*\n)?<<<<<<< CREATE\n([\s\S]*?)\n>>>>>>> CREATE/g;
  while ((match = createPattern.exec(cleanedText)) !== null) {
    const filename = match[1] || '';
    const content = cleanContent(match[2]);
    const blockId = `create-${filename}-${content.length}-${allBlocks.length}`;
    allBlocks.push({ type: 'create', id: blockId, filename, content });
    matches.push({ index: match.index, length: match[0].length, block: allBlocks[allBlocks.length - 1] });
  }

  const deletePattern = /Delete File:?\s*[`]?([^\s`]+)[`]?/g;
  while ((match = deletePattern.exec(cleanedText)) !== null) {
    const filename = match[1] || '';
    const blockId = `delete-${filename}-${allBlocks.length}`;
    allBlocks.push({ type: 'delete', id: blockId, filename });
    matches.push({ index: match.index, length: match[0].length, block: allBlocks[allBlocks.length - 1] });
  }

  const runPattern = /Run Command:?\s*[`]?([^\n`]+)[`]?/g;
  while ((match = runPattern.exec(cleanedText)) !== null) {
    const command = match[1] || '';
    const blockId = `run-${command.length}-${allBlocks.length}`;
    allBlocks.push({ type: 'run', id: blockId, command });
    matches.push({ index: match.index, length: match[0].length, block: allBlocks[allBlocks.length - 1] });
  }

  matches.sort((a, b) => a.index - b.index);

  let lastIndex = 0;
  for (const m of matches) {
    if (m.index > lastIndex) {
      inlineContent.push({ type: 'text', content: cleanedText.slice(lastIndex, m.index) });
    }
    inlineContent.push({ type: 'block', block: m.block });
    lastIndex = m.index + m.length;
  }

  if (lastIndex < cleanedText.length) {
    inlineContent.push({ type: 'text', content: cleanedText.slice(lastIndex) });
  }

  const displayText = cleanedText
    .replace(mcpPattern, '')
    .replace(editPattern, '')
    .replace(createPattern, '')
    .replace(deletePattern, '')
    .replace(runPattern, '')
    .replace(/\n(?:File|Create File|Delete File|Run Command):?\s*[`]?[^\s`]+[`]?\s*$/g, '')
    .trim();

  return { think, displayText, blocks: allBlocks, inlineContent };
}
