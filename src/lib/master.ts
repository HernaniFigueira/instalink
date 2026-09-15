// ═══════════════════════════════════════════════════════════════
// MASTER DA PLATAFORMA — domínio puro (sem I/O de rede)
// ═══════════════════════════════════════════════════════════════
// A conta Master pertence ao InstaLink, NÃO a uma Organization.
// Ela enxerga a plataforma inteira; dados operacionais de unidade
// só entram via SupportSession (já em access.ts).
//
// Fonte persistente: User.role === 'master'
// Fallback bootstrap/emergência: MASTER_EMAILS (autoriza isMasterUser,
// mas NÃO entra na contagem/listagem administrativa de Masters e NÃO
// contorna a proteção do último Master).
//
// Receita do InstaLink ≠ receita operacional das Organizations.
// Enquanto não houver planos/cobrança reais, platformRevenue = 0.
import type { DB, User, UserRole, AuditAction } from './types';
// access-core: puro (sem next/headers) — master.ts também é importável em testes/domínio.
import { hasMasterRole, isMasterEmail, isMasterUser, masterEmails } from './access-core';

export type PlatformUserKind = 'master' | 'owner' | 'admin' | 'member';

/** DTO seguro de usuário — NUNCA expõe hash, tokens ou segredos. */
export interface SafeUserView {
  id: string;
  name: string;
  email: string;
  kind: PlatformUserKind;
  platformRole: UserRole | 'owner';
  /** Como o Master foi reconhecido: role persistente ou só fallback env. */
  masterSource: 'role' | 'env' | null;
  organizationIds: string[];
  organizationNames: string[];
  unitIds: string[];
  unitNames: string[];
  createdAt: string;
  lastLoginAt: string;
  isMaster: boolean;
}

export type MasterManageResult =
  | {
    ok: true;
    userId: string;
    email: string;
    role: UserRole;
    created: boolean;
    action: 'promoted' | 'revoked' | 'created';
  }
  | {
    ok: false;
    error: string;
    code: 'not_found' | 'last_master' | 'invalid' | 'forbidden' | 'already';
  };

/**
 * Contagem administrativa de Masters = somente role='master' no banco.
 * MASTER_EMAILS NÃO entra aqui (evita contornar a proteção do último Master
 * e evita Masters “fantasma” na gestão).
 */
export function countMasters(db: DB): number {
  return db.users.filter((u) => hasMasterRole(u)).length;
}

/** Masters persistentes (role=master) — fonte da gestão /master/masters. */
export function mastersOf(db: DB): User[] {
  return db.users.filter((u) => hasMasterRole(u));
}

/**
 * Masters efetivos para autorização (role OU MASTER_EMAILS).
 * Usado só para visão/diagnóstico — NÃO para last-master nem revogação.
 */
export function effectiveMastersOf(db: DB): User[] {
  return db.users.filter((u) => isMasterUser(u));
}

export function masterSourceOf(user: Pick<User, 'role' | 'email'>): 'role' | 'env' | null {
  if (hasMasterRole(user)) return 'role';
  if (isMasterEmail(user)) return 'env';
  return null;
}

/** Classifica o papel do usuário na plataforma (visão Master). */
export function platformUserKind(db: DB, user: User): PlatformUserKind {
  if (isMasterUser(user)) return 'master';
  const ownsOrg = db.organizations.some((o) => o.ownerId === user.id);
  if (ownsOrg) return 'owner';
  const orgAdmin = db.organizationMembers.some(
    (m) => m.userId === user.id && m.active !== false && (m.role === 'OWNER' || m.role === 'ADMIN'),
  );
  if (orgAdmin) return 'admin';
  const bizOwner = db.businesses.some((b) => b.ownerId === user.id);
  if (bizOwner) return 'owner';
  const bizAdmin = db.members.some(
    (m) => m.userId === user.id && m.active !== false && (m.role === 'OWNER' || m.role === 'ADMIN'),
  );
  if (bizAdmin) return 'admin';
  return 'member';
}

function orgsAndUnitsFor(db: DB, userId: string): {
  organizationIds: string[];
  organizationNames: string[];
  unitIds: string[];
  unitNames: string[];
} {
  const orgIds = new Set<string>();
  for (const o of db.organizations) {
    if (o.ownerId === userId) orgIds.add(o.id);
  }
  for (const m of db.organizationMembers) {
    if (m.userId === userId && m.active !== false) orgIds.add(m.organizationId);
  }
  const unitIds = new Set<string>();
  for (const b of db.businesses) {
    if (b.ownerId === userId) {
      unitIds.add(b.id);
      if (b.organizationId) orgIds.add(b.organizationId);
    }
  }
  for (const m of db.members) {
    if (m.userId === userId && m.active !== false) {
      unitIds.add(m.businessId);
      const b = db.businesses.find((x) => x.id === m.businessId);
      if (b?.organizationId) orgIds.add(b.organizationId);
    }
  }
  const organizationIds = [...orgIds];
  const unitIdList = [...unitIds];
  return {
    organizationIds,
    organizationNames: organizationIds.map((id) => db.organizations.find((o) => o.id === id)?.name || id),
    unitIds: unitIdList,
    unitNames: unitIdList.map((id) => db.businesses.find((b) => b.id === id)?.name || id),
  };
}

/** Visão segura de um usuário (sem passwordHash/tokens). */
export function safeUserView(db: DB, user: User): SafeUserView {
  const links = orgsAndUnitsFor(db, user.id);
  const kind = platformUserKind(db, user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    kind,
    platformRole: (user.role as UserRole) || 'owner',
    masterSource: masterSourceOf(user),
    organizationIds: links.organizationIds,
    organizationNames: links.organizationNames,
    unitIds: links.unitIds,
    unitNames: links.unitNames,
    createdAt: user.createdAt || '',
    lastLoginAt: user.lastLoginAt || '',
    isMaster: isMasterUser(user),
  };
}

export function listPlatformUsers(db: DB): SafeUserView[] {
  return db.users
    .map((u) => safeUserView(db, u))
    .sort((a, b) => {
      const order: Record<PlatformUserKind, number> = { master: 0, owner: 1, admin: 2, member: 3 };
      const d = order[a.kind] - order[b.kind];
      if (d !== 0) return d;
      return a.email.localeCompare(b.email);
    });
}

/**
 * Lista administrativa de Masters = somente role='master'.
 * Fallback MASTER_EMAILS (sem role) NÃO aparece aqui — evita Master “invisível”
 * e força promoção explícita (role) para gestão normal.
 */
export function listMastersSafe(db: DB): SafeUserView[] {
  return mastersOf(db).map((u) => safeUserView(db, u))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Fallback env visível para diagnóstico (não gerenciável por revoke de role).
 * Aparece separado na API para o operador saber quem está só no env.
 */
export function listEnvOnlyMastersSafe(db: DB): SafeUserView[] {
  return db.users
    .filter((u) => isMasterEmail(u) && !hasMasterRole(u))
    .map((u) => safeUserView(db, u))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Promove usuário existente a Master (role = 'master').
 * Não altera senha. Não confunde com OWNER de Organization.
 * Se o e-mail já estava só em MASTER_EMAILS, grava role persistente.
 */
export function promoteToMaster(db: DB, email: string): MasterManageResult {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.includes('@')) {
    return { ok: false, error: 'Informe um e-mail válido.', code: 'invalid' };
  }
  const user = db.users.find((u) => u.email.toLowerCase() === normalized);
  if (!user) return { ok: false, error: 'Usuário não encontrado.', code: 'not_found' };
  if (hasMasterRole(user)) {
    return { ok: false, error: 'Este usuário já é Master.', code: 'already' };
  }
  user.role = 'master';
  return { ok: true, userId: user.id, email: user.email, role: 'master', created: false, action: 'promoted' };
}

/**
 * Remove privilégio Master persistente (role → owner).
 * Conta SOMENTE role='master'. MASTER_EMAILS NÃO contorna last_master:
 * se só resta 1 role=master, a remoção é bloqueada mesmo com e-mails no env.
 * Quem está só no env não tem role para revogar por esta função.
 */
export function revokeMaster(db: DB, userId: string): MasterManageResult {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: 'Usuário não encontrado.', code: 'not_found' };
  if (!hasMasterRole(user)) {
    if (isMasterEmail(user)) {
      return {
        ok: false,
        error: 'Este acesso Master vem só de MASTER_EMAILS (env). Remova o e-mail da variável de ambiente; não há role=master para revogar no banco.',
        code: 'invalid',
      };
    }
    return { ok: false, error: 'Este usuário não é Master.', code: 'invalid' };
  }
  if (countMasters(db) <= 1) {
    return {
      ok: false,
      error: 'Não é possível remover o último Master da plataforma.',
      code: 'last_master',
    };
  }
  user.role = 'owner';
  return { ok: true, userId: user.id, email: user.email, role: 'owner', created: false, action: 'revoked' };
}

/**
 * Cria usuário novo já como Master, ou promove se o e-mail já existir.
 * passwordHash deve vir já hasheado (scrypt) — nunca texto puro aqui.
 */
export function upsertMasterUser(
  db: DB,
  input: { email: string; name?: string; passwordHash?: string; createdAt?: string },
): MasterManageResult {
  const email = String(input.email || '').trim().toLowerCase();
  if (!email.includes('@')) {
    return { ok: false, error: 'Informe um e-mail válido.', code: 'invalid' };
  }
  const existing = db.users.find((u) => u.email.toLowerCase() === email);
  if (existing) {
    if (hasMasterRole(existing)) {
      return { ok: false, error: 'Este usuário já é Master.', code: 'already' };
    }
    existing.role = 'master';
    if (input.name?.trim()) existing.name = input.name.trim().slice(0, 80);
    return { ok: true, userId: existing.id, email: existing.email, role: 'master', created: false, action: 'promoted' };
  }
  if (!input.passwordHash) {
    return { ok: false, error: 'Para criar um Master novo é necessário definir uma senha.', code: 'invalid' };
  }
  const id = `master-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = input.createdAt || new Date().toISOString();
  const user: User = {
    id,
    name: (input.name || email.split('@')[0] || 'Master').trim().slice(0, 80),
    email,
    passwordHash: input.passwordHash,
    createdAt: now,
    role: 'master',
    lastLoginAt: '',
  };
  db.users.push(user);
  return { ok: true, userId: user.id, email: user.email, role: 'master', created: true, action: 'created' };
}

/** Ação de auditoria correspondente à gestão de Master. */
export function masterAuditAction(action: 'promoted' | 'revoked' | 'created'): AuditAction {
  if (action === 'revoked') return 'master.revoked';
  if (action === 'created') return 'master.created';
  return 'master.promoted';
}

// ── Visão geral da plataforma ────────────────────────────────

export interface PlatformOverview {
  organizations: number;
  units: number;
  users: number;
  masters: number;
  owners: number;
  admins: number;
  members: number;
  publishedUnits: number;
  supportSessionsActive: number;
  /** Receita do InstaLink (plataforma). Sem billing real = 0. */
  platformRevenueCents: number;
  platformRevenueLabel: string;
  platformRevenueHint: string;
  /** Reservado para P futuro — estrutura, sem inventar dados. */
  billing: {
    implemented: false;
    monthlyRevenueCents: number;
    annualRevenueCents: number;
    mrrCents: number;
    payingUnits: number;
    subscriptions: number;
    pastDue: number;
    cancellations: number;
  };
  recentActivity: Array<{
    id: string;
    at: string;
    action: string;
    actorEmail: string;
    actorRole: string;
    businessId: string;
    businessName: string;
    organizationId: string;
    organizationName: string;
    meta: Record<string, unknown>;
  }>;
}

export function platformOverview(db: DB, activityLimit = 20): PlatformOverview {
  const users = listPlatformUsers(db);
  // Contagem administrativa = role=master (não MASTER_EMAILS).
  const masters = countMasters(db);
  const owners = users.filter((u) => u.kind === 'owner').length;
  const admins = users.filter((u) => u.kind === 'admin').length;
  const members = users.filter((u) => u.kind === 'member').length;
  const now = Date.now();
  const activeSupport = db.supportSessions.filter(
    (s) => !s.endedAt && new Date(s.expiresAt).getTime() > now,
  ).length;

  const recent = db.audit
    .slice()
    .reverse()
    .slice(0, activityLimit)
    .map((a) => {
      const business = a.businessId ? db.businesses.find((b) => b.id === a.businessId) : undefined;
      const orgId = business?.organizationId || (a.meta && (a.meta as any).organizationId) || '';
      const org = orgId ? db.organizations.find((o) => o.id === orgId) : undefined;
      return {
        id: a.id,
        at: a.at,
        action: a.action,
        actorEmail: a.actorEmail,
        actorRole: a.actorRole,
        businessId: a.businessId || '',
        businessName: business?.name || '',
        organizationId: orgId || '',
        organizationName: org?.name || '',
        meta: a.meta || {},
      };
    });

  return {
    organizations: db.organizations.length,
    units: db.businesses.length,
    users: db.users.length,
    masters,
    owners,
    admins,
    members,
    publishedUnits: db.businesses.filter((b) => b.published).length,
    supportSessionsActive: activeSupport,
    // Sem planos/cobrança implementados: zero explícito — NÃO inventar.
    platformRevenueCents: 0,
    platformRevenueLabel: 'Receita do InstaLink',
    platformRevenueHint:
      'Receita da própria plataforma (assinaturas InstaLink). Ainda não há planos/cobrança implementados — valor real = R$ 0,00. Não confunde com a receita operacional das Organizations.',
    billing: {
      implemented: false,
      monthlyRevenueCents: 0,
      annualRevenueCents: 0,
      mrrCents: 0,
      payingUnits: 0,
      subscriptions: 0,
      pastDue: 0,
      cancellations: 0,
    },
    recentActivity: recent,
  };
}

export interface OrgMasterRow {
  id: string;
  name: string;
  owner: { id: string; name: string; email: string; lastLoginAt: string } | null;
  units: number;
  users: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  unitSummaries: Array<{ id: string; name: string; slug: string; address: string; published: boolean; status: string }>;
}

export function listOrganizationsForMaster(db: DB, q = ''): OrgMasterRow[] {
  const term = q.trim().toLowerCase();
  const rows = db.organizations.map((o) => {
    const owner = db.users.find((u) => u.id === o.ownerId);
    const units = db.businesses.filter((b) => b.organizationId === o.id);
    const unitIds = new Set(units.map((u) => u.id));
    const userIds = new Set<string>();
    if (owner) userIds.add(owner.id);
    for (const m of db.organizationMembers) {
      if (m.organizationId === o.id && m.active !== false) userIds.add(m.userId);
    }
    for (const m of db.members) {
      if (unitIds.has(m.businessId) && m.active !== false) userIds.add(m.userId);
    }
    for (const b of units) userIds.add(b.ownerId);
    const orgAudit = db.audit.filter(
      (a) => (a.meta && (a.meta as any).organizationId === o.id) || unitIds.has(a.businessId),
    );
    const lastActivityAt = orgAudit.length
      ? orgAudit.reduce((max, a) => (a.at > max ? a.at : max), orgAudit[0].at)
      : o.updatedAt || o.createdAt || '';
    return {
      id: o.id,
      name: o.name,
      owner: owner
        ? { id: owner.id, name: owner.name, email: owner.email, lastLoginAt: owner.lastLoginAt || '' }
        : null,
      units: units.length,
      users: userIds.size,
      createdAt: o.createdAt || '',
      updatedAt: o.updatedAt || '',
      lastActivityAt,
      unitSummaries: units.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        address: b.address || '',
        published: !!b.published,
        status: b.published ? 'published' : 'draft',
      })),
    };
  });
  const filtered = term
    ? rows.filter((r) =>
      r.name.toLowerCase().includes(term) ||
      (r.owner?.email || '').toLowerCase().includes(term) ||
      (r.owner?.name || '').toLowerCase().includes(term))
    : rows;
  return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface UnitMasterRow {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  organizationName: string;
  address: string;
  status: string;
  published: boolean;
  owner: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function listUnitsForMaster(db: DB, q = ''): UnitMasterRow[] {
  const term = q.trim().toLowerCase();
  const rows = db.businesses.map((b) => {
    const org = db.organizations.find((o) => o.id === b.organizationId);
    const owner = db.users.find((u) => u.id === b.ownerId);
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      organizationId: b.organizationId || '',
      organizationName: org?.name || '',
      address: b.address || '',
      status: b.published ? 'published' : 'draft',
      published: !!b.published,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      createdAt: b.createdAt || '',
      updatedAt: b.updatedAt || '',
    };
  });
  const filtered = term
    ? rows.filter((r) =>
      r.name.toLowerCase().includes(term) ||
      r.slug.toLowerCase().includes(term) ||
      r.organizationName.toLowerCase().includes(term) ||
      (r.owner?.email || '').toLowerCase().includes(term) ||
      (r.address || '').toLowerCase().includes(term))
    : rows;
  return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Garante que um Owner/Admin NÃO se auto-promove a Master via dados crus. */
export function assertCannotSelfPromoteToMaster(
  actor: Pick<User, 'id' | 'role' | 'email'>,
  targetRole: unknown,
): boolean {
  // Retorna true se a tentativa é ILEGAL (deve ser bloqueada).
  if (targetRole !== 'master') return false;
  return !isMasterUser(actor);
}

export { hasMasterRole, isMasterEmail, isMasterUser, masterEmails };
