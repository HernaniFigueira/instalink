// ═══════════════════════════════════════════════════════════════
// AUTORIZAÇÃO — núcleo PURO (sem I/O, sem next/headers)
// ═══════════════════════════════════════════════════════════════
// Seguro para import em Client Components (ex.: DashboardShell via
// organization.ts). Guards de API e cookies ficam em access.ts.
//
// Precedência: MASTER > Organization OWNER/ADMIN > Business OWNER/ADMIN/MEMBER
//
// ESCOPO DO PROFISSIONAL (P2): quando o login representa um profissional
// (Professional.userId === user.id naquela unidade), ele vê SOMENTE a própria
// agenda. A regra é aplicada aqui (camada de acesso) e consumida pelas APIs —
// esconder botão não é segurança. Papéis ADMINISTRATIVOS (dono da unidade,
// OWNER/ADMIN da organização, OWNER/ADMIN da unidade, master em suporte)
// preservam o acesso amplo que já existia: o recorte não reduz permissões
// administrativas.
import type {
  Business, BusinessMember, DB, MemberRole, PermissionId, Professional, SupportSession, User,
} from './types';
import { permissionsFor } from './permissions';

export {
  PERMISSIONS, PERMISSION_IDS, ROLES, roleDef, isValidRole, isValidPermission, permissionsFor,
} from './permissions';
export type { PermissionDef, RoleDef } from './permissions';

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
  /** Profissional vinculado a este login nesta unidade (null = nenhum). */
  professional: Professional | null;
  /**
   * Escopo de agenda do profissional: '' = sem restrição (vê tudo o que a
   * permissão já permitia); id = vê SOMENTE os atendimentos desse
   * profissional. Aplicado no backend por `scopeBookings`.
   */
  professionalScope: string;
}

/** Papéis que NUNCA são reduzidos pelo vínculo com um profissional. */
export const BROAD_ACCESS_ROLES: Array<MemberRole | 'MASTER'> = ['OWNER', 'ADMIN', 'MASTER'];

/**
 * Profissional ATIVO vinculado a este login nesta unidade.
 * Vínculo é por unidade: o mesmo usuário pode ser profissional na unidade A e
 * não ter vínculo nenhum na unidade B (isolamento entre negócios preservado).
 */
export function professionalForUser(
  db: DB,
  businessId: string,
  userId: string,
): Professional | null {
  if (!businessId || !userId) return null;
  return db.professionals.find(
    (p) => p.businessId === businessId && p.userId === userId && p.active !== false,
  ) || null;
}

/**
 * Escopo "sem acesso nenhum à agenda": usado quando o papel é de ATENDIMENTO
 * (PROFISSIONAL) mas o administrador ainda não vinculou a pessoa a um
 * profissional. Fecha por PADRÃO — é melhor não mostrar a agenda de ninguém
 * do que mostrar a de todos por esquecimento de configuração.
 */
export const NO_PROFESSIONAL_SCOPE = '__nenhum__';

/**
 * Escopo de agenda efetivo. `''` = sem restrição.
 * Só restringe quem tem vínculo E papel não administrativo.
 */
export function professionalScopeFor(
  db: DB,
  user: User,
  businessId: string,
  role: MemberRole | 'MASTER' | '',
): string {
  if (!role || BROAD_ACCESS_ROLES.includes(role)) return '';
  const linked = professionalForUser(db, businessId, user.id);
  if (linked) return linked.id;
  return role === 'PROFISSIONAL' ? NO_PROFESSIONAL_SCOPE : '';
}

/**
 * Situação da agenda deste contexto, para a interface dizer a verdade:
 *   'all'  → vê a agenda da unidade conforme a permissão;
 *   'own'  → vê SOMENTE os atendimentos do profissional vinculado;
 *   'none' → papel de atendimento ainda SEM vínculo (agenda vazia por
 *            segurança, à espera do vínculo feito pelo administrador).
 */
export function agendaScopeFor(ctx: Pick<AccessContext, 'professionalScope'>): 'all' | 'own' | 'none' {
  if (!ctx.professionalScope) return 'all';
  return ctx.professionalScope === NO_PROFESSIONAL_SCOPE ? 'none' : 'own';
}

/** Dados públicos do escopo para as respostas de API (nunca vaza ids de terceiros). */
export function scopeInfo(ctx: Pick<AccessContext, 'professionalScope' | 'professional'>): {
  professionalId: string; professionalName: string; unlinked: boolean;
} | null {
  if (!ctx.professionalScope) return null;
  if (ctx.professionalScope === NO_PROFESSIONAL_SCOPE) {
    return { professionalId: '', professionalName: '', unlinked: true };
  }
  return { professionalId: ctx.professionalScope, professionalName: ctx.professional?.name || '', unlinked: false };
}

/**
 * Filtro de atendimentos pelo escopo. Função PURA — a mesma usada no GET de
 * agenda, no PATCH e nos painéis do Dashboard, para não existir caminho que
 * "esqueça" a regra.
 */
export function scopeBookings<T extends { professionalId?: string }>(items: T[], scope: string): T[] {
  if (!scope) return items;
  return items.filter((x) => (x.professionalId || '') === scope);
}

/** O contexto pode acessar/alterar este atendimento? (escopo do profissional) */
export function canAccessBooking(ctx: Pick<AccessContext, 'professionalScope'>, booking: { professionalId?: string }): boolean {
  if (!ctx.professionalScope) return true;
  return (booking.professionalId || '') === ctx.professionalScope;
}

/** Profissional visível para este contexto (escopo do profissional). */
export function scopeProfessionals<T extends { id: string }>(items: T[], scope: string): T[] {
  if (!scope) return items;
  return items.filter((x) => x.id === scope);
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
        professional: null, professionalScope: '',
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
      professional: null, professionalScope: '',
    };
  }

  // 3. Business owner
  if (business.ownerId === user.id) {
    return {
      user, business, member: null, role: 'OWNER',
      permissions: permissionsFor('OWNER'), isOwner: true, isMaster: false,
      support: null, readOnly: false,
      professional: null, professionalScope: '',
    };
  }

  // 4. Business member
  const member = db.members.find(
    (m) => m.businessId === businessId && m.userId === user.id && m.active !== false,
  ) || null;
  if (member) {
    // Escopo do profissional: vínculo User→Professional desta unidade.
    const professional = professionalForUser(db, businessId, user.id);
    const professionalScope = professionalScopeFor(db, user, businessId, member.role);
    return {
      user, business, member, role: member.role,
      permissions: permissionsFor(member.role, member.permissions),
      isOwner: false, isMaster: false, support: null, readOnly: member.role === 'VIEWER',
      professional, professionalScope,
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
