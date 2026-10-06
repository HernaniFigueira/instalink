// ═══════════════════════════════════════════════════════════════
// APARÊNCIA DO SISTEMA — tema da clínica (missão final · §6)
// ═══════════════════════════════════════════════════════════════
// CONTRATO UNIVERSAL DE COR (4 CATEGORIAS — docs/GODOUTOR-UI-CONTRACT.md):
//   A) TEXTO        sempre near-black — o tema NUNCA muda o texto;
//   B) TEMA         (esta paleta) controla: COR DE ACENTO (item ativo da
//                   navegação, CTA principal, acentos de header). A ESTRUTURA
//                   é FIXA desde o DS 1.0 (§13): sidebar branca, topbar
//                   neutra — o tema NÃO pinta superfície estrutural;
//   C) SEMÂNTICAS   verde=ok, vermelho=erro, âmbar=atenção — independentes;
//   D) FUNDO        do workspace é neutro universal — não acompanha o tema.
//
// PALETA POR FAMÍLIAS (21 presets): Neutro/Branco · Azul clínico, amigável,
// profundo · Verde sálvia, equilibrado, profundo · Teal claro, médio,
// profundo · Violeta suave, atual, profundo · Amarelo suave, Âmbar, Dourado ·
// Rosé, Vinho, Bordô · Ônix.
//
// Cada preset deriva, do MESMO tom de acento, os tokens de acento (nunca
// misturados com --text):
//   --accent*      → CTAs PRINCIPAIS + acentos de header (accent, hover, soft,
//                    border, contrast). O contraste do accent é calculado na
//                    carga (preto ou branco, nunca "no olho").
//   --il-nav-active*/--il-nav-cta → APENAS o estado ATIVO da navegação herda o
//                    acento (fundo suave + texto do acento). Fundo, hover,
//                    borda e textos da sidebar são neutros e fixos.
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
  accent: string,
): NavAccent {
  const accentSoft = lighten(accent, 0.86);
  // Texto do acento sobre o fundo suave do acento: escurece em passos
  // determinísticos até AA (≥ 4.5:1). Nunca "no olho".
  let accentFg = accent;
  for (let guard = 0; guard < 12 && contrastRatio(accentFg, accentSoft) < 4.5; guard++) {
    accentFg = darken(accentFg, 0.08);
  }
  return {
    id,
    family,
    label,
    // Amostra do seletor = a COR DE ACENTO (a estrutura da navegação é branca
    // e não muda com o tema — DS 1.0 §13).
    swatch: accent,
    vars: {
      // ── Acento (B: tema) ──
      '--accent': accent,
      '--accent-hover': darken(accent, 0.14),
      '--accent-soft': accentSoft,
      '--accent-fg': accentFg,
      '--accent-border': mix(accent, '#ffffff', 0.55),
      '--accent-contrast': contrastOn(accent),
      // ── Navegação: SÓ o estado ativo herda o acento ──
      '--il-nav-active': accentSoft,
      '--il-nav-active-fg': accentFg,
      '--il-nav-cta': accent,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// OS 21 PRESETS, por família (contrato §6: preview + contraste AA)
// ═══════════════════════════════════════════════════════════════
export const NAV_ACCENTS: NavAccent[] = [
  // ── Neutro / Branco ──
  preset('branco', 'neutro', 'Branco', '#4b5563'),
  preset('neutro', 'neutro', 'Neutro', '#3f4652'),
  // ── Azul ──
  preset('azul-clinico', 'azul', 'Azul clínico', '#3f37c9'),
  preset('azul-amigavel', 'azul', 'Azul amigável', '#2563eb'),
  preset('azul-profundo', 'azul', 'Azul profundo', '#2563eb'),
  // ── Verde ──
  preset('verde-salvia', 'verde', 'Verde sálvia', '#4d7c5f'),
  preset('verde-equilibrado', 'verde', 'Verde equilibrado', '#15803d'),
  preset('verde-profundo', 'verde', 'Verde profundo', '#166534'),
  // ── Teal ──
  preset('teal-claro', 'teal', 'Teal claro', '#0b7d74'),
  preset('teal', 'teal', 'Teal médio', '#0f766e'),
  preset('teal-profundo', 'teal', 'Teal profundo', '#115e59'),
  // ── Violeta ──
  preset('violeta-suave', 'violeta', 'Violeta suave', '#6d5fd8'),
  preset('violeta', 'violeta', 'Violeta', '#6d28d9'),
  preset('violeta-profundo', 'violeta', 'Violeta profundo', '#5b21b6'),
  // ── Amarelo / Âmbar (texto sobre accent é near-black — contrato A) ──
  preset('amarelo-suave', 'amarelo', 'Amarelo suave', '#b45309'),
  preset('ambar', 'amarelo', 'Âmbar', '#b45309'),
  preset('dourado', 'amarelo', 'Dourado', '#a16207'),
  // ── Rosé / Vinho / Bordô ──
  preset('rose', 'rosé', 'Rosé', '#ad4d64'),
  preset('vinho', 'rosé', 'Vinho', '#861e45'),
  preset('bordo', 'rosé', 'Bordô', '#6b1435'),
  // ── Ônix ──
  preset('onix', 'onix', 'Ônix', '#18181b'),
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

// TEMA PADRÃO = AZUL PROFUNDO (acento azul do DS). A escolha explícita válida
// no localStorage tem precedência e nunca é regravada ao atualizar o default.
export const DEFAULT_ACCENT_ID = 'azul-profundo';
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

/** Active picker only; all historical IDs and tokens above remain resolvable. */
export const CURATED_NAV_ACCENT_LABELS: Readonly<Record<string, string>> = {
  'azul-profundo': 'Azul clínico', 'verde-equilibrado': 'Verde saúde',
  'teal-profundo': 'Teal', vinho: 'Vinho institucional', onix: 'Neutro / Ônix',
};
