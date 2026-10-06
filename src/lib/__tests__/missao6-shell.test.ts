import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_ACCENTS, NAV_ACCENT_DEFAULT, navAccentById, contrastRatio } from '../nav-accent';
import { rawToken } from './helpers/ds-tokens';

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
describe('shell · topbar neutra', () => {
  it('permanece estruturalmente neutra e não reage ao tema', () => {
    expect(css).toMatch(/\.ws-topbar \{[\s\S]*?background: var\(--surface\)/);
    const topbar = css.slice(css.indexOf('.ws-topbar {'), css.indexOf('.ws-unitpill'));
    expect(topbar).not.toContain('--il-nav');
    expect(topbar).not.toContain('--accent');
    // sem blur/filtro REAL em container com texto (backdrop-filter: none é a
    // proteção; só se proíbe blur ativo)
    expect(css).not.toMatch(/\.ws-topbar \{[^}]*backdrop-filter:\s*blur/);
    expect(css).not.toMatch(/\.ws-topbar \{[^}]*[^-]filter:\s*blur/);
  });
});

describe('missão 6 · 2 — radius controlado (menos bolha)', () => {
  it('escala de radius compacta vive na FONTE ÚNICA (DS 1.0)', () => {
    // valores menores que os antigos (xs6/sm9/md11/lg14/xl18/2xl24) e
    // declarados UMA vez (`--gd-radius-*`); aqui só o alias chega.
    for (const [tok, max] of [['--gd-radius-xs', 5], ['--gd-radius-sm', 7], ['--gd-radius-md', 8], ['--gd-radius-lg', 10], ['--gd-radius-xl', 12], ['--gd-radius-2xl', 16]] as const) {
      const v = Number(rawToken(tok).replace('px', ''));
      expect(v, tok).toBeLessThanOrEqual(max);
      expect(rawToken(tok.replace('--gd-', '--')), tok).toBe(`var(${tok})`);
    }
    // pill preservado para busca/chips/encaixes especiais
    expect(rawToken('--radius-pill')).toBe('var(--gd-radius-pill)');
    expect(rawToken('--gd-radius-pill')).toBe('999px');
  });
});

describe('missão 6 · 3 → DS 1.0 §15/§18 — grupo abre PAINEL LATERAL (sem acordeão)', () => {
  it('o grupo NÃO empurra filhos: abre a EXTENSÃO ligada ao rail (superfície do DS)', () => {
    // o acordeão que empurrava o resto da lista saiu do CSS e do componente
    expect(css).not.toContain('.workspace-submenu');
    expect(nav).not.toContain('workspace-submenu');
    expect(nav).not.toContain('setOpened');
    const peek = css.slice(css.indexOf('.ws-peek {'), css.indexOf('@keyframes ws-peek-in'));
    // MISSÃO UX CLOSURE · item 1: a extensão é FISICAMENTE ligada ao rail —
    // nasce na borda dele (mesmo left, sem gap), encosta na topbar, vai até o
    // rodapé, superfície branca, UMA divisória de 1px, SEM raio e SEM sombra
    // (nada de card flutuante, nada de cara de modal).
    expect(peek).toMatch(/left: var\(--gd-rail-w\)/);
    expect(peek).toMatch(/top: var\(--gd-topbar-h\)/);
    expect(peek).toMatch(/bottom: 0/);
    expect(peek).toMatch(/background: var\(--gd-nav-panel-bg\)/);
    expect(peek).toMatch(/border-right: 1px solid var\(--gd-nav-border\)/);
    expect(peek).toMatch(/border-left: 0/);
    expect(peek).toMatch(/border-radius: 0/);
    expect(peek).toMatch(/box-shadow: none/);
    // subitem (recuo) preservado para o drawer móvel
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
    expect(NAV_ACCENT_DEFAULT).toBe('azul-profundo'); // default aprovado, preferences override
    for (const a of NAV_ACCENTS) {
      // DS 1.0 §13 — o preset pinta o ACENTO (não a estrutura). O par que
      // ele realmente usa (fg do acento sobre soft do acento) é AA real.
      const bg = a.vars['--il-nav-active'];
      const fg = a.vars['--il-nav-active-fg'];
      expect(bg, a.id).toMatch(/^#[0-9a-f]{6}$/);
      const contrast = lum(fg) > 0.5 ? lum(fg) - lum(bg) : lum(bg) - lum(fg);
      expect(contrast, a.id).toBeGreaterThan(0.45);
      expect(contrastRatio(fg, bg), a.id).toBeGreaterThanOrEqual(4.5);
    }
    expect(navAccentById('teal').id).toBe('teal');
    expect(navAccentById('lixo').id).toBe('azul-profundo'); // fallback seguro
  });

  it('os presets vivem em Configurações → Aparência (Aparência), com preview e persistência local', () => {
    const perfil = read('src/app/(dashboard)/configuracoes/page.tsx');
    const shellComp = read('src/components/dashboard/ShellAppearance.tsx');
    expect(perfil).toContain('ShellAppearance');
    expect(shellComp).toContain('data-testid="shell-appearance"');
    expect(shellComp).toContain('nav-accent-preview');
    expect(shellComp).toContain('aria-label="Cor de acento"');
    expect(shellComp).toContain("setNavAccent(a.id)");
    // preferência pessoal (localStorage) — sem banco/API (decisão documentada)
    expect(read('src/lib/nav-accent.ts')).toContain('localStorage');
    expect(read('src/lib/nav-accent.ts')).toContain('godoutor.nav-accent');
  });

  it('a shell APLICA o preset via data-nav-accent; a topbar/sidebar não têm seletor de cor', () => {
    expect(shell).toContain('data-nav-accent={navAccent}');
    // Each saved preset is applied as variables on the workspace shell; CSS
    // does not hard-code theme-specific overrides of structural tokens.
    expect(shell).toContain('data-nav-accent={navAccent}');
    expect(shell).toContain('...accentVars');
    expect(read('src/lib/nav-accent.ts')).toContain("preset('onix'");
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
    // MISSÃO UX CLOSURE: não existe mais modo recolhido/expandido, então o
    // recorte usa o fim da PRÓPRIA regra (chave de fechamento), não a regra
    // seguinte — o contrato verificado é o mesmo.
    const start = css.indexOf('.il-platform .workspace-sidebar {');
    const side = css.slice(start, css.indexOf('}', start) + 1);
    expect(side).not.toContain('box-shadow');
    expect(side).toContain('border-right: 1px solid var(--il-nav-border)');
    // quick create = ação da topbar (mesmo contrato do sino: repouso limpo)
    expect(css).toMatch(/\.ws-quickcreate-btn \{[\s\S]*?background: transparent/);
  });
});
