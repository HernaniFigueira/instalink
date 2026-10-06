'use client';
// ═══════════════════════════════════════════════════════════════
// NAVEGAÇÃO · PAINEL LATERAL DE GRUPO (§15–§18 do DS 1.0)
// ═══════════════════════════════════════════════════════════════
// Um GRUPO da navegação (Clínica/Automação/Gestão/Configurações) NÃO abre um
// acordeão dentro da coluna (acabou o reflow que empurrava os filhos e o resto
// da lista). Ele abre um PAINEL LATERAL à direita:
//
//   • posição: sempre abaixo da top bar, ancorado na borda da navegação —
//     quem calcula isso é o CSS por token (`--gd-topbar-h`, `--gd-rail-w`,
//     `--gd-sidebar-w`); este hook não mede DOM;
//   • vale nos DOIS modos: rail recolhido E sidebar expandida (pin). O painel
//     nunca altera o estado persistido da navegação;
//   • abre por hover E por foco (teclado), com o MESMO contrato de tempo;
//   • fecha no Escape, na troca de rota, no clique em item e ao perder
//     hover/foco por `PEEK_CLOSE_MS` (tempo de trânsito do mouse).
//
// Contrato de tempo (travado por teste):
//   • abertura: ~180ms ease-out (janela 140–180ms — §15);
//   • fechamento: 250–300ms DEPOIS do mouseleave (trânsito mouse ↔ painel);
//   • `prefers-reduced-motion`: a animação de entrada sai (CSS).
import { useCallback, useEffect, useRef, useState } from 'react';

export const PEEK_CLOSE_MS = 275;      // janela 250–300ms
export const PEEK_ANIM_MS = 180;       // janela 140–180ms (§15)
export const PEEK_ANIM_EASE = 'ease-out';

export interface SidebarPeekState {
  /** Grupo aberto no painel lateral (id da área) ou null. */
  peekId: string | null;
  /** Hover/focus começou num grupo — abre (ou renova) o painel. */
  onGroupEnter: (id: string) => void;
  /** Hover/focus saiu — agenda o fechamento (250–300ms). */
  onGroupLeave: () => void;
  /** Hover entrou no próprio painel — mantém aberto. */
  onPeekEnter: () => void;
  /** Hover saiu do painel — fecha no mesmo tempo do grupo. */
  onPeekLeave: () => void;
  /** Fecha na hora (clique em item, Escape, troca de rota). */
  closePeek: () => void;
  /**
   * Clique no grupo: TRAVA/destrava o painel.
   *   • fechado → abre e trava (fica mesmo com mouseleave);
   *   • aberto solto (hover) → trava;
   *   • aberto e travado → fecha.
   * NUNCA expande/recolhe a navegação — o rail não tem pin.
   */
  togglePeek: (id: string) => void;
  /**
   * Teclado: abre e TRAVA o painel do grupo (↑/↓/Enter no botão do grupo).
   * O foco entra nos destinos, então o painel não pode fechar ao sair do
   * botão — quem fecha é Escape/← ou a troca de rota.
   */
  pinPeek: (id: string) => void;
}

export function useSidebarPeek(): SidebarPeekState {
  // `pinned` = painel travado pelo CLIQUE (sobrevive a mouseleave).
  const [peek, setPeek] = useState<{ id: string; pinned: boolean } | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onGroupEnter = useCallback((id: string) => {
    clear();
    // hover mantém/abre SOLTO; nunca destrava um painel travado pelo clique.
    setPeek((prev) => (prev?.id === id ? prev : { id, pinned: false }));
  }, [clear]);

  const scheduleClose = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => {
      // painel travado pelo clique NÃO fecha no mouseleave.
      setPeek((prev) => (prev?.pinned ? prev : null));
      timer.current = null;
    }, PEEK_CLOSE_MS);
  }, [clear]);

  const closePeek = useCallback(() => {
    clear();
    setPeek(null);
  }, [clear]);

  // Escape fecha (teclado) — o painel nunca captura o foco: os itens seguem
  // tabuláveis e o botão do grupo mantém o foco.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { clear(); setPeek(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear]);

  // Nunca vaza timer entre desmontagens.
  useEffect(() => clear, [clear]);

  const togglePeek = useCallback((id: string) => {
    clear();
    setPeek((prev) => {
      if (prev?.id === id) {
        // solto → trava; travado → fecha.
        return prev.pinned ? null : { id, pinned: true };
      }
      return { id, pinned: true };
    });
  }, [clear]);

  const pinPeek = useCallback((id: string) => {
    clear();
    setPeek({ id, pinned: true });
  }, [clear]);

  return {
    peekId: peek?.id ?? null,
    togglePeek,
    pinPeek,
    onGroupEnter,
    onGroupLeave: scheduleClose,
    onPeekEnter: clear,
    onPeekLeave: scheduleClose,
    closePeek,
  };
}
