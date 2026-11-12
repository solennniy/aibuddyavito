import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const api = 'http://127.0.0.1:8017'
const web = process.env.E2E_BASE_URL || 'http://127.0.0.1:5177'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: web,
    launchOptions: { executablePath: process.env.BROWSER_PATH },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : [
    {
      command: `"${process.env.PYTHON || 'python'}" -m uvicorn backend.main:app --host 127.0.0.1 --port 8017`,
      cwd: root,
      url: `${api}/api/session`,
      env: {
        DATABASE_PATH: join(tmpdir(), `aibuddy-e2e-${randomUUID()}.sqlite3`),
        LLM_API_URL: '',
        LLM_API_KEY: '',
        LLM_MODEL: '',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5177 --strictPort',
      cwd: import.meta.dirname,
      url: web,
      env: { API_TARGET: api },
    },
  ],
})
