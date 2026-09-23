import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · FASE 2 fechamento — linguinha de fechar +
// migração dos sheets operacionais para WorkspaceSheet.
// ═══════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8');

describe('WorkspaceSheet · linguinha de fechar', () => {
  const ws = read('src/components/dashboard/WorkspaceSheet.tsx');

  it('sem X no canto do cabeçalho; aba externa à esquerda no lugar', () => {
    expect(ws).not.toContain('ws-sheet__close');
    expect(ws).toContain('ws-sheet__tab');
    expect(ws).toContain('aria-label={`Fechar ${title}`}');
    expect(ws).toContain('title="Fechar"');
    expect(ws).toContain('onClick={close}');
  });

  it('CSS: aba ~38–44px, fora do lado esquerdo, coral, hover mais forte, foco visível', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('.ws-sheet__tab');
    expect(css).toMatch(/\.ws-sheet__tab \{[^}]*left: -22px/);
    expect(css).toMatch(/\.ws-sheet__tab \{[^}]*width: 42px/);
    expect(css).toMatch(/\.ws-sheet__tab \{[^}]*height: 42px/);
    expect(css).toMatch(/\.ws-sheet__tab:hover/);
    expect(css).toMatch(/\.ws-sheet__tab:focus-visible/);
    expect(css).toMatch(/border-radius: 14px 0 0 14px/);
    expect(css).toMatch(/var\(--danger\)/);
  });

  it('ESC fecha (comportamento herdado do dialog)', () => {
    expect(ws).toContain("if (e.key === 'Escape')");
    expect(ws).toContain('onCancel');
  });
});

describe('Overlays operacionais usam WorkspaceSheet', () => {
  it('BookingDetailSheet migrado de Drawer', () => {
    const s = read('src/components/dashboard/BookingDetailSheet.tsx');
    expect(s).toContain('WorkspaceSheet');
    expect(s).not.toContain('<Drawer');
    expect(s).toContain('Detalhe do agendamento');
    // lógica preservada
    expect(s).toContain('Pet360Sheet');
    expect(s).toContain('onSaved');
  });

  it('EncounterSheet migrado de Drawer sem reimplementar lógica', () => {
    const s = read('src/components/dashboard/EncounterSheet.tsx');
    expect(s).toContain('WorkspaceSheet');
    expect(s).not.toContain('<Drawer');
    expect(s).toContain("action: 'finalize'");
    expect(s).toContain('onSaved');
    expect(s).toContain('onChanged');
  });

  it('AnamneseFiller e NewClientSheet já são WorkspaceSheet', () => {
    expect(read('src/components/dashboard/AnamneseFiller.tsx')).toContain('WorkspaceSheet');
    expect(read('src/components/dashboard/NewClientSheet.tsx')).toContain('WorkspaceSheet');
    expect(read('src/components/dashboard/NewClientSheet.tsx')).not.toContain('<Drawer');
  });
});
