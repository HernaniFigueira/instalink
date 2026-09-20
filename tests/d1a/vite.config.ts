import { defineConfig } from 'vite';
import path from 'node:path';
const repository = path.resolve(__dirname, '../..');
// Test-only app: not part of Next routes or the production build. No backend,
// authentication bypass, fixture endpoint or real customer data.
export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@': path.join(repository, 'src') } },
  oxc: { jsx: { runtime: 'automatic' } },
  css: { postcss: repository },
  server: { host: '0.0.0.0', port: 3100, strictPort: true, allowedHosts: ['.e2b.app'], fs: { allow: [repository] } },
});
