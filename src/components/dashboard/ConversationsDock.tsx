'use client';
// ═══════════════════════════════════════════════════════════════
// CONVERSAS NO WORKSPACE SHEET — GoDoutor UI Revolution · Etapa B
// ═══════════════════════════════════════════════════════════════
// O antigo botão flutuante colado na borda virou um DOCK refinado (pílula com
// acento cyan de comunicação) e o inbox abre no Workspace Sheet — o mesmo
// componente que servirá paciente/atendimento/agendamento/tarefas depois.
//
// Preservado da base (nada disso é cosmético):
//   • a página completa /conversas continua intacta (link "Abrir página
//     completa" no cabeçalho do sheet);
//   • navegar para outra rota fecha o sheet;
//   • não abre por cima de outro diálogo já aberto;
//   • foco contido e devolvido ao elemento que abriu (dentro do sheet).
//
// Minimize NÃO desmonta o ConversationsView: a conversa em andamento sobrevive
// à pílula minimizada (comportamento de slider de aplicação, não de modal).
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/icons';
import { ConversationsView } from './ConversationsView';
import { WorkspaceSheet } from './WorkspaceSheet';

export function ConversationsDock({ businessId }: { businessId: string }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [visited, setVisited] = useState(false);
  const path = usePathname();

  // Navegar troca o contexto de operação: o sheet sai junto.
  useEffect(() => { setOpen(false); setMinimized(false); }, [path]);

  return (
    <>
      <button
        type="button"
        data-conversations-open
        className="conversation-shortcut"
        aria-label="Abrir painel de Conversas"
        aria-expanded={open}
        onClick={() => {
          if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
          setVisited(true);
          setMinimized(false);
          setOpen(true);
        }}
      >
        <span className="conversation-shortcut__icon" aria-hidden="true"><Icon n="inbox" size={16} /></span>
        <span>Conversas</span>
      </button>

      <WorkspaceSheet
        open={open}
        onClose={() => { setOpen(false); setMinimized(false); }}
        title="Conversas"
        subtitle="As mensagens dos clientes em um só lugar"
        icon="inbox"
        fullPageHref={`/conversas?b=${businessId}`}
        minimizable
        minimized={minimized}
        onMinimizedChange={setMinimized}
        width="clamp(720px, 72vw, 1400px)"
      >
        <div className="p-4 h-full min-h-0">
          {visited && <ConversationsView unitId={businessId} panel />}
        </div>
      </WorkspaceSheet>
    </>
  );
}
