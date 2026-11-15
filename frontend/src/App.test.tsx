import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import type { AccessRequest, Task } from './api'

const people = [
  { id: 'anna', name: 'Анна', team_id: 'backend', role: 'intern', token: 'intern-anna' },
  { id: 'ivan', name: 'Иван', team_id: 'data', role: 'intern', token: 'intern-ivan' },
  { id: 'mentor', name: 'Мария', team_id: 'backend', role: 'mentor', token: 'mentor' },
]

function fixture(path = '/') {
  const tasks: Task[] = [
    { id: 't1', title: 'Прочитать введение', description: 'Материалы команды', status: 'todo', period: 'week_1', completed_at: null, document_ids: ['kb'], request_ids: [] },
    { id: 't2', title: 'Согласовать цели', description: 'Нужен наставник', status: 'blocked', period: 'week_1', completed_at: null, document_ids: [], request_ids: ['req'] },
  ]
  let request: AccessRequest | null = null
  const conversation: { id: string; sender: string; message: string; created_at: string }[] = []
  const fail = new Map<string, Response>()
  const mock = vi.fn(async (url: string, options: RequestInit) => {
    const { method, body } = options
    const key = method + ' ' + url
    if (fail.has(key)) {
      const response = fail.get(key)!
      fail.delete(key)
      return response
    }
    const token = (options.headers as Record<string, string>).Authorization?.slice(7)
    const person = people.find(user => user.token === token)
    const payload = body ? JSON.parse(body as string) : {}
    if (url === '/api/session') return Response.json({ users: people })
    if (url === '/api/me') return Response.json(person)
    if (url === '/api/tasks') return Response.json({ tasks: person?.role === 'intern' ? tasks : [] })
    if (url === '/api/tasks/t1' || url === '/api/tasks/t1?include_next=true') {
      tasks[0] = { ...tasks[0], status: payload.status }
      return Response.json({ ...tasks[0], next_task: tasks[1] })
    }
    if (url === '/api/knowledge') return Response.json({ documents: person?.role === 'intern' ? [{ id: 'kb', title: 'Учебная инструкция', content: 'Запросите доступ.', source_type: 'synthetic' }] : [] })
    if (url === '/api/chat') {
      if (payload.message.startsWith('Неизвестный вопрос')) return Response.json({
        answer: 'Не нашёл инструкцию.', sources: [], mode: 'demo', action: null, needs_human: true,
      })
      if (payload.message === 'Как прочитать введение?') return Response.json({
        answer: 'Начните с материалов команды.', sources: [], mode: 'demo', action: null, task_id: 't1',
      })
      if (payload.task_id === 't1') return Response.json({
        answer: 'Отметить задачу как выполненную?', sources: [], mode: 'demo', action: null,
        complete_task: { id: 't1', title: tasks[0].title },
      })
      return Response.json({ answer: 'Подготовьте заявку.', sources: [{ id: 'kb', title: 'Учебная инструкция' }], mode: 'demo', action: { resource: 'team_workspace' } })
    }
    if (url === '/api/mentor/messages') return Response.json({ messages: [] })
    if (url === '/api/chat/contacts') return Response.json({ contacts: person?.role === 'mentor' ? [{ id: 'anna', name: 'Анна', kind: 'mentor' }] : [{ id: 'mentor', name: 'Мария', kind: 'mentor' }, { id: 'ivan', name: 'Иван', kind: 'peer' }] })
    if (url.startsWith('/api/peer/conversations/')) {
      if (method === 'POST') {
        conversation.push({ id: 'peer-message', sender: 'me', message: payload.message, created_at: '2026-11-14' })
        return Response.json({ id: 'peer-message' })
      }
      return Response.json({ messages: conversation })
    }
    if (url === '/api/mentor/conversations') return Response.json({ conversations: [{ intern_id: 'anna', intern_name: 'Анна' }] })
    if (url.startsWith('/api/mentor/conversations/')) {
      if (method === 'POST') {
        conversation.push({ id: 'reply', sender: 'mentor', message: payload.message, created_at: '2026-11-14' })
        return Response.json({ id: 'reply' })
      }
      return Response.json({ messages: conversation })
    }
    if (url === '/api/requests' && method === 'POST') {
      request = { id: 'req', resource: payload.resource, reason: payload.reason, status: 'draft', ticket_id: null, next_step: 'Проверьте заявку.' }
      return Response.json({ request })
    }
    if (url === '/api/requests/req/confirm' && request && payload.confirmed) {
      request = { ...request, status: 'submitted', ticket_id: 'DEMO-001', next_step: 'Дождитесь рассмотрения.' }
      return Response.json({ request })
    }
    if (url === '/api/requests') return Response.json({ requests: token === 'intern-anna' && request ? [request] : [] })
    throw new Error('Unexpected request ' + url)
  })
  vi.stubGlobal('fetch', mock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>)
  return { fail, mock }
}

const link = (name: string) => within(screen.getByRole('navigation')).getByRole('link', { name })
const fill = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
function switchTo(value: string, returnTo: string) {
  fireEvent.click(screen.getByRole('link', { name: 'Открыть профиль' }))
  fireEvent.change(screen.getByLabelText('Демо-профиль'), { target: { value } })
  fireEvent.click(link(returnTo))
}

beforeEach(() => sessionStorage.clear())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AI Buddy workspace', () => {
  it('opens a suggested question in the assistant', async () => {
    fixture()
    await screen.findByRole('heading', { name: 'Чем могу помочь сегодня?' })
    click('Где найти документацию?')
    await screen.findByText('Подготовьте заявку.')
    expect(screen.getByText('Где найти документацию?')).toBeTruthy()
    click('Свернуть диалог')
    expect(screen.getByRole('textbox', { name: 'Вопрос AI Buddy' })).toBeTruthy()
  })
  it('sends a question from the home page and restores the compact view', async () => {
    const { mock } = fixture()
    await screen.findByRole('heading', { name: 'Чем могу помочь сегодня?' })
    fill('Вопрос AI Buddy', 'Как подать заявку?')
    click('Открыть вопрос в AI Buddy')
    await screen.findByText('Подготовьте заявку.')
    expect(mock.mock.calls.filter(([url]) => url === '/api/chat')).toHaveLength(1)
    expect(screen.getByText('Как подать заявку?')).toBeTruthy()
    click('Свернуть диалог')
    expect(screen.getByRole('textbox', { name: 'Вопрос AI Buddy' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Свернуть диалог' })).toBeNull()
  })
  it('offers a mentor after five consecutive unanswered questions', async () => {
    const { mock } = fixture()
    await screen.findByRole('heading', { name: 'Чем могу помочь сегодня?' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Сообщения' }).at(-1)!)
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Чат AI Buddy' })).getByRole('button', { name: /AI Buddy/ }))
    for (let i = 1; i <= 5; i++) {
      fill('Ваш вопрос', 'Неизвестный вопрос ' + i)
      click('Отправить')
      await screen.findByText('Неизвестный вопрос ' + i)
      if (i < 5) expect(screen.queryByRole('button', { name: 'Написать наставнику' })).toBeNull()
    }
    click('Написать наставнику')
    expect((screen.getByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement).value).toContain('Неизвестный вопрос 5')
    expect(mock.mock.calls.some(([url, options]) => url === '/api/mentor/messages' && options.method === 'POST')).toBe(false)
  })
  it('resets the unanswered count after a successful answer', async () => {
    fixture()
    await screen.findByRole('heading', { name: 'Чем могу помочь сегодня?' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Сообщения' }).at(-1)!)
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Чат AI Buddy' })).getByRole('button', { name: /AI Buddy/ }))
    for (let i = 1; i <= 4; i++) {
      fill('Ваш вопрос', 'Неизвестный вопрос ' + i)
      click('Отправить')
      await screen.findByText('Неизвестный вопрос ' + i)
    }
    fill('Ваш вопрос', 'Как подать заявку?')
    click('Отправить')
    await screen.findByText('Подготовьте заявку.')
    fill('Ваш вопрос', 'Неизвестный вопрос 5')
    click('Отправить')
    await screen.findByText('Неизвестный вопрос 5')
    expect(screen.queryByRole('button', { name: 'Написать наставнику' })).toBeNull()
  })
  it('shows AI Buddy first and lets an intern message another intern', async () => {
    fixture()
    await screen.findByRole('heading', { name: 'Чем могу помочь сегодня?' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Сообщения' }).at(-1)!)
    expect(within(screen.getByRole('complementary', { name: 'Чат AI Buddy' })).getByRole('button', { name: /AI Buddy/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Мария/ })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /Иван/ }))
    fill('Сообщение', 'Привет, Иван!')
    click('Отправить')
    await screen.findByText('Привет, Иван!')
  })

  it('lets a mentor select an intern and send a reply', async () => {
    fixture()
    await screen.findByRole('heading', { name: 'Чем могу помочь сегодня?' })
    switchTo('mentor', 'Обзор')
    await screen.findByRole('heading', { name: 'Здравствуйте, Мария' })
    expect(screen.getByText('Задачи наставника и заявки закреплённых стажёров')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Сообщения' }).at(-1)!)
    expect(screen.getByRole('button', { name: /Спросить поддержку/ })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /Анна/ }))
    fill('Сообщение', 'Открой README')
    click('Отправить')
    await screen.findByText(/Открой README/)
  })

  it('saves checklist progress from chat after clicking confirmation', async () => {
    const { mock } = fixture('/checklist')
    const task = await screen.findByRole('checkbox', { name: 'Прочитать введение' })
    expect(screen.queryAllByRole('button', { name: /Спросить AI Buddy/ })).toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Сообщения' }).at(-1)!)
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Чат AI Buddy' })).getByRole('button', { name: /AI Buddy/ }))
    fill('Ваш вопрос', 'Как прочитать введение?')
    click('Отправить')
    await screen.findByText('Начните с материалов команды.')
    fill('Ваш вопрос', 'Я сделала')
    click('Отправить')
    await screen.findByRole('button', { name: 'Подтвердить выполнение' })
    expect(mock.mock.calls.some(([, options]) => options.method === 'PATCH')).toBe(false)
    click('Подтвердить выполнение')
    await screen.findByText(/Следующий шаг: «Согласовать цели»/)
    await waitFor(() => expect((task as HTMLInputElement).checked).toBe(true))
    expect(screen.queryByRole('button', { name: 'Подтвердить выполнение' })).toBeNull()
  })

  it('navigates from onboarding to an explicitly confirmed request and hides it when changing identities', async () => {
    const { fail, mock } = fixture()
    await screen.findByRole('heading', { name: 'Чем могу помочь сегодня?' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Сообщения' }).at(-1)!)
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Чат AI Buddy' })).getByRole('button', { name: /AI Buddy/ }))
    fill('Ваш вопрос', 'Как получить доступ к пространству команды?')
    fail.set('POST /api/chat', Response.json({ detail: 'Чат временно недоступен' }, { status: 503 }))
    click('Отправить')
    await screen.findByRole('alert')
    click('Повторить')
    await screen.findByText('Подготовьте заявку.')
    fireEvent.click(screen.getByText('Источники'))
    fireEvent.click(screen.getByRole('link', { name: 'Учебная инструкция' }))
    await screen.findByText('Запросите доступ.')
    fireEvent.click(link('Мои заявки'))
    fill('Зачем нужен доступ', 'Изучить материалы')
    fail.set('POST /api/requests', new Response('invalid', { status: 422 }))
    click('Проверить заявку')
    await screen.findByText('Проверьте заявку')
    expect(mock.mock.calls.some(([url, options]) => url === '/api/requests' && options.method === 'POST')).toBe(false)
    click('Подтвердить отправку')
    await screen.findByRole('alert')
    fail.set('POST /api/requests/req/confirm', Response.json({ detail: 'Повторите отправку' }, { status: 503 }))
    click('Повторить')
    await screen.findByRole('alert')
    click('Повторить')
    await waitFor(() => expect(screen.getAllByText('DEMO-001').length).toBeGreaterThan(0))
    expect(mock.mock.calls.find(([url]) => url.endsWith('/confirm'))?.[1].body).toBe('{"confirmed":true}')
    switchTo('intern-ivan', 'Мои заявки')
    await screen.findByText('Заявок пока нет.')
    expect(screen.queryByText('DEMO-001')).toBeNull()
    switchTo('mentor', 'Заявки стажёров')
    await screen.findByText('Создание заявок доступно стажёрам.')
  })

  it('loads tasks by period and keeps server task status after navigating', async () => {
    fixture('/checklist')
    await screen.findByRole('heading', { name: 'Первая неделя' })
    const task = screen.getByRole('checkbox', { name: 'Прочитать введение' }) as HTMLInputElement
    const blocked = screen.getByRole('checkbox', { name: 'Согласовать цели' }) as HTMLInputElement
    expect(blocked.disabled).toBe(true)
    expect(screen.getByText('Связанные заявки (1)')).toBeTruthy()
    fireEvent.click(task)
    await waitFor(() => expect(task.checked).toBe(true))
    fireEvent.click(link('Обзор'))
    await screen.findByText('1 из 2 задач выполнено')
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1)
    fireEvent.click(link('Чек-лист'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Прочитать введение' }))
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Прочитать введение' }) as HTMLInputElement).checked).toBe(false))
    switchTo('mentor', 'Чек-лист')
    await screen.findByRole('heading', { name: 'Задачи наставника' })
    await screen.findByText('Задач пока нет.')
  })
})
