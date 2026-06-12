import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:8788' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
