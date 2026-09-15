// ═══════════════════════════════════════════════════════════════
// AUTORIZAÇÃO — camada CENTRAL (empresa + membro + permissão)
// ═══════════════════════════════════════════════════════════════
// Toda API sensível valida, nesta ordem:
//   1. identidade (sessão de lojista);
//   2. empresa (o usuário realmente pertence a este businessId);
//   3. papel/permissão (o que ele pode fazer AQUI).
//
// Esconder botão é UX, não segurança: as telas do painel usam as MESMAS
// funções para decidir o que mostrar, e as APIs revalidam tudo no servidor.
//
// Master da plataforma (User.role === 'master' ou MASTER_EMAILS) NÃO é dono
// de nada em termos de autorização operacional: MASTER tem precedência sobre
// qualquer vínculo de tenant. Acesso a unidade = somente SupportSession
// explícita (auditada), modo 'view' (leitura) ou 'admin' (escrita).
//
// Precedência: MASTER > Organization OWNER/ADMIN > Business OWNER/ADMIN/MEMBER
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readDB } from './db';
import { userFromRequest, getBearerToken, COOKIE_NAME } from './auth';
import { getUserBySession } from './auth';
import { cookies } from 'next/headers';
import type {
  Business, BusinessMember, DB, MemberRole, PermissionId, SupportSession, User,
} from './types';
import { PERMISSION_IDS, ROLES, isValidPermission, permissionsFor, roleDef } from './permissions';

// ── Catálogo de permissões/papéis (reexportado do módulo puro) ──
export {
  PERMISSIONS, PERMISSION_IDS, ROLES, roleDef, isValidRole, isValidPermission, permissionsFor,
} from './permissions';
export type { PermissionDef, RoleDef } from './permissions';

// ── Contexto de acesso ───────────────────────────────────────
export interface AccessContext {
  user: User;
  business: Business;
  member: BusinessMember | null; // null quando é o proprietário ou master
  role: MemberRole | 'MASTER';
  permissions: Record<PermissionId, boolean>;
  isOwner: boolean;
  isMaster: boolean;
  support: SupportSession | null; // preenchido no modo suporte do master
  readOnly: boolean; // suporte em modo visualização
}

/**
 * E-mails com acesso master definidos por AMBIENTE (MASTER_EMAILS, separados
 * por vírgula). Fallback de bootstrap/emergência — NÃO é a fonte persistente.
 * Fonte principal: User.role === 'master'.
 */
export function masterEmails(): string[] {
  return (process.env.MASTER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Fonte persistente de Master no banco. */
export function hasMasterRole(user: Pick<User, 'role'> | null | undefined): boolean {
  return !!user && user.role === 'master';
}

/** E-mail autorizado via MASTER_EMAILS (fallback), independente do role. */
export function isMasterEmail(user: Pick<User, 'email'> | null | undefined): boolean {
  if (!user) return false;
  const email = String(user.email || '').toLowerCase();
  return !!email && masterEmails().includes(email);
}

/**
 * Identidade Master efetiva para autorização (login, requireMaster, suporte).
 * role='master' OU e-mail em MASTER_EMAILS.
 * Em ambos os casos a precedência Master se aplica (sem acesso tenant direto).
 */
export function isMasterUser(user: Pick<User, 'role' | 'email'> | null | undefined): boolean {
  if (!user) return false;
  return hasMasterRole(user) || isMasterEmail(user);
}

/** SupportSession vigente, do próprio master, para a unidade (opcional). */
export function isValidSupportSession(
  support: SupportSession | null | undefined,
  masterUserId: string,
  businessId?: string,
): support is SupportSession {
  if (!support) return false;
  if (support.masterUserId !== masterUserId) return false;
  if (support.endedAt) return false;
  if (new Date(support.expiresAt).getTime() <= Date.now()) return false;
  if (businessId && support.businessId !== businessId) return false;
  return true;
}

/** Membros ATIVOS do usuário (para montar a navegação e as APIs). */
export function membershipsOf(db: DB, userId: string): BusinessMember[] {
  return db.members.filter((m) => m.userId === userId && m.active !== false);
}

/**
 * Papel administrativo do usuário na organização (vazio = sem acesso org).
 * Master NÃO herda papel de org — mesmo sendo ownerId legado.
 */
export function organizationRoleIn(db: DB, userId: string, organizationId: string, user?: User): 'OWNER' | 'ADMIN' | '' {
  if (user && isMasterUser(user)) return '';
  const organization = db.organizations.find((o) => o.id === organizationId);
  if (!organization) return '';
  if (organization.ownerId === userId) return 'OWNER';
  const membership = db.organizationMembers.find(
    (m) => m.organizationId === organizationId && m.userId === userId && m.active !== false,
  );
  return membership?.role === 'OWNER' || membership?.role === 'ADMIN' ? membership.role : '';
}

/**
 * Unidades acessíveis.
 *
 * Precedência Master: se isMasterUser, IGNORA ownership/membership/org-admin.
 * Só a unidade da SupportSession vigente entra na lista.
 * Demais usuários: ownership, org admin ou membership explícito.
 */
export function accessibleBusinesses(
  db: DB,
  user: User,
  support: SupportSession | null = null,
): Business[] {
  // 1. MASTER — identidade de plataforma; sem vínculo tenant operacional.
  if (isMasterUser(user)) {
    if (isValidSupportSession(support, user.id)) {
      const target = db.businesses.find((b) => b.id === support.businessId);
      return target ? [target] : [];
    }
    return [];
  }

  const owned = db.businesses.filter((b) => b.ownerId === user.id);
  const ids = new Set(membershipsOf(db, user.id).map((m) => m.businessId));
  const governedOrganizationIds = new Set(
    db.organizations
      .filter((o) => organizationRoleIn(db, user.id, o.id, user) !== '')
      .map((o) => o.id),
  );
  const asMember = db.businesses.filter((b) => ids.has(b.id) && b.ownerId !== user.id);
  const asOrganizationAdmin = db.businesses.filter(
    (b) => !!b.organizationId && governedOrganizationIds.has(b.organizationId) &&
      b.ownerId !== user.id && !ids.has(b.id),
  );
  return [...owned, ...asMember, ...asOrganizationAdmin];
}

/**
 * Papel de tenant no negócio ('' = sem acesso tenant).
 * Master nunca retorna OWNER/ADMIN/MEMBER aqui — só '' (use resolveAccess p/ MASTER).
 */
export function roleIn(db: DB, user: User, businessId: string): MemberRole | '' {
  if (isMasterUser(user)) return '';
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return '';
  if (business.ownerId === user.id) return 'OWNER';
  const organizationRole = business.organizationId ? organizationRoleIn(db, user.id, business.organizationId, user) : '';
  if (organizationRole) return organizationRole;
  const member = db.members.find(
    (m) => m.businessId === businessId && m.userId === user.id && m.active !== false,
  );
  return member ? member.role : '';
}

/**
 * Resolve o contexto de acesso a uma empresa.
 *
 * Ordem fixa:
 *   1. É Master? → somente SupportSession válida da unidade; senão null.
 *   2. Organization OWNER/ADMIN.
 *   3. Business owner / member.
 *   4. Negar.
 *
 * Master + vínculo tenant antigo NÃO contorna SupportSession.
 */
export function resolveAccess(
  db: DB,
  user: User,
  businessId: string,
  support: SupportSession | null = null,
): AccessContext | null {
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return null;

  // 1. MASTER primeiro — precedência absoluta sobre tenant.
  if (isMasterUser(user)) {
    if (isValidSupportSession(support, user.id, businessId)) {
      return {
        user, business, member: null, role: 'MASTER',
        permissions: permissionsFor('OWNER'), isOwner: false, isMaster: true,
        support, readOnly: support.mode === 'view',
      };
    }
    return null;
  }

  // 2. Organization OWNER/ADMIN
  const organizationRole = business.organizationId
    ? organizationRoleIn(db, user.id, business.organizationId, user)
    : '';
  if (organizationRole) {
    return {
      user, business, member: null, role: organizationRole,
      permissions: permissionsFor(organizationRole),
      isOwner: organizationRole === 'OWNER', isMaster: false,
      support: null, readOnly: false,
    };
  }

  // 3. Business owner
  if (business.ownerId === user.id) {
    return {
      user, business, member: null, role: 'OWNER',
      permissions: permissionsFor('OWNER'), isOwner: true, isMaster: false,
      support: null, readOnly: false,
    };
  }

  // 4. Business member
  const member = db.members.find(
    (m) => m.businessId === businessId && m.userId === user.id && m.active !== false,
  ) || null;
  if (member) {
    return {
      user, business, member, role: member.role,
      permissions: permissionsFor(member.role, member.permissions),
      isOwner: false, isMaster: false, support: null, readOnly: member.role === 'VIEWER',
    };
  }

  return null;
}

/**
 * O usuário PODE ver/usar este módulo? `readOnly` (suporte em visualização ou
 * visualizador) bloqueia escrita em outra camada — aqui só decidimos escopo.
 */
export function can(ctx: AccessContext, permission: PermissionId): boolean {
  return ctx.permissions[permission] === true;
}

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
