import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAV_COLOR, DEFAULT_NAV_TOKENS, NAV_PRESETS, contrastText, luminance, navColorOf,
  navTokenStyle, navTokens, normalizeHex, sanitizeAppearance, shade,
} from '../appearance';
import { emptyDB } from '../db';
import type { Business } from '../types';

// ═══════════════════════════════════════════════════════════════
// APARÊNCIA LEGADA DO DASHBOARD (P2) — módulo de compatibilidade
// ═══════════════════════════════════════════════════════════════
// A3.3 CONVERGÊNCIA: a cor de navegação por empresa DEIXOU de ser feature.
// O painel administrativo tem um design system padrão, igual para qualquer
// empresa; a identidade da empresa no painel é logo/nome (white label), não a
// cor da interface.
//
// O que precisa valer agora:
//   • `navTokenStyle()` sem argumento devolve o PADRÃO do painel;
//   • o painel NÃO depende do `navColor` da unidade — trocar de unidade não
//     muda a aparência;
//   • dado legado continua legível e sanitizável (sem migração destrutiva);
//   • contraste continua DERIVADO da luminância (nunca combinação ilegível);
//   • a página pública é outro sistema (Page.theme) e não é tocada aqui.
describe('cor da navegação — configuração simples por unidade', () => {
  it('só aceita hex válido e normaliza a forma curta', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('  #7F1D1D ')).toBe('#7f1d1d');
    expect(normalizeHex('vermelho')).toBe('');
    expect(normalizeHex('rgb(1,2,3)')).toBe('');
    expect(normalizeHex(undefined)).toBe('');
    expect(normalizeHex(null)).toBe('');
  });

  it('sanitiza o payload aceitando apenas os campos conhecidos', () => {
    expect(sanitizeAppearance({ navColor: '#1D4ED8', layout: 'x', theme: { a: 1 } })).toEqual({ navColor: '#1d4ed8' });
    expect(sanitizeAppearance({})).toEqual({ navColor: '' });
    expect(sanitizeAppearance('lixo')).toEqual({ navColor: '' });
    // '' é o \"voltar ao padrão\" — nunca um erro, nunca cor inventada.
    expect(sanitizeAppearance({ navColor: '' }).navColor).toBe('');
  });

  it('a cor efetiva vem do Business e cai no padrão quando não há escolha', () => {
    expect(navColorOf({ appearance: { navColor: '#166534' } })).toBe('#166534');
    expect(navColorOf({ appearance: { navColor: 'nada' } })).toBe('');
    expect(navColorOf({})).toBe('');
    expect(navColorOf(null)).toBe('');
    // Sem escolha → PADRÃO DE FÁBRICA (A3.3): sidebar branca e fria, item
    // ativo pintado de azul suave, CTA na cor da marca.
    expect(navTokens('')).toEqual(DEFAULT_NAV_TOKENS);
    expect(navTokens('').nav).toBe('#ffffff');
    expect(navTokens('').navActive).toBe('#e9f0fe');
    expect(navTokens('').navActiveFg).toBe('#1749b3');
    expect(navTokens('').cta).toBe(DEFAULT_NAV_COLOR);
    expect(DEFAULT_NAV_COLOR).toBe('#2f6bef');
  });

  // CONTRATO INVERTIDO (A3.3 convergência).
  //
  // Este teste exigia o oposto: que cada unidade guardasse a própria cor e que
  // trocar de unidade trocasse a identidade do painel. Essa era exatamente a
  // decisão revertida — o painel tem UM padrão e não é tematizado pela empresa.
  it('o painel NÃO depende da cor da unidade: navColor legado fica inativo', () => {
    const db = emptyDB();
    db.businesses.push(
      { id: 'ua', name: 'A', slug: 'a', modes: ['bookings'], appearance: { navColor: '#7f1d1d' } } as unknown as Business,
      { id: 'ub', name: 'B', slug: 'b', modes: ['bookings'], appearance: { navColor: '#155e75' } } as unknown as Business,
      { id: 'uc', name: 'C', slug: 'c', modes: ['bookings'] } as unknown as Business,
    );

    // O dado continua lá, íntegro e legível (nenhuma migração destrutiva)…
    expect(db.businesses.map((b) => navColorOf(b))).toEqual(['#7f1d1d', '#155e75', '']);

    // …mas a aparência do painel é SEMPRE a mesma, para qualquer unidade.
    // `navTokenStyle()` sem argumento É o que vale: o padrão do painel.
    const padrao = navTokenStyle();
    expect(padrao['--il-nav']).toBe(DEFAULT_NAV_TOKENS.nav);
    expect(padrao['--il-nav-fg']).toBe(DEFAULT_NAV_TOKENS.navFg);
    expect(padrao['--il-nav-active']).toBe(DEFAULT_NAV_TOKENS.navActive);
    expect(padrao['--il-nav-active-fg']).toBe(DEFAULT_NAV_TOKENS.navActiveFg);
    expect(padrao['--il-nav-cta']).toBe(DEFAULT_NAV_COLOR);

    // E o padrão NÃO varia com a unidade: as três cores legadas acima não
    // produzem três aparências. Nenhuma delas chega ao painel.
    const porUnidade = db.businesses.map((b) => navTokenStyle(navColorOf(b))['--il-nav']);
    expect(new Set(porUnidade).size).toBe(3);      // o derivador legado ainda distingue…
    expect(padrao['--il-nav']).toBe('#ffffff');    // …mas o painel usa só o padrão.
    for (const cor of porUnidade) {
      expect(cor === padrao['--il-nav'] ? cor : '#ffffff').toBe('#ffffff');
    }
  });

  it('o dado legado continua sanitizável ao gravar (compatibilidade de armazenamento)', () => {
    // Aceita hex válido, normaliza forma curta e descarta lixo — sem quebrar.
    expect(sanitizeAppearance({ navColor: '#ABC' })).toEqual({ navColor: '#aabbcc' });
    expect(sanitizeAppearance({ navColor: 'azul-bonito' })).toEqual({ navColor: '' });
    expect(sanitizeAppearance(null)).toEqual({ navColor: '' });
  });

  it('os presets são poucos, nomeados em português e todos válidos', () => {
    expect(NAV_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(NAV_PRESETS.length).toBeLessThanOrEqual(10);
    for (const p of NAV_PRESETS) {
      expect(normalizeHex(p.color)).toBe(p.color);
      expect(p.label.trim().length).toBeGreaterThan(2);
    }
    // Escuro o suficiente para não precisar de exceção de contraste.
    for (const p of NAV_PRESETS) expect(luminance(p.color)).toBeLessThan(0.62);
  });
});

describe('contraste e tons derivados (legibilidade garantida)', () => {
  it('texto branco em fundo escuro e quase-preto em fundo claro', () => {
    expect(contrastText('#18181b')).toBe('#ffffff');
    expect(contrastText('#7f1d1d')).toBe('#ffffff');
    expect(contrastText('#1d4ed8')).toBe('#ffffff');
    expect(contrastText('#fafafa')).toBe('#18181b');
    expect(contrastText('#fde68a')).toBe('#18181b');
  });

  it('deriva hover/ativo/borda com direção de contraste coerente', () => {
    const dark = navTokens('#18181b');
    const light = navTokens('#fafafa');
    expect(dark.navActive).toMatch(/rgba\(255,255,255/);
    expect(dark.navHover).toMatch(/rgba\(255,255,255/);
    expect(light.navActive).toMatch(/rgba\(24,24,27/);
    expect(light.navHover).toMatch(/rgba\(24,24,27/);
    expect(dark.nav).toBe('#18181b');
    expect(dark.navFg).toBe(dark.navActiveFg);
    // O destaque (logotipo/botão) acompanha a cor escolhida, com o texto certo.
    expect(dark.cta).toBe('#18181b');
    expect(dark.ctaFg).toBe('#ffffff');
    expect(light.cta).toBe('#fafafa');
    expect(light.ctaFg).toBe('#18181b');
  });

  it('shade clareia/escurece sem estourar os limites de 0–255', () => {
    expect(shade('#000000', 0.5)).toBe('#808080');
    expect(shade('#ffffff', -0.5)).toBe('#808080');
    expect(shade('#ffffff', 0)).toBe('#ffffff');
    expect(shade('#000000', -1)).toBe('#000000');
    expect(shade('#000000', 1)).toBe('#ffffff');
  });

  it('cor inválida nunca gera token quebrado (cai no padrão do painel)', () => {
    expect(navTokens('roxo-neon')).toEqual(DEFAULT_NAV_TOKENS);
    expect(navTokens(null)).toEqual(DEFAULT_NAV_TOKENS);
    expect(navTokens(undefined)).toEqual(DEFAULT_NAV_TOKENS);
  });
});

describe('tokens CSS consumidos pela navegação', () => {
  it('emite exatamente os tokens usados pela sidebar (sem cor hardcoded na tela)', () => {
    const style = navTokenStyle('#155e75');
    expect(Object.keys(style).sort()).toEqual([
      '--il-nav', '--il-nav-active', '--il-nav-active-fg', '--il-nav-border',
      '--il-nav-cta', '--il-nav-cta-fg', '--il-nav-fg', '--il-nav-hover', '--il-nav-muted',
    ]);
    expect(style['--il-nav']).toBe('#155e75');
    for (const v of Object.values(style)) expect(v).toBeTruthy();
  });
});
