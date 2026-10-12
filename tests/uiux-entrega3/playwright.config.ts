import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Entrega 3 · Agenda, UX por papel e E2E final. Muta dados SINTÉTICOS: só servidor local isolado.
const baseURL = process.env.DESIGN_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
  throw Error('Entrega 3 mutates synthetic data: local isolated servers only.');
}

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.browser.spec.ts',
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  // Artefatos fora do repo (não versionados).
  outputDir: process.env.E3_ARTIFACTS || path.join(os.homedir(), '.cache/e3-browser'),
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
    launchOptions: {
      executablePath: process.env.D1A_BROWSER_EXECUTABLE || undefined,
      chromiumSandbox: true,
    },
  },
});
