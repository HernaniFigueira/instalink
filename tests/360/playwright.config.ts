import { defineConfig } from '@playwright/test';
const baseURL = process.env.DESIGN_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw Error('Journey tests mutate synthetic data: local isolated servers only.');
export default defineConfig({
  testDir: __dirname, testMatch: '*.browser.spec.ts', workers: 1, timeout: 60000, expect: { timeout: 15000 },
  outputDir: '../../.cache/360-browser', reporter: 'list',
  use: { baseURL, viewport: { width: 1366, height: 900 }, screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.D1A_BROWSER_EXECUTABLE || undefined, chromiumSandbox: true } },
});
