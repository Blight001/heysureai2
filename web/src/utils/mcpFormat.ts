export const createMcpCallBlockPattern = () =>
  /<mcp[-_]call>\s*([\s\S]*?)\s*<\/\s*(?:mcp[-_]call|[｜|]*\s*DSML\s*[｜|]*\s*(?:invoke|tool[-_]?calls?))\s*>/gi

export const stripMcpCallBlocks = (raw?: string) => {
  return String(raw || '').replace(createMcpCallBlockPattern(), '').trim()
}

