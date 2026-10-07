import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { GeistMono } from 'geist/font/mono';
// DS 1.0 — a fonte única de tokens entra PRIMEIRO: `globals.css` (compatibilidade)
// apenas aponta os nomes históricos para `--gd-*`.
import '@/styles/godoutor-design-system.css';
import './globals.css';
import { AuthBootstrap } from '@/components/AuthBootstrap';

// TIPOGRAFIA — uma família só (DS 1.1): **Barlow**, self-hosted, zero requisição
// ao Google em runtime (e nenhuma no BUILD).
//
// Por que `next/font/local` e não `next/font/google` (decisão documentada):
// `next/font/google` baixa a fonte NO BUILD. O ambiente de homologação desta
// missão não tem acesso a fonts.googleapis.com (TLS bloqueado: `curl` falha e o
// `next build` morre em "Failed to fetch `Barlow` from Google Fonts"), o que
// tornaria o gate de build e TODA a evidência visual irreproduzíveis fora de uma
// máquina com rede aberta. Os arquivos OFL da própria Barlow foram vendorizados
// em `src/app/fonts/barlow/` (origem: pacote `@fontsource/barlow`, licença em
// `OFL.txt`), e o resultado é o mesmo do `next/font/google`: self-host, preload,
// `swap`, fallback métrico — e agora também buildável offline.
//
// Barlow entra pelos pesos que a escala usa (400/500/600/700); 700 é exceção de
// hierarquia, não padrão. Numerais tabulares (`tabular-nums`) continuam valendo:
// a Agenda depende disso para alinhar horários.
const sans = localFont({
  src: [
    { path: './fonts/barlow/barlow-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/barlow/barlow-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/barlow/barlow-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/barlow/barlow-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  preload: true,
  variable: '--font-barlow',
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
