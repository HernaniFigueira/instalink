'use client';
// ═══════════════════════════════════════════════════════════════
// PERMISSÕES DA UNIDADE ATIVA — projeção client-side (A1.2 · Bloco 2)
// ═══════════════════════════════════════════════════════════════
// Para a UI concordar com os guards (nunca oferecer uma porta que o servidor
// vai negar com 403), algumas telas precisam saber as permissões do usuário
// na unidade ativa ANTES de renderizar um atalho. A fonte é a MESMA do
// DashboardShell (/api/auth/me) — com cache curto em nível de módulo para a
// mesma informação não ser buscada duas vezes na mesma navegação.
//
// REGRA DE SEGURANÇA: isto é APENAS apresentação. Esconder um link sem
// permissão é UX; a autorização de verdade continua no servidor
// (requireBusiness em cada API). Nunca confie neste hook para proteger dado.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { resolveActiveBusinessId } from '@/lib/business-context';
import type { PermissionId } from '@/lib/types';

interface MePayload {
  businesses?: Array<{
    id: string;
    permissions?: Partial<Record<PermissionId, boolean>>;
  }>;
}

const CACHE_TTL_MS = 5000; // mesma régua de revalidação do DashboardShell
let cache: { at: number; data: MePayload } | null = null;
let inflight: Promise<MePayload | null> | null = null;

async function fetchMe(): Promise<MePayload | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (!inflight) {
    inflight = fetch('/api/auth/me')
      .then(async (r) => (r.ok ? ((await r.json()) as MePayload) : null))
      .catch(() => null)
      .then((data) => {
        cache = { at: Date.now(), data: data || {} };
        return data;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export interface PanelPermissions {
  /** Permissões do usuário na unidade ativa ({} enquanto resolve). */
  permissions: Partial<Record<PermissionId, boolean>>;
  /** false enquanto /api/auth/me não chega. */
  ready: boolean;
}

/**
 * Permissões da unidade ativa (?b= quando válido; senão a primeira unidade da
 * conta — a mesma resolução do DashboardShell e do useBusinessId). Um `?b=`
 * que não pertence à conta NUNCA concede nada: cai para unidade própria.
 */
export function usePanelPermissions(): PanelPermissions {
  const params = useSearchParams();
  const requested = params.get('b') || '';
  const [state, setState] = useState<PanelPermissions>({ permissions: {}, ready: false });

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((d) => {
      if (cancelled) return;
      const list = Array.isArray(d?.businesses) ? d!.businesses! : [];
      const id = resolveActiveBusinessId(requested, list);
      const biz = list.find((b) => b.id === id);
      setState({ permissions: biz?.permissions || {}, ready: true });
    });
    return () => { cancelled = true; };
  }, [requested]);

  return state;
}
