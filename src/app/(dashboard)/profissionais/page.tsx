'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui';

// CLINICAL STRUCTURE CONSOLIDATION (B1):
// Profissionais deixa de ser rota autônoma de mesmo peso. Gestão unificada vive em /equipe.
// Esta rota permanece como **compatibilidade + redirect**: links antigos, bookmarks e deep-links
// continuam válidos e levam para a fonte única. Nenhum dado ou API foi removido.
export default function ProfissionaisRedirectPage() {
  const router = useRouter();
  const params = useSearchParams();
  const businessId = params.get('b') || '';

  useEffect(() => {
    const target = businessId ? `/equipe?b=${encodeURIComponent(businessId)}#profissionais` : '/equipe';
    router.replace(target);
  }, [businessId, router]);

  const href = businessId ? `/equipe?b=${encodeURIComponent(businessId)}#profissionais` : '/equipe';

  return (
    <div className="bg-white border border-zinc-200 rounded-lg text-center py-12 px-6">
      <p className="font-semibold text-sm">Profissionais agora ficam em Equipe</p>
      <p className="text-sm text-zinc-500 mt-1">A gestão de pessoas foi unificada. Você será redirecionado para a seção de profissionais dentro de Equipe.</p>
      <Link href={href} className="mt-4 inline-block">
        <Button variant="primary" size="sm">Ir para Equipe → Profissionais</Button>
      </Link>
    </div>
  );
}
