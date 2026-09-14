import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';
import './globals.css';
import { AuthBootstrap } from '@/components/AuthBootstrap';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const sora = Sora({ subsets: ['latin'], weight: ['600', '700', '800'], display: 'swap', variable: '--font-sora' });

export const metadata: Metadata = {
  title: 'InstaLink.app — Página, agenda e clientes em um link',
  description: 'Transforme o link da bio em atendimento organizado: página, serviços, agenda, clientes, WhatsApp, assistente e resultados.',
  themeColor: '#0e090b',
  openGraph: {
    title: 'InstaLink.app — Página, agenda e clientes em um link',
    description: 'Página, serviços, agenda, clientes, WhatsApp e resultados em um só link.',
    type: 'website',
    locale: 'pt_BR',
    siteName: 'InstaLink.app',
  },
  twitter: {
    card: 'summary',
    title: 'InstaLink.app — Página, agenda e clientes em um link',
    description: 'Página, serviços, agenda, clientes, WhatsApp e resultados em um só link.',
  },
};

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
