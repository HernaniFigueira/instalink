// ═══════════════════════════════════════════════════════════════
// AUTORIZAÇÃO — camada CENTRAL (empresa + membro + permissão)
// ═══════════════════════════════════════════════════════════════
// Núcleo puro (isMasterUser, resolveAccess, accessibleBusinesses…): access-core.
// Este arquivo = core + guards de API + cookies (next/headers, next/server).
// Client Components NÃO devem importar este módulo — use access-core ou
// organization (que importa só o core).
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readDB } from './db';
import {
  getBearerToken, getUserBySessionFromDB, hasRequestCredentials,
  userFromRequest, userFromRequestFromDB, sessionCookieId,
} from './auth';
import { cookies } from 'next/headers';
import type { DB, PermissionId, SupportSession, User } from './types';
import {
  isMasterUser, resolveAccess, type AccessContext,
} from './access-core';

// Reexporta o núcleo puro + catálogo (API pública estável de @/lib/access).
export {
  PERMISSIONS, PERMISSION_IDS, ROLES, roleDef, isValidRole, isValidPermission, permissionsFor,
  masterEmails, hasMasterRole, isMasterEmail, isMasterUser, isValidSupportSession,
  membershipsOf, organizationRoleIn, accessibleBusinesses, roleIn, resolveAccess, can,
  // Escopo do profissional (P2): vínculo User→Professional e filtros puros
  // reutilizados por agenda, catálogo, CRM e painéis do Dashboard.
  BROAD_ACCESS_ROLES, professionalForUser, professionalScopeFor,
  scopeBookings, canAccessBooking, scopeProfessionals,
  agendaScopeFor, scopeInfo, NO_PROFESSIONAL_SCOPE,
} from './access-core';
export type { PermissionDef, RoleDef } from './access-core';
export type { AccessContext } from './access-core';

// ── Sessão de suporte (master) ───────────────────────────────
export const SUPPORT_COOKIE = 'il_support';
const SUPPORT_MINUTES = 60;

/** Pure SupportSession lookup. Never performs database I/O. */
export function supportFromDB(
  db: Pick<DB, 'supportSessions'>,
  supportSessionId: string | undefined,
  masterUserId?: string,
): SupportSession | null {
  if (!supportSessionId) return null;
  const support = db.supportSessions.find((session) => session.id === supportSessionId);
  if (!support || support.endedAt) return null;
  if (new Date(support.expiresAt).getTime() < Date.now()) return null;
  if (masterUserId && support.masterUserId !== masterUserId) return null;
  return support;
}

/** Resolve the request's support cookie against an already-owned snapshot. */
export function supportFromRequestFromDB(
  req: NextRequest,
  db: Pick<DB, 'supportSessions'>,
  masterUserId?: string,
): SupportSession | null {
  return supportFromDB(db, req.cookies.get(SUPPORT_COOKIE)?.value, masterUserId);
}

/** Standalone wrapper retained for existing callers. */
export async function supportFromRequest(req: NextRequest, masterUserId?: string): Promise<SupportSession | null> {
  const id = req.cookies.get(SUPPORT_COOKIE)?.value;
  if (!id) return null;
  return supportFromDB(await readDB(), id, masterUserId);
}

/** Standalone Server Components wrapper retained for existing callers. */
export async function supportFromCookies(): Promise<SupportSession | null> {
  const id = cookies().get(SUPPORT_COOKIE)?.value;
  if (!id) return null;
  return supportFromDB(await readDB(), id);
}

export function supportExpiry(from = new Date()): string {
  return new Date(from.getTime() + SUPPORT_MINUTES * 60000).toISOString();
}

export { SUPPORT_MINUTES };

// ── Guards de API ────────────────────────────────────────────
export type Guarded =
  | { ok: true; db: DB; ctx: AccessContext }
  | { ok: false; res: NextResponse };

const unauthorized = (message: string, status = 403) =>
  NextResponse.json({ error: message }, { status });

/** Autentica o lojista (cookie ou Bearer). */
export async function requireUser(req: NextRequest, snapshot?: DB): Promise<
  { ok: true; user: User } | { ok: false; res: NextResponse }
> {
  const user = snapshot
    ? userFromRequestFromDB(req, snapshot)
    : await userFromRequest(req);
  if (!user) return { ok: false, res: unauthorized('Não autenticado.', 401) };
  return { ok: true, user };
}

/**
 * Guarda central das APIs de empresa:
 *   identidade → empresa → permissão → (modo suporte somente leitura).
 */
export async function requireBusiness(
  req: NextRequest,
  businessId: string,
  // Uma permissão OU a lista de permissões aceitáveis ("qualquer uma").
  // Usado, por exemplo, para LEITURA de catálogo, que serve tanto quem
  // administra o catálogo quanto quem usa a agenda/clientes.
  permission?: PermissionId | PermissionId[],
  snapshot?: DB,
): Promise<Guarded> {
  if (!businessId) return { ok: false, res: unauthorized('Negócio não informado.', 400) };
  // No credential means there is no reason to fetch instalink_doc. When a
  // request carries a token, auth, support, tenant, and permissions all resolve
  // from this one request-local snapshot.
  if (!snapshot && !hasRequestCredentials(req)) {
    return { ok: false, res: unauthorized('Não autenticado.', 401) };
  }
  const db = snapshot || await readDB();
  const user = userFromRequestFromDB(req, db);
  if (!user) return { ok: false, res: unauthorized('Não autenticado.', 401) };
  const support = isMasterUser(user) ? supportFromRequestFromDB(req, db, user.id) : null;
  const ctx = resolveAccess(db, user, businessId, support);
  if (!ctx) return { ok: false, res: unauthorized('Você não tem acesso a este negócio.') };
  if (ctx.readOnly && req.method !== 'GET' && req.method !== 'HEAD') {
    return { ok: false, res: unauthorized('Modo suporte (visualização): alterações bloqueadas.', 403) };
  }
  if (permission) {
    const needed = Array.isArray(permission) ? permission : [permission];
    if (!needed.some((perm) => ctx.permissions[perm] === true)) {
      return { ok: false, res: unauthorized('Seu perfil não tem permissão para esta ação.', 403) };
    }
  }
  return { ok: true, db, ctx };
}

/** Guarda do painel master (plataforma). */
export async function requireMaster(req: NextRequest): Promise<
  { ok: true; user: User; db: DB } | { ok: false; res: NextResponse }
> {
  if (!hasRequestCredentials(req)) {
    return { ok: false, res: unauthorized('Não autenticado.', 401) };
  }
  const db = await readDB();
  const user = userFromRequestFromDB(req, db);
  if (!user) return { ok: false, res: unauthorized('Não autenticado.', 401) };
  if (!isMasterUser(user)) return { ok: false, res: unauthorized('Área restrita da plataforma.') };
  return { ok: true, user, db };
}

/**
 * Sessão de lojista a partir de cookies (Server Components/rotas que não
 * recebem NextRequest). Reutiliza exatamente a mesma resolução de acesso.
 */
export async function currentAccess(businessId: string): Promise<AccessContext | null> {
  const cookieStore = cookies();
  const sessionId = sessionCookieId(cookieStore);
  if (!sessionId) return null;
  const db = await readDB();
  const user = getUserBySessionFromDB(db, sessionId);
  if (!user) return null;
  const support = isMasterUser(user)
    ? supportFromDB(db, cookieStore.get(SUPPORT_COOKIE)?.value, user.id)
    : null;
  return resolveAccess(db, user, businessId, support);
}

export { getBearerToken };
