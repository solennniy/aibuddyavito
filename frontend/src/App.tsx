import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AccessRequest, type ChatAnswer, type DemoUser, type Document, type Task, type User } from './api'
import avitoLogo from './assets/avito-logo.webp?url'
import chatAvatars from './assets/chat-avatars.webp?url'

const periods: Record<string, string> = {
  week_1: 'Первая неделя', week_2: 'Вторая неделя', month_1: 'Первый месяц',
  month_2: 'Второй месяц', month_3_plus: 'После трёх месяцев',
}
const statuses: Record<string, string> = {
  todo: 'Предстоит', in_progress: 'В работе', completed: 'Выполнено', blocked: 'Заблокировано',
  draft: 'Черновик', submitted: 'Отправлена в учебный сервис', in_review: 'Рассматривается',
  approved: 'Согласована', rejected: 'Отклонена', failed: 'Ошибка обработки',
}
const roles: Record<string, string> = { intern: 'Стажёр', mentor: 'Наставник', admin: 'Администратор' }
const taskFollowUp = /^(с чего начать|что (конкретно|именно|нужно)|как (это|ее|её|его)|я (сделал[аи]?|завершил[аи]?|выполнил[аи]?)[.!]?\s*$|готово[.!]?\s*$)/i
type ChatEntry = { question: string; result: ChatAnswer }
type FirstTask = { title: string; state: 'blocked' | 'waiting' | 'ready'; alternative: string | null }

function ChatIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3.2a7.5 7.5 0 0 1 5.8-11.8h.1A7.5 7.5 0 0 1 20 11.5Z"/><path d="M9 10h7m-7 3h5"/></svg>
}

function Chevron({ down = false }: { down?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={down ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'}/></svg>
}

function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return <div className="error" role="alert">{error.message}{retry && <button className="quiet" onClick={retry}>Повторить</button>}</div>
}

function RequestHistory({ requests, actions }: { requests: AccessRequest[]; actions?: (request: AccessRequest) => React.ReactNode }) {
  return requests.length ? <ul className="rows">{requests.map(request =>
    <li key={request.id} className="row">
      <div><strong>{request.ticket_id ?? 'Заявка на доступ'}</strong>{request.intern_name && <p>Стажёр: {request.intern_name}</p>}<p>{request.reason}</p>{!request.intern_name && <p>{request.next_step}</p>}{actions?.(request)}</div>
      <span className="status" data-status={request.status}>{statuses[request.status] ?? request.status}</span>
    </li>)}</ul> : <p className="muted">Заявок пока нет.</p>
}

function Dashboard({ user, tasks, requests, firstTask, openAssistant }: { user: User; tasks: Task[]; requests: AccessRequest[]; firstTask?: FirstTask | null; openAssistant: (question?: string) => void }) {
  const completed = tasks.filter(task => task.status === 'completed').length
  const upcoming = tasks.filter(task => task.status === 'todo' || task.status === 'in_progress')
  const blocked = tasks.filter(task => task.status === 'blocked')
  const mentor = user.role === 'mentor'
  const allCompleted = tasks.length > 0 && completed === tasks.length
  return <>
    {!mentor && <section className="buddy-hero">
      <div><p className="buddy-eyebrow">AI Buddy · помощник стажёра</p><h1>Привет, {user.name}!</h1><p>Помогу разобраться с адаптацией, доступами и первой задачей.</p>
        <button type="button" onClick={() => openAssistant()}>Спросить AI Buddy</button>
      </div>
      <div className="buddy-hero-avatar"><ChatAvatar kind="ai" /></div>
    </section>}
    {!mentor && <div className="buddy-shortcuts" aria-label="Быстрые вопросы">
      {['Как получить доступ к пространству команды?', 'Где найти документацию команды?', 'Как начать первую задачу?', 'Как посмотреть прогресс?'].map(question =>
        <button type="button" key={question} onClick={() => openAssistant(question)}>{question}<span aria-hidden="true">↗</span></button>)}
    </div>}
    {mentor && <header className="intro"><h1>Здравствуйте, {user.name}</h1><p>Задачи наставника и заявки закреплённых стажёров</p></header>}
    <div className="dashboard">
      <section className="panel timeline">
        <h2>{user.role === 'mentor' ? 'Задачи наставника' : 'Прогресс адаптации'}</h2>
        <div className="progress-caption">
          <p className="metric">{completed} <span>из {tasks.length} задач выполнено</span></p>
          <strong>{tasks.length ? Math.round(completed / tasks.length * 100) : 0}%</strong>
        </div>
        <progress aria-label={mentor ? 'Выполнение задач наставника' : 'Прогресс адаптации'} aria-valuetext={`${completed} из ${tasks.length} задач выполнено`} value={completed} max={tasks.length || 1} />
        <p className="progress-note">{allCompleted
          ? mentor ? 'Все задачи наставника в чек-листе выполнены. Проверяйте новые заявки стажёров.' : 'Все задачи чек-листа выполнены. Можно вернуться к ним и проверить отметки.'
          : 'Полоса показывает долю задач, отмеченных выполненными в чек-листе.'}</p>
        {allCompleted && <Link to={mentor ? '/requests' : '/checklist'}>{mentor ? 'Посмотреть заявки стажёров' : 'Открыть чек-лист'}</Link>}
      </section>
      {user.role === 'intern' && <section className="panel next-step"><h2>Первая рабочая задача</h2>
        <p><strong>{firstTask?.title ?? 'Доступ к команде'}</strong></p>
        {firstTask?.state === 'ready' ? <p role="status">Можно начать, доступ выдан</p> :
          firstTask?.state === 'waiting' ? <>
            <p role="status">Задача ждёт доступа</p>
            {firstTask.alternative && <p>Пока ждёте: {firstTask.alternative}</p>}
            <Link to="/requests">Проверить заявку</Link>
          </> : <>
            <p>Мешает начать: нужен доступ к пространству команды.</p>
          </>}
      </section>}
      <section className="panel">
        <h2>Ближайшие задачи</h2>
        <ul className="rows">{upcoming.slice(0, 4).map(task => <li key={task.id} className="row">{task.title}<span className="status">{statuses[task.status]}</span></li>)}</ul>
        {!upcoming.length && <p className="muted">{allCompleted ? 'Все задачи выполнены.' : 'Ближайших задач нет.'}</p>}
        <Link to="/checklist">Открыть чек-лист</Link>
      </section>
      <section className="panel"><h2>{user.role === 'mentor' ? 'Заявки стажёров' : 'Последние заявки'}</h2><RequestHistory requests={requests.slice(0, 3)} /><Link to="/requests">Открыть заявки</Link></section>
      <section className="panel"><h2>Заблокированные задачи</h2>{firstTask && firstTask.state !== 'ready' && <p>{firstTask.title} — {firstTask.state === 'waiting' ? 'ожидает выдачи доступа' : 'нужен доступ к пространству команды'}</p>}{blocked.length > 0 && <ul>{blocked.map(task => <li key={task.id}>{task.title}</li>)}</ul>}{!blocked.length && (!firstTask || firstTask.state === 'ready') && <p className="muted">Заблокированных задач нет.</p>}</section>
    </div>
  </>
}

function Checklist({ tasks, token, role }: { tasks: Task[]; token: string; role: string }) {
  const client = useQueryClient()
  const change = useMutation({
    mutationFn: (task: Task) => api<Task>('/tasks/' + encodeURIComponent(task.id), token, { status: task.status === 'completed' ? 'todo' : 'completed' }, 'PATCH'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tasks', token] }),
  })
  const groups = Map.groupBy(tasks, task => task.period)
  return <><header className="intro"><h1>{role === 'mentor' ? 'Задачи наставника' : 'Чек-лист адаптации'}</h1><p>Задачи сгруппированы по периодам стажировки. Периоды показывают, когда их предполагается выполнять.</p></header>
    {change.error && <ErrorNotice error={change.error} />}
    {!tasks.length && <p>Задач пока нет.</p>}
    {Array.from(groups, ([period, entries]) => <section className="panel stack" key={period}>
      <h2>{periods[period] ?? period}</h2>
      <ul className="rows">{entries.map(task => <li key={task.id} className="row">
        <div>
          <label className="task"><input type="checkbox" checked={task.status === 'completed'} disabled={change.isPending || task.status === 'blocked'} onChange={() => change.mutate(task)} />{task.title}</label>
          <p>{task.description}</p>
          {task.document_ids.map(id => <p key={id}><Link to={'/knowledge#' + id}>Открыть инструкцию</Link></p>)}
          {task.request_ids.length > 0 && <Link to="/requests">Связанные заявки ({task.request_ids.length})</Link>}
        </div>
        <span className="status" data-status={task.status}>{statuses[task.status]}</span>
      </li>)}</ul>
    </section>)}
  </>
}

type ChatChoice = { id: string; name: string; kind: 'mentor' | 'peer' }

function ChatAvatar({ kind }: { kind: 'ai' | 'support' | 'anna' | 'ivan' | 'mentor' }) {
  return <span className={`chat-avatar avatar-${kind}`} style={{ backgroundImage: `url(${chatAvatars})` }} aria-hidden="true">
    {kind === 'ai' && <span className="avatar-brand"><img src={avitoLogo} alt="" /></span>}
  </span>
}

function PersonConversation({ token, user, choice, initialMessage = '' }: { token: string; user: User; choice: ChatChoice; initialMessage?: string }) {
  const client = useQueryClient()
  const [message, setMessage] = useState(initialMessage)
  const path = choice.kind === 'peer' ? '/peer/conversations/' + encodeURIComponent(choice.id)
    : '/mentor/conversations/' + encodeURIComponent(user.role === 'mentor' ? choice.id : user.id)
  const thread = useQuery({
    queryKey: ['conversation', token, path],
    queryFn: () => api<{ messages: { id: string; sender: string; message: string; created_at: string }[] }>(path, token),
    refetchInterval: 5000,
  })
  const send = useMutation({
    mutationFn: (text: string) => api<{ id: string }>(
      choice.kind === 'mentor' && user.role === 'intern' ? '/mentor/messages' : path,
      token, { message: text },
    ),
    onSuccess: () => { setMessage(''); void client.invalidateQueries({ queryKey: ['conversation', token, path] }) },
  })
  return <section className="panel conversation">
      {thread.isPending && <p role="status">Загружаем переписку…</p>}
      {thread.error && <ErrorNotice error={thread.error} retry={() => void thread.refetch()} />}
      {thread.data?.messages.length === 0 && <p>Сообщений пока нет.</p>}
      <div className="messages" aria-label="Переписка" aria-live="polite">{thread.data?.messages.map(item =>
        <p key={item.id} className={(choice.kind === 'peer' ? item.sender === 'me' : item.sender === user.role) ? 'asked' : 'reply'}>{item.message}</p>
      )}</div>
      <form className="composer" onSubmit={event => { event.preventDefault(); if (message.trim() && !send.isPending) send.mutate(message.trim()) }}>
        <label htmlFor="person-message">Сообщение</label>
        <textarea id="person-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} required />
        <button disabled={send.isPending}>{send.isPending ? 'Отправляем…' : 'Отправить'}</button>
      </form>
      {send.error && <ErrorNotice error={send.error} retry={() => send.mutate(send.variables!)} />}
  </section>
}

function ContactRow({ token, user, choice, onSelect }: { token: string; user: User; choice: ChatChoice; onSelect: () => void }) {
  const path = choice.kind === 'peer' ? '/peer/conversations/' + encodeURIComponent(choice.id)
    : '/mentor/conversations/' + encodeURIComponent(user.role === 'mentor' ? choice.id : user.id)
  const thread = useQuery({
    queryKey: ['conversation', token, path],
    queryFn: () => api<{ messages: { message: string }[] }>(path, token),
    refetchInterval: 5000,
  })
  const last = thread.data?.messages.at(-1)?.message
  return <button className="chat-list-item" type="button" onClick={onSelect}>
    <ChatAvatar kind={choice.name === 'Анна' ? 'anna' : choice.name === 'Иван' ? 'ivan' : 'mentor'} />
    <span className="chat-list-copy"><strong>{choice.name}</strong><span>{thread.isPending ? 'Загружаем…' : thread.error ? 'Не удалось загрузить' : last ?? 'Начать переписку'}</span></span>
  </button>
}

function SupportConversation({ token }: { token: string }) {
  const client = useQueryClient()
  const [message, setMessage] = useState('')
  const thread = useQuery({
    queryKey: ['support', token],
    queryFn: () => api<{ messages: { id: string; message: string }[] }>('/support/messages', token),
  })
  const send = useMutation({
    mutationFn: (text: string) => api<{ id: string }>('/support/messages', token, { message: text }),
    onSuccess: () => { setMessage(''); void client.invalidateQueries({ queryKey: ['support', token] }) },
  })
  return <section className="panel conversation">
    <p className="muted">Учебная поддержка. Сообщения сохраняются в демо, сотрудники поддержки к нему не подключены.</p>
    {thread.isPending && <p role="status">Загружаем переписку…</p>}
    {thread.error && <ErrorNotice error={thread.error} retry={() => void thread.refetch()} />}
    <div className="messages" aria-live="polite">{thread.data?.messages.map(item => <p key={item.id} className="asked">{item.message}</p>)}</div>
    <form className="composer" onSubmit={event => { event.preventDefault(); if (message.trim() && !send.isPending) send.mutate(message.trim()) }}>
      <label htmlFor="support-message">Вопрос в поддержку</label>
      <textarea id="support-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} required />
      <button disabled={send.isPending}>{send.isPending ? 'Сохраняем…' : 'Отправить'}</button>
    </form>
    {send.error && <ErrorNotice error={send.error} retry={() => send.mutate(send.variables!)} />}
  </section>
}

function Assistant({ token, user, canRequest, history, addEntry, onClose, initialQuestion }: {
  token: string
  user: User
  canRequest: boolean
  history: ChatEntry[]
  addEntry: (entry: ChatEntry) => void
  onClose: () => void
  initialQuestion?: string | null
}) {
  const client = useQueryClient()
  const [question, setQuestion] = useState(initialQuestion ?? '')
  const [view, setView] = useState<'list' | 'ai' | 'support' | 'person'>(initialQuestion !== null && initialQuestion !== undefined ? 'ai' : 'list')
  const [choice, setChoice] = useState<ChatChoice | null>(null)
  const [handoffMessage, setHandoffMessage] = useState('')
  const unresolved = history.reduce((count, entry) => entry.question
    ? entry.result.needs_human ? count + 1 : 0
    : count, 0)
  const contacts = useQuery({
    queryKey: ['chat-contacts', token],
    queryFn: () => api<{ contacts: ChatChoice[] }>('/chat/contacts', token),
    refetchInterval: 10000,
  })
  const send = useMutation({
    mutationFn: (message: string) => api<ChatAnswer>('/chat', token, {
      message,
      previous_question: history.findLast(entry => entry.question)?.question ?? '',
      task_id: taskFollowUp.test(message) ? history.at(-1)?.result.task_id ?? undefined : undefined,
    }),
    onSuccess: (result, message) => { addEntry({ question: message, result }); setQuestion('') },
  })
  const complete = useMutation({
    mutationFn: (id: string) => api<Task & { next_task: Pick<Task, 'id' | 'title' | 'description'> | null }>(
      '/tasks/' + encodeURIComponent(id) + '?include_next=true', token, { status: 'completed' }, 'PATCH',
    ),
    onSuccess: ({ title, next_task }) => {
      addEntry({ question: '', result: {
        answer: `«${title}» отмечена в чек-листе. ` + (next_task
          ? `Следующий шаг: «${next_task.title}». ${next_task.description}`
          : 'Все задачи в вашем чек-листе выполнены.'),
        sources: [], mode: 'demo', action: null, task_id: next_task?.id,
      } })
      void client.invalidateQueries({ queryKey: ['tasks', token] })
    },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (question.trim() && !send.isPending && !complete.isPending) {
      complete.reset()
      send.mutate(question.trim())
    }
  }
  return <>
    <header className="chat-heading">{view !== 'list' && <button type="button" className="chat-back" aria-label="Назад к чатам" onClick={() => setView('list')}>‹</button>}<h2>{view === 'person' ? choice?.name : view === 'ai' ? 'AI Buddy' : view === 'support' ? 'Поддержка' : 'Сообщения'}</h2><button type="button" className="chat-close" aria-label="Свернуть сообщения" onClick={onClose}><Chevron down /></button></header>
    {view === 'list' && <div className="chat-list">
      {canRequest ? <button className="chat-list-item support-item" type="button" onClick={() => setView('ai')}><ChatAvatar kind="ai" /><span className="chat-list-copy"><strong>AI Buddy</strong><span>{history.at(-1)?.result.answer ?? 'Помощь с адаптацией'}</span></span></button>
        : <button className="chat-list-item support-item" type="button" onClick={() => setView('support')}><ChatAvatar kind="support" /><span className="chat-list-copy"><strong>Спросить поддержку</strong><span>Учебный прототип</span></span></button>}
      {contacts.isPending && <p className="chat-list-status" role="status">Загружаем чаты…</p>}
      {contacts.error && <ErrorNotice error={contacts.error} retry={() => void contacts.refetch()} />}
      {contacts.data?.contacts.filter(contact => !canRequest || contact.kind !== 'mentor').map(contact => <ContactRow key={contact.kind + contact.id} token={token} user={user} choice={contact} onSelect={() => { setHandoffMessage(''); setChoice(contact); setView('person') }} />)}
      {contacts.data?.contacts.length === 0 && <p className="chat-list-status">Пока нет доступных собеседников.</p>}
    </div>}
    {view === 'support' && <SupportConversation token={token} />}
    {view === 'person' && choice && <PersonConversation key={choice.kind + choice.id} token={token} user={user} choice={choice} initialMessage={handoffMessage} />}
    {view === 'ai' && canRequest &&
    <div className="assistant-layout">
      <section className="panel conversation">
        <div className="messages" aria-live="polite">
          <p className="chat-participant"><strong>AI Buddy</strong></p>
          <p className="intro-message">{canRequest ? 'Спросите про задачу или напишите, что уже сделали.' : 'Спросите про этапы адаптации или откройте обращения стажёров.'}</p>
          {history.map(({ question: asked, result }, index) => <article key={index}>
            {asked && <p className="asked">{asked}</p>}<div className="reply"><strong>AI Buddy</strong><p>{result.answer}</p>
            {result.sources.length > 0 && <details className="sources"><summary>Источники</summary><ul>{result.sources.map(source => <li key={source.id}><Link to={'/knowledge#' + source.id} onClick={onClose}>{source.title}</Link></li>)}</ul></details>}
            {result.action && <Link className="button secondary" to="/requests" onClick={onClose}>Создать заявку</Link>}
            {index === history.length - 1 && canRequest && unresolved >= 5 &&
              contacts.data?.contacts.find(contact => contact.kind === 'mentor') &&
              <button type="button" className="secondary" onClick={() => {
                const mentor = contacts.data?.contacts.find(contact => contact.kind === 'mentor')
                if (mentor) {
                  setHandoffMessage(history.filter(entry => entry.question).slice(-5).map(entry => entry.question).join('\n'))
                  setChoice(mentor)
                  setView('person')
                }
              }}>Написать наставнику</button>}
            {result.complete_task && index === history.length - 1 && <button type="button" disabled={complete.isPending || send.isPending} onClick={() => complete.mutate(result.complete_task!.id)}>
              {complete.isPending ? 'Сохраняем…' : 'Подтвердить выполнение'}
            </button>}
            </div>
          </article>)}
        </div>
        {send.isPending && <p role="status">Ищем ответ…</p>}
        {send.error && <ErrorNotice error={send.error} retry={() => send.mutate(send.variables!)} />}
        {complete.error && <ErrorNotice error={complete.error} />}
        <form className="composer" onSubmit={submit}>
          <label htmlFor="question">Ваш вопрос</label>
          <textarea id="question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} required placeholder="Напишите сообщение" />
          <button type="submit" disabled={send.isPending || complete.isPending}>Отправить</button>
        </form>
      </section>
    </div>}
  </>
}

function Requests({ token, user, requests }: { token: string; user: User; requests: AccessRequest[] }) {
  const client = useQueryClient()
  const [params] = useSearchParams()
  const [reason, setReason] = useState(() => (params.get('reason') ?? '').slice(0, 500))
  const [selected, setSelected] = useState<AccessRequest | null>(null)
  const mentorMessages = useQuery({
    queryKey: ['mentor-messages', token],
    queryFn: () => api<{ messages: { id: string; intern_name: string; message: string }[] }>('/mentor/messages', token),
    enabled: user.role === 'mentor',
    refetchInterval: 5000,
  })
  const updateHistory = () => client.invalidateQueries({ queryKey: ['requests'] })
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      api<{ request: AccessRequest }>('/requests/' + encodeURIComponent(id) + '/review', token, { decision }),
    onSettled: async () => {
      await Promise.all([updateHistory(), client.invalidateQueries({ queryKey: ['tasks'] })])
    },
  })
  const prepare = useMutation({
    mutationFn: ({ reason, key }: { reason: string; key: string }) =>
      api<{ request: AccessRequest }>('/requests', token, { resource: 'team_workspace', reason }, 'POST', key),
    onSuccess: ({ request }) => { setSelected(request); setReason(''); void updateHistory() },
  })
  const confirm = useMutation({
    mutationFn: (id: string) => api<{ request: AccessRequest }>('/requests/' + encodeURIComponent(id) + '/confirm', token, { confirmed: true }),
    onSuccess: ({ request }) => { setSelected(request); void updateHistory(); void client.invalidateQueries({ queryKey: ['tasks', token] }) },
    onError: () => { void updateHistory() },
  })
  const grant = useMutation({
    mutationFn: (id: string) => api<{ request: AccessRequest }>('/demo/requests/' + encodeURIComponent(id) + '/grant', token, { confirmed: true }),
    onSuccess: ({ request }) => { setSelected(request); void updateHistory(); void client.invalidateQueries({ queryKey: ['tasks', token] }) },
  })
  const pending = prepare.isPending || confirm.isPending || grant.isPending
  return <>
    <header className="intro"><h1>{user.role === 'mentor' ? 'Заявки стажёров' : 'Мои заявки'}</h1><p>{user.role === 'mentor' ? 'Отправленные заявки закреплённых за вами стажёров' : 'Заявки отправляются в учебный сервис'}</p></header>
    <div className="dashboard">
      {user.role === 'mentor' && <section className="panel" id="mentor-messages"><h2>Обращения стажёров</h2>{mentorMessages.isPending && <p>Загружаем обращения…</p>}{mentorMessages.error && <ErrorNotice error={mentorMessages.error} retry={() => void mentorMessages.refetch()} />}{mentorMessages.data?.messages.length === 0 && <p className="muted">Обращений пока нет.</p>}<ul className="rows">{mentorMessages.data?.messages.map(message => <li className="row" key={message.id}><div><strong>{message.intern_name}</strong><p>{message.message}</p></div></li>)}</ul></section>}
      <section className="panel">
        <h2>Доступ к пространству команды</h2>
        {user.role === 'intern' ? <>
          <form className="composer" onSubmit={event => {
            event.preventDefault()
            const value = reason.trim()
            if (pending || !value) return
            confirm.reset()
            const previous = prepare.variables
            const key = prepare.isError && previous?.reason === value ? previous.key : crypto.randomUUID()
            prepare.mutate({ reason: value, key })
          }}>
            <label htmlFor="reason">Зачем нужен доступ</label>
            <textarea id="reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required />
            <button type="submit" id="prepare" disabled={pending}>Подготовить заявку</button>
          </form>
          {prepare.error && <ErrorNotice error={prepare.error} />}
          {selected && <div className="draft" aria-live="polite">
            <strong>{selected.ticket_id ?? 'Проверьте черновик'}</strong>
            <p>{selected.reason}</p><p>{selected.next_step}</p>
            {['draft', 'failed'].includes(selected.status) ?
              <button id="confirm" onClick={() => confirm.mutate(selected.id)} disabled={pending}>Подтвердить отправку</button>
              : <p className="status" data-status={selected.status}>{selected.status === 'completed' ? 'Доступ выдан' : statuses[selected.status]}</p>}
            {confirm.error && <ErrorNotice error={confirm.error} retry={() => confirm.mutate(selected.id)} />}
          </div>}
          {pending && <p role="status">Обрабатываем заявку…</p>}
        </> : <p className="muted">Создание заявок доступно стажёрам.</p>}
      </section>
      <section className="panel">
        <h2>История заявок</h2>
        {review.error && <ErrorNotice error={review.error} />}
        <RequestHistory requests={requests} actions={request => {
          if (user.role === 'mentor' && ['submitted', 'in_review'].includes(request.status)) {
            return <div className="request-actions">
              <button type="button" disabled={review.isPending} onClick={() => review.mutate({ id: request.id, decision: 'approved' })}>Согласовать</button>
              <button type="button" className="secondary" disabled={review.isPending} onClick={() => review.mutate({ id: request.id, decision: 'rejected' })}>Отклонить</button>
            </div>
          }
          if (user.role === 'intern' && request.status === 'approved') {
            return <button type="button" className="quiet" disabled={pending} onClick={() => grant.mutate(request.id)}>Демо: подтвердить выдачу доступа</button>
          }
        }} />
        {grant.error && <ErrorNotice error={grant.error} />}
        {user.role === 'intern' && requests.filter(request => ['draft', 'failed'].includes(request.status)).map(request =>
          <button className="quiet" key={request.id} onClick={() => { confirm.reset(); setSelected(request) }}>Открыть черновик: {request.reason}</button>
        )}
      </section>
    </div>
  </>
}

function Knowledge({ token }: { token: string }) {
  const resources = [
    ['Чек-лист стажёра', 'Этапы адаптации и материалы для backend-стажёров', 'https://docs.google.com/spreadsheets/d/1qKFqOzfSZ2jEz57jBSmq7rukDXi_tRfWohgemViceV0/edit?usp=sharing'],
    ['AvitoTech Playbook', 'Процессы, стандарты и культура инженерных команд', 'https://github.com/avito-tech/playbook'],
    ['AvitoTech на Хабре', 'Инженерные статьи и примеры инструментов', 'https://habr.com/ru/companies/avito/articles/'],
    ['AvitoTech', 'Материалы о технологиях и командах', 'https://avito.tech/'],
    ['AvitoTech Internship', 'Стажировки и задания прошлых наборов', 'https://github.com/avito-tech/tech-internship'],
    ['Дизайн-система Авито', 'Как устроена библиотека компонентов в Figma', 'https://habr.com/ru/companies/avito/articles/543450/'],
    ['Стажировки Авито', 'Информация о программах стажировок', 'https://start.avito.ru/internships'],
    ['Доклад о дизайн-системе', 'Видео о дизайн-системе Авито', 'https://rutube.ru/video/6a203a00a9ef7cdd25d811a01cacd61b/'],
  ]
  const result = useQuery({ queryKey: ['knowledge', token], queryFn: () => api<{ documents: Document[] }>('/knowledge', token) })
  return <><header className="intro"><h1>База знаний</h1><p>Инструкции, доступные вашей роли</p></header>
    {result.isPending && <p role="status">Загружаем инструкции…</p>}
    {result.error && <ErrorNotice error={result.error} retry={() => void result.refetch()} />}
    {result.data?.documents.map(document => <section key={document.id} id={document.id} className="panel stack">
      <h2>{document.title}</h2><p>{document.content}</p><small className="muted">Учебный материал</small>
    </section>)}
    {result.data?.documents.length === 0 && <p>Доступных инструкций нет.</p>}
    <section className="panel stack">
      <h2>Открытые материалы Авито</h2>
      <p className="muted">Источники из кейса помогут познакомиться с компанией и инструментами.</p>
      <ul className="rows">{resources.map(([title, description, url]) =>
        <li className="row" key={url}><div><a href={url} target="_blank" rel="noopener noreferrer">{title} ↗</a><p>{description}</p></div></li>
      )}</ul>
    </section>
  </>
}

function Workspace({ token, openAssistant }: { token: string; openAssistant: (question?: string) => void }) {
  const profile = useQuery({ queryKey: ['profile', token], queryFn: () => api<User>('/me', token) })
  const tasks = useQuery({ queryKey: ['tasks', token], queryFn: () => api<{ tasks: Task[]; first_task?: FirstTask | null }>('/tasks', token), refetchInterval: 5000 })
  const requests = useQuery({
    queryKey: ['requests', token],
    queryFn: () => api<{ requests: AccessRequest[] }>('/requests', token),
    refetchOnMount: 'always',
    refetchInterval: 5000,
  })
  const errors = [profile, tasks, requests].filter(result => result.error)
  if (errors.length) return <ErrorNotice error={errors[0].error!} retry={() => errors.forEach(result => void result.refetch())} />
  if (!profile.data || !tasks.data || !requests.data) return <p role="status">Загружаем ваш маршрут…</p>
  return <Routes>
    <Route path="/" element={<Dashboard user={profile.data} tasks={tasks.data.tasks} requests={requests.data.requests} firstTask={tasks.data.first_task} openAssistant={openAssistant} />} />
    <Route path="/checklist" element={<Checklist tasks={tasks.data.tasks} token={token} role={profile.data.role} />} />
    <Route path="/requests" element={<Requests token={token} user={profile.data} requests={requests.data.requests} />} />
    <Route path="/knowledge" element={<Knowledge token={token} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

export function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ users: DemoUser[] }>('/session') })
  const client = useQueryClient()
  const [preferred, setPreferred] = useState(() => sessionStorage.getItem('buddy-profile') ?? '')
  const [chatOpen, setChatOpen] = useState(false)
  const [initialQuestion, setInitialQuestion] = useState<string | null>(null)
  const [chatSession, setChatSession] = useState(0)
  const openAssistant = (question = '') => { setInitialQuestion(question); setChatSession(value => value + 1); setChatOpen(true) }
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([])
  const [theme, setTheme] = useState(() => localStorage.getItem('buddy-theme') ?? 'system')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('buddy-theme', theme)
  }, [theme])
  const users = session.data?.users ?? []
  const current = users.find(user => user.token === preferred) ?? users[0]
  return <>
    <header className="topbar">
      <Link to="/" className="brand"><span className="brand-logo"><img src={avitoLogo} alt="Авито" /><img className="brand-logo-inverse" src={avitoLogo} alt="" aria-hidden="true" /></span><span>AI Buddy</span></Link>
      <div className="topbar-controls">
      {current && <button type="button" className="messages-icon" aria-label="Сообщения" aria-expanded={chatOpen} aria-controls="buddy-messages" onClick={() => { setInitialQuestion(null); setChatOpen(open => !open) }}><ChatIcon /></button>}
      <NavLink to="/profile" className="profile-icon" aria-label="Открыть профиль" title="Профиль">
        {current ? <ChatAvatar kind={current.name === 'Анна' ? 'anna' : current.name === 'Иван' ? 'ivan' : 'mentor'} /> :
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="12" cy="8" r="3.25" />
            <path d="M5 20v-1a7 7 0 0 1 14 0v1" strokeLinecap="round" />
          </svg>}
      </NavLink>
      </div>
    </header>
    <div className="shell">
      <nav aria-label="Рабочая область">
        <NavLink to="/" end>Обзор</NavLink>
        <NavLink to="/checklist">Чек-лист</NavLink>
        <NavLink to="/requests">{current?.role === 'mentor' ? 'Заявки стажёров' : 'Мои заявки'}</NavLink>
        <NavLink to="/knowledge">База знаний</NavLink>
      </nav>
      <main>
        {session.isPending && <p role="status">Загружаем профили…</p>}
        {session.error && <ErrorNotice error={session.error} retry={() => void session.refetch()} />}
        <Routes>
          <Route path="/profile" element={<section className="panel profile-page">
          <h1>Профиль</h1>
          {current && <p>{current.name}, {roles[current.role] ?? current.role}</p>}
          <label htmlFor="identity">Демо-профиль <select id="identity" disabled={!users.length} value={current?.token ?? ''} onChange={event => {
            if (current) client.removeQueries({ predicate: query => query.queryKey.includes(current.token) })
            setChatHistory([])
            setChatOpen(false)
            sessionStorage.setItem('buddy-profile', event.target.value)
            setPreferred(event.target.value)
          }}>
            {!users.length && <option value="">Загрузка…</option>}
            {users.map(user => <option key={user.token} value={user.token}>{user.name}, {roles[user.role] ?? user.role}</option>)}
          </select></label>
          <section className="profile-section" aria-labelledby="profile-login">
            <h2 id="profile-login">Способы входа</h2>
            <div className="profile-provider"><span>Госуслуги</span><span>Не подключено</span></div>
            <div className="profile-provider"><span>Корпоративный аккаунт</span><span>Не подключено</span></div>
          </section>
          <div className="profile-section">
          <label>Тема <select value={theme} onChange={event => setTheme(event.target.value)}>
            <option value="system">Системная</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select></label>
          </div>
        </section>} />
          <Route path="*" element={current && <Workspace key={current.token} token={current.token} openAssistant={openAssistant} />} />
        </Routes>
        <footer>Демонстрационный прототип. Инструкции и сервис заявок учебные.</footer>
      </main>
    </div>
    {current && !chatOpen && <button type="button" className="chat-launcher" aria-expanded={false} aria-controls="buddy-messages" onClick={() => { setInitialQuestion(null); setChatOpen(true) }}>Сообщения<Chevron /></button>}
    {current && chatOpen && <aside id="buddy-messages" className="chat-widget" aria-label="Чат AI Buddy"><Assistant key={chatSession} token={current.token} user={current} canRequest={current.role === 'intern'} history={chatHistory} initialQuestion={initialQuestion} addEntry={entry => setChatHistory(old => [...old, entry])} onClose={() => { setChatOpen(false); setInitialQuestion(null) }} /></aside>}
  </>
}
