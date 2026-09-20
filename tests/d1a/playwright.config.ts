import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: __dirname,
  testMatch: '*.browser.spec.ts',
  outputDir: '../../.cache/d1a-browser',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.D1A_BASE_URL || 'http://127.0.0.1:3100',
    viewport: { width: 1366, height: 768 },
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.D1A_BROWSER_EXECUTABLE || undefined,
      chromiumSandbox: true,
    },
  },
  // Start npm run test:d1a:serve separately. No implicit server/production I/O.
});
