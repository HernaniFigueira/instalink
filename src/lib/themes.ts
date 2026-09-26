// Modelos prontos de design — o lojista escolhe uma combinação fechada
// (cores + tipografia + formato) e DEPOIS ajusta o que quiser.
// Nada aqui é por nicho: qualquer negócio pode usar qualquer modelo.
import type { Niche, Theme } from './types';

export interface ThemePreset {
  id: string;
  name: string;
  hint: string;
  theme: Theme;
  /**
   * FASE 2 · P9 — preset de TIPO DE CLÍNICA / profissional individual.
   * É só aparência sobre os MESMOS blocos: nunca cria outra engine nem outro
   * conjunto de componentes. Ausente = modelo geral (nicho).
   */
  clinicType?: 'medica' | 'odontologica' | 'veterinaria' | 'estetica' | 'particular' | 'geral';
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
  // ── FASE 2 · P9 — MODELOS DE PÁGINA POR TIPO DE CLÍNICA ──
  // O mesmo motor de blocos; só cores/fonte/formato mudam. Os ids batem com
  // `CLINIC_PRESETS[].pagePresetId` (presets de P5) — a unidade nova nasce
  // com o modelo do seu tipo e o editor oferece todos.
  {
    id: 'clinica-medica', name: 'Modelo Médico', clinicType: 'medica',
    hint: 'Azul clínico, limpo e objetivo',
    theme: {
      primary: '#2563eb', secondary: '#0ea5e9', background: '#f8fafc',
      surface: '#ffffff', text: '#0f172a', muted: '#64748b',
      radius: 14, font: 'inter', buttonStyle: 'solid',
    },
  },
  {
    id: 'clinica-odontologica', name: 'Modelo Odontológico', clinicType: 'odontologica',
    hint: 'Ciano suave, foco em sorrisos',
    theme: {
      primary: '#0891b2', secondary: '#2563eb', background: '#f0fdfa',
      surface: '#ffffff', text: '#083344', muted: '#64748b',
      radius: 16, font: 'inter', buttonStyle: 'soft',
    },
  },
  {
    id: 'clinica-veterinaria', name: 'Modelo Veterinário', clinicType: 'veterinaria',
    hint: 'Verde acolhedor para tutores e pets',
    theme: {
      primary: '#16a34a', secondary: '#f59e0b', background: '#f7fee7',
      surface: '#ffffff', text: '#14532d', muted: '#6b7280',
      radius: 18, font: 'rounded', buttonStyle: 'solid',
    },
  },
  {
    id: 'clinica-estetica', name: 'Modelo Estético', clinicType: 'estetica',
    hint: 'Rosé elegante e leve',
    theme: {
      primary: '#db2777', secondary: '#f43f5e', background: '#fffaf9',
      surface: '#ffffff', text: '#271219', muted: '#8b7f84',
      radius: 16, font: 'serif', buttonStyle: 'soft',
    },
  },
  {
    id: 'clinica-particular', name: 'Profissional individual', clinicType: 'particular',
    hint: 'Neutro e direto para quem atende sozinho',
    theme: {
      primary: '#18181b', secondary: '#3f3f46', background: '#fafafa',
      surface: '#ffffff', text: '#18181b', muted: '#71717a',
      radius: 10, font: 'inter', buttonStyle: 'outline',
    },
  },
  {
    id: 'clinica-geral', name: 'Modelo Clínica', clinicType: 'geral',
    hint: 'Equilibrado para qualquer especialidade',
    theme: {
      primary: '#0d9488', secondary: '#0f766e', background: '#f8fafc',
      surface: '#ffffff', text: '#0f172a', muted: '#64748b',
      radius: 14, font: 'inter', buttonStyle: 'solid',
    },
  },
];

export function presetById(id: string | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) || THEME_PRESETS[3];
}

/** Modelo de página sugerido para o TIPO de clínica (P9) — '' sem sugestão. */
export function clinicPresetId(clinicType: string | undefined): string {
  const found = THEME_PRESETS.find((p) => p.clinicType && p.clinicType === clinicType);
  if (found) return found.id;
  if (clinicType === 'particular') return 'clinica-particular';
  return '';
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
