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

  it('DS 1.0 · close no canto superior direito, agora com o CloseButton canônico', () => {
    expect(ws).not.toContain('ws-sheet__tab');
    expect(ws).toContain('ws-sheet__close');
    // §4 — UM CloseButton em todo o sistema: o sheet NÃO desenha o próprio X.
    expect(ws).toContain("from '@/components/ui'");
    expect(ws).toContain('<CloseButton');
    expect(ws).toContain('label={`Fechar ${title}`}');
    expect(ws).toContain("requestClose('close-button')");
    // X fica no header actions (topo à direita), não como aba externa
    expect(ws).toMatch(/ws-sheet__actions[\s\S]*ws-sheet__close/);
  });

  it('DS 1.0 · §4 — fechar é NEUTRO (o X vermelho foi proibido e removido)', () => {
    const css = read('src/app/globals.css');
    const ui = read('src/components/ui.tsx');
    expect(css).toContain('.ws-sheet__close');
    expect(css).not.toContain('.ws-sheet__tab');
    // A regra antiga (danger 75% no ícone + fundo/borda avermelhados) NÃO pode
    // voltar: fechar não é ação destrutiva e não compete com o Danger real.
    const closeRule = css.slice(css.indexOf('.ws-sheet__close {'), css.indexOf('}', css.indexOf('.ws-sheet__close {')));
    expect(closeRule).not.toMatch(/danger|red|#(e|d|c)[0-9a-f]{5}/i);
    expect(css).toMatch(/\.ws-sheet__close:hover \{[^}]*--gd-bg-hover/);
    // O neutro vem do canônico (mesmo componente usado por Dialog/Drawer).
    expect(ui).toMatch(/export function CloseButton[\s\S]*?gd-text-muted/);
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
  it('BookingDetailSheet no overlay canônico (DS 1.1: DetailSideModal)', () => {
    const s = read('src/components/dashboard/BookingDetailSheet.tsx');
    // Item 3B da missão: o DETALHE é o painel lateral canônico do DS
    // (DetailPanel · 460px). Continua sendo um overlay contextual do painel —
    // nunca uma página nova, nunca um segundo Dialog de criação.
    // Nome canônico do DS 1.1 (o DS 1.0 o chamava de `DetailPanel`).
    expect(s).toContain('DetailSideModal');
    expect(s).not.toContain('WorkspaceSheet');
    expect(s).not.toContain('<Drawer');
    expect(s).toContain('Detalhe do agendamento');
    expect(s).toContain('Pet360Sheet');
    expect(s).toContain('encounterWorkspaceHref');
    expect(s).not.toContain('<EncounterSheet');
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
