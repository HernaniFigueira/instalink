'use client';
// ═══════════════════════════════════════════════════════════════
// WORKSPACE SHEET — GoDoutor UI Revolution · Etapa B
// ═══════════════════════════════════════════════════════════════
// O "slider" do painel (referência conceitual: Bitrix24). UM componente para
// qualquer fluxo lateral do produto — hoje Conversas; amanhã detalhe do
// paciente, atendimento, agendamento, tarefas e notificações trocam apenas
// `children` e `title`. Nenhuma tela reimplementa drawer.
//
// Comportamento garantido (briefing):
//   • abre pela direita com animação de 180ms (DS 1.0 · §15; saída simétrica);
//   • NUNCA cobre a topbar (top: --topbar-h + --sheet-gap) nem a sidebar
//     (largura limitada por --sheet-left, medido em runtime pelo shell);
//   • margem de --sheet-gap (14px) nas extremidades, raio e sombra elegantes;
//   • backdrop discreto (não apaga o contexto de operação);
//   • ESC fecha; foco entra no título; Tab fica contido (lib/dialog-focus);
//     ao fechar o foco VOLTA para o elemento que abriu;
//   • `prefers-reduced-motion` zera a animação (ver CSS).
//
// Cabeçalho: título · ação opcional "abrir página completa" · minimizar
// (quando `minimizable`). Fechar = X padrão no canto superior direito
// (herdado por TODO sheet) + ESC. Minimizar NÃO desmonta o conteúdo: o
// sheet vira uma pílula ancorada no canto e o estado interno é preservado.
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { WORKSPACE_SHEET_SIZES } from '@/lib/workspace-sheet-sizes';
import { wrapDialogFocus } from '@/lib/dialog-focus';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/scroll-lock';
import { isTopOverlay, popOverlay, pushOverlay } from '@/lib/overlay-stack';
import { useOverlayDismissGuard, type DismissGuardState, type DismissReason } from './OverlayDismissGuard';
import { CloseButton } from '@/components/ui';

// DS 1.0 · §15 — janela de movimento do sistema é 140–180ms (ease-out). A
// entrada/saída do sheet vivia em 200ms; entra na janela sem virar animação
// decorativa (o tempo de saída acompanha, e prefers-reduced-motion zera).
const MOTION_MS = 180;

const SHEET_WIDTH_PRESETS: Record<string, string> = {
  'max-w-xs': '20rem', 'max-w-sm': '24rem',
  [WORKSPACE_SHEET_SIZES.compact]: '28rem',
  [WORKSPACE_SHEET_SIZES.nestedForm]: '32rem', 'max-w-xl': '36rem',
  [WORKSPACE_SHEET_SIZES.standard]: '42rem',
  'max-w-3xl': '48rem', [WORKSPACE_SHEET_SIZES.wide]: '56rem',
  'max-w-5xl': '64rem',
};

function sheetWidthValue(width?: string): string {
  if (!width) return '640px';
  const arbitrary = width.match(/^max-w-\[(.+)\]$/);
  return arbitrary?.[1] || SHEET_WIDTH_PRESETS[width] || width;
}

function motionMs(): number {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : MOTION_MS;
  } catch { return MOTION_MS; }
}

export function WorkspaceSheet({ open, onClose, title, subtitle, icon, fullPageHref, fullPageLabel = 'Abrir página completa', minimizable = false, minimized = false, onMinimizedChange, width, children, footer, dismissGuard }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  /** Destino real da versão em página inteira (só aparece quando informado). */
  fullPageHref?: string;
  fullPageLabel?: string;
  minimizable?: boolean;
  minimized?: boolean;
  onMinimizedChange?: (value: boolean) => void;
  /** Largura desejada; o sheet nunca invade a sidebar/topbar mesmo assim. */
  width?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Optional unsaved/saving contract; read-only sheets retain ordinary dismiss. */
  dismissGuard?: DismissGuardState;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const dismiss = useOverlayDismissGuard();
  const requestClose = (reason: DismissReason) => dismiss.requestClose(reason, dismissGuard, closeNow);

  // Abre/fecha com animação de saída; preserva e devolve o foco.
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    // Lock compartilhado: sheets empilhados NÃO guardam overflow próprio.
    lockBodyScroll(element);
    element.showModal();
    // Pilha compartilhada: um sheet SOBRE outro (cadastro por cima do
    // agendamento) é o do TOPO; o de baixo não responde a Escape/Tab.
    pushOverlay(element);
    heading.current?.focus({ preventScroll: true });

    // Conteúdo assíncrono pode remover o controle focado do DOM: o foco volta
    // para o título em vez de escapar para trás do véu.
    const contain = () => {
      if (element.open && !element.contains(document.activeElement)) {
        heading.current?.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(contain);
    observer.observe(element, { childList: true, subtree: true });
    document.addEventListener('focusin', contain);

    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', contain);
      clearTimeout(timer.current);
      popOverlay(element);
      element.close();
      unlockBodyScroll(element);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  function closeNow() {
    if (closing) return;
    setClosing(true);
    timer.current = setTimeout(() => {
      setClosing(false);
      onClose();
    }, motionMs());
  }

  function toggleMinimized() {
    onMinimizedChange?.(!minimized);
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialog}
      className="ws-sheet"
      data-closing={closing || undefined}
      data-minimized={minimized || undefined}
      style={{ '--sheet-w': sheetWidthValue(width) } as React.CSSProperties}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        // O <dialog> nativo só manda cancel para o de CIMA; a pilha garante o
        // mesmo contrato quando a camada de baixo tem handler próprio.
        if (isTopOverlay(e.currentTarget)) requestClose('escape');
      }}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose('backdrop'); }}
      onKeyDown={(e) => {
        wrapDialogFocus(e, e.currentTarget, heading.current);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose('escape'); }
      }}
    >
      <div className="ws-sheet__inner">
        <header className="ws-sheet__header">
          {icon && (
            <span className="ws-sheet__icon" aria-hidden="true"><Icon n={icon} size={17} /></span>
          )}
          <div className="ws-sheet__titles">
            <h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2>
            {subtitle && !minimized && <p className="ws-sheet__sub">{subtitle}</p>}
          </div>

          <div className="ws-sheet__actions">
            {fullPageHref && !minimized && (
              <Link className="ws-sheet__fullpage" href={fullPageHref}>
                <Icon n="external" size={14} /> {fullPageLabel}
              </Link>
            )}
            {minimizable && (
              <button
                type="button"
                className="ws-sheet__icon-button"
                aria-label={minimized ? `Restaurar ${title}` : `Minimizar ${title}`}
                title={minimized ? 'Restaurar' : 'Minimizar'}
                onClick={toggleMinimized}
              >
                <Icon n={minimized ? 'expand' : 'minimize'} size={16} />
              </button>
            )}
            {/* DS 1.0 · §4 — fechar = o CloseButton CANÔNICO (neutro, um só em
                todo o sistema). O "X vermelho" herdado por todos os sheets foi
                eliminado: fechar não é ação destrutiva. */}
            <CloseButton
              className="ws-sheet__close"
              label={`Fechar ${title}`}
              onClick={() => requestClose('close-button')}
            />
          </div>
        </header>

        <div className="ws-sheet__body ws-scroll">{children}</div>
        {footer && !minimized && <div className="ws-sheet__footer">{footer}</div>}
      </div>
      {dismiss.dialog}
    </dialog>
  );
}
