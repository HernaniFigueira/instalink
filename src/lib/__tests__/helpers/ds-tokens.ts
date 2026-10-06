// ═══════════════════════════════════════════════════════════════
// HELPERS DE CONTRATO — DS 1.0 (não é um arquivo de teste)
// ═══════════════════════════════════════════════════════════════
// Os testes de contrato visual precisam AVALIAR os tokens reais (contraste
// WCAG calculado, nunca regex de cor). Desde o DS 1.0 a FONTE ÚNICA é
// `src/styles/godoutor-design-system.css` (`--gd-*`); `globals.css` só contém
// ALIASES (`--text: var(--gd-text)`). Este helper lê os dois arquivos,
// resolve a cadeia de `var()` e devolve cores sólidas sRGB.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

export const DS_CSS_PATH = 'src/styles/godoutor-design-system.css';
export const GLOBALS_CSS_PATH = 'src/app/globals.css';

export const dsCss = readFileSync(resolve(DS_CSS_PATH), 'utf8');
export const globalsCss = readFileSync(resolve(GLOBALS_CSS_PATH), 'utf8');

const tokens = new Map<string, string>();
for (const [source, text] of [[DS_CSS_PATH, dsCss], [GLOBALS_CSS_PATH, globalsCss]] as const) {
  const root = postcss.parse(text);
  for (const selector of [':root', '.il-platform', '.gd-app']) {
    root.walkRules(selector, (rule) => {
      rule.walkDecls(/^--/, (decl) => { tokens.set(decl.prop, decl.value.trim()); });
    });
  }
  void source;
}

/** Mapa efetivo de tokens (DS 1.0 + aliases do globals; alias vence). */
export const TOKENS = tokens as ReadonlyMap<string, string>;

/** Valor cru declarado para um token (sem resolver `var()`). */
export function rawToken(name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Token ausente: ${name}`);
  return value;
}

/** Cor sólida sRGB resolvida pela cadeia de aliases. */
export function color(name: string, seen = new Set<string>()): string {
  if (/^#[0-9a-f]{6}$/i.test(name)) return name;
  if (seen.has(name)) throw new Error(`Alias cíclico: ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  if (!value) throw new Error(`Cor ausente: ${name}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  if (alias) return color(alias[1], seen);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Não é cor sRGB sólida: ${name}=${value}`);
  return value;
}

export function luminance(token: string): number {
  const hex = color(token);
  const linear = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrast(a: string, b: string): number {
  const pair = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (pair[0] + 0.05) / (pair[1] + 0.05);
}

/** Luminância relativa de um hex cru (#rrggbb). */
export function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

/** Contraste WCAG entre dois hex crus. */
export function hexContrast(a: string, b: string): number {
  const [hi, lo] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
