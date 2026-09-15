'use client';
// ═══════════════════════════════════════════════════════════════
// REVALIDAÇÃO AO VOLTAR PARA A TELA (P2)
// ═══════════════════════════════════════════════════════════════
// Motivação (Acesso do Profissional): a secretária registra a chegada /
// confirma o atendimento, e quem atende precisa VER isso sem apertar F5.
// A arquitetura atual não tem tempo real (nada de websocket/socket novo), então
// usamos o mecanismo mais simples que existe: quando a aba volta a ficar
// visível/em foco, recarregamos os dados UMA vez.
//
// Regras:
//   • nada de polling: só quando a pessoa volta para a tela;
//   • intervalo mínimo (padrão 20s) para não repetir chamadas em sequência;
//   • nunca dispara com a aba em segundo plano;
//   • a função chamada é a MESMA que já carrega a tela (não existe caminho novo).
import { useEffect, useRef } from 'react';

export function useRevalidateOnFocus(run: () => void, minMs = 20000) {
  const runRef = useRef(run);
  const last = useRef(0);

  useEffect(() => { runRef.current = run; }, [run]);

  useEffect(() => {
    function maybe() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - last.current < minMs) return;
      last.current = now;
      runRef.current();
    }
    // `focus` cobre voltar para a janela; `visibilitychange` cobre trocar de aba.
    window.addEventListener('focus', maybe);
    document.addEventListener('visibilitychange', maybe);
    return () => {
      window.removeEventListener('focus', maybe);
      document.removeEventListener('visibilitychange', maybe);
    };
  }, [minMs]);
}
