export interface User {
  id: string
  name: string
  role: string
  team_id: string
}

export type DemoUser = User & { token: string }
export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'blocked'
export interface Task {
  id: string
  title: string
  description: string
  period: string
  status: TaskStatus
  completed_at: string | null
  document_ids: string[]
  request_ids: string[]
}
export interface Document {
  id: string
  title: string
  content: string
  source_type: string
}
export interface ChatAnswer {
  answer: string
  sources: Pick<Document, 'id' | 'title'>[]
  mode: string
  action: { resource: 'team_workspace' } | null
}
export interface AccessRequest {
  id: string
  resource: string
  reason: string
  status: string
  ticket_id: string | null
  next_step: string
}

export async function api<T>(path: string, token = '', body?: object, method = 'POST'): Promise<T> {
  const response = await fetch('/api' + path, {
    method: body ? method : 'GET',
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : 'Сервис не смог обработать запрос. Попробуйте ещё раз.')
  }
  return data as T
}
