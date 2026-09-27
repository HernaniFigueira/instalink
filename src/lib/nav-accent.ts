// ═══════════════════════════════════════════════════════════════
// APARÊNCIA DO SISTEMA — cor da navegação (missão 6)
// ═══════════════════════════════════════════════════════════════
// A personalização de cor da sidebar mora em Configurações → Aparência
// (nunca exposta na shell). Presets SEGUROS: cada um traz fg/muted já
// validados para contraste AA sobre o fundo do preset.
// Persistência local (localStorage) — sem banco/APIs nesta missão.
'use client';

export type NavAccentId =
  | 'azul-clinico' | 'azul-amigavel' | 'violeta' | 'teal'
  | 'verde-salvia' | 'ambar' | 'onix' | 'vinho';

export interface NavAccent {
  id: NavAccentId;
  /** Rótulo no seletor. */
  label: string;
  /** Amostra para o swatch (cor de fundo do preset). */
  swatch: string;
  /** Tokens --il-nav* aplicados em .workspace-shell[data-nav-accent=…]. */
  vars: Record<string, string>;
}

export const NAV_ACCENTS: NavAccent[] = [
  {
    id: 'azul-clinico',
    label: 'Azul clínico',
    swatch: '#3f37c9',
    vars: {
      '--il-nav': '#3f37c9', '--il-nav-fg': '#f2f3ff', '--il-nav-muted': '#d3dafc',
      '--il-nav-hover': '#4c43d1', '--il-nav-active': '#5b4fe2', '--il-nav-active-fg': '#ffffff',
    },
  },
  {
    id: 'azul-amigavel',
    label: 'Azul amigável',
    swatch: '#2563eb',
    vars: {
      '--il-nav': '#2563eb', '--il-nav-fg': '#eff6ff', '--il-nav-muted': '#bfdbfe',
      '--il-nav-hover': '#1d4ed8', '--il-nav-active': '#3b82f6', '--il-nav-active-fg': '#ffffff',
    },
  },
  {
    id: 'violeta',
    label: 'Violeta',
    swatch: '#6d28d9',
    vars: {
      '--il-nav': '#6d28d9', '--il-nav-fg': '#f5f3ff', '--il-nav-muted': '#ddd6fe',
      '--il-nav-hover': '#5b21b6', '--il-nav-active': '#7c3aed', '--il-nav-active-fg': '#ffffff',
    },
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: '#0f766e',
    vars: {
      '--il-nav': '#0f766e', '--il-nav-fg': '#f0fdfa', '--il-nav-muted': '#b8e8e0',
      '--il-nav-hover': '#115e59', '--il-nav-active': '#14b8a6', '--il-nav-active-fg': '#ffffff',
    },
  },
  {
    id: 'verde-salvia',
    label: 'Verde sálvia',
    swatch: '#4d7c5f',
    vars: {
      '--il-nav': '#4d7c5f', '--il-nav-fg': '#f4f8f4', '--il-nav-muted': '#cfe3d2',
      '--il-nav-hover': '#3f6a50', '--il-nav-active': '#5f8d6e', '--il-nav-active-fg': '#ffffff',
    },
  },
  {
    id: 'ambar',
    label: 'Âmbar',
    swatch: '#b45309',
    vars: {
      '--il-nav': '#b45309', '--il-nav-fg': '#fff8eb', '--il-nav-muted': '#f5d9a8',
      '--il-nav-hover': '#92400e', '--il-nav-active': '#d97706', '--il-nav-active-fg': '#ffffff',
    },
  },
  {
    id: 'onix',
    label: 'Ônix',
    swatch: '#18181b',
    vars: {
      '--il-nav': '#18181b', '--il-nav-fg': '#fafafa', '--il-nav-muted': '#c4c4c8',
      '--il-nav-hover': '#27272a', '--il-nav-active': '#3f3f46', '--il-nav-active-fg': '#ffffff',
    },
  },
  {
    id: 'vinho',
    label: 'Vinho',
    swatch: '#9f1239',
    vars: {
      '--il-nav': '#9f1239', '--il-nav-fg': '#fff1f2', '--il-nav-muted': '#f7cdd6',
      '--il-nav-hover': '#881337', '--il-nav-active': '#be123c', '--il-nav-active-fg': '#ffffff',
    },
  },
];

export const NAV_ACCENT_DEFAULT: NavAccentId = 'azul-clinico';

const STORAGE_KEY = 'godoutor.nav-accent';

export function navAccentById(id: string | null | undefined): NavAccent {
  return NAV_ACCENTS.find((a) => a.id === id) || NAV_ACCENTS[0];
}

/** Leitura segura (SSR/hidratação): só o padrão antes do mount. */
export function getNavAccent(): NavAccentId {
  if (typeof window === 'undefined') return NAV_ACCENT_DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return (NAV_ACCENTS.some((a) => a.id === raw) ? raw : NAV_ACCENT_DEFAULT) as NavAccentId;
  } catch {
    return NAV_ACCENT_DEFAULT;
  }
}

export function setNavAccent(id: NavAccentId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
    // Sincroniza shell aberta em outra aba/janela.
    window.dispatchEvent(new CustomEvent('godoutor:nav-accent', { detail: id }));
  } catch {
    /* storage indisponível — o preset segue padrão */
  }
}
