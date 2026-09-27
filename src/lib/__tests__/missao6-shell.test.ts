import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_ACCENTS, NAV_ACCENT_DEFAULT, navAccentById } from '../nav-accent';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const css = read('src/app/globals.css');
const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
const quick = read('src/components/dashboard/QuickCreateMenu.tsx');
const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
const shell = read('src/components/DashboardShell.tsx');
const config = read('src/app/(dashboard)/configuracoes/page.tsx');

/** Luminância relativa (0–1) de um hex — contraste real, não regex. */
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}


// ═══════════════════════════════════════════════════════════════
// MISSÃO 6 — nova direção visual premium (mockup aprovado, adaptado)
// ═══════════════════════════════════════════════════════════════
describe('missão 6 · 1 — topbar com fundo colorido suave', () => {
  it('usa tom suave da cor da navegação (color-mix) clareando para a direita', () => {
    expect(css).toMatch(/\.ws-topbar \{[\s\S]*?background: linear-gradient\(90deg/);
    expect(css).toContain('color-mix(in srgb, var(--il-nav) 13%, var(--surface))');
    // sem blur/filtro REAL em container com texto (backdrop-filter: none é a
    // proteção; só se proíbe blur ativo)
    expect(css).not.toMatch(/\.ws-topbar \{[^}]*backdrop-filter:\s*blur/);
    expect(css).not.toMatch(/\.ws-topbar \{[^}]*[^-]filter:\s*blur/);
  });
});

describe('missão 6 · 2 — radius controlado (menos bolha)', () => {
  it('tokens globais reduzidos nos dois blocos (:root e .il-platform)', () => {
    // valores menores que os antigos (xs6/sm9/md11/lg14/xl18/2xl24)
    for (const [tok, max] of [['--radius-xs', 5], ['--radius-sm', 7], ['--radius-md', 8], ['--radius-lg', 10], ['--radius-xl', 12], ['--radius-2xl', 16]] as const) {
      const values = [...css.matchAll(new RegExp(`${tok}: (\\d+)px`, 'g'))].map((m) => Number(m[1]));
      expect(values.length).toBeGreaterThanOrEqual(2);
      for (const v of values) expect(v, tok).toBeLessThanOrEqual(max);
    }
    // pill preservado para busca/chips/encaixes especiais
    expect(css).toContain('--radius-pill: 999px');
  });
});

describe('missão 6 · 3 — submenu expansível em bloco premium', () => {
  it('o conteúdo do grupo aberto abre dentro de uma superfície encaixada', () => {
    expect(css).toMatch(/\.workspace-submenu__guide \{[\s\S]*?background: rgba\(255, 255, 255, 0\.10\)/);
    expect(css).toMatch(/\.workspace-submenu__guide \{[\s\S]*?border-radius: var\(--radius-md\)/);
    // subitem com radius próprio dentro do bloco
    expect(css).toContain('.workspace-link--sub { min-height: 34px; font-size: 13px; padding-left: 14px; border-radius: var(--radius-sm); }');
  });
});

describe('missão 6 · 4 — quick create “+” premium (volta ao topo)', () => {
  it('botão circular na cor da identidade + popover de ações', () => {
    expect(quick).toContain('ws-quickcreate-btn');
    expect(quick).toContain('data-testid="quick-create-btn"');
    expect(quick).toContain('aria-label="Criar rápido"');
    // ações úteis do contexto (deep links ?novo=1 existentes — sem lógica nova)
    for (const label of ['Novo agendamento', 'Nova pendência', 'Novo recebimento']) {
      expect(quick, label).toContain(label);
    }
    expect(quick).toContain('novo=1');
    // pet só em clínica veterinária
    expect(quick).toContain('vet || i.icon !== \'paw\'');
    // ações filtradas por permissão (canCreate)
    expect(quick).toContain('canCreate.includes(i.requires)');
  });

  it('a topbar integra o menu sem expor o contrato antigo ws-newbtn', () => {
    expect(topbar).toContain('<QuickCreateMenu');
    expect(topbar).not.toContain('ws-newbtn');
  });
});

describe('missão 6 · 5 — personalização da sidebar em Configurações (não na shell)', () => {
  it('presets seguros de cor (contraste AA: fg claro sobre escuro OU near-black sobre claro)', () => {
    expect(NAV_ACCENTS.length).toBeGreaterThanOrEqual(8); // missão final: 21 presets por famílias
    expect(NAV_ACCENT_DEFAULT).toBe('azul-clinico');
    for (const a of NAV_ACCENTS) {
      const bg = a.vars['--il-nav'];
      const fg = a.vars['--il-nav-fg'];
      expect(bg, a.id).toMatch(/^#[0-9a-f]{6}$/);
      // CONTRATO DE COR (missão final, categoria A/B): o texto do nav é
      // legível em QUALQUER preset — claro sobre escuro, near-black sobre
      // claro. O contraste real decide, nunca "no olho".
      const contrast = lum(fg) > 0.5 ? lum(fg) - lum(bg) : lum(bg) - lum(fg);
      expect(contrast, a.id).toBeGreaterThan(0.45);
    }
    expect(navAccentById('teal').id).toBe('teal');
    expect(navAccentById('lixo').id).toBe('azul-clinico'); // fallback seguro
  });

  it('os presets vivem em Configurações → Aparência, com preview e persistência local', () => {
    expect(config).toContain('data-testid="shell-appearance"');
    expect(config).toContain('nav-accent-preview');
    expect(config).toContain('aria-label="Cor da navegação"');
    expect(config).toContain("setNavAccent(a.id)");
    // preferência pessoal (localStorage) — sem banco/API (decisão documentada)
    expect(read('src/lib/nav-accent.ts')).toContain('localStorage');
    expect(read('src/lib/nav-accent.ts')).toContain('godoutor.nav-accent');
  });

  it('a shell APLICA o preset via data-nav-accent; a topbar/sidebar não têm seletor de cor', () => {
    expect(shell).toContain('data-nav-accent={navAccent}');
    expect(css).toContain(".workspace-shell[data-nav-accent='violeta']");
    expect(css).toContain(".workspace-shell[data-nav-accent='onix']");
    // seletor de cor NÃO exposto na shell principal
    expect(topbar).not.toContain('nav-accent');
    expect(nav).not.toContain('nav-accent');
    expect(nav).not.toContain('Aparência da sidebar');
    // A3.3 preservado: cor da EMPRESA não tematiza o painel
    expect(shell).not.toMatch(/import \{[^}]*navTokenStyle/); // A3.3: sem aplicação ativa
  });
});

describe('missão 6 · 6 — encaixe sidebar × painel principal', () => {
  it('divisa sidebar × painel SEM sombra projetada; ações da topbar no contrato comum', () => {
    // Refino final: a separação é só borda 1px + diferença de fundo.
    const side = css.slice(css.indexOf('.il-platform .workspace-sidebar {'), css.indexOf('.il-platform .workspace-sidebar.is-collapsed'));
    expect(side).not.toContain('box-shadow');
    expect(side).toContain('border-right: 1px solid var(--il-nav-border)');
    // quick create = ação da topbar (mesmo contrato do sino: repouso limpo)
    expect(css).toMatch(/\.ws-quickcreate-btn \{[\s\S]*?background: transparent/);
  });
});
