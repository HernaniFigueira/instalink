// ═══════════════════════════════════════════════════════════════
// REFINO VISUAL DO PREVIEW — bugs reais (fundo da Agenda, sombra da
// sidebar) + ajuste cirúrgico da sidebar (ícones inativos, grupo aberto,
// accordion tradicional, tooltip do rail no tema).
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_ACCENTS, contrastRatio, findAccent } from '../nav-accent';
import { color } from './helpers/ds-tokens';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const css = read('src/app/globals.css');
const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');

describe('bug 1 — Agenda NÃO tem background próprio (pixel = --workspace-bg)', () => {
  it('agenda-page-gutter é transparente (herda o fundo do shell)', () => {
    // a regra do background (não a do padding) — a que declara background
    const ruleStart = css.indexOf('.il-platform .agenda-page-gutter {\n  background:');
    expect(ruleStart).toBeGreaterThan(0);
    const g = css.slice(ruleStart, ruleStart + 140);
    expect(g).toContain('background: transparent');
    // proibido qualquer gradiente/overlay próprio da Agenda no wrapper externo
    expect(g).not.toContain('radial-gradient');
    expect(g).not.toContain('linear-gradient');
  });

  it('nenhum radial/gradiente lavanda sobra nas regras de fundo da Agenda', () => {
    // o overlay índigo/amarelo que pintava #F4F4FE foi removido por completo
    expect(css).not.toContain('rgba(79, 70, 229, 0.05)');
    expect(css).not.toContain('#f7f8fe');
  });
});

describe('bug 2 — sidebar sem sombra projetada na divisa', () => {
  it('workspace-sidebar: sem box-shadow (só border-right 1px)', () => {
    const s = css.slice(css.indexOf('.il-platform .workspace-sidebar {'), css.indexOf('.il-platform .workspace-sidebar.is-collapsed'));
    expect(s).not.toContain('box-shadow');
    expect(s).toContain('border-right: 1px solid var(--il-nav-border)');
  });
});

describe('sidebar · ícones inativos legíveis (força ~70%, nunca lavados)', () => {
  it('token --il-nav-icon é NEUTRO fixo (DS 1.0 §13)', () => {
    expect(css).toContain('--il-nav-icon:');
    expect(color('--il-nav-icon')).toBe('#5b636e');
    // nenhum preset reescreve a estrutura da navegação
    for (const a of NAV_ACCENTS) {
      expect(Object.keys(a.vars), a.id).not.toContain('--il-nav-icon');
    }
  });

  it('ícone do link inativo usa --il-nav-icon (não muted nem opacity baixa)', () => {
    const icon = css.slice(css.indexOf('.workspace-link__icon {'), css.indexOf('.workspace-link__icon {') + 260);
    expect(icon).toContain('color: var(--il-nav-icon)');
    expect(icon).not.toMatch(/opacity:\s*0\./);
  });

  it('ícones inativos com presença real (não lavados) na navegação branca', () => {
    const iconFg = color('--il-nav-icon');
    const navBg = color('--il-nav');
    // piso de legibilidade do glifo (nunca lavado/transparente)
    expect(contrastRatio(iconFg, navBg), `${iconFg} × ${navBg}`).toBeGreaterThanOrEqual(3.2);
    // e nunca mais forte que o fg cheio do nav (mantém hierarquia)
    expect(contrastRatio(iconFg, navBg)).toBeLessThanOrEqual(
      Math.max(contrastRatio(color('--il-nav-fg'), navBg), 3.2) + 0.01,
    );
  });
});

describe('sidebar · grupo ABERTO aceso, distinto da rota ativa', () => {
  it('open = container sutil + ícone aceso (par nav-active) — current = accent cheio', () => {
    const open = css.slice(css.indexOf(".workspace-link--group[aria-expanded='true'] {"), css.indexOf(".workspace-link--group[aria-expanded='true'] {") + 700);
    // container sutil (não o par forte do current)
    expect(open).toContain('background: var(--il-nav-hover)');
    expect(open).toContain('color: var(--il-nav-fg)');
    // ícone ACESO no par ativo (contraste AA entre si)
    expect(open).toContain('background: transparent; color: var(--il-nav-active-fg)');
    // current continua o mais forte (accent preenchido)
    const cur = css.slice(css.indexOf('.workspace-link[aria-current="page"] .workspace-link__icon {'), css.indexOf('.workspace-link[aria-current="page"] .workspace-link__icon {') + 300);
    expect(cur).toContain('background: transparent; color: var(--il-nav-active-fg)');
  });

  it('par do ícone aceso é AA em todos os presets', () => {
    for (const a of NAV_ACCENTS) {
      expect(
        contrastRatio(a.vars['--il-nav-active-fg'], a.vars['--il-nav-active']),
        a.id,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('DS 1.0 §15/§18 — grupo abre painel lateral (acordeão extinto)', () => {
  it('clique alterna o painel (trava/destrava) — nunca mexe na navegação', () => {
    expect(nav).toContain('peekCtl.togglePeek(area.id)');
    expect(nav).not.toContain('setOpened');
    expect(nav).not.toContain('workspace-submenu');
  });

  it('sem grupo forçado aberto; a rota apenas marca o grupo dono', () => {
    expect(nav).not.toContain('opened');
    expect(nav).toContain('activeGroup');
    expect(nav).not.toContain('defaultGroup');
  });
});

describe('tooltip do rail recolhido: SEMPRE neutro grafite', () => {
  it('ws-nav-tip = grafite quase preto + branco — sem cor do tema, sem roxo/lilás', () => {
    const tip = css.slice(css.indexOf('.ws-nav-tip {'), css.indexOf('.ws-nav-tip {') + 460);
    expect(tip).toContain('background: #242424');
    expect(tip).toContain('color: #ffffff');
    // proibido herdar o tema ou usar o roxo/lilás antigo
    expect(tip).not.toContain('var(--il-nav)');
    expect(tip).not.toContain('#232a44');
  });

  it('grafite × branco = AA (contraste fixo em qualquer tema)', () => {
    expect(contrastRatio('#ffffff', '#242424')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tema padrão = Deep Blue (fallback sem preferência)', () => {
  it('DEFAULT_ACCENT_ID é azul-profundo; escolhas válidas têm prioridade', async () => {
    const mod = await import('../nav-accent');
    expect(mod.DEFAULT_ACCENT_ID).toBe('azul-profundo');
    expect(mod.navAccentById('qualquer-coisa-inexistente').id).toBe('azul-profundo');
  });

  it('defaults do DS: estrutura branca fixa + acento azul do preset padrão', () => {
    expect(css).toContain('--il-nav: var(--gd-nav-bg)');
    expect(color('--il-nav')).toBe('#ffffff');
    expect(css).toContain('--accent: var(--gd-accent)');
    expect(color('--accent')).toBe('#2563eb');
    // §13: o preset ativo pinta só o item ativo — tokens de estrutura fixos.
    expect(css).toContain('--il-nav-active: var(--gd-nav-active-bg)');
  });

  it('preferência salva continua sendo respeitada (não sobrescreve)', () => {
    expect(read('src/lib/nav-accent.ts')).toContain('localStorage.getItem(NAV_ACCENT_STORAGE_KEY)');
  });
});
