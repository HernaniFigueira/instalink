// ═══════════════════════════════════════════════════════════════
// APARÊNCIA DO SISTEMA — tema da clínica (missão final · §6)
// ═══════════════════════════════════════════════════════════════
// CONTRATO UNIVERSAL DE COR (4 CATEGORIAS — docs/GODOUTOR-UI-CONTRACT.md):
//   A) TEXTO        sempre near-black — o tema NUNCA muda o texto;
//   B) TEMA         (esta paleta) controla: sidebar, topbar suave, ícone e
//                   acento do page header, item ativo e CTAs PRINCIPAIS;
//   C) SEMÂNTICAS   verde=ok, vermelho=erro, âmbar=atenção — independentes;
//   D) FUNDO        do workspace é neutro universal — não acompanha o tema.
//
// PALETA POR FAMÍLIAS (21 presets): Neutro/Branco · Azul clínico, amigável,
// profundo · Verde sálvia, equilibrado, profundo · Teal claro, médio,
// profundo · Violeta suave, atual, profundo · Amarelo suave, Âmbar, Dourado ·
// Rosé, Vinho, Bordô · Ônix.
//
// Cada preset traz DOIS grupos de tokens (nunca misturados com --text):
//   --il-nav*   → sidebar (fundo, texto do nav, hover, item ativo);
//   --accent*   → CTAs PRINCIPAIS + acentos de header (accent, hover, soft,
//                 border, contrast). O contraste do accent é calculado na
//                 carga (preto ou branco, nunca "no olho").
//
// A personalização mora em Configurações → Aparência (nunca no shell) e
// NÃO afeta a página pública. Persistência local (localStorage).
'use client';

export type NavAccentFamily =
  | 'neutro' | 'azul' | 'verde' | 'teal' | 'violeta' | 'amarelo' | 'rosé' | 'onix';

export interface NavAccent {
  id: string;
  family: NavAccentFamily;
  /** Rótulo no seletor. */
  label: string;
  /** Amostra do swatch (cor de fundo do preset). */
  swatch: string;
  /** Tokens aplicados em .workspace-shell[data-nav-accent=…]. */
  vars: Record<string, string>;
}

// ── Derivação determinística de tons (mesma régua para todos) ──
// Escurece/clareia um hex por fator; usado para hover/soft/border.
function mix(hex: string, target: string, amount: number): string {
  const h = hex.replace('#', '');
  const t = target.replace('#', '');
  const f = (i: number) => Math.round(
    parseInt(h.slice(i, i + 2), 16) * (1 - amount) + parseInt(t.slice(i, i + 2), 16) * amount,
  );
  return '#' + [f(0), f(2), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
const darken = (hex: string, amount: number) => mix(hex, '#000000', amount);
const lighten = (hex: string, amount: number) => mix(hex, '#ffffff', amount);

/** Luminância relativa WCAG de um hex (#rrggbb). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

/** Texto sobre a cor: near-black em fundos claros, branco nos escuros (AA). */
export function contrastOn(hex: string): string {
  // Fundo claro → texto quase preto (contrato A: texto sempre near-black).
  return relativeLuminance(hex) > 0.35 ? '#18181b' : '#ffffff';
}

/** Ratio de contraste WCAG entre duas cores. */
/**
 * REGR ESTRUTURAL DE CONTRASTE (refino final): para QUALQUER fundo, o fg é
 * escolhido pelo contraste real (AA) — nunca cor fixa. Fundo escuro → fg
 * claro; fundo claro → fg near-black. Vale para item ativo da sidebar,
 * chips preenchidos, monograma da clínica e tudo que usar o accent preenchido.
 */
export function bestFgOn(bg: string): string {
  return contrastRatio('#ffffff', bg) >= contrastRatio('#18181b', bg) ? '#ffffff' : '#18181b';
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function preset(
  id: string,
  family: NavAccentFamily,
  label: string,
  nav: string,
  accent: string,
  opts: { navFg?: string } = {},
): NavAccent {
  const navFg = opts.navFg || contrastOn(nav);
  // ── Estado ativo com AA GARANTIDO (regra estrutural): parte do tom ativo
  // base e ajusta (escurece/clareia) até o melhor fg chegar a ≥ 4.5:1.
  // Vale para os 21 presets sem override por tema. ──
  let navActive = navFg === '#18181b' ? darken(nav, 0.18) : lighten(nav, 0.14);
  for (let guard = 0; guard < 12 && contrastRatio(bestFgOn(navActive), navActive) < 4.5; guard++) {
    navActive = bestFgOn(navActive) === '#ffffff' ? darken(navActive, 0.07) : lighten(navActive, 0.07);
  }
  const navActiveFg = bestFgOn(navActive);
  // Ícone inativo: caminho moderado até o melhor fg, com piso de contraste
  // 3.5:1 sobre o nav (o chip do ícone soma 12% de branco por cima — o piso
  // real no navegador fica ~3.1:1: legível, nunca lavado; força ≤ ~82%).
  let iconAmt = 0.72;
  let navIcon = mix(nav, bestFgOn(nav), iconAmt);
  for (let guard = 0; guard < 6 && contrastRatio(navIcon, nav) < 3.5; guard++) {
    iconAmt = Math.min(0.84, iconAmt + 0.06);
    navIcon = mix(nav, bestFgOn(nav), iconAmt);
  }
  return {
    id,
    family,
    label,
    swatch: nav,
    vars: {
      // ── Sidebar (B: tema) ──
      '--il-nav': nav,
      '--il-nav-fg': navFg === '#18181b' ? '#18181b' : '#ffffff',
      '--il-nav-muted': navFg === '#18181b' ? mix(nav, '#18181b', 0.42) : mix(nav, '#ffffff', 0.34),
      // Ícones INATIVOS: força visual moderada (60–75%) — legíveis, nunca
      // lavados; derivado do fg do tema e ajustado até ≥ 3.2:1 sobre o nav
      // (navs médios ganham mais mistura; nada de glifo transparente).
      '--il-nav-icon': navIcon,
      '--il-nav-hover': darken(nav, 0.12),
      '--il-nav-active': navActive,
      // fg do ATIVO calculado do bg ATIVO real (regra estrutural) — nunca cor
      // fixa: fundo escuro → letra clara; fundo claro → letra near-black.
      '--il-nav-active-fg': navActiveFg,
      // ── CTAs principais + acentos (B: tema) ──
      '--accent': accent,
      '--accent-hover': darken(accent, 0.14),
      '--accent-soft': lighten(accent, 0.86),
      '--accent-border': mix(accent, '#ffffff', 0.55),
      '--accent-contrast': contrastOn(accent),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// OS 21 PRESETS, por família (contrato §6: preview + contraste AA)
// ═══════════════════════════════════════════════════════════════
export const NAV_ACCENTS: NavAccent[] = [
  // ── Neutro / Branco ──
  preset('branco', 'neutro', 'Branco', '#eef1f6', '#4b5563', { navFg: '#18181b' }),
  preset('neutro', 'neutro', 'Neutro', '#d8dde6', '#3f4652', { navFg: '#18181b' }),
  // ── Azul ──
  preset('azul-clinico', 'azul', 'Azul clínico', '#3f37c9', '#3f37c9'),
  preset('azul-amigavel', 'azul', 'Azul amigável', '#2563eb', '#2563eb'),
  preset('azul-profundo', 'azul', 'Azul profundo', '#1e3a8a', '#1e40af'),
  // ── Verde ──
  preset('verde-salvia', 'verde', 'Verde sálvia', '#4d7c5f', '#4d7c5f'),
  preset('verde-equilibrado', 'verde', 'Verde equilibrado', '#15803d', '#15803d'),
  preset('verde-profundo', 'verde', 'Verde profundo', '#14532d', '#166534'),
  // ── Teal ──
  preset('teal-claro', 'teal', 'Teal claro', '#0b7d74', '#0b7d74'),
  preset('teal', 'teal', 'Teal médio', '#0f766e', '#0f766e'),
  preset('teal-profundo', 'teal', 'Teal profundo', '#134e4a', '#115e59'),
  // ── Violeta ──
  preset('violeta-suave', 'violeta', 'Violeta suave', '#6d5fd8', '#6d5fd8'),
  preset('violeta', 'violeta', 'Violeta', '#6d28d9', '#6d28d9'),
  preset('violeta-profundo', 'violeta', 'Violeta profundo', '#4c1d95', '#5b21b6'),
  // ── Amarelo / Âmbar (texto sobre accent é near-black — contrato A) ──
  preset('amarelo-suave', 'amarelo', 'Amarelo suave', '#e8c96a', '#b45309', { navFg: '#18181b' }),
  preset('ambar', 'amarelo', 'Âmbar', '#b45309', '#b45309'),
  preset('dourado', 'amarelo', 'Dourado', '#a16207', '#a16207'),
  // ── Rosé / Vinho / Bordô ──
  preset('rose', 'rosé', 'Rosé', '#ad4d64', '#ad4d64'),
  preset('vinho', 'rosé', 'Vinho', '#7f1d3f', '#861e45'),
  preset('bordo', 'rosé', 'Bordô', '#5f1230', '#6b1435'),
  // ── Ônix ──
  preset('onix', 'onix', 'Ônix', '#18181b', '#27272a'),
];

/** Resolução por id, com aliases das missões anteriores (localStorage legado). */
const ALIASES: Record<string, string> = {
  'violeta-atual': 'violeta',
  'teal-medio': 'teal',
};
export function findAccent(id: string): NavAccent | undefined {
  const resolved = ALIASES[id] || id;
  return NAV_ACCENTS.find((a) => a.id === resolved);
}

// TEMA PADRÃO = NEUTRO (usuário sem preferência salva inicia em Neutro;
// nunca mais o índigo/roxo como fallback). Preferência válida no
// localStorage é sempre respeitada — nada de sobrescrever escolha do usuário.
export const DEFAULT_ACCENT_ID = 'neutro';
// Chave LEGADA (missão 6) — preserva a preferência já persistida do usuário.
export const NAV_ACCENT_STORAGE_KEY = 'godoutor.nav-accent';

/** Compat: id de preset (string — os 21 ids + aliases legados). */
export type NavAccentId = string;

/** Compat (missão 7): nome antigo do padrão. */
export const NAV_ACCENT_DEFAULT = DEFAULT_ACCENT_ID;
/** Compat (missão 6–7): resolvedor com fallback seguro — nunca undefined. */
export function navAccentById(id: string): NavAccent {
  return findAccent(id) || findAccent(DEFAULT_ACCENT_ID)!;
}

/** Id ativo (localStorage, com fallback seguro para o padrão). */
export function getNavAccent(): NavAccentId {
  if (typeof window === 'undefined') return DEFAULT_ACCENT_ID;
  try {
    const raw = window.localStorage.getItem(NAV_ACCENT_STORAGE_KEY) || '';
    const found = raw ? findAccent(raw) : undefined;
    return found ? found.id : DEFAULT_ACCENT_ID;
  } catch {
    return DEFAULT_ACCENT_ID;
  }
}

/** Seleciona o tema e avisa o shell (`godoutor:nav-accent`). */
export function setNavAccent(id: NavAccentId): void {
  const found = findAccent(id);
  const next = found ? found.id : DEFAULT_ACCENT_ID;
  try { window.localStorage.setItem(NAV_ACCENT_STORAGE_KEY, next); } catch { /* storage bloqueado */ }
  try {
    window.dispatchEvent(new CustomEvent<NavAccentId>('godoutor:nav-accent', { detail: next }));
  } catch { /* ambiente sem CustomEvent */ }
}

/** Famílias na ordem do seletor (Configurações → Aparência). */
export const NAV_ACCENT_FAMILIES: Array<{ id: NavAccentFamily; label: string }> = [
  { id: 'neutro', label: 'Neutro / Branco' },
  { id: 'azul', label: 'Azul' },
  { id: 'verde', label: 'Verde' },
  { id: 'teal', label: 'Teal' },
  { id: 'violeta', label: 'Violeta' },
  { id: 'amarelo', label: 'Amarelo / Âmbar' },
  { id: 'rosé', label: 'Rosé / Vinho' },
  { id: 'onix', label: 'Ônix' },
];
