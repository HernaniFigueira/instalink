import { execFileSync } from 'node:child_process';
import { it, expect } from 'vitest';

it('auditoria transitiva: nenhum callback de escrita alcança Promise/I/O (mesmo ignorada)', () => {
  const output = execFileSync(process.execPath, ['scripts/audit-db-callbacks.mjs'], { encoding: 'utf8', timeout: 30_000 });
  expect(output).toContain('OK: nenhuma Promise');
}, 35_000);
