import { expect, test } from '@playwright/test'

type DemoUser = { role: string; token: string }
type Ticket = { id: string; ticket_id: string; status: string }

test('стажёр проходит путь от задачи до сохранённой заявки', async ({ page, request }, info) => {
  const session = await request.get('/api/session')
  expect(session.ok()).toBeTruthy()
  const { users }: { users: DemoUser[] } = await session.json()
  const [intern, otherIntern] = users.filter((user) => user.role === 'intern')
  expect(intern).toBeDefined()
  expect(otherIntern).toBeDefined()

  await page.goto('/')
  await page.getByRole('link', { name: 'Открыть профиль' }).click()
  await page.locator('#identity').selectOption(intern.token)
  await page.getByRole('link', { name: 'Обзор', exact: true }).click()
  await page.screenshot({ path: info.outputPath('dashboard-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Сообщения', exact: true }).last().click()
  await expect(page.getByRole('complementary', { name: 'Чат AI Buddy' })).toBeVisible()
  await page.locator('#question').fill('Как получить доступ к пространству команды?')
  const chatResponse = page.waitForResponse((response) => response.url().endsWith('/api/chat'))
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  const chat = await chatResponse
  expect(chat.ok()).toBeTruthy()
  const { sources } = await chat.json()
  expect(sources.length).toBeGreaterThan(0)
  await page.getByText('Источники', { exact: true }).click()
  await expect(page.getByText(sources[0].title, { exact: true }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Создать заявку' }).click()
  await page.locator('#reason').fill('Нужны материалы для первой задачи. [fail-once]')
  await page.locator('#prepare').click()
  await expect(page.locator('#confirm')).toBeVisible()
  const firstConfirmation = page.waitForResponse((response) => /\/api\/requests\/[^/]+\/confirm$/.test(response.url()))
  await page.locator('#confirm').click()
  expect((await firstConfirmation).status()).toBe(503)
  const confirmation = page.waitForResponse((response) => /\/api\/requests\/[^/]+\/confirm$/.test(response.url()))
  await page.getByRole('button', { name: 'Повторить' }).click()
  const submitted = await confirmation
  expect(submitted.ok()).toBeTruthy()
  const { request: ticket }: { request: Ticket } = await submitted.json()
  expect(ticket.status).toBe('submitted')
  expect(ticket.ticket_id).toBeTruthy()

  await page.getByRole('link', { name: 'Мои заявки' }).click()
  await page.reload()
  await expect(page.getByText(ticket.ticket_id, { exact: false }).first()).toBeVisible()

  const repeat = await request.post(`/api/requests/${ticket.id}/confirm`, {
    headers: { Authorization: `Bearer ${intern.token}` },
    data: { confirmed: true },
  })
  expect(repeat.ok()).toBeTruthy()
  expect((await repeat.json()).request.ticket_id).toBe(ticket.ticket_id)

  const forged = await request.post(`/api/requests/${ticket.id}/confirm`, {
    headers: { Authorization: `Bearer ${otherIntern.token}` },
    data: { confirmed: true },
  })
  expect([403, 404]).toContain(forged.status())
  const list = await request.get('/api/requests', {
    headers: { Authorization: `Bearer ${otherIntern.token}` },
  })
  expect((await list.json()).requests).toEqual([])

  await page.getByRole('link', { name: 'Обзор', exact: true }).click()
  await expect(page.getByText('Задача ждёт доступа')).toBeVisible()
  await expect(page.getByText(/^Пока ждёте:/)).toBeVisible()
  await page.getByRole('link', { name: 'Проверить заявку' }).click()
  const mentor = users.find(user => user.role === 'mentor')!
  await page.getByRole('link', { name: 'Открыть профиль' }).click()
  await page.locator('#identity').selectOption(mentor.token)
  await page.getByRole('link', { name: 'Заявки стажёров' }).click()
  const ticketRow = page.getByRole('listitem').filter({ hasText: ticket.ticket_id })
  await ticketRow.getByRole('button', { name: 'Согласовать' }).click()
  await expect(ticketRow.getByText('Согласована')).toBeVisible()
  await page.getByRole('link', { name: 'Открыть профиль' }).click()
  await page.locator('#identity').selectOption(intern.token)
  await page.getByRole('link', { name: 'Мои заявки' }).click()
  await page.getByRole('button', { name: 'Демо: подтвердить выдачу доступа' }).click()
  await expect(page.getByText('Доступ выдан', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Обзор', exact: true }).click()
  await page.reload()
  await expect(page.getByText('Можно начать, доступ выдан')).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: 'Сообщения' }).click()
  await page.getByText('Написать наставнику', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Вопрос наставнику' }).fill('Помогите выбрать первую задачу.')
  await page.getByRole('button', { name: 'Отправить наставнику' }).click()
  await expect(page.getByText('Обращение отправлено наставнику в демоверсии.')).toBeVisible()
  await page.getByRole('button', { name: 'Свернуть сообщения' }).click()
  await page.getByRole('link', { name: 'Открыть профиль' }).click()
  await page.locator('#identity').selectOption(mentor.token)
  await page.getByRole('banner').getByRole('button', { name: 'Сообщения' }).click()
  await page.getByRole('link', { name: 'Открыть обращения стажёров' }).click()
  await expect(page.getByRole('heading', { name: 'Обращения стажёров' })).toBeVisible()
  await expect(page.getByText('Помогите выбрать первую задачу.')).toBeVisible()
})

test('панель на мобильном экране не выходит за границы окна', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Первая рабочая задача' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: info.outputPath('dashboard-mobile.png'), fullPage: true })
  const light = await page.locator('html').evaluate(root => getComputedStyle(root).backgroundColor)
  await page.getByRole('link', { name: 'Открыть профиль' }).click()
  await page.getByRole('combobox', { name: 'Тема' }).selectOption('dark')
  await page.getByRole('link', { name: 'Обзор', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Первая рабочая задача' })).toBeVisible()
  const dark = await page.locator('html').evaluate(root => getComputedStyle(root).backgroundColor)
  expect(dark).not.toBe(light)
  await page.getByRole('button', { name: 'Сообщения', exact: true }).last().click()
  await expect(page.getByRole('textbox', { name: 'Ваш вопрос' })).toBeVisible()
  await expect(page.getByText('Написать наставнику')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: info.outputPath('dashboard-dark-chat-mobile.png') })
})
