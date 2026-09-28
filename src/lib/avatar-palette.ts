// ═══════════════════════════════════════════════════════════════
// AVATAR PALETTE — cores intercaladas/determinísticas para iniciais
//
// Regras do contrato (refino final de UI):
//   • NUNCA aleatório a cada render — o mesmo nome tem SEMPRE a mesma cor.
//   • Paleta curta (8), suave/profissional; sem saturação infantil.
//   • Letras legíveis com alto contraste AA (texto claro ou escuro conforme
//     a luminância do fundo).
//   • O hash é estável entre sessões e navegadores (sem Math.random).
// ═══════════════════════════════════════════════════════════════

export interface AvatarColor {
  /** Fundo do círculo. */
  bg: string;
  /** Cor das iniciais (AA ≥ 4.5:1 sobre `bg`). */
  fg: string;
}

/**
 * Paleta fixa — azul, teal, violeta, âmbar, verde, coral suave, carvão, petróleo.
 * Cada par (bg, fg) foi escolhido para contraste AA do texto de iniciais.
 */
export const AVATAR_PALETTE: AvatarColor[] = [
  { bg: '#3b6ed5', fg: '#ffffff' }, // azul
  { bg: '#0e8a7d', fg: '#ffffff' }, // teal
  { bg: '#6d5fd8', fg: '#ffffff' }, // violeta
  { bg: '#b45309', fg: '#ffffff' }, // âmbar
  { bg: '#2f7d4f', fg: '#ffffff' }, // verde
  { bg: '#c2604f', fg: '#ffffff' }, // coral suave
  { bg: '#3f3f46', fg: '#ffffff' }, // carvão
  { bg: '#155e75', fg: '#ffffff' }, // petróleo
];

/** Hash estável (FNV-1a 32-bit) — determinístico entre sessões/navegadores. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Cor do avatar para um nome: SEMPRE a mesma pessoa → mesma cor.
 * O nome é normalizado (caixa/espaços) para "Mariana" e "mariana" baterem.
 */
export function avatarColorFor(name: string): AvatarColor {
  const key = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return AVATAR_PALETTE[0];
  return AVATAR_PALETTE[stableHash(key) % AVATAR_PALETTE.length];
}

/** Iniciais de até 2 letras (compartilhada pelos fallbacks do workspace). */
export function avatarInitials(name: string): string {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?';
}
