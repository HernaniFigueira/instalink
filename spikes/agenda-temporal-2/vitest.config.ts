import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const spikeDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(spikeDir, '../..');

export default defineConfig({
  resolve: { alias: { '@': path.join(repository, 'src') }, dedupe: ['react', 'react-dom'] },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    root: spikeDir,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
