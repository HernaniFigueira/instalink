import type { Business, DB, Organization, User } from './types';
import { accessibleBusinesses, isMasterUser } from './access';

/**
 * Organizations visíveis ao usuário.
 * Master NÃO herda orgs por ownership/membership — só unidades da SupportSession
 * (via accessibleBusinesses). Sem suporte = lista vazia.
 */
export function organizationsFor(db: DB, user: User): Organization[] {
  if (isMasterUser(user)) {
    const unitOrgIds = new Set(
      accessibleBusinesses(db, user).map((b) => b.organizationId).filter(Boolean),
    );
    return db.organizations.filter((o) => unitOrgIds.has(o.id));
  }
  const unitOrgIds = new Set(accessibleBusinesses(db, user).map((b) => b.organizationId));
  const memberOrgIds = new Set(db.organizationMembers
    .filter((m) => m.userId === user.id && m.active !== false)
    .map((m) => m.organizationId));
  return db.organizations.filter((o) => o.ownerId === user.id || unitOrgIds.has(o.id) || memberOrgIds.has(o.id));
}

/**
 * Gestão de Organization (criar unidade etc.).
 * Master NÃO gerencia org por vínculo tenant — só via fluxo Master/suporte.
 */
export function canManageOrganization(db: DB, user: User, organizationId: string): boolean {
  if (isMasterUser(user)) return false;
  const org = db.organizations.find((o) => o.id === organizationId);
  if (!org) return false;
  if (org.ownerId === user.id) return true;
  return db.organizationMembers.some((m) => m.organizationId === organizationId && m.userId === user.id && m.active !== false && m.role === 'ADMIN');
}

export function unitsForOrganization(db: DB, user: User, organizationId: string): Business[] {
  const accessible = new Set(accessibleBusinesses(db, user).map((b) => b.id));
  return db.businesses.filter((b) => b.organizationId === organizationId && accessible.has(b.id));
}

export function unitsInSameOrganization<T extends { organizationId?: string }>(
  current: T | null | undefined,
  units: T[],
): T[] {
  if (!current?.organizationId) return current ? [current] : [];
  return units.filter((unit) => unit.organizationId === current.organizationId);
}

export function hasMultipleUnits<T extends { organizationId?: string }>(current: T | null | undefined, units: T[]): boolean {
  return unitsInSameOrganization(current, units).length > 1;
}
