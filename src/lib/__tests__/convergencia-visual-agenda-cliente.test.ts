import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Convergência visual Agenda/Cliente — contratos de movimento e hierarquia.
// Entrada e saída das folhas laterais pela MESMA borda direita; nada de scale
// (que fazia a folha parecer nascer do centro) e backdrop acompanha a folha.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const ruleBody = (css: string, selector: string) => {
  const i = css.indexOf(selector);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
};

describe('movimento das folhas laterais (Agenda → detalhe)', () => {
  const css = read('src/app/globals.css');
  const ds = read('src/styles/godoutor-design-system.css');

  it('ws-sheet entra pela direita e sai pela direita, sem scale', () => {
    const sheetIn = css.slice(css.indexOf('@keyframes ws-sheet-in'), css.indexOf('@keyframes ws-sheet-in') + 260);
    const sheetOut = css.slice(css.indexOf('@keyframes ws-sheet-out'), css.indexOf('@keyframes ws-sheet-out') + 200);
    expect(sheetIn).toContain('translateX(calc(100% + var(--sheet-gap, 14px)))');
    expect(sheetIn).not.toContain('scale');
    expect(sheetOut).toContain('to { opacity: 0; transform: translateX(calc(100% + var(--sheet-gap, 14px))); }');
    expect(sheetOut).not.toContain('scale');
  });

  it('o backdrop do ws-sheet tem fade de entrada e de saída', () => {
    expect(css).toContain('dialog.ws-sheet[open]::backdrop { animation: gd-fade-in');
    expect(css).toContain('dialog.ws-sheet[data-closing]::backdrop { animation: gd-fade-out');
  });

  it('gd-detail (detalhe da Agenda) entra de fora da borda direita e sai para a direita', () => {
    expect(ruleBody(ds, '@keyframes gd-detail-in')).toContain('from { transform: translateX(100%); }');
    const outIdx = ds.indexOf('@keyframes gd-detail-out');
    expect(ds.slice(outIdx, outIdx + 120)).toContain('to { transform: translateX(100%); }');
    expect(ds).not.toMatch(/gd-detail-(in|out)[^}]*translateX\(-/);
  });
});

describe('hierarquia do hover e prévia do cliente', () => {
  const page = read('src/app/(dashboard)/agenda/page.tsx');
  const drawer = read('src/components/dashboard/ClientProfileDrawer.tsx');

  it('hover tem "Ver detalhes" como única ação primária e "Editar" secundário', () => {
    expect(page).toMatch(/variant="secondary" onClick=\{\(\) => onBlockEdit/);
    expect(page).toMatch(/variant="primary" onClick=\{\(\) => onBlockClick/);
    expect(page.split('>Ver detalhes</Button>').length - 1).toBe(1);
    expect(page).toContain('variant="primary" onClick={() => onBlockClick(b.id, eventRefs.current.get(b.id) ?? null)}>Ver detalhes</Button>');
  });

  it('prévia do cliente não usa coluna lateral e separa blocos na ordem de leitura', () => {
    const preview = drawer.slice(drawer.indexOf('function ClientQuickPreview'), drawer.indexOf('function PreviewBlock'));
    expect(preview).not.toMatch(/sm:grid-cols|grid-cols-\[/);
    expect(preview.indexOf('Próximo atendimento')).toBeGreaterThan(-1);
  });

  it('perfil completo usa cabeçalhos de seção h3 com a mesma tipografia de rótulo', () => {
    const overview = drawer.slice(drawer.indexOf("tab === 'overview'"), drawer.indexOf("tab === 'files'"));
    expect(overview).toContain('<h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">Próximo agendamento</h3>');
    expect(overview).not.toContain('text-[11.5px]');
  });
});
