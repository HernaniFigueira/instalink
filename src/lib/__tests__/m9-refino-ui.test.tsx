// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// REFINO FINAL DE UI — critérios de aceite travados (1–12)
// 1  flyout sem sombra pesada · 2–4 comportamento da sidebar recolhida ·
// 5  avatares determinísticos · 6  chips de título padronizados ·
// 7  breadcrumb removido · 8  Agenda alinhada · 9  CTA no tema ·
// 10 texto near-black · 11 fundo universal · 12 transições suaves.
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar } from '@/components/ui';
import {
  AVATAR_PALETTE, avatarColorFor, avatarInitials, stableHash,
} from '../avatar-palette';
import { useSidebarPeek, PEEK_CLOSE_MS } from '../sidebar-peek';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const css = read('src/app/globals.css');
const ui = read('src/components/ui.tsx');
const shell = read('src/components/DashboardShell.tsx');
const agenda = read('src/app/(dashboard)/agenda/page.tsx');
const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');

describe('critério 1 — flyout da sidebar recolhida: sem sombra pesada', () => {
  it('usa sombra mínima + borda 1px + radius (nada de cartão flutuante pesado)', () => {
    const peek = css.slice(css.indexOf('.ws-peek {'), css.indexOf('@keyframes ws-peek-in'));
    // borda sutil 1px + radius elegante + fundo sólido
    expect(peek).toMatch(/border:\s*1px solid var\(--border\)/);
    expect(peek).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(peek).toMatch(/background:\s*var\(--surface\)/);
    // sombra MÍNIMA — proibida a pesada (--shadow-lg / grande blur/offset)
    expect(peek).not.toContain('--shadow-lg');
    expect(peek).not.toMatch(/box-shadow:\s*0 1[0-9]px/);
    expect(peek).not.toMatch(/box-shadow:\s*0 2[0-9]px/);
  });
});

describe('critérios 2–4 — sidebar recolhida: flyout sem expandir', () => {
  it('2/3: hover e clique de grupo NUNCA alteram o collapsed persistido', () => {
    // O contrato vive no próprio hook: nenhum retorno/callback mexe em collapse.
    const src = read('src/lib/sidebar-peek.ts');
    expect(src).not.toMatch(/onCollapse|setCollapsed/);
    // togglePeek = trava/destrava o flyout (clique), nunca expande.
    expect(nav).toContain('peekCtl.togglePeek');
    expect(nav).toContain('peekCtl.togglePeek(area.id');
    expect(nav).toContain('a sidebar');
  });

  it('clique trava o flyout (sobrevive a mouseleave) e o segundo clique fecha', () => {
    vi.useFakeTimers();
    const Probe = () => {
      const ctl = useSidebarPeek(true);
      return (
        <div>
          <button
            data-testid="grupo"
            aria-expanded={ctl.peekId === 'clinica'}
            onMouseEnter={() => ctl.onGroupEnter('clinica', 10)}
            onMouseLeave={() => ctl.onGroupLeave()}
            onClick={() => ctl.togglePeek('clinica', 10)}
          >
            Clínica
          </button>
          <span data-testid="aberto">{ctl.peekId ?? '-'}</span>
          <button data-testid="sair" onMouseEnter={ctl.onPeekEnter} onMouseLeave={ctl.onPeekLeave} />
        </div>
      );
    };
    render(<Probe />);
    const grupo = screen.getByTestId('grupo');
    // hover abre solto
    fireEvent.mouseEnter(grupo);
    expect(screen.getByTestId('aberto').textContent).toBe('clinica');
    // clique TRAVA (mesmo com hover já aberto)
    fireEvent.click(grupo);
    fireEvent.mouseLeave(grupo);
    vi.advanceTimersByTime(PEEK_CLOSE_MS + 50);
    // travado: mouseleave NÃO fecha (critério 3 — sem expansão/fechamento brusco)
    expect(screen.getByTestId('aberto').textContent).toBe('clinica');
    // segundo clique fecha
    fireEvent.click(grupo);
    expect(screen.getByTestId('aberto').textContent).toBe('-');
    vi.useRealTimers();
  });

  it('4: itens SEM submenu seguem só tooltip+navegação (sem flyout)', () => {
    // rotas diretas usam data-tip e NÃO data-peek-group
    expect(nav).toContain('data-tip');
    expect(nav).not.toMatch(/data-peek-group.*?link\(/);
  });
});

describe('critério 5 — avatares fallback: paleta intercalada DETERMINÍSTICA', () => {
  it('mesmo nome → SEMPRE a mesma cor (nunca aleatório por render)', () => {
    for (const name of ['Mariana Alves', 'Thor', 'Carlos', 'Juliana Lima', '']) {
      expect(avatarColorFor(name)).toEqual(avatarColorFor(name));
      expect(avatarColorFor(name)).toEqual(avatarColorFor(`  ${name}  `));
      expect(avatarColorFor(name)).toEqual(avatarColorFor(name.toUpperCase()));
    }
  });

  it('paleta de 8 cores fixas (azul/teal/violeta/âmbar/verde/coral/carvão/petróleo)', () => {
    expect(AVATAR_PALETTE).toHaveLength(8);
    for (const c of AVATAR_PALETTE) {
      expect(c.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.fg).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // hash estável (sem Math.random) e distribui os nomes pela paleta
    expect(stableHash('Mariana Alves')).toBe(stableHash('Mariana Alves'));
    const used = new Set(['Mariana Alves', 'Carlos', 'Juliana', 'Thor', 'Mel', 'Luna'].map((n) => avatarColorFor(n).bg));
    expect(used.size).toBeGreaterThan(3); // intercaladas de verdade
  });

  it('iniciais legíveis + Avatar aplica fundo/letra da paleta (alto contraste)', () => {
    expect(avatarInitials('Mariana Alves')).toBe('MA');
    expect(avatarInitials('thor')).toBe('T');
    render(<Avatar name="Mariana Alves" size={32} />);
    const circle = screen.getByText('MA') as HTMLElement;
    const tone = avatarColorFor('Mariana Alves');
    const hexToRgb = (h: string) => {
      const n = parseInt(h.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(circle.style.background).toBe(hexToRgb(tone.bg));
    expect(circle.style.color).toBe(hexToRgb(tone.fg));
  });
});

describe('critério 6 — chips de título padronizados em TODAS as telas', () => {
  it('PageHeader: chip 40×40, fundo neutro sutil, borda 1px, ícone line accent, título preto', () => {
    const header = ui.slice(ui.indexOf('export function PageHeader'), ui.indexOf('export function PageHeader') + 1400);
    expect(header).toContain('w-10 h-10');
    expect(header).toContain('bg-[var(--surface-2)]');
    expect(header).toContain('border border-[var(--border)]');
    expect(header).toContain('text-[var(--accent)]'); // ícone = tema
    const h1 = header.slice(header.indexOf('<h1'), header.indexOf('</h1>'));
    expect(h1).toContain('text-[var(--text)]'); // título = near-black
  });

  it('Agenda usa o MESMO chip do PageHeader (sem identidade própria)', () => {
    const chip = agenda.slice(agenda.indexOf('data-agenda-title-icon'), agenda.indexOf('data-agenda-title-icon') + 260);
    expect(chip).toContain('bg-[var(--surface-2)] text-[var(--accent)]');
    expect(chip).toContain('il-page-header__icon');
    expect(chip).not.toContain('brand-fg'); // modelo antigo do chip morto
  });
});

describe('critério 7 — breadcrumb removido do workspace', () => {
  it('nenhuma navegação de breadcrumb renderizada no shell', () => {
    expect(shell).not.toContain('aria-label="Breadcrumb"');
    expect(shell).not.toContain('ws-crumbs--content');
  });
});

describe('critérios 8–11 — Agenda/CTA/tema/fundo', () => {
  it('8/9: "Novo agendamento" é primary do TEMA (variant cta violeta morta)', () => {
    expect(agenda).toContain('variant="primary"');
    expect(agenda).not.toContain('variant="cta"');
  });

  it('9/10: CTA principal = --accent; texto nunca muda com o tema', () => {
    expect(ui).toMatch(/primary:\s*\n?\s*'bg-\[var\(--accent\)\]/);
    expect(ui).toMatch(/primary:[^}]*text-\[var\(--accent-contrast\)\]/);
    // título/texto continuam near-black em qualquer tema
    expect(ui).toContain('text-[var(--text)]');
  });

  it('11: fundo universal do workspace (sem identidade por tela)', () => {
    expect(css).toMatch(/--bg-top:\s*#f4f6f8/);
    expect(css).toMatch(/--bg-bottom:\s*#f8f9fb/);
    expect(agenda).not.toMatch(/bg-\[#(?!fff)/i); // Agenda sem hex de fundo próprio
  });

  it('12: transições suaves do flyout + prefers-reduced-motion', () => {
    expect(css).toContain('ws-peek-in');
    expect(css).toContain('prefers-reduced-motion');
  });
});