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
import { resolveActiveBusinessId } from '@/lib/business-context';
import { loadMe } from '@/lib/session-me';
import type { PermissionId } from '@/lib/types';

interface MePayload {
  businesses?: Array<{
    id: string;
    role?: string;
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
  /** false enquanto /api/auth/me não chega. */
  ready: boolean;
}

/**
 * Permissões da unidade ativa (?b= quando válido; senão a primeira unidade da
 * conta — a mesma resolução do DashboardShell e do useBusinessId). Um `?b=`
 * que não pertence à conta NUNCA concede nada: cai para unidade própria.
 */
export function usePanelPermissions(): PanelPermissions {
  // Null-safe: fora de um provider de router (ex.: render estático de teste,
  // impressão) `useSearchParams()` devolve null — sem permissão resolvida, a
  // UI cai no padrão conservador do consumidor (não derruba o render).
  const params = useSearchParams();
  const requested = params?.get('b') || '';
  const [state, setState] = useState<PanelPermissions>({ permissions: {}, role: '', ready: false });

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((d) => {
      if (cancelled) return;
      const list = Array.isArray(d?.businesses) ? d!.businesses! : [];
      const id = resolveActiveBusinessId(requested, list);
      const biz = list.find((b) => b.id === id);
      setState({ permissions: biz?.permissions || {}, role: biz?.role || '', ready: true });
    });
    return () => { cancelled = true; };
  }, [requested]);

  return state;
}
