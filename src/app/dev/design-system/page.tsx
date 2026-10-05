import { notFound } from 'next/navigation';
import { DesignSystemCatalog } from './catalog';

// Catálogo VIVO do Design System (fora da navegação final).
// Em produção ele não é uma rota pública: exige `?dev=1` explícito.
export const dynamic = 'force-dynamic';

export default function DesignSystemPage({ searchParams }: { searchParams?: { dev?: string } }) {
  if (process.env.NODE_ENV === 'production' && searchParams?.dev !== '1') notFound();
  return <DesignSystemCatalog />;
}
