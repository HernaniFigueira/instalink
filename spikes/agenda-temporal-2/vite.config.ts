import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
  createDemoServerState,
  resetDemoServerState,
  validateDemoMutation,
  type DemoMutationRequest,
} from './src/domain/server-mock.ts';
import type { DemoServerState } from './src/domain/server-mock.ts';

const spikeDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(spikeDir, '../..');
const scheduleXModules = path.join(spikeDir, 'schedule-x/node_modules');
const serverStates = new Map<number, DemoServerState>();

function stateFor(eventCount: number): DemoServerState {
  const count = Math.max(7, Math.min(1_000, Math.floor(eventCount || 7)));
  let state = serverStates.get(count);
  if (!state) {
    state = createDemoServerState(count);
    serverStates.set(count, state);
  }
  return state;
}

function isolatedDemoApi(): Plugin {
  return {
    name: 'agenda-temporal-spike-demo-api',
    configureServer(server) {
      server.middlewares.use('/__agenda_temporal_spike/validate', (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST');
          res.end('Method not allowed');
          return;
        }
        const chunks: Uint8Array[] = [];
        req.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DemoMutationRequest;
            // A small delay makes the pending / server-authoritative state visible in the UI.
            await new Promise((resolve) => setTimeout(resolve, 90));
            const state = stateFor(payload.eventCount || 7);
            const result = validateDemoMutation(payload, state);
            res.statusCode = result.ok ? 200 : 409;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(result));
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, message: 'Payload de demonstração inválido.' }));
          }
        });
        req.on('error', next);
      });

      server.middlewares.use('/__agenda_temporal_spike/reset', (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST');
          res.end('Method not allowed');
          return;
        }
        const chunks: Uint8Array[] = [];
        req.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { eventCount?: number };
            const count = Math.max(7, Math.min(1_000, Math.floor(body.eventCount || 7)));
            const state = stateFor(count);
            resetDemoServerState(state, count);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ ok: true, eventCount: count }));
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, message: 'Payload de reset inválido.' }));
          }
        });
        req.on('error', next);
      });
    },
  };
}

export default defineConfig({
  root: spikeDir,
  plugins: [react(), isolatedDemoApi()],
  resolve: {
    alias: [
      { find: '@', replacement: path.join(repository, 'src') },
      { find: /^@schedule-x\/calendar$/, replacement: path.join(scheduleXModules, '@schedule-x/calendar') },
      { find: /^@schedule-x\/react$/, replacement: path.join(scheduleXModules, '@schedule-x/react') },
      { find: /^@schedule-x\/shared$/, replacement: path.join(scheduleXModules, '@schedule-x/shared') },
      { find: /^@schedule-x\/calendar-controls$/, replacement: path.join(scheduleXModules, '@schedule-x/calendar-controls') },
      { find: /^@schedule-x\/theme-default$/, replacement: path.join(scheduleXModules, '@schedule-x/theme-default') },
      { find: /^@agenda-sx\/temporal\/global$/, replacement: path.join(scheduleXModules, 'temporal-polyfill/global.esm.js') },
      { find: /^@agenda-sx\/temporal$/, replacement: path.join(scheduleXModules, 'temporal-polyfill') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '0.0.0.0',
    port: 3101,
    strictPort: true,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    fs: { allow: [repository] },
  },
  preview: {
    host: '0.0.0.0',
    port: 3101,
    strictPort: true,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
  },
  build: {
    outDir: path.join(spikeDir, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
