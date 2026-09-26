import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · FASE 2 fechamento — X padrão de fechar em TODO
// WorkspaceSheet (linguinha ABANDONADA) + scroll-lock compartilhado
// para sheets empilhados + migração dos sheets operacionais.
// ═══════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8');

describe('WorkspaceSheet · X padrão de fechar (sem linguinha)', () => {
  const ws = read('src/components/dashboard/WorkspaceSheet.tsx');

  it('X no canto superior direito do cabeçalho; linguinha removida', () => {
    expect(ws).not.toContain('ws-sheet__tab');
    expect(ws).toContain('ws-sheet__close');
    expect(ws).toContain('aria-label={`Fechar ${title}`}');
    expect(ws).toContain('title="Fechar"');
    expect(ws).toContain('onClick={close}');
    // X fica no header actions (topo à direita), não como aba externa
    expect(ws).toMatch(/ws-sheet__actions[\s\S]*ws-sheet__close/);
  });

  it('CSS: circular, fundo suave, vermelho acolhedor, hover, foco visível', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('.ws-sheet__close');
    expect(css).not.toContain('.ws-sheet__tab');
    expect(css).toMatch(/\.ws-sheet__close \{[^}]*border-radius: 999px/);
    expect(css).toMatch(/\.ws-sheet__close \{[^}]*width: 34px/);
    expect(css).toMatch(/\.ws-sheet__close:hover/);
    expect(css).toMatch(/\.ws-sheet__close:focus-visible/);
    expect(css).toMatch(/color-mix\(in srgb, var\(--danger\)/);
    // regras inválidas/nested do mobile não voltam
    expect(css).not.toMatch(/dialog\.ws-sheet \{\s*\.ws-sheet__/);
  });

  it('ESC fecha (comportamento herdado do dialog)', () => {
    expect(ws).toContain("if (e.key === 'Escape')");
    expect(ws).toContain('onCancel');
  });
});

describe('Scroll lock compartilhado (sheets empilhados)', () => {
  const lock = read('src/lib/scroll-lock.ts');
  const ws = read('src/components/dashboard/WorkspaceSheet.tsx');
  const ui = read('src/components/ui.tsx');

  it('lock é reference-counted por token — sem previous overflow por sheet', () => {
    expect(lock).toContain('const locks = new Set');
    expect(lock).toContain('lockBodyScroll');
    expect(lock).toContain('unlockBodyScroll');
    expect(lock).toMatch(/locks\.size === 0/);
    expect(lock).toMatch(/savedOverflow/);
    // WorkspaceSheet e Drawer usam o MESMO módulo
    expect(ws).toContain("from '@/lib/scroll-lock'");
    expect(ws).not.toContain('document.body.style.overflow');
    expect(ui).toContain("from '@/lib/scroll-lock'");
    expect(ui).not.toContain('bodyOverflowBeforeDrawer');
    expect(ui).not.toContain('openDrawers');
  });
});

describe('Overlays operacionais usam WorkspaceSheet', () => {
  it('BookingDetailSheet migrado de Drawer', () => {
    const s = read('src/components/dashboard/BookingDetailSheet.tsx');
    expect(s).toContain('WorkspaceSheet');
    expect(s).not.toContain('<Drawer');
    expect(s).toContain('Detalhe do agendamento');
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
