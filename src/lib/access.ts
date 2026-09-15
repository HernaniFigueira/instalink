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
import { userFromRequest, getBearerToken, COOKIE_NAME } from './auth';
import { getUserBySession } from './auth';
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

export async function supportFromRequest(req: NextRequest, masterUserId?: string): Promise<SupportSession | null> {
  const id = req.cookies.get(SUPPORT_COOKIE)?.value;
  if (!id) return null;
  const support = await supportFromDb(id);
  return support && (!masterUserId || support.masterUserId === masterUserId) ? support : null;
}

export async function supportFromCookies(): Promise<SupportSession | null> {
  const id = cookies().get(SUPPORT_COOKIE)?.value;
  if (!id) return null;
  return supportFromDb(id);
}

async function supportFromDb(id: string): Promise<SupportSession | null> {
  const db = await readDB();
  const s = db.supportSessions.find((x) => x.id === id);
  if (!s || s.endedAt) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) return null;
  return s;
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
export async function requireUser(req: NextRequest): Promise<
  { ok: true; user: User } | { ok: false; res: NextResponse }
> {
  const user = await userFromRequest(req);
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
): Promise<Guarded> {
  if (!businessId) return { ok: false, res: unauthorized('Negócio não informado.', 400) };
  const auth = await requireUser(req);
  if (!auth.ok) return auth;
  const db = await readDB();
  const support = isMasterUser(auth.user) ? await supportFromRequest(req, auth.user.id) : null;
  const ctx = resolveAccess(db, auth.user, businessId, support);
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
  const auth = await requireUser(req);
  if (!auth.ok) return auth;
  if (!isMasterUser(auth.user)) return { ok: false, res: unauthorized('Área restrita da plataforma.') };
  const db = await readDB();
  return { ok: true, user: auth.user, db };
}

/**
 * Sessão de lojista a partir de cookies (Server Components/rotas que não
 * recebem NextRequest). Reutiliza exatamente a mesma resolução de acesso.
 */
export async function currentAccess(businessId: string): Promise<AccessContext | null> {
  const sessionId = cookies().get(COOKIE_NAME)?.value;
  const user = await getUserBySession(sessionId);
  if (!user) return null;
  const db = await readDB();
  const support = isMasterUser(user) ? await supportFromCookies() : null;
  return resolveAccess(db, user, businessId, support);
}

export { getBearerToken };
