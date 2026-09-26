const path = require('path');
const fs = require('fs');

const mockFont = path.join(__dirname, 'next-font-mocks.js');
if (!process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES && fs.existsSync(mockFont)) {
  process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = mockFont;
}

/**
 * ROTAS LEGADAS → CANÔNICAS (A1.2 · Bloco 1 · §5)
 * ═══════════════════════════════════════════════════════════════
 * A fonte única deste mapa é `src/lib/panel.ts` → `LEGACY_ROUTES`. Um teste
 * (src/lib/__tests__/panel.test.ts) lê este arquivo e reprova o build se
 * alguma entrada do catálogo ficar sem redirect — ou vice-versa.
 *
 * Por que redirect e não página antiga redirecionando sozinha:
 *   • bookmark, link externo e histórico de e-mail continuam funcionando;
 *   • SEO/canônico: 308 (permanente, preserva método) diz ao crawler que a
 *     porta mudou de nome para sempre;
 *   • a URL canônica passa a ser a ÚNICA que renderiza — nunca duas portas
 *     para a mesma tela.
 *
 * Query strings são preservadas automaticamente pelo Next (`?b=<unidade>`,
 * `?period=`, `?organization=`), então trocar de unidade sobrevive ao rename.
 * Quando o destino já traz query própria (`/canais?tab=integracoes`), o Next
 * mantém os dois conjuntos e o destino vence em caso de chave repetida.
 *
 * As rotas antigas deixam de existir como páginas (a pasta foi renomeada),
 * portanto NÃO há arquivo que precise ser mantido — só o redirect.
 */
const LEGACY_REDIRECTS = [
  { from: '/horarios', to: '/disponibilidade' },
  { from: '/whatsapp', to: '/conversas' },
  { from: '/esteira', to: '/funil' },
  { from: '/integracoes', to: '/canais?tab=integracoes' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    instrumentationHook: true,
  },
  async redirects() {
    // F3 — home de Automação em `/automacao` (nome do briefing) → tela canônica
    // `/automacoes`. Alias de URL, não é rota nova do catálogo (sem porta órfã).
    const aliases = [
      { source: '/automacao', destination: '/automacoes', permanent: true },
    ];
    return [
      ...aliases,
      ...LEGACY_REDIRECTS.map(({ from, to }) => ({
        source: from,
        destination: to,
        // permanent: true → 308 (preserva método e corpo; 301 poderia virar GET).
        permanent: true,
      })),
    ];
  },
};
module.exports = nextConfig;
