import type { Theme } from '@/lib/types';

// Corpo + display por fonte. Display (títulos) usa a fonte com personalidade;
// corpo usa ela mesma quando legível, ou Inter quando é display-only.
const BODY: Record<Theme['font'], string> = {
  inter: 'Inter, system-ui, sans-serif',
  rounded: "'Nunito', 'Segoe UI Rounded', system-ui, sans-serif",
  serif: 'Inter, system-ui, sans-serif',
  mono: "'JetBrains Mono', ui-monospace, monospace",
  sora: 'Inter, system-ui, sans-serif',
  space: 'Inter, system-ui, sans-serif',
};

const DISPLAY: Record<Theme['font'], string> = {
  inter: 'Inter, system-ui, sans-serif',
  rounded: "'Nunito', 'Segoe UI Rounded', system-ui, sans-serif",
  serif: "'Playfair Display', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  sora: "'Sora', Inter, system-ui, sans-serif",
  space: "'Space Grotesk', Inter, system-ui, sans-serif",
};

const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800' +
  '&family=JetBrains+Mono:wght@500;700' +
  '&family=Nunito:wght@600;700;800;900' +
  '&family=Playfair+Display:wght@700;800' +
  '&family=Sora:wght@600;700;800' +
  '&family=Space+Grotesk:wght@500;600;700' +
  '&display=swap';

/** Texto do botão com contraste automático (fundo claro → texto escuro). */
export function btnTextFor(hex: string): string {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return '#ffffff';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1c1917' : '#ffffff';
}

export function ThemeStyle({ theme }: { theme: Theme }) {
  const css = `
    --il-primary: ${theme.primary};
    --il-secondary: ${theme.secondary};
    --il-bg: ${theme.background};
    --il-surface: ${theme.surface};
    --il-text: ${theme.text};
    --il-muted: ${theme.muted};
    --il-radius: ${theme.radius}px;
    --il-font: ${BODY[theme.font]};
    --il-display: ${DISPLAY[theme.font]};
    --il-btn-text: ${btnTextFor(theme.primary)};
  `;
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href={GOOGLE_FONTS} rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: `.il-page{${css}}` }} />
    </>
  );
}
