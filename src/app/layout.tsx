import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import './globals.css';
import { AuthBootstrap } from '@/components/AuthBootstrap';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const sora = Sora({ subsets: ['latin'], weight: ['600', '700', '800'], display: 'swap', variable: '--font-sora' });

export const metadata: Metadata = {
  title: 'GoDoutor — Sua clínica organizada',
  description: 'Da primeira reserva ao próximo atendimento: página da clínica, agenda, pacientes e equipe em um só lugar.',
  openGraph: {
    title: 'GoDoutor — Sua clínica organizada',
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

export const viewport: Viewport = { themeColor: '#f7f7f4' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${sora.variable}`}>
      <body>
        <AuthBootstrap />
        {children}
      </body>
    </html>
  );
}
