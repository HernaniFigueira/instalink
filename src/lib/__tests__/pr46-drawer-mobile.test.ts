// PR #46 · Drawer "Gerenciar pessoa" em 390px — contrato de geometria (Design System).
// A prova visual real (390/1024/1366 em browser) está em docs/AUTO-HOMOLOGACAO-PR46-MODELO-OPERACIONAL.md;
// aqui travamos a regra para que ninguém reintroduza a faixa de ~180px (46vw) no celular.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_SHEET_SIZES } from '../workspace-sheet-sizes';

const css = fs.readFileSync('src/app/globals.css', 'utf8');

/** Corpo do bloco `@media (<query>) { ... }` (chaves balanceadas). */
function mediaBlocks(query: string): string[] {
  const out: string[] = [];
  let from = 0;
  const head = `@media (${query})`;
  for (;;) {
    const i = css.indexOf(head, from);
    if (i < 0) break;
    const open = css.indexOf('{', i);
    let depth = 1; let j = open + 1;
    while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out.push(css.slice(open + 1, j - 1));
    from = j;
  }
  return out;
}

describe('Drawer mobile (390px) — geometria', () => {
  it('abaixo de 768px a faixa do Drawer ocupa a largura útil (sem o limite de 46vw), exceto o menu de navegação', () => {
    const blocks = mediaBlocks('max-width: 767px').join('\n');
    expect(blocks).toMatch(/dialog\.il-drawer:not\(\.workspace-nav-drawer\)\s+\.il-drawer__strip\s*\{\s*max-width:\s*none\s*!important/);
  });

  it('a regra existe SÓ no breakpoint mobile — tablet/desktop mantêm o token de 46vw', () => {
    let withoutMobile = css;
    for (const b of mediaBlocks('max-width: 767px')) withoutMobile = withoutMobile.replace(b, '');
    expect(withoutMobile).not.toMatch(/\.il-drawer__strip\s*\{\s*max-width:\s*none\s*!important/);
    expect(WORKSPACE_SHEET_SIZES.clinical).toBe('max-w-[min(46vw,760px)]');
    expect(WORKSPACE_SHEET_SIZES.equipe).toBe('max-w-[min(46vw,760px)]');
  });

  it('o dialog mobile já tem respiro lateral de 8px e o footer do Drawer quebra linha (botão nunca corta)', () => {
    const blocks = mediaBlocks('max-width: 767px').join('\n');
    expect(blocks).toMatch(/dialog\.il-drawer\s*\{[^}]*left:\s*8px/);
    const ui = fs.readFileSync('src/components/ui.tsx', 'utf8');
    expect(ui).toMatch(/ws-sheet__footer il-actionbar shrink-0 flex flex-wrap/);
  });

  it('a Equipe usa o Drawer do Design System com o token clinical (sem modal/largura paralela)', () => {
    const page = fs.readFileSync('src/app/(dashboard)/equipe/page.tsx', 'utf8');
    expect(page).toContain('width={WORKSPACE_SHEET_SIZES.clinical}');
    expect(page).not.toMatch(/<dialog/);
  });
});
