import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the real API (against Postgres) and the built web app.
// Prerequisites: migrated database with the app role (`pnpm db:setup`), Mailpit on :1025/:8025,
// and `pnpm build`.
const apiEnv = {
  NODE_ENV: 'test',
  API_PORT: '4000',
  API_CORS_ORIGINS: 'http://localhost:3000',
  APP_WEB_URL: 'http://localhost:3000',
  SMTP_URL: process.env.SMTP_URL ?? 'smtp://localhost:1025',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  // WhatsApp uses the in-memory fake in tests; webhooks are signed with this test-only secret.
  META_APP_SECRET: 'e2e-meta-app-secret',
  AI_PROVIDER: 'none',
  ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: 'http://localhost:4000/health/ready',
      env: apiEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000',
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:4000' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
