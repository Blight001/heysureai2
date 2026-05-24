// Helpers for invoking PowerShell from Node and parsing its JSON output.

export const PS = 'powershell.exe -NonInteractive -NoProfile -Command'

// Escape a value for safe embedding in a PowerShell single-quoted string
// that is itself wrapped in cmd.exe double quotes. Reject values containing
// double quotes since they would break the outer cmd quoting layer.
export function psStr(value: string): string {
  if (value.includes('"')) {
    throw new Error('Value must not contain double-quote characters')
  }
  return value.replace(/'/g, "''")
}

// Parse output produced by ConvertTo-Json. PowerShell emits a bare object
// when there is exactly one result and an array otherwise — normalize to array.
export function parsePsJson<T>(stdout: string, fallback: T): T {
  if (!stdout) return fallback
  try {
    const parsed = JSON.parse(stdout)
    return Array.isArray(parsed) ? (parsed as T) : ([parsed] as T)
  } catch {
    return fallback
  }
}
