// ═══════════════════════════════════════════════════════════════
// LANDING POR PAPEL — o primeiro destino útil de cada perfil (§P1.12)
// ═══════════════════════════════════════════════════════════════
// Depois do login, TODO mundo caía em /dashboard. Isso mandava a recepção
// para um panorama de gestão e, pior, perfis sem a permissão "dashboard"
// (ex.: VIEWER com só a agenda liberada) direto para um 403.
//
// Contrato desta missão:
//   OWNER / ADMIN          → Visão geral (/dashboard)
//   ATENDENTE / SECRETARIA → Agenda (/agenda) — a operação do dia
//   PROFISSIONAL           → "Meu dia" (/dashboard com a visão do profissional)
//   qualquer outro         → primeiro destino que o catálogo LIBERA
//
// NUNCA um destino que o backend recusaria: a função só devolve rota que
// o catálogo (lib/panel.ts) considera acessível para o contexto informado.
//
// Puro (sem I/O): coberto por src/lib/__tests__/landing.test.ts.
import type { BusinessMode, FeatureId, MemberRole, PermissionId } from './types';
import { allowedPanelRoutes, firstAllowedPath, type PanelContext } from './panel';

export type LandingRole = MemberRole | 'MASTER' | string;

export interface LandingContext {
  role?: LandingRole;
  permissions: Partial<Record<PermissionId, boolean>>;
  modes: BusinessMode[];
  features: Partial<Record<FeatureId, boolean>>;
}

/** Papéis cujo primeiro destino útil é a OPERAÇÃO do dia (agenda). */
const DESK_ROLES: ReadonlySet<string> = new Set(['ATENDENTE', 'SECRETARIA']);

function panelCtx(ctx: LandingContext): PanelContext {
  return { permissions: ctx.permissions, modes: ctx.modes, features: ctx.features };
}

/** A rota é acessível para este contexto? (a autoridade é o catálogo) */
function canOpen(ctx: LandingContext, path: string): boolean {
  return allowedPanelRoutes(panelCtx(ctx)).some((r) => r.href === path);
}

/**
 * Primeiro destino após o login. Sempre uma rota ACESSÍVEL (o catálogo é a
 * autoridade): '' só quando o perfil não abre nada no painel — o chamador
 * cai no fluxo existente (onboarding/organização).
 */
export function landingPathFor(ctx: LandingContext): string {
  const role = String(ctx.role || '').toUpperCase();

  // MASTER da plataforma tem área própria (fluxo existente do login).
  if (role === 'MASTER') return '/master';

  // Recepção/balcão: a Agenda é a primeira tela útil — desde que possa abri-la.
  if (DESK_ROLES.has(role) && canOpen(ctx, '/agenda')) return '/agenda';

  // Quem atende: "Meu dia" É a Visão geral com o recorte do profissional.
  if (role === 'PROFISSIONAL' && canOpen(ctx, '/dashboard')) return '/dashboard';

  // Owner/Admin e demais perfis com visão geral: panorama.
  if (!DESK_ROLES.has(role) && canOpen(ctx, '/dashboard')) return '/dashboard';

  // Atendente sem acesso à visão geral cai no PRIMEIRO destino liberado —
  // normalmente a própria Agenda; nunca um 403.
  return firstAllowedPath(panelCtx(ctx));
}
