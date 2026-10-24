import {
  API,
  type AssistEvent,
  type AssistRequest,
  type HealthResponse,
  type ProjectSummary,
  type RunRequest,
  type ScholarProject,
  type StreamEvent,
} from '../protocol.ts'

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `请求失败（HTTP ${response.status}）`)
  return payload
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API}/health`, { cache: 'no-store', signal })
  return await jsonResponse<HealthResponse>(response)
}

export async function listProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  const response = await fetch(`${API}/projects`, { cache: 'no-store', signal })
  const payload = await jsonResponse<{ projects: ProjectSummary[] }>(response)
  return payload.projects
}

export async function getProject(id: string, signal?: AbortSignal): Promise<ScholarProject> {
  const response = await fetch(`${API}/projects/${encodeURIComponent(id)}`, { cache: 'no-store', signal })
  const payload = await jsonResponse<{ project: ScholarProject }>(response)
  return payload.project
}

export async function patchProject(id: string, change: Partial<ScholarProject>): Promise<ScholarProject> {
  const response = await fetch(`${API}/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-eyanbao': '1' },
    body: JSON.stringify(change),
  })
  const payload = await jsonResponse<{ project: ScholarProject }>(response)
  return payload.project
}

export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`${API}/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-eyanbao': '1' },
  })
  await jsonResponse<{ ok: true }>(response)
}

export async function runResearch(
  request: RunRequest,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eyanbao': '1' },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `研究请求失败（HTTP ${response.status}）`)
  }
  if (response.body === null) throw new Error('生成服务没有返回可读取的数据流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      onEvent(JSON.parse(line) as StreamEvent)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim() !== '') onEvent(JSON.parse(buffer) as StreamEvent)
}

export async function runAssist(
  request: AssistRequest,
  onEvent: (event: AssistEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API}/assist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eyanbao': '1' },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `AI 辅助请求失败（HTTP ${response.status}）`)
  }
  if (response.body === null) throw new Error('AI 辅助没有返回可读取的数据流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      onEvent(JSON.parse(line) as AssistEvent)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim() !== '') onEvent(JSON.parse(buffer) as AssistEvent)
}

export function exportUrl(id: string, format: 'docx' | 'md'): string {
  return `${API}/projects/${encodeURIComponent(id)}/export.${format}`
}
