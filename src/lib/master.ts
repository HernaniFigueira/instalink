// ═══════════════════════════════════════════════════════════════
// MASTER DA PLATAFORMA — domínio puro (sem I/O de rede)
// ═══════════════════════════════════════════════════════════════
// A conta Master pertence ao InstaLink, NÃO a uma Organization.
// Ela enxerga a plataforma inteira; dados operacionais de unidade
// só entram via SupportSession (já em access.ts).
//
// Receita do InstaLink ≠ receita operacional das Organizations.
// Enquanto não houver planos/cobrança reais, platformRevenue = 0.
import type { DB, User, UserRole, AuditAction } from './types';
import { isMasterUser, masterEmails } from './access';

export type PlatformUserKind = 'master' | 'owner' | 'admin' | 'member';

/** DTO seguro de usuário — NUNCA expõe hash, tokens ou segredos. */
export interface SafeUserView {
  id: string;
  name: string;
  email: string;
  kind: PlatformUserKind;
  platformRole: UserRole | 'owner';
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

export function countMasters(db: DB): number {
  return db.users.filter((u) => isMasterUser(u)).length;
}

export function mastersOf(db: DB): User[] {
  return db.users.filter((u) => isMasterUser(u));
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

export function listMastersSafe(db: DB): SafeUserView[] {
  return mastersOf(db).map((u) => safeUserView(db, u))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Promove usuário existente a Master (role = 'master').
 * Não altera senha. Não confunde com OWNER de Organization.
 */
export function promoteToMaster(db: DB, email: string): MasterManageResult {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.includes('@')) {
    return { ok: false, error: 'Informe um e-mail válido.', code: 'invalid' };
  }
  const user = db.users.find((u) => u.email.toLowerCase() === normalized);
  if (!user) return { ok: false, error: 'Usuário não encontrado.', code: 'not_found' };
  if (user.role === 'master') {
    return { ok: false, error: 'Este usuário já é Master.', code: 'already' };
  }
  user.role = 'master';
  return { ok: true, userId: user.id, email: user.email, role: 'master', created: false, action: 'promoted' };
}

/**
 * Remove privilégio Master. Impede remover o último Master da plataforma
 * (contando role=master E e-mails em MASTER_EMAILS presentes no banco).
 */
export function revokeMaster(db: DB, userId: string): MasterManageResult {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: 'Usuário não encontrado.', code: 'not_found' };
  if (!isMasterUser(user)) {
    return { ok: false, error: 'Este usuário não é Master.', code: 'invalid' };
  }
  // Conta masters "efetivos" no banco. E-mails só em MASTER_EMAILS (sem role)
  // ainda passam isMasterUser, mas revogar role de alguém que só está no env
  // não remove o acesso via env — ainda assim protegemos o último role=master
  // quando não há outro master efetivo.
  const effective = mastersOf(db);
  if (effective.length <= 1 && user.role === 'master') {
    // Se o único master efetivo é este, bloquear — mesmo com MASTER_EMAILS,
    // o env pode ser removido; precisamos de ao menos um role=master.
    const roleMasters = db.users.filter((u) => u.role === 'master');
    if (roleMasters.length <= 1) {
      return {
        ok: false,
        error: 'Não é possível remover o último Master da plataforma.',
        code: 'last_master',
      };
    }
  }
  if (user.role === 'master') {
    user.role = 'owner';
  }
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
    if (existing.role === 'master') {
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
  const masters = users.filter((u) => u.kind === 'master').length;
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

export { isMasterUser, masterEmails };
