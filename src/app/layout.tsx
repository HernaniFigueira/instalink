import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { GeistMono } from 'geist/font/mono';
// DS 1.0 — a fonte única de tokens entra PRIMEIRO: `globals.css` (compatibilidade)
// apenas aponta os nomes históricos para `--gd-*`.
import '@/styles/godoutor-design-system.css';
import './globals.css';
import { AuthBootstrap } from '@/components/AuthBootstrap';

// TIPOGRAFIA — uma família só (camada visual PR #69): **Inter**, self-hosted.
// Decisão fixa da missão visual (VISUAL-EXECUTION-PACK-SHADCN-NOVA, 00/08):
// Inter entra no preview como fonte única do produto. Os woff2 (OFL, origem
// `@fontsource/inter` / gate da PR) ficam vendorizados em `src/app/fonts/inter/`
// — zero requisição ao Google em runtime e nenhuma no BUILD.
// Pesos da escala: 400 (value/helper), 500 (value/meta), 600 (title/label), 700
// (só título de página). Numerais tabulares continuam valendo na Agenda.
const sans = localFont({
  src: [
    { path: './fonts/inter/inter-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter/inter-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter/inter-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/inter/inter-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  preload: true,
  variable: '--font-inter',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
});
// Mono continua Geist Mono (pacote `geist`): nosso único uso de mono é código/
// identificador em páginas de compatibilidade; trocá-lo não muda a interface.
const mono = GeistMono;

export const metadata: Metadata = {
  title: 'GoDoutor — o sistema da sua clínica',
  description: 'Da primeira conversa ao próximo atendimento: WhatsApp, agenda, pacientes, financeiro e equipe em um só lugar.',
  openGraph: {
    title: 'GoDoutor — o sistema da sua clínica',
    description: 'Agenda, pacientes, equipe e operação clínica em um só lugar.',
    type: 'website',
    locale: 'pt_BR',
    siteName: 'GoDoutor',
  },
  twitter: {
    card: 'summary',
    title: 'GoDoutor — Sua clínica organizada',
    description: 'Agenda, pacientes, equipe e operação clínica em um só lugar.',
  },
};

export const viewport: Viewport = { themeColor: '#f8fafc' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AuthBootstrap />
        {children}
      </body>
    </html>
  );
}
