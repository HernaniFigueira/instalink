import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import { AuthBootstrap } from '@/components/AuthBootstrap';

// TIPOGRAFIA — uma família só (Geist Sans), self-hosted pelo pacote `geist`:
//   • nada de duas famílias competindo (Inter + Sora) nem de fetch de fonte;
//   • a interface inteira (títulos, corpo, números) fala a mesma língua;
//   • numerais tabulares onde há número (`tabular-nums`) continuam valendo.
const sans = GeistSans;

export const metadata: Metadata = {
  title: 'GoDoutor — o sistema da sua clínica',
  description: 'Da primeira conversa ao próximo atendimento: WhatsApp, agenda, pacientes, financeiro e equipe em um só lugar.',
  openGraph: {
    title: 'GoDoutor — o sistema da sua clínica',
    description: 'Página da clínica, agenda, pacientes e equipe em um só lugar.',
    type: 'website',
    locale: 'pt_BR',
    siteName: 'GoDoutor',
  },
  twitter: {
    card: 'summary',
    title: 'GoDoutor — Sua clínica organizada',
    description: 'Página da clínica, agenda, pacientes e equipe em um só lugar.',
  },
};

export const viewport: Viewport = { themeColor: '#f8fafc' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={sans.variable}>
      <body>
        <AuthBootstrap />
        {children}
      </body>
    </html>
  );
}
