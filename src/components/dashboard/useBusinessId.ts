'use client';
// ═══════════════════════════════════════════════════════════════
// EMPRESA ATIVA — contexto consistente para as telas do painel
// ═══════════════════════════════════════════════════════════════
// O ?b= da URL continua existindo (compatibilidade e contexto explícito),
// mas NÃO é mais a fonte única e frágil: quando falta (ou aponta para uma
// empresa fora da conta), a tela resolve a empresa ativa pela MESMA fonte
// do DashboardShell — /api/auth/me. Nada de loop "Negócio não informado".
//
// Estados possíveis (a tela decide como apresentar cada um):
//   resolving   → ainda descobrindo a empresa (espera curta);
//   businessId  → empresa resolvida: carregar dados normalmente;
//   noBusiness  → a conta não tem empresa (estado próprio, com CTA);
//   contextError→ falha de rede ao resolver o contexto (tentar de novo
//                 recomeça o ciclo INTEIRO — não é um "Tentar de novo"
//                 decorativo).
// 401 não é tratado aqui: o DashboardShell já conduz o fluxo de sessão.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { resolveActiveBusinessId } from '@/lib/business-context';

export interface ActiveBusiness {
  /** Id da empresa resolvida ('' enquanto resolve ou quando não há). */
  businessId: string;
  /** Ainda resolvendo o contexto (primeira carga ou nova tentativa). */
  resolving: boolean;
  /** A conta autenticada não possui empresa alguma. */
  noBusiness: boolean;
  /** Falha de rede ao resolver o contexto (não é ausência de empresa). */
  contextError: boolean;
  /** Recomeça a resolução do zero (contexto + dados). */
  retry: () => void;
}

export function useBusinessId(): ActiveBusiness {
  const params = useSearchParams();
  const requested = params.get('b') || '';
  const [resolved, setResolved] = useState('');
  const [resolving, setResolving] = useState(true);
  const [noBusiness, setNoBusiness] = useState(false);
  const [contextError, setContextError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // ?b= NUNCA é aceito cegamente: o id precisa constar da lista real de
    // empresas da conta (/api/auth/me — a MESMA fonte do DashboardShell).
    // Constando, ele é usado; não constando (ex.: empresa de outra conta na
    // URL), cai para a empresa ativa válida via resolveActiveBusinessId.
    // URL estranha NÃO vira "Negócio não encontrado" nem logout — só
    // resolve o contexto certo; conta sem empresa vira o estado noBusiness.
    setResolving(true);
    setContextError(false);
    setNoBusiness(false);
    let cancelled = false;
    fetch('/api/auth/me')
      .then(async (r) => {
        if (!r.ok) return null; // 401: o shell conduz; demais: contextError abaixo
        const d = await r.json().catch(() => null);
        if (d && !d.user) return null;
        return d;
      })
      .then((d) => {
        if (cancelled) return;
        if (!d) { setResolving(false); return; } // shell redireciona p/ login
        const list: Array<{ id: string }> = Array.isArray(d.businesses) ? d.businesses : [];
        const id = resolveActiveBusinessId(requested, list);
        if (id) setResolved(id);
        else setNoBusiness(true);
        setResolving(false);
      })
      .catch(() => {
        if (cancelled) return;
        setContextError(true);
        setResolving(false);
      });
    return () => { cancelled = true; };
  }, [requested, attempt]);

  const retry = useCallback(() => {
    setResolved('');
    setNoBusiness(false);
    setContextError(false);
    setResolving(true);
    setAttempt((a) => a + 1);
  }, []);

  return { businessId: resolved, resolving, noBusiness, contextError, retry };
}
