// ═══════════════════════════════════════════════════════════════
// DS 1.0 · CONTRATO DE CONVERGÊNCIA (fonte, não fixture)
// ═══════════════════════════════════════════════════════════════
// O QA de browser prova o que ESTÁ renderizado; este contrato prova o que
// EXISTE no código — inclusive telas que o fixture não abre (aba condicional,
// permissão, feature desligada). Sem ele, a fila de migração poderia reabrir
// em silêncio com um `<select>` novo ou um modal artesanal.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../');
const UI = 'components/ui.tsx';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// B5 · portabilidade: no Windows `path.relative` devolve separadores `\`, o que
// quebraria as comparações com a allow-list (`components/public/` etc.).
// Normaliza o relativo para `/` ANTES de qualquer comparação — sem afrouxar a
// allow-list e sem remover expectativas.
const toPosix = (p: string) => p.split('\\').join('/');

const files = walk(SRC).map((f) => ({ path: f, rel: toPosix(path.relative(SRC, f)) }));

// Marcadores montados por concatenação: o teste fala de comentários sem
// precisar de escapes frágeis em literal de regex.
const ABRE_JSX = '{' + '/*';
const FECHA_JSX = '*' + '}';
const ABRE_BLOCO = '/' + '*';
const FECHA_BLOCO = '*' + '/';
const VAZIO = ' ';

/** Substitui comentários por espaço, preservando a contagem de linhas. */
function semComentarios(raw: string): string {
  const aplainar = (trecho: string) => trecho.replace(/\S/g, VAZIO);
  let out = raw;
  for (const [abre, fecha] of [[ABRE_JSX, FECHA_JSX], [ABRE_BLOCO, FECHA_BLOCO]] as const) {
    let i = out.indexOf(abre);
    while (i !== -1) {
      const j = out.indexOf(fecha, i + abre.length);
      if (j === -1) break;
      const fim = j + fecha.length;
      out = out.slice(0, i) + aplainar(out.slice(i, fim)) + out.slice(fim);
      i = out.indexOf(abre, fim);
    }
  }
  return out
    .split('\n')
    .map((line) => (line.trim().startsWith('//') ? '' : line))
    .join('\n');
}

/** Linhas com uso REAL do termo (comentário não conta como uso). */
function usos(rel: string, termos: string[]): string[] {
  const body = semComentarios(fs.readFileSync(path.join(SRC, rel), 'utf8'));
  return body
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => termos.some((t) => line.includes(t)))
    .map(({ line, n }) => `${rel}:${n}: ${line.slice(0, 90)}`);
}

describe('DS 1.0 · nenhum controle ou overlay fora do sistema', () => {
  it('não existe <select> cru fora de ui.tsx (Select canônico é a única porta)', () => {
    const offenses = files
      .filter((f) => f.rel !== UI)
      .flatMap((f) => usos(f.rel, ['<select']));
    expect(offenses, ['Use "Select" de @/components/ui.', ...offenses].join('\n')).toEqual([]);
  });

  it('não existe camada artesanal `fixed inset-0` no painel (só Dialog/Drawer/Sheet)', () => {
    const allow = ['components/public/'];
    const offenses = files
      .filter((f) => f.rel !== UI && !allow.some((a) => f.rel.startsWith(a)))
      .flatMap((f) => usos(f.rel, ['fixed inset-0']));
    expect(offenses, ['Use "Dialog"/"Drawer"/"Sheet" de @/components/ui.', ...offenses].join('\n')).toEqual([]);
  });

  it('o CloseButton dos overlays não pinta o X de danger (X vermelho é proibido)', () => {
    const ui = fs.readFileSync(path.join(SRC, UI), 'utf8');
    const start = ui.indexOf('export function CloseButton');
    expect(start).toBeGreaterThan(-1);
    const block = ui.slice(start, start + 1400);
    expect(block.includes('text-[var(--danger')).toBe(false);
    expect(block.includes('bg-[var(--danger')).toBe(false);
  });

  it('nenhuma tela reintroduz gradiente DECORATIVO no painel', () => {
    // Allow-list explícita, com motivo técnico — cada caso é textura/preview de
    // DADO, nunca preenchimento de estrutura (o que §1 proíbe):
    //   · components/public/*         → página do cliente final (tema do negócio);
    //   · results-view.tsx            → hachura de "não rastreado" (dado ausente);
    //   · (dashboard)/pagina/page.tsx → preview do tema da página do cliente no
    //                                   editor legado (o painel em si não pinta).
    const allow = ['components/public/', 'components/dashboard/results-view.tsx', 'app/(dashboard)/pagina/page.tsx'];
    const offenses = files
      .filter((f) => !allow.some((a) => f.rel.startsWith(a)))
      .flatMap((f) => usos(f.rel, ['linear-gradient', 'radial-gradient']));
    expect(offenses, ['Gradiente decorativo é proibido (§1).', ...offenses].join('\n')).toEqual([]);
  });
});
