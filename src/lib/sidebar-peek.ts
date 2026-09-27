'use client';
// ═══════════════════════════════════════════════════════════════
// SIDEBAR RECOLHIDA · HOVER-PEEK DE GRUPOS (§7)
// ═══════════════════════════════════════════════════════════════
// Quando a sidebar está RECOLHIDA:
//   • ROTA direta no hover = só tooltip (nada muda);
//   • GRUPO expansível (Clínica/Automação/Gestão/Configurações) no hover =
//     peek TEMPORÁRIO com os itens do grupo, ao lado do rail.
//
// Contrato de tempo (travado por teste):
//   • abertura: aparece em 150–200ms (animação ease-out de ~200ms);
//   • fechamento: recolhe 250–300ms DEPOIS do mouseleave (tempo de trânsito
//     do mouse para dentro do peek) — ~275ms;
//   • o peek NUNCA altera o estado `collapsed` persistido — o botão
//     Recolher/Expandir é a ÚNICA preferência persistente;
//   • expandida (acordeão), hover não abre peek nenhum.
import { useCallback, useEffect, useRef, useState } from 'react';

export const PEEK_CLOSE_MS = 275;      // janela 250–300ms
export const PEEK_ANIM_MS = 200;       // janela 180–220ms (CSS)
export const PEEK_ANIM_EASE = 'ease-out';

export interface SidebarPeekState {
  /** Grupo aberto em peek (id da área) ou null. */
  peekId: string | null;
  /** Posição vertical (px de viewport) para ancorar o peek. */
  peekTop: number;
  /** Hover começou num grupo (mini) — abre/renova o peek. */
  onGroupEnter: (id: string, top: number) => void;
  /** Hover saiu — agenda o fechamento (250–300ms). */
  onGroupLeave: () => void;
  /** Hover entrou no próprio peek — mantém aberto. */
  onPeekEnter: () => void;
  /** Hover saiu do peek — fecha no mesmo tempo do grupo. */
  onPeekLeave: () => void;
  /** Fecha na hora (clique/foco/Escape). */
  closePeek: () => void;
}

export function useSidebarPeek(collapsed: boolean): SidebarPeekState {
  const [peek, setPeek] = useState<{ id: string; top: number } | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onGroupEnter = useCallback((id: string, top: number) => {
    if (!collapsed) return; // expandida = acordeão; nunca peek
    clear();
    setPeek({ id, top });
  }, [collapsed, clear]);

  const scheduleClose = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => {
      setPeek(null);
      timer.current = null;
    }, PEEK_CLOSE_MS);
  }, [clear]);

  const closePeek = useCallback(() => {
    clear();
    setPeek(null);
  }, [clear]);

  // Trocar de rota/recolher apaga o peek imediatamente.
  useEffect(() => {
    if (!collapsed) { clear(); setPeek(null); }
  }, [collapsed, clear]);

  // Nunca vaza timer entre desmontagens.
  useEffect(() => clear, [clear]);

  return {
    peekId: peek?.id ?? null,
    peekTop: peek?.top ?? 0,
    onGroupEnter,
    onGroupLeave: scheduleClose,
    onPeekEnter: clear,
    onPeekLeave: scheduleClose,
    closePeek,
  };
}
