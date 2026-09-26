/** @type {import('tailwindcss').Config} */
// ═══════════════════════════════════════════════════════════════
// TAILWIND ↔ DESIGN SYSTEM (A3.3)
// ═══════════════════════════════════════════════════════════════
// Nada de cor hardcoded por tela: as classes utilitárias abaixo são
// APELIDOS dos tokens CSS de src/app/globals.css. Trocar o token troca o
// sistema inteiro.
//
// `zinc` é REDEFINIDO de propósito: é a escala neutra do produto (fria e
// suave), então todo o código que já usa `bg-zinc-900`/`text-zinc-500`
// herda o novo neutro sem precisar de remendo por tela.
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // §4 — a tipografia interna é Geist Sans, e só ela. "Inter" não é
        // carregada em lugar nenhum: mantê-la aqui fazia `font-sans` cair no
        // system-ui e a tela trocar de letra sem ninguém perceber.
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        // Neutros do produto (frio, suave, com contraste de estado).
        zinc: {
          50: "#f7f9fd",
          100: "#f0f3fa",
          200: "#e4e8f3",
          300: "#d2d9e8",
          400: "#a7b0c7",
          500: "#79839b",
          600: "#5a6480",
          700: "#454e68",
          800: "#2d3449",
          900: "#1b2135",
          950: "#10141f",
        },
        // Estrutura
        canvas: "var(--bg)",
        "canvas-tint": "var(--bg-tint)",
        panel: {
          DEFAULT: "var(--surface)",
          soft: "var(--surface-2)",
          sunken: "var(--surface-3)",
          hover: "var(--surface-hover)",
        },
        line: {
          DEFAULT: "var(--border)",
          soft: "var(--border-soft)",
          strong: "var(--border-strong)",
        },
        ink: {
          DEFAULT: "var(--text)",
          strong: "var(--text-strong)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)",
        },
        // Ação
        brand: {
          DEFAULT: "var(--brand)",
          strong: "var(--brand-strong)",
          soft: "var(--brand-soft)",
          softer: "var(--brand-softer)",
          border: "var(--brand-border)",
          fg: "var(--brand-fg)",
        },
        // Estado
        ok: {
          DEFAULT: "var(--success)",
          strong: "var(--success-strong)",
          soft: "var(--success-bg)",
          border: "var(--success-border)",
          fg: "var(--success-fg)",
        },
        info: {
          DEFAULT: "var(--info)",
          strong: "var(--info-strong)",
          soft: "var(--info-bg)",
          border: "var(--info-border)",
          fg: "var(--info-fg)",
        },
        // Atenção
        warn: {
          DEFAULT: "var(--warning)",
          strong: "var(--warning-strong)",
          soft: "var(--warning-bg)",
          border: "var(--warning-border)",
          fg: "var(--warning-fg)",
        },
        // Destrutivo
        bad: {
          DEFAULT: "var(--danger)",
          strong: "var(--danger-strong)",
          soft: "var(--danger-bg)",
          border: "var(--danger-border)",
          fg: "var(--danger-fg)",
        },
        // Apoio
        lilac: {
          DEFAULT: "var(--lilac)",
          strong: "var(--lilac-strong)",
          soft: "var(--lilac-bg)",
          border: "var(--lilac-border)",
          fg: "var(--lilac-fg)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        DEFAULT: "var(--shadow-sm)",
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        brand: "var(--shadow-brand)",
        inset: "var(--shadow-inset)",
        focus: "var(--focus-ring)",
      },
    },
  },
  plugins: [],
};
