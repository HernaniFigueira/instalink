'use client';
// ═══════════════════════════════════════════════════════════════
// PERMISSÕES DA UNIDADE ATIVA — projeção client-side (A1.2 · Bloco 2)
// ═══════════════════════════════════════════════════════════════
// Para a UI concordar com os guards (nunca oferecer uma porta que o servidor
// vai negar com 403), algumas telas precisam saber as permissões do usuário
// na unidade ativa ANTES de renderizar um atalho. A fonte é a MESMA do
// DashboardShell (/api/auth/me) — pelo MESMO loader compartilhado
// (`lib/session-me`), para a mesma informação não ser buscada duas vezes na
// mesma navegação por consumidores diferentes (shell, unidade ativa, este).
//
// REGRA DE SEGURANÇA: isto é APENAS apresentação. Esconder um link sem
// permissão é UX; a autorização de verdade continua no servidor
// (requireBusiness em cada API). Nunca confie neste hook para proteger dado.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { readLastBusinessId, resolveActiveBusinessId } from '@/lib/business-context';
import { loadMe } from '@/lib/session-me';
import type { PermissionId } from '@/lib/types';

interface MePayload {
  user?: { id?: string };
  businesses?: Array<{
    id: string;
    role?: string;
    professionalId?: string;
    professionalName?: string;
    permissions?: Partial<Record<PermissionId, boolean>>;
  }>;
}

async function fetchMe(): Promise<MePayload | null> {
  const res = await loadMe();
  return res.ok ? (res.data as MePayload | null) : null;
}

export interface PanelPermissions {
  /** Permissões do usuário na unidade ativa ({} enquanto resolve). */
  permissions: Partial<Record<PermissionId, boolean>>;
  /**
   * Papel na unidade ativa ('' enquanto resolve). É o MESMO valor que o
   * servidor usa para decidir regras de papel (ex.: reabrir registro de
   * atendimento finalizado) — a tela só evita oferecer o que o servidor
   * negaria.
   */
  role: string;
  /**
   * Professional vinculado NA UNIDADE ATIVA ('' quando não há vínculo).
   * CLINICAL ACCESS: o acesso clínico é da unidade, mas a OPERAÇÃO (agenda,
   * iniciar atendimento) continua do profissional — a tela precisa saber de
   * quem é o agendamento antes de oferecer a ação que o servidor negaria.
   */
  professionalId: string;
  /** Nome do profissional vinculado na unidade ativa, quando houver. */
  professionalName: string;
  /**
   * Unidade ativa já validada contra a sessão. Vazio significa que a pessoa
   * ainda precisa escolher uma unidade; nunca é inferida pela ordem da lista.
   */
  businessId: string;
  /** false enquanto /api/auth/me não chega. */
  ready: boolean;
}

/**
 * Permissões da unidade ativa: `?b=` válido, depois a última unidade lembrada
 * desta conta e, por fim, a única unidade acessível. Com várias unidades sem
 * escolha válida, devolve contexto vazio — nunca assume `businesses[0]`.
 * Um `?b=` que não pertence à conta também nunca concede nada.
 */
export function usePanelPermissions(): PanelPermissions {
  // Null-safe: fora de um provider de router (ex.: render estático de teste,
  // impressão) `useSearchParams()` devolve null — sem permissão resolvida, a
  // UI cai no padrão conservador do consumidor (não derruba o render).
  const params = useSearchParams();
  const requested = params?.get('b') || '';
  const [state, setState] = useState<PanelPermissions>({
    permissions: {}, role: '', ready: false, professionalId: '', professionalName: '', businessId: '',
  });

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((d) => {
      if (cancelled) return;
      const list = Array.isArray(d?.businesses) ? d!.businesses! : [];
      // A unidade lembrada é por usuário. Sem ela (e com 2+ unidades), a
      // projeção permanece vazia até uma escolha explícita — igual ao shell.
      const id = resolveActiveBusinessId(requested, list, readLastBusinessId(d?.user?.id));
      const biz = list.find((b) => b.id === id);
      setState({
        permissions: biz?.permissions || {}, role: biz?.role || '', ready: true,
        professionalId: biz?.professionalId || '',
        professionalName: biz?.professionalName || '',
        businessId: biz?.id || '',
      });
    });
    return () => { cancelled = true; };
  }, [requested]);

  return state;
}
