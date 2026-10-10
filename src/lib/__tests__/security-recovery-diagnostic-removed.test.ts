import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Regressão de segurança P0: a rota de diagnóstico de banco
// (GET /api/recovery-diagnostic) era pública, sem autenticação, e abria conexão
// com o banco para revelar usuário, schema e presença de tabela. Foi removida
// por não ter consumidor operacional. Este teste garante que ela não volte
// a existir e que nenhum código a referencie.

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ROUTE_DIR = path.join(ROOT, 'src', 'app', 'api', 'recovery-diagnostic');
const SELF = path.resolve(__filename);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('segurança P0 — rota /api/recovery-diagnostic removida', () => {
  it('o diretório da rota não existe mais (Next não publica o endpoint)', () => {
    expect(fs.existsSync(ROUTE_DIR)).toBe(false);
  });

  it('nenhum arquivo do repositório referencia o caminho do endpoint', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (path.resolve(file) === SELF) continue;
      if (!/\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml)$/.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('recovery-diagnostic')) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('nenhuma rota de API sob src/app/api consulta SUPABASE_DB_URL diretamente', () => {
    const apiDir = path.join(ROOT, 'src', 'app', 'api');
    const offenders = walk(apiDir)
      .filter((f) => /route\.(ts|tsx|js)$/.test(f))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('SUPABASE_DB_URL'))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
