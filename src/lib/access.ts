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
// Master da plataforma (User.role === 'master') NÃO é dono de nada: ele só
// entra no contexto de uma empresa através de uma SupportSession explícita
// (auditada), em modo 'view' (somente leitura) ou 'admin' (com escrita).
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
 * por vírgula). É o caminho operacional para promover alguém sem tocar no
 * banco e SEM senha secreta hardcoded no código.
 */
export function masterEmails(): string[] {
  return (process.env.MASTER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isMasterUser(user: Pick<User, 'role' | 'email'> | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'master') return true;
  const email = String(user.email || '').toLowerCase();
  return !!email && masterEmails().includes(email);
}

/** Membros ATIVOS do usuário (para montar a navegação e as APIs). */
export function membershipsOf(db: DB, userId: string): BusinessMember[] {
  return db.members.filter((m) => m.userId === userId && m.active !== false);
}

/**
 * Negócios que o usuário pode acessar: os que ele possui + os que é membro
 * ativo. NUNCA retorna negócio de terceiro — a ÚNICA exceção é a empresa
 * aberta explicitamente numa sessão de suporte do master (auditada e com
 * prazo), que entra no fim da lista.
 */
export function accessibleBusinesses(
  db: DB,
  user: User,
  support: SupportSession | null = null,
): Business[] {
  const owned = db.businesses.filter((b) => b.ownerId === user.id);
  const ids = new Set(membershipsOf(db, user.id).map((m) => m.businessId));
  const asMember = db.businesses.filter((b) => ids.has(b.id) && b.ownerId !== user.id);
  const list = [...owned, ...asMember];
  if (support && !support.endedAt && new Date(support.expiresAt).getTime() > Date.now()) {
    const target = db.businesses.find((b) => b.id === support.businessId);
    if (target && !list.some((b) => b.id === target.id)) list.push(target);
  }
  return list;
}

/** Papel do usuário neste negócio ('' = sem acesso). */
export function roleIn(db: DB, user: User, businessId: string): MemberRole | '' {
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return '';
  if (business.ownerId === user.id) return 'OWNER';
  const member = db.members.find(
    (m) => m.businessId === businessId && m.userId === user.id && m.active !== false,
  );
  return member ? member.role : '';
}

/**
 * Resolve o contexto de acesso de um usuário a uma empresa — incluindo o
 * modo suporte do master. Devolve null quando não há autorização alguma.
 */
export function resolveAccess(
  db: DB,
  user: User,
  businessId: string,
  support: SupportSession | null = null,
): AccessContext | null {
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return null;

  const isOwner = business.ownerId === user.id;
  const member = db.members.find(
    (m) => m.businessId === businessId && m.userId === user.id && m.active !== false,
  ) || null;

  if (isOwner) {
    return {
      user, business, member: null, role: 'OWNER',
      permissions: permissionsFor('OWNER'), isOwner: true, isMaster: isMasterUser(user),
      support: null, readOnly: false,
    };
  }

  if (member) {
    return {
      user, business, member, role: member.role,
      permissions: permissionsFor(member.role, member.permissions),
      isOwner: false, isMaster: isMasterUser(user), support: null, readOnly: member.role === 'VIEWER',
    };
  }

  // Master SEM sessão de suporte não tem acesso a conteúdo de empresa.
  if (isMasterUser(user) && support && support.businessId === businessId && !support.endedAt) {
    return {
      user, business, member: null, role: 'MASTER',
      permissions: permissionsFor('OWNER'), isOwner: false, isMaster: true,
      support, readOnly: support.mode === 'view',
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

export async function supportFromRequest(req: NextRequest): Promise<SupportSession | null> {
  const id = req.cookies.get(SUPPORT_COOKIE)?.value;
  if (!id) return null;
  return supportFromDb(id);
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
  const support = isMasterUser(auth.user) ? await supportFromRequest(req) : null;
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
