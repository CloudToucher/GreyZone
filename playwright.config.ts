import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4321',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1060 } },
    },
  ],
  webServer: {
    command: 'npx tsx tests/browser/server.ts',
    url: 'http://127.0.0.1:4321/api/health',
    timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: '4321', HOST: '127.0.0.1', DATA_DIR: '.data/ui-tests' },
  },
});
