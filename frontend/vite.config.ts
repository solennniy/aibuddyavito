import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_TARGET ?? 'http://127.0.0.1:8000' },
  },
  test: {
    include: ['src/**/*.test.tsx'],
    environment: 'jsdom',
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.tsx'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { lines: 81 },
    },
  },
})
