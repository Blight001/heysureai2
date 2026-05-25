/**
 * Shared HTTP client used by every API module and composable.
 *
 * Centralises:
 *   - Authorization header injection (Bearer token from localStorage).
 *   - JSON body encoding.
 *   - Backend error envelope parsing ({ "detail": "..." }) with a friendly fallback.
 *
 * Components should never call fetch directly for the application API; they should
 * import from `@/api/<module>` instead so cross-cutting concerns stay in one place.
 */

class ApiError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

const TOKEN_STORAGE_KEY = 'token'

export const getAuthToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export const setAuthToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // ignore quota / privacy mode failures
  }
}

export const clearAuthToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  headers?: Record<string, string>
  /** When true (default), attach Authorization: Bearer <token>. */
  auth?: boolean
  /** When false (default), skip JSON body encoding (e.g. raw form data). */
  rawBody?: boolean
  /** Fallback error message if the server doesn't return a `detail` field. */
  fallbackError?: string
  /** Optional explicit token; falls back to localStorage. */
  token?: string
  signal?: AbortSignal
}

const buildUrl = (path: string, query?: RequestOptions['query']) => {
  if (!query) return path
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    usp.set(key, String(value))
  }
  const qs = usp.toString()
  if (!qs) return path
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`
}

const parseDetail = async (res: Response, fallback: string): Promise<{ message: string; payload: unknown }> => {
  try {
    const data = await res.json()
    const detail = (data && typeof data === 'object' ? (data as any).detail : undefined) as
      | string
      | undefined
    return { message: detail ? String(detail) : fallback, payload: data }
  } catch {
    return { message: fallback, payload: null }
  }
}

export const request = async <T = unknown>(path: string, options: RequestOptions = {}): Promise<T> => {
  const {
    method = 'GET',
    body,
    query,
    headers = {},
    auth = true,
    rawBody = false,
    fallbackError = '请求失败',
    token,
    signal,
  } = options

  const finalHeaders: Record<string, string> = { ...headers }
  if (auth) {
    const bearer = token ?? getAuthToken()
    if (bearer) finalHeaders.Authorization = `Bearer ${bearer}`
  }

  let payload: BodyInit | undefined
  if (body !== undefined && body !== null) {
    if (rawBody) {
      payload = body as BodyInit
    } else {
      if (!finalHeaders['Content-Type']) finalHeaders['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers: finalHeaders,
    body: payload,
    signal,
  })

  if (!res.ok) {
    const { message, payload: errBody } = await parseDetail(res, fallbackError)
    throw new ApiError(message, res.status, errBody)
  }

  if (res.status === 204) return undefined as T

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as T
  }
  return (await res.text()) as unknown as T
}

export const get = <T = unknown>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
  request<T>(path, { ...options, method: 'GET' })

export const post = <T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
) => request<T>(path, { ...options, method: 'POST', body })

export const put = <T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
) => request<T>(path, { ...options, method: 'PUT', body })

export const patch = <T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
) => request<T>(path, { ...options, method: 'PATCH', body })

export const del = <T = unknown>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
  request<T>(path, { ...options, method: 'DELETE' })
