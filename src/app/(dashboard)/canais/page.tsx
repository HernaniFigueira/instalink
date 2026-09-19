'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { CanaisIntegracoesView } from '@/components/dashboard/CanaisIntegracoesView';
import { IntegracoesView } from '@/components/dashboard/IntegracoesView';
import { WhatsappChannelPanel } from '@/components/dashboard/WhatsappChannelPanel';
import { InstagramChannelPanel } from '@/components/dashboard/InstagramChannelPanel';
import { PageHeader, Tabs } from '@/components/ui';

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

/** Ícone de cada aba — a seção é reconhecível sem ler o rótulo. */
const TAB_ICON: Record<CanaisTab, string> = {
  canais: 'chat',
  fontes: 'spark',
  integracoes: 'plugs',
};

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
  // Aba = URL, derivada a cada render (A1.2 · Bloco 2): refresh preserva a
  // aba, botão voltar funciona, deep-link abre na aba certa — sem estado
  // paralelo para dessincronizar.
  const tab = tabFromParam(params.get('tab'));
  const { denied } = useAreaLoad('Canais & Integrações');

  /** Aba = URL (mantém a unidade ativa e o histórico do navegador coerente). */
  function choose(next: CanaisTab) {
    if (next === tab) return;
    const qs = new URLSearchParams();
    qs.set('tab', next);
    if (businessId) qs.set('b', businessId);
    router.push(`/canais?${qs.toString()}`, { scroll: false });
  }

  if (denied) return <AccessDenied area="Canais & Integrações" />;

  return (
    <>
      <PageHeader
        icon="plugs"
        title="Canais & Integrações"
        hint="Por onde o cliente fala com você, de onde ele chega e como outros sistemas se conectam."
      />

      {/* A3.3 — abas em pill (padrão único de navegação interna do painel).
          `aria-controls`/`id` continuam ligando aba e painel para leitor de tela. */}
      <div className="mb-4">
        <Tabs
          items={TABS.map(([id, label]) => ({ id, label, icon: TAB_ICON[id] }))}
          value={tab}
          onChange={(id) => choose(id)}
          ariaLabel="Seções de Canais & Integrações"
        />
      </div>

      <div role="tabpanel" id={`canais-panel-${tab}`} aria-labelledby={`canais-tab-${tab}`}>
        {tab === 'canais' && (
          <div className="space-y-4">
            {/* Um painel por CANAL conectável, na ordem do catálogo: cada um
                mostra o seu estado real e o que falta (nada de "em breve"). */}
            <WhatsappChannelPanel businessId={businessId} />
            <InstagramChannelPanel businessId={businessId} />
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
