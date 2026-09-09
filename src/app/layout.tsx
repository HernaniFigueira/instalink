import type { Metadata } from 'next';
import './globals.css';
import { AuthBootstrap } from '@/components/AuthBootstrap';

export const metadata: Metadata = {
  title: 'InstaLink.app — Seu negócio inteiro em um link',
  description: 'Transforme o link da bio em uma estrutura comercial: página, catálogo, pedidos, agenda, WhatsApp, IA e resultados.',
  themeColor: '#0e090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthBootstrap />
        {children}
      </body>
    </html>
  );
}
