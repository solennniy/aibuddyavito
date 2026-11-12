import { useState, type FormEvent } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AccessRequest, type ChatAnswer, type DemoUser, type Document, type Task, type User } from './api'

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
const help = '/assistant?question=' + encodeURIComponent('Как получить доступ к пространству команды?')
type ChatEntry = { question: string; result: ChatAnswer }
type FirstTask = { title: string; state: 'blocked' | 'waiting' | 'ready'; reason: string; alternative: string | null }

function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return <div className="error" role="alert">{error.message}{retry && <button className="quiet" onClick={retry}>Повторить</button>}</div>
}

function RequestHistory({ requests }: { requests: AccessRequest[] }) {
  return requests.length ? <ul className="rows">{requests.map(request =>
    <li key={request.id} className="row">
      <div><strong>{request.ticket_id ?? 'Заявка на доступ'}</strong><p>{request.reason}</p><p>{request.next_step}</p></div>
      <span className="status" data-status={request.status}>{statuses[request.status] ?? request.status}</span>
    </li>)}</ul> : <p className="muted">Заявок пока нет.</p>
}

function Dashboard({ user, tasks, requests, firstTask }: { user: User; tasks: Task[]; requests: AccessRequest[]; firstTask?: FirstTask | null }) {
  const completed = tasks.filter(task => task.status === 'completed').length
  const upcoming = tasks.filter(task => task.status === 'todo' || task.status === 'in_progress')
  const blocked = tasks.filter(task => task.status === 'blocked')
  return <>
    <header className="intro"><h1>Здравствуйте, {user.name}</h1><p>Ваш план адаптации и заявки в пространство команды</p></header>
    <div className="dashboard">
      <section className="panel timeline">
        <h2>Маршрут адаптации</h2>
        <p className="metric">{completed} <span>из {tasks.length} задач выполнено</span></p>
        <progress aria-label="Прогресс адаптации" value={completed} max={tasks.length || 1} />
        <ol className="periods">{Object.entries(periods).map(([key, title]) =>
          <li key={key} aria-current={upcoming[0]?.period === key ? 'step' : undefined}>{title}</li>
        )}</ol>
      </section>
      {user.role === 'intern' && <section className="panel next-step"><h2>Первая рабочая задача</h2>
        <p><strong>{firstTask?.title ?? 'Доступ к команде'}</strong></p>
        {firstTask?.state === 'ready' ? <p role="status">Можно начать · доступ выдан</p> :
          firstTask?.state === 'waiting' ? <>
            <p role="status">Задача ждёт доступа</p>
            {firstTask.alternative && <p>Пока ждёте: {firstTask.alternative}</p>}
            <Link to="/requests">Проверить заявку</Link>
          </> : <>
            <p>Мешает начать: нужен доступ к пространству команды.</p>
            <Link className="button" to={help + (firstTask ? '&reason=' + encodeURIComponent(firstTask.reason) : '')}>Получить помощь</Link>
          </>}
      </section>}
      <section className="panel">
        <h2>Ближайшие задачи</h2>
        <ul className="rows">{upcoming.slice(0, 4).map(task => <li key={task.id} className="row">{task.title}<span className="status">{statuses[task.status]}</span></li>)}</ul>
        {!upcoming.length && <p className="muted">Ближайших задач нет.</p>}
        <Link to="/checklist">Открыть чек-лист</Link>
      </section>
      <section className="panel"><h2>Последние заявки</h2><RequestHistory requests={requests.slice(0, 3)} /><Link to="/requests">Открыть заявки</Link></section>
      <section className="panel"><h2>Заблокированные задачи</h2>{blocked.length ? <ul>{blocked.map(task => <li key={task.id}>{task.title}</li>)}</ul> : <p className="muted">Заблокированных задач нет.</p>}</section>
    </div>
  </>
}

function Checklist({ tasks, token }: { tasks: Task[]; token: string }) {
  const client = useQueryClient()
  const change = useMutation({
    mutationFn: (task: Task) => api<Task>('/tasks/' + encodeURIComponent(task.id), token, { status: task.status === 'completed' ? 'todo' : 'completed' }, 'PATCH'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tasks', token] }),
  })
  const groups = Map.groupBy(tasks, task => task.period)
  return <><header className="intro"><h1>Чек-лист адаптации</h1></header>
    {change.error && <ErrorNotice error={change.error} />}
    {!tasks.length && <p>У этой роли нет задач стажёра.</p>}
    {Array.from(groups, ([period, entries]) => <section className="panel stack" key={period}>
      <h2>{periods[period] ?? period}</h2>
      <ul className="rows">{entries.map(task => <li key={task.id} className="row">
        <div>
          <label className="task"><input type="checkbox" checked={task.status === 'completed'} disabled={change.isPending || task.status === 'blocked'} onChange={() => change.mutate(task)} />{task.title}</label>
          <p>{task.description}</p>
          {task.id === 'task-access-workspace' && <p><Link to={help}>Получить помощь</Link></p>}
          {task.document_ids.map(id => <p key={id}><Link to={'/knowledge#' + id}>Открыть инструкцию</Link></p>)}
          {task.request_ids.length > 0 && <Link to="/requests">Связанные заявки ({task.request_ids.length})</Link>}
        </div>
        <span className="status" data-status={task.status}>{statuses[task.status]}</span>
      </li>)}</ul>
    </section>)}
  </>
}

function Assistant({ token, canRequest, history, addEntry }: {
  token: string
  canRequest: boolean
  history: ChatEntry[]
  addEntry: (entry: ChatEntry) => void
}) {
  const [params] = useSearchParams()
  const [question, setQuestion] = useState(params.get('question') ?? '')
  const send = useMutation({
    mutationFn: (message: string) => api<ChatAnswer>('/chat', token, { message }),
    onSuccess: (result, message) => { addEntry({ question: message, result }); setQuestion('') },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (question.trim()) send.mutate(question.trim())
  }
  return <>
    <header className="intro"><h1>AI Buddy</h1><p>Ответы по доступным учебным инструкциям</p></header>
    <div className="assistant-layout">
      <section className="panel conversation">
        <div className="messages" aria-live="polite">
          <p className="intro-message">Спросите, как пройти этап адаптации или запросить доступ к пространству команды.</p>
          {history.map(({ question: asked, result }, index) => <article key={index}>
            <p className="asked">{asked}</p><div className="reply"><strong>AI Buddy · {result.mode === 'demo' ? 'деморежим' : 'ответ модели'}</strong><p>{result.answer}</p>
            {result.sources.length > 0 && <details className="sources"><summary>Источники</summary><ul>{result.sources.map(source => <li key={source.id}><Link to={'/knowledge#' + source.id}>{source.title}</Link></li>)}</ul></details>}
            {result.action && <Link className="button secondary" to={params.has('reason') ? '/requests?' + new URLSearchParams({ reason: params.get('reason')! }) : '/requests'}>Создать заявку</Link>}
            </div>
          </article>)}
        </div>
        {send.isPending && <p role="status">Ищем ответ…</p>}
        {send.error && <ErrorNotice error={send.error} retry={() => send.mutate(send.variables!)} />}
        <form className="composer" onSubmit={submit}>
          <label htmlFor="question">Ваш вопрос</label>
          <textarea id="question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} required placeholder="Как запросить доступ к пространству команды?" />
          <button type="submit" disabled={send.isPending}>Отправить</button>
        </form>
      </section>
      {canRequest && <aside className="panel next-step"><h2>Следующий шаг</h2><p>Для первой задачи можно запросить доступ к пространству вашей команды.</p><Link to="/requests">Перейти к заявке</Link></aside>}
    </div>
  </>
}

function Requests({ token, user, requests }: { token: string; user: User; requests: AccessRequest[] }) {
  const client = useQueryClient()
  const [params] = useSearchParams()
  const [reason, setReason] = useState(() => (params.get('reason') ?? '').slice(0, 500))
  const [selected, setSelected] = useState<AccessRequest | null>(null)
  const updateHistory = () => client.invalidateQueries({ queryKey: ['requests', token] })
  const prepare = useMutation({
    mutationFn: () => api<{ request: AccessRequest }>('/requests', token, { resource: 'team_workspace', reason: reason.trim() }),
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
    <header className="intro"><h1>Мои заявки</h1><p>Заявки отправляются в учебный сервис</p></header>
    <div className="dashboard">
      <section className="panel">
        <h2>Доступ к пространству команды</h2>
        {user.role === 'intern' ? <>
          <form className="composer" onSubmit={event => { event.preventDefault(); if (reason.trim()) { confirm.reset(); prepare.mutate() } }}>
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
        <h2>История заявок</h2><RequestHistory requests={requests} />
        {user.role === 'intern' && requests.filter(request => request.status === 'submitted').map(request =>
          <button className="quiet" key={request.id} disabled={pending} onClick={() => grant.mutate(request.id)}>Демо: подтвердить выдачу доступа</button>
        )}
        {grant.error && <ErrorNotice error={grant.error} />}
        {user.role === 'intern' && requests.filter(request => ['draft', 'failed'].includes(request.status)).map(request =>
          <button className="quiet" key={request.id} onClick={() => { confirm.reset(); setSelected(request) }}>Открыть черновик: {request.reason}</button>
        )}
      </section>
    </div>
  </>
}

function Knowledge({ token }: { token: string }) {
  const result = useQuery({ queryKey: ['knowledge', token], queryFn: () => api<{ documents: Document[] }>('/knowledge', token) })
  return <><header className="intro"><h1>База знаний</h1><p>Инструкции, доступные вашей роли</p></header>
    {result.isPending && <p role="status">Загружаем инструкции…</p>}
    {result.error && <ErrorNotice error={result.error} retry={() => void result.refetch()} />}
    {result.data?.documents.map(document => <section key={document.id} id={document.id} className="panel stack">
      <h2>{document.title}</h2><p>{document.content}</p><small className="muted">Учебный материал</small>
    </section>)}
    {result.data?.documents.length === 0 && <p>Доступных инструкций нет.</p>}
  </>
}

function Workspace({ token }: { token: string }) {
  const [history, setHistory] = useState<ChatEntry[]>([])
  const profile = useQuery({ queryKey: ['profile', token], queryFn: () => api<User>('/me', token) })
  const tasks = useQuery({ queryKey: ['tasks', token], queryFn: () => api<{ tasks: Task[]; first_task?: FirstTask | null }>('/tasks', token) })
  const requests = useQuery({ queryKey: ['requests', token], queryFn: () => api<{ requests: AccessRequest[] }>('/requests', token) })
  const errors = [profile, tasks, requests].filter(result => result.error)
  if (errors.length) return <ErrorNotice error={errors[0].error!} retry={() => errors.forEach(result => void result.refetch())} />
  if (!profile.data || !tasks.data || !requests.data) return <p role="status">Загружаем ваш маршрут…</p>
  return <Routes>
    <Route path="/" element={<Dashboard user={profile.data} tasks={tasks.data.tasks} requests={requests.data.requests} firstTask={tasks.data.first_task} />} />
    <Route path="/checklist" element={<Checklist tasks={tasks.data.tasks} token={token} />} />
    <Route path="/assistant" element={<Assistant token={token} canRequest={profile.data.role === 'intern'} history={history} addEntry={entry => setHistory(old => [...old, entry])} />} />
    <Route path="/requests" element={<Requests token={token} user={profile.data} requests={requests.data.requests} />} />
    <Route path="/knowledge" element={<Knowledge token={token} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

export function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ users: DemoUser[] }>('/session') })
  const client = useQueryClient()
  const [preferred, setPreferred] = useState(() => sessionStorage.getItem('buddy-profile') ?? '')
  const users = session.data?.users ?? []
  const current = users.find(user => user.token === preferred) ?? users[0]
  return <>
    <header className="topbar">
      <Link to="/" className="brand"><span className="mark" aria-hidden="true"><i /><i /><i /><i /></span>AI Buddy</Link>
      <label htmlFor="identity">Демо-профиль <select id="identity" disabled={!users.length} value={current?.token ?? ''} onChange={event => {
        if (current) client.removeQueries({ predicate: query => query.queryKey.includes(current.token) })
        sessionStorage.setItem('buddy-profile', event.target.value)
        setPreferred(event.target.value)
      }}>
        {!users.length && <option value="">Загрузка…</option>}
        {users.map(user => <option key={user.token} value={user.token}>{user.name} · {roles[user.role] ?? user.role}</option>)}
      </select></label>
    </header>
    <div className="shell">
      <nav aria-label="Рабочая область">
        <NavLink to="/" end>Обзор</NavLink>
        <NavLink to="/checklist">Чек-лист</NavLink>
        <NavLink to="/assistant">AI Buddy</NavLink>
        <NavLink to="/requests">Мои заявки</NavLink>
        <NavLink to="/knowledge">База знаний</NavLink>
      </nav>
      <main>
        {session.isPending && <p role="status">Загружаем профили…</p>}
        {session.error && <ErrorNotice error={session.error} retry={() => void session.refetch()} />}
        {current && <Workspace key={current.token} token={current.token} />}
        <footer>Демонстрационный прототип. Инструкции и сервис заявок учебные.</footer>
      </main>
    </div>
  </>
}
