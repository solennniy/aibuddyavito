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
  await page.locator('#identity').selectOption(intern.token)
  const help = page.getByRole('link', { name: 'Получить помощь' }).first()
  await expect(help).toBeVisible()
  await page.screenshot({ path: info.outputPath('dashboard-desktop.png'), fullPage: true })
  await help.click()
  await expect(page).toHaveURL(/\/assistant/)
  await expect(page.locator('#question')).not.toHaveValue('')
  const chatResponse = page.waitForResponse((response) => response.url().endsWith('/api/chat'))
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  const chat = await chatResponse
  expect(chat.ok()).toBeTruthy()
  const { sources } = await chat.json()
  expect(sources.length).toBeGreaterThan(0)
  await page.getByText('Источники', { exact: true }).click()
  await expect(page.getByText(sources[0].title, { exact: true }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Создать заявку' }).click()
  await expect(page.locator('#reason')).toHaveValue('Нужно изучить архитектуру команды и подготовить первый PR.')
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
  await page.getByRole('button', { name: 'Демо: подтвердить выдачу доступа' }).click()
  await expect(page.getByText('Доступ выдан', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Обзор', exact: true }).click()
  await page.reload()
  await expect(page.getByText('Можно начать · доступ выдан')).toBeVisible()
})

test('панель на мобильном экране не выходит за границы окна', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Получить помощь' }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: info.outputPath('dashboard-mobile.png'), fullPage: true })
})
