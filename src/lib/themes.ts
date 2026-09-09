// Modelos prontos de design — o lojista escolhe uma combinação fechada
// (cores + tipografia + formato) e DEPOIS ajusta o que quiser.
// Nada aqui é por nicho: qualquer negócio pode usar qualquer modelo.
import type { Niche, Theme } from './types';

export interface ThemePreset {
  id: string;
  name: string;
  hint: string;
  theme: Theme;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'limao', name: 'Lima Elétrica', hint: 'Escuro, jovem e chamativo',
    theme: {
      primary: '#a3e635', secondary: '#2f7bff', background: '#120a0b',
      surface: '#201416', text: '#fafaf9', muted: '#a8a29e',
      radius: 20, font: 'sora', buttonStyle: 'solid',
    },
  },
  {
    id: 'oceano', name: 'Azul Elétrico', hint: 'Confiança com energia',
    theme: {
      primary: '#0050bd', secondary: '#38bdf8', background: '#f2f7ff',
      surface: '#ffffff', text: '#0b1b33', muted: '#5b6b85',
      radius: 18, font: 'sora', buttonStyle: 'solid',
    },
  },
  {
    id: 'pordosol', name: 'Pôr do Sol', hint: 'Quente, ideal para delivery',
    theme: {
      primary: '#ea580c', secondary: '#fbbf24', background: '#fff7ed',
      surface: '#ffffff', text: '#431407', muted: '#9c6b4c',
      radius: 20, font: 'rounded', buttonStyle: 'soft',
    },
  },
  {
    id: 'fresh', name: 'Verde Fresh', hint: 'Leve, saudável, pet e bem-estar',
    theme: {
      primary: '#16a34a', secondary: '#4ade80', background: '#f0fdf4',
      surface: '#ffffff', text: '#052e16', muted: '#5f7a68',
      radius: 16, font: 'inter', buttonStyle: 'solid',
    },
  },
  {
    id: 'noite', name: 'Noite Neon', hint: 'Premium, urbano, sofisticado',
    theme: {
      primary: '#8b5cf6', secondary: '#22d3ee', background: '#0b0b12',
      surface: '#16161f', text: '#f4f4f5', muted: '#8e8e9a',
      radius: 14, font: 'space', buttonStyle: 'solid',
    },
  },
  {
    id: 'rose', name: 'Rosé', hint: 'Delicado, beleza e estética',
    theme: {
      primary: '#db2777', secondary: '#f9a8d4', background: '#fdf2f8',
      surface: '#ffffff', text: '#4a1d33', muted: '#a07e90',
      radius: 22, font: 'serif', buttonStyle: 'solid',
    },
  },
  {
    id: 'cafe', name: 'Café & Craft', hint: 'Artesanal, aconchegante',
    theme: {
      primary: '#92400e', secondary: '#d97706', background: '#f7f3ec',
      surface: '#fffdf8', text: '#292019', muted: '#8a7a68',
      radius: 12, font: 'serif', buttonStyle: 'outline',
    },
  },
  {
    id: 'essencial', name: 'Essencial', hint: 'Minimalista, preto e branco',
    theme: {
      primary: '#18181b', secondary: '#71717a', background: '#fafafa',
      surface: '#ffffff', text: '#111111', muted: '#71717a',
      radius: 12, font: 'inter', buttonStyle: 'solid',
    },
  },
];

export function presetById(id: string | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) || THEME_PRESETS[3];
}

/** Modelo inicial sugerido por nicho (só o ponto de partida). */
export const NICHE_PRESET: Record<Niche, string> = {
  alimentacao: 'pordosol',
  loja: 'noite',
  beleza: 'rose',
  saude: 'oceano',
  servicos: 'oceano',
  profissional: 'essencial',
  educacao: 'oceano',
  pet: 'fresh',
  outro: 'fresh',
};

/** Descobre se o tema atual ainda é idêntico a algum modelo. */
export function matchingPreset(theme: Theme): string | null {
  const norm = (t: Theme) => JSON.stringify([
    t.primary, t.secondary, t.background, t.surface, t.text,
    t.muted, t.radius, t.font, t.buttonStyle,
  ]);
  const cur = norm(theme);
  return THEME_PRESETS.find((p) => norm(p.theme) === cur)?.id ?? null;
}
