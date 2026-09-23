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
//   • abre pela direita com animação de 200ms (e saída simétrica);
//   • NUNCA cobre a topbar (top: --topbar-h + --sheet-gap) nem a sidebar
//     (largura limitada por --sheet-left, medido em runtime pelo shell);
//   • margem de --sheet-gap (14px) nas extremidades, raio e sombra elegantes;
//   • backdrop discreto (não apaga o contexto de operação);
//   • ESC fecha; foco entra no título; Tab fica contido (lib/dialog-focus);
//     ao fechar o foco VOLTA para o elemento que abriu;
//   • `prefers-reduced-motion` zera a animação (ver CSS).
//
// Cabeçalho: título · ação opcional "abrir página completa" · minimizar
// (quando `minimizable`) · X de fechar. Minimizar NÃO desmonta o conteúdo: o
// sheet vira uma pílula ancorada no canto e o estado interno é preservado.
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { wrapDialogFocus } from '@/lib/dialog-focus';

const MOTION_MS = 200;

function motionMs(): number {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : MOTION_MS;
  } catch { return MOTION_MS; }
}

export function WorkspaceSheet({ open, onClose, title, subtitle, icon, fullPageHref, fullPageLabel = 'Abrir página completa', minimizable = false, minimized = false, onMinimizedChange, width, children, footer }: {
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
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [closing, setClosing] = useState(false);
  const titleId = useId();

  // Abre/fecha com animação de saída; preserva e devolve o foco.
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
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
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  function close() {
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
      style={width ? ({ '--sheet-w': width } as React.CSSProperties) : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => {
        wrapDialogFocus(e, e.currentTarget, heading.current);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
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
            <button
              type="button"
              className="ws-sheet__icon-button ws-sheet__close"
              aria-label={`Fechar ${title}`}
              title="Fechar (Esc)"
              onClick={close}
            >
              <Icon n="x" size={17} />
            </button>
          </div>
        </header>

        <div className="ws-sheet__body ws-scroll">{children}</div>
        {footer && !minimized && <div className="ws-sheet__footer">{footer}</div>}
      </div>
    </dialog>
  );
}
