import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Harness LOCAL e isolado (fixture sintética — nunca produção/Supabase).
// Ver setup.mjs. O executável do Chromium vem de D1A_BROWSER_EXECUTABLE
// (padrão do repositório; ex.: binário extraído em ~/.cache/ag-chromium/chromium
// com LD_LIBRARY_PATH apontando para as libs dele).
const baseURL = process.env.DESIGN_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
  throw Error('Agenda viewport tests read a local isolated server only.');
}
export default defineConfig({
  testDir: __dirname, testMatch: '*.browser.spec.ts', workers: 1, timeout: 120000, expect: { timeout: 15000 },
  outputDir: '../../.cache/agenda-viewport-browser', reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.D1A_BROWSER_EXECUTABLE || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
});
export const FIXTURE_FILE = process.env.DESIGN_TEST_FIXTURE || path.join(os.homedir(), '.cache/agenda-viewport/fixture.json');
