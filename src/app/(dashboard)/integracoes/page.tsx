'use client';

import { useSearchParams } from 'next/navigation';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { IntegracoesView } from '@/components/dashboard/IntegracoesView';

export default function IntegracoesPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const { denied } = useAreaLoad('Configurações');

  if (denied) return <AccessDenied area="Configurações" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-semibold text-zinc-900">Integrações com Sites Externos</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Conecte qualquer site, formulário ou landing page ao motor do InstaLink via API, Webhooks ou Widget de agendamento.
        </p>
      </div>

      <IntegracoesView />
    </div>
  );
}
