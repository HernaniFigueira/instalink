// ═══════════════════════════════════════════════════════════════
// IDENTIDADE VISUAL DO DASHBOARD (P2) — uma cor principal por Business
// ═══════════════════════════════════════════════════════════════
// Escopo DELIBERADAMENTE pequeno: o dono escolhe UMA cor para a navegação
// (sidebar/topbar do painel) e o sistema deriva os tons necessários (hover,
// ativo, contraste do texto). NÃO é um theme editor: nada por componente,
// nada de dezenas de opções.
//
// Regras:
//   • vive em `Business.appearance` → trocar de unidade troca a identidade;
//   • a página pública NÃO usa nada daqui (identidade pública continua em
//     Page.theme/ThemeStyle — sistemas independentes);
//   • os valores saem como TOKENS CSS (`--il-nav*`), consumidos pela sidebar
//     via classes Tailwind arbitrárias — nada de cor hardcoded espalhada.
//
// Módulo PURO (sem I/O): importável no cliente e coberto por testes.
import type { BusinessAppearance } from './types';

/** Uma cor por padrão de negócio; rótulos simples, sem jargão. */
export interface NavPreset {
  id: string;
  label: string;
  color: string;
}

export const NAV_PRESETS: NavPreset[] = [
  { id: 'grafite', label: 'Grafite', color: '#18181b' },
  { id: 'azul', label: 'Azul', color: '#1d4ed8' },
  { id: 'vinho', label: 'Vinho', color: '#7f1d1d' },
  { id: 'verde', label: 'Verde', color: '#166534' },
  { id: 'rosa', label: 'Rosa', color: '#9d174d' },
  { id: 'roxo', label: 'Roxo', color: '#5b21b6' },
  { id: 'petroleo', label: 'Azul-petróleo', color: '#155e75' },
  { id: 'terracota', label: 'Terracota', color: '#9a3412' },
];

/** Cor de referência do produto (usada ao derivar tons de uma cor inválida). */
export const DEFAULT_NAV_COLOR = '#18181b';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` → `#aabbcc` (minúsculo). Retorna '' quando não é hex válido. */
export function normalizeHex(input: unknown): string {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!HEX.test(raw)) return '';
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return raw;
}

function rgbOf(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHex(hex) || DEFAULT_NAV_COLOR;
  const n = parseInt(clean.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** Luminância relativa (0 = preto, 1 = branco). */
export function luminance(hex: string): number {
  const { r, g, b } = rgbOf(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Texto com contraste sobre a cor informada (branco ou quase-preto). */
export function contrastText(hex: string): string {
  return luminance(hex) > 0.62 ? '#18181b' : '#ffffff';
}

/** Mistura a cor com preto (`amount` < 0) ou branco (`amount` > 0). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = rgbOf(hex);
  const target = amount < 0 ? 0 : 255;
  const w = Math.abs(amount);
  const mix = (c: number) => c + (target - c) * w;
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

export interface NavTokens {
  /** Fundo da navegação. */
  nav: string;
  /** Texto/ícones sobre a navegação. */
  navFg: string;
  /** Texto secundário (apoio) da navegação. */
  navMuted: string;
  /** Fundo de item em hover. */
  navHover: string;
  /** Fundo do item ATIVO. */
  navActive: string;
  /** Texto do item ativo. */
  navActiveFg: string;
  /** Divisórias/bordas internas da navegação. */
  navBorder: string;
  /** Fundo sólido de destaque (logotipo, botão "Ver site", aba ativa no mobile). */
  cta: string;
  /** Texto sobre `cta`. */
  ctaFg: string;
}

/**
 * VISUAL ATUAL DO PAINEL (nenhuma cor configurada): sidebar branca, item ativo
 * preto. É o padrão de fábrica — escolher uma cor em Configurações → Aparência
 * é o que pinta a navegação. Assim a configuração nova não muda a cara de quem
 * nunca mexeu nela.
 */
export const DEFAULT_NAV_TOKENS: NavTokens = {
  nav: '#ffffff',
  navFg: '#27272a',
  navMuted: '#71717a',
  navHover: '#f4f4f5',
  navActive: '#f4f4f5',
  navActiveFg: '#18181b',
  navBorder: '#e4e4e7',
  cta: '#18181b',
  ctaFg: '#ffffff',
};

/**
 * Tokens derivados da cor principal. Contraste NUNCA depende de escolha do
 * usuário: o texto (item normal, item ativo) é derivado da luminância.
 */
export function navTokens(color?: string | null): NavTokens {
  const base = normalizeHex(color);
  // Sem cor escolhida (ou valor inválido) → padrão de fábrica do painel.
  if (!base) return { ...DEFAULT_NAV_TOKENS };
  const light = luminance(base) > 0.62;
  const fg = contrastText(base);
  return {
    nav: base,
    navFg: fg,
    navMuted: light ? 'rgba(24,24,27,0.66)' : 'rgba(255,255,255,0.72)',
    navHover: light ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.12)',
    navActive: light ? 'rgba(24,24,27,0.14)' : 'rgba(255,255,255,0.20)',
    navActiveFg: fg,
    navBorder: light ? 'rgba(24,24,27,0.12)' : 'rgba(255,255,255,0.16)',
    cta: base,
    ctaFg: fg,
  };
}

/** Cor efetiva configurada no negócio ('' = padrão do produto). */
export function navColorOf(business?: { appearance?: BusinessAppearance } | null): string {
  return normalizeHex(business?.appearance?.navColor);
}

/** Payload sanitizado para persistir (whitelist de campos). */
export function sanitizeAppearance(input: unknown): BusinessAppearance {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return { navColor: normalizeHex(raw.navColor) };
}

/** Estilo inline com os tokens — aplicado no container do painel. */
export function navTokenStyle(color?: string | null): Record<string, string> {
  const t = navTokens(color);
  return {
    '--il-nav': t.nav,
    '--il-nav-fg': t.navFg,
    '--il-nav-muted': t.navMuted,
    '--il-nav-hover': t.navHover,
    '--il-nav-active': t.navActive,
    '--il-nav-active-fg': t.navActiveFg,
    '--il-nav-border': t.navBorder,
    '--il-nav-cta': t.cta,
    '--il-nav-cta-fg': t.ctaFg,
  };
}
