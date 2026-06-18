import { formatDateTime } from '@/utils/datetime'
import type { DbValue } from '@/api/admin'
import type { AdminMcpParamRow } from '@/types/admin'

export const formatOptionalDateTime = (ts: number | null | undefined): string => formatDateTime(ts, '—')

export const formatCommitDateTime = (ts: number | null | undefined): string => formatDateTime(ts, '')

export const formatLogTime = (ts: number): string => {
  try {
    return new Date(ts * 1000).toLocaleTimeString()
  } catch {
    return ''
  }
}

export const joinDataPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

export const buildDataBreadcrumbs = (path: string) => {
  const crumbs: Array<{ name: string; path: string }> = [{ name: 'data', path: '' }]
  let acc = ''
  for (const part of path ? path.split('/') : []) {
    acc = acc ? `${acc}/${part}` : part
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
}

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const dbValueToString = (value: DbValue): string => {
  if (value === null || value === undefined) return ''
  return String(value)
}

export const dbValuePreview = (value: DbValue): string => {
  const text = dbValueToString(value)
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

export const sampleMcpValueForType = (type: string): unknown => {
  if (type.includes('integer') || type.includes('number')) return 0
  if (type.includes('boolean')) return false
  if (type.includes('array')) return []
  if (type.includes('object')) return {}
  return ''
}

export const buildMcpParamRows = (inputSchema: unknown): AdminMcpParamRow[] => {
  if (!inputSchema || typeof inputSchema !== 'object') return []

  const schema = inputSchema as { properties?: unknown; required?: unknown }
  const props = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, { type?: unknown; description?: unknown }>
    : null
  if (!props) return []

  const required = Array.isArray(schema.required)
    ? schema.required.map(String)
    : []

  return Object.entries(props).map(([name, cfg]) => {
    const rawType = cfg?.type
    const type = Array.isArray(rawType) ? rawType.map(String).join(' | ') : String(rawType || 'any')
    return {
      name,
      type,
      required: required.includes(name),
      description: String(cfg?.description || ''),
    }
  })
}
