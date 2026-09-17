'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { CanaisIntegracoesView } from '@/components/dashboard/CanaisIntegracoesView';
import { IntegracoesView } from '@/components/dashboard/IntegracoesView';
import { WhatsappChannelPanel } from '@/components/dashboard/WhatsappChannelPanel';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════
// CANAIS & INTEGRAÇÕES — porta única das conexões
// ═══════════════════════════════════════════════════════════════
// Antes este território tinha TRÊS portas para a mesma coisa: a rota
// /integracoes, a aba "Integrações" de Configurações e a aba "Canais" de
// Configurações. Navegação paralela é o caminho mais curto para duas verdades
// diferentes — então agora existe UMA porta, com três abas REAIS e exclusivas:
//
//   CANAIS        → por onde se conversa (WhatsApp + provedores de canal)
//   FONTES        → de onde o lead chega (formulário, landing, QR…)
//   INTEGRAÇÕES   → por onde os dados viajam (provedores técnicos, eventos
//                   recebidos, chaves de API, webhooks de saída e widget)
//
// A aba vive na URL (?tab=), então o redirect de /integracoes chega no lugar
// certo e qualquer link continua compartilhável. Configurações deixa de ter
// abas de canais/integrações e passa a apontar para cá.
type CanaisTab = 'canais' | 'fontes' | 'integracoes';

const TABS: Array<[CanaisTab, string]> = [
  ['canais', 'Canais'],
  ['fontes', 'Fontes'],
  ['integracoes', 'Integrações'],
];

function tabFromParam(value: string | null): CanaisTab {
  return TABS.some(([id]) => id === value) ? (value as CanaisTab) : 'canais';
}

export default function CanaisPage() {
  const router = useRouter();
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [tab, setTab] = useState<CanaisTab>(() => tabFromParam(params.get('tab')));
  const { denied } = useAreaLoad('Canais & Integrações');

  /** Aba = URL (mantém a unidade ativa e o histórico do navegador coerente). */
  function choose(next: CanaisTab) {
    if (next === tab) return;
    setTab(next);
    const qs = new URLSearchParams();
    qs.set('tab', next);
    if (businessId) qs.set('b', businessId);
    router.replace(`/canais?${qs.toString()}`, { scroll: false });
  }

  if (denied) return <AccessDenied area="Canais & Integrações" />;

  return (
    <>
      <div className="mb-4">
        <h1 className="text-base font-semibold text-zinc-900">Canais &amp; Integrações</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Por onde o cliente fala com você, de onde ele chega e como outros sistemas se conectam.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-md mb-4 w-fit max-w-full" role="tablist" aria-label="Seções de Canais & Integrações">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`canais-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`canais-panel-${id}`}
            onClick={() => choose(id)}
            className={cn(
              'text-xs font-medium px-3 py-1.5 rounded whitespace-nowrap',
              tab === id ? 'bg-white shadow-sm border border-zinc-200 text-zinc-900' : 'text-zinc-500',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`canais-panel-${tab}`} aria-labelledby={`canais-tab-${tab}`}>
        {tab === 'canais' && (
          <div className="space-y-4">
            <WhatsappChannelPanel businessId={businessId} />
            <CanaisIntegracoesView only="channel" />
          </div>
        )}
        {tab === 'fontes' && <CanaisIntegracoesView only="source" />}
        {tab === 'integracoes' && (
          <div className="space-y-4">
            <CanaisIntegracoesView only="technical" />
            <IntegracoesView />
          </div>
        )}
      </div>
    </>
  );
}
