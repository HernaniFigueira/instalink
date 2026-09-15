import { afterEach, describe, expect, it } from 'vitest';
import {
  accessibleBusinesses, hasMasterRole, isMasterEmail, isMasterUser, resolveAccess, requireMaster, roleIn,
} from '../access';
import { emptyDB } from '../db';
import { canManageOrganization, organizationsFor } from '../organization';
import {
  assertCannotSelfPromoteToMaster,
  countMasters,
  listEnvOnlyMastersSafe,
  listMastersSafe,
  listOrganizationsForMaster,
  listPlatformUsers,
  listUnitsForMaster,
  masterSourceOf,
  platformOverview,
  platformUserKind,
  promoteToMaster,
  revokeMaster,
  safeUserView,
  upsertMasterUser,
} from '../master';
import type { Business, Organization, SupportSession, User } from '../types';
import { RESERVED_SLUGS } from '../utils';

const user = (id: string, role: User['role'] = 'owner'): User => ({
  id, name: id, email: `${id}@test.dev`, passwordHash: 'scrypt:x:y', createdAt: '2026-01-01', role, lastLoginAt: '',
});
const org = (id: string, ownerId: string): Organization => ({
  id, ownerId, name: id, metadata: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01',
});
const unit = (id: string, ownerId: string, organizationId: string) => ({
  id, ownerId, organizationId, name: id, slug: id, modes: [], features: {}, published: false,
  address: 'Rua X', createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as unknown as Business);

function support(partial: Partial<SupportSession> & Pick<SupportSession, 'masterUserId' | 'businessId'>): SupportSession {
  return {
    id: 'ss',
    masterEmail: 'm@test.dev',
    mode: 'view',
    reason: '',
    createdAt: '2026-01-01',
    expiresAt: '2999-01-01',
    endedAt: '',
    ...partial,
  };
}

describe('Master — autenticação de papel e isolamento', () => {
  it('usuário normal / owner / admin NÃO são master', () => {
    expect(isMasterUser(user('u', 'owner'))).toBe(false);
    expect(isMasterUser(user('u', 'admin'))).toBe(false);
    expect(isMasterUser(null)).toBe(false);
    expect(isMasterUser(user('m', 'master'))).toBe(true);
  });

  it('Master lista todas as Organizations; owner só a sua', () => {
    const db = emptyDB();
    const master = user('master', 'master');
    const ownerA = user('oa'); const ownerB = user('ob');
    db.users.push(master, ownerA, ownerB);
    db.organizations.push(org('oa', 'oa'), org('ob', 'ob'));
    db.businesses.push(unit('ua', 'oa', 'oa'), unit('ub', 'ob', 'ob'));

    const all = listOrganizationsForMaster(db);
    expect(all.map((o) => o.id).sort()).toEqual(['oa', 'ob']);
    expect(all.find((o) => o.id === 'oa')?.units).toBe(1);
    expect(all.find((o) => o.id === 'oa')?.owner?.email).toBe('oa@test.dev');

    // Owner não usa listOrganizationsForMaster no app (API exige requireMaster),
    // mas accessibleBusinesses continua isolado:
    expect(accessibleBusinesses(db, ownerA).map((b) => b.id)).toEqual(['ua']);
    expect(accessibleBusinesses(db, master)).toEqual([]);
  });

  it('Master lista todas as unidades e usuários globais', () => {
    const db = emptyDB();
    const master = user('master', 'master');
    const owner = user('owner');
    const admin = user('admin');
    const staff = user('staff');
    db.users.push(master, owner, admin, staff);
    db.organizations.push(org('org', 'owner'));
    db.businesses.push(unit('u1', 'owner', 'org'), unit('u2', 'owner', 'org'));
    db.members.push({
      id: 'm1', businessId: 'u1', userId: 'admin', role: 'ADMIN',
      permissions: {}, active: true, note: '', invitedBy: 'owner', createdAt: '', updatedAt: '',
    });
    db.members.push({
      id: 'm2', businessId: 'u1', userId: 'staff', role: 'SECRETARIA',
      permissions: {}, active: true, note: '', invitedBy: 'owner', createdAt: '', updatedAt: '',
    });

    expect(listUnitsForMaster(db).map((u) => u.id).sort()).toEqual(['u1', 'u2']);
    const users = listPlatformUsers(db);
    expect(users.find((u) => u.id === 'master')?.kind).toBe('master');
    expect(users.find((u) => u.id === 'owner')?.kind).toBe('owner');
    expect(users.find((u) => u.id === 'admin')?.kind).toBe('admin');
    expect(users.find((u) => u.id === 'staff')?.kind).toBe('member');
    // DTO seguro: nenhum hash
    const raw = JSON.stringify(users);
    expect(raw).not.toMatch(/passwordHash|scrypt:|token/i);
  });

  it('Master sem SupportSession não acessa dados operacionais via requireBusiness/resolveAccess', () => {
    const db = emptyDB();
    const master = user('master', 'master');
    const owner = user('owner');
    db.users.push(master, owner);
    db.organizations.push(org('org', 'owner'));
    db.businesses.push(unit('u1', 'owner', 'org'));
    expect(resolveAccess(db, master, 'u1')).toBeNull();
    expect(accessibleBusinesses(db, master)).toEqual([]);
  });

  it('Master com SupportSession válida acessa somente a unidade autorizada', () => {
    const db = emptyDB();
    const master = user('master', 'master');
    const owner = user('owner');
    db.users.push(master, owner);
    db.organizations.push(org('org', 'owner'));
    db.businesses.push(unit('anchieta', 'owner', 'org'), unit('olinda', 'owner', 'org'));
    const ss = support({ masterUserId: 'master', businessId: 'anchieta', mode: 'view' });
    const ctx = resolveAccess(db, master, 'anchieta', ss);
    expect(ctx?.isMaster).toBe(true);
    expect(ctx?.readOnly).toBe(true);
    expect(resolveAccess(db, master, 'olinda', ss)).toBeNull();
    expect(accessibleBusinesses(db, master, ss).map((b) => b.id)).toEqual(['anchieta']);
  });

  it('SupportSession expirada é rejeitada', () => {
    const db = emptyDB();
    const master = user('master', 'master');
    db.users.push(master, user('owner'));
    db.businesses.push(unit('u1', 'owner', 'org'));
    const ss = support({ masterUserId: 'master', businessId: 'u1', expiresAt: '2000-01-01' });
    expect(resolveAccess(db, master, 'u1', ss)).toBeNull();
  });

  it('SupportSession de outro Master é rejeitada', () => {
    const db = emptyDB();
    const master = user('master', 'master');
    db.users.push(master, user('owner'));
    db.businesses.push(unit('u1', 'owner', 'org'));
    const ss = support({ masterUserId: 'other-master', businessId: 'u1' });
    expect(resolveAccess(db, master, 'u1', ss)).toBeNull();
  });

  it('Support View = readOnly; Support Admin = escrita liberada na unidade', () => {
    const db = emptyDB();
    const master = user('master', 'master');
    db.users.push(master, user('owner'));
    db.businesses.push(unit('u1', 'owner', 'org'));
    const view = resolveAccess(db, master, 'u1', support({ masterUserId: 'master', businessId: 'u1', mode: 'view' }));
    const admin = resolveAccess(db, master, 'u1', support({ masterUserId: 'master', businessId: 'u1', mode: 'admin' }));
    expect(view?.readOnly).toBe(true);
    expect(admin?.readOnly).toBe(false);
    expect(admin?.role).toBe('MASTER');
  });
});

describe('Master — gestão de privilégio e anti-escalação', () => {
  it('usuário normal / owner / admin não conseguem se auto-promover a master', () => {
    expect(assertCannotSelfPromoteToMaster(user('owner', 'owner'), 'master')).toBe(true);
    expect(assertCannotSelfPromoteToMaster(user('admin', 'admin'), 'master')).toBe(true);
    expect(assertCannotSelfPromoteToMaster(user('staff', 'owner'), 'master')).toBe(true);
    expect(assertCannotSelfPromoteToMaster(user('m', 'master'), 'master')).toBe(false);
    expect(assertCannotSelfPromoteToMaster(user('owner', 'owner'), 'ADMIN')).toBe(false);
  });

  it('Master autorizado promove outro usuário a Master', () => {
    const db = emptyDB();
    db.users.push(user('m1', 'master'), user('u2', 'owner'));
    const r = promoteToMaster(db, 'u2@test.dev');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe('promoted');
      expect(db.users.find((u) => u.id === 'u2')?.role).toBe('master');
    }
    expect(countMasters(db)).toBe(2);
  });

  it('não é possível excluir o último Master', () => {
    const db = emptyDB();
    db.users.push(user('only', 'master'));
    const r = revokeMaster(db, 'only');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('last_master');
    expect(db.users.find((u) => u.id === 'only')?.role).toBe('master');
  });

  it('remoção de Master (quando há outro) altera o acesso imediatamente', () => {
    const db = emptyDB();
    db.users.push(user('m1', 'master'), user('m2', 'master'));
    const r = revokeMaster(db, 'm2');
    expect(r.ok).toBe(true);
    const revoked = db.users.find((u) => u.id === 'm2')!;
    expect(revoked.role).toBe('owner');
    expect(isMasterUser(revoked)).toBe(false);
    expect(countMasters(db)).toBe(1);
  });

  it('upsert cria Master novo com hash (nunca texto puro) e promove existente', () => {
    const db = emptyDB();
    const created = upsertMasterUser(db, {
      email: 'novo@test.dev',
      name: 'Novo',
      passwordHash: 'scrypt:salt:hashvalue',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.created).toBe(true);
      const u = db.users.find((x) => x.id === created.userId)!;
      expect(u.role).toBe('master');
      expect(u.passwordHash).toBe('scrypt:salt:hashvalue');
      expect(u.passwordHash).not.toContain('minha-senha');
    }
    // promover existente
    db.users.push(user('exist', 'owner'));
    const promoted = upsertMasterUser(db, { email: 'exist@test.dev' });
    expect(promoted.ok).toBe(true);
    if (promoted.ok) expect(promoted.action).toBe('promoted');
  });

  it('listMastersSafe não vaza segredos', () => {
    const db = emptyDB();
    db.users.push({ ...user('m', 'master'), passwordHash: 'scrypt:secret:hash' });
    const list = listMastersSafe(db);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|scrypt:secret/);
  });
});

describe('Master — receita da plataforma vs operacional', () => {
  it('receita do InstaLink é zero explícito sem billing; não usa receita de Organizations', () => {
    const db = emptyDB();
    db.users.push(user('m', 'master'), user('o'));
    db.organizations.push(org('org', 'o'));
    db.businesses.push(unit('u1', 'o', 'org'));
    // Simula "receita operacional" enorme no domínio do cliente — Master NÃO a soma.
    db.bookings.push({
      id: 'bk', businessId: 'u1', status: 'completed', date: '2026-09-01',
      total: 999999, price: 999999,
    } as any);
    const overview = platformOverview(db);
    expect(overview.platformRevenueCents).toBe(0);
    expect(overview.billing.implemented).toBe(false);
    expect(overview.billing.mrrCents).toBe(0);
    expect(overview.organizations).toBe(1);
    expect(overview.units).toBe(1);
    expect(overview.platformRevenueHint.toLowerCase()).toMatch(/instalink|plataforma/);
    // Hint deixa explícito que NÃO é receita operacional do cliente.
    expect(overview.platformRevenueHint.toLowerCase()).toMatch(/não confunde|nao confunde|própria plataforma|propria plataforma/);
    // O valor numérico da overview NÃO incorpora o booking de R$ 9.999,99.
    expect(overview.platformRevenueCents).toBe(0);
  });

  it('safeUserView e platformUserKind classificam corretamente', () => {
    const db = emptyDB();
    const master = user('m', 'master');
    const owner = user('o');
    db.users.push(master, owner);
    db.organizations.push(org('org', 'o'));
    db.businesses.push(unit('u1', 'o', 'org'));
    expect(platformUserKind(db, master)).toBe('master');
    expect(platformUserKind(db, owner)).toBe('owner');
    const view = safeUserView(db, owner);
    expect(view.organizationNames).toContain('org');
    expect(view.unitNames).toContain('u1');
    expect((view as any).passwordHash).toBeUndefined();
  });
});

describe('Master — rota e slug reservado', () => {
  it('slug master é reservado (não vira página pública de negócio)', () => {
    expect(RESERVED_SLUGS.has('master')).toBe(true);
    expect(RESERVED_SLUGS.has('admin')).toBe(true);
  });
});

describe('Master — requireMaster (guard de API)', () => {
  it('requireMaster exportado e isMasterUser alinhados com o contrato do guard', () => {
    // O guard real precisa de NextRequest; validamos o núcleo que ele usa.
    expect(typeof requireMaster).toBe('function');
    expect(isMasterUser(user('x', 'master'))).toBe(true);
    expect(isMasterUser(user('x', 'owner'))).toBe(false);
  });
});

describe('Master — MASTER_EMAILS fallback coerente (sem Master invisível)', () => {
  const prev = process.env.MASTER_EMAILS;
  afterEach(() => {
    if (prev === undefined) delete process.env.MASTER_EMAILS;
    else process.env.MASTER_EMAILS = prev;
  });

  it('usuário no banco + MASTER_EMAILS + role≠master: Master efetivo, fora da gestão/contagem', () => {
    process.env.MASTER_EMAILS = 'env-master@test.dev';
    const db = emptyDB();
    const envUser: User = {
      ...user('env', 'owner'),
      email: 'env-master@test.dev',
    };
    const roleMaster = user('role-m', 'master');
    db.users.push(envUser, roleMaster);
    db.organizations.push(org('org', envUser.id));
    db.businesses.push(unit('u1', envUser.id, 'org'));

    // 1–2. autenticável como Master efetivo
    expect(isMasterUser(envUser)).toBe(true);
    expect(hasMasterRole(envUser)).toBe(false);
    expect(isMasterEmail(envUser)).toBe(true);
    expect(masterSourceOf(envUser)).toBe('env');

    // 3. NÃO aparece na lista administrativa de Masters (role)
    expect(listMastersSafe(db).map((m) => m.id)).toEqual(['role-m']);
    // mas é VISÍVEL no diagnóstico env-only (não invisível)
    expect(listEnvOnlyMastersSafe(db).map((m) => m.email)).toEqual(['env-master@test.dev']);

    // 4. NÃO entra em countMasters (só role)
    expect(countMasters(db)).toBe(1);

    // 5. pode usar SupportSession (é Master efetivo)
    const ss = support({ masterUserId: envUser.id, businessId: 'u1', mode: 'view' });
    expect(resolveAccess(db, envUser, 'u1', ss)?.role).toBe('MASTER');

    // 6. last_master NÃO é contornado pelo env: único role=master ainda protegido
    const blocked = revokeMaster(db, 'role-m');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('last_master');

    // revogar env-only via role falha com orientação clara
    const envRevoke = revokeMaster(db, envUser.id);
    expect(envRevoke.ok).toBe(false);
  });

  it('promover env-only grava role=master e entra na gestão', () => {
    process.env.MASTER_EMAILS = 'env-master@test.dev';
    const db = emptyDB();
    const envUser: User = { ...user('env', 'owner'), email: 'env-master@test.dev' };
    db.users.push(envUser, user('other', 'master'));
    const r = promoteToMaster(db, 'env-master@test.dev');
    expect(r.ok).toBe(true);
    expect(hasMasterRole(envUser)).toBe(true);
    expect(listMastersSafe(db).map((m) => m.email).sort()).toEqual(['env-master@test.dev', 'other@test.dev']);
    expect(listEnvOnlyMastersSafe(db)).toEqual([]);
    expect(countMasters(db)).toBe(2);
  });
});

describe('Master — precedência sobre vínculos de tenant', () => {
  const prev = process.env.MASTER_EMAILS;
  afterEach(() => {
    if (prev === undefined) delete process.env.MASTER_EMAILS;
    else process.env.MASTER_EMAILS = prev;
  });

  it('Master + BusinessOwner: SEM SupportSession não acessa a própria unidade', () => {
    const db = emptyDB();
    // Mesmo usuário: role=master E ownerId da business
    const masterOwner = user('mo', 'master');
    db.users.push(masterOwner);
    db.organizations.push(org('org', masterOwner.id));
    db.businesses.push(unit('clinic', masterOwner.id, 'org'));

    expect(isMasterUser(masterOwner)).toBe(true);
    expect(resolveAccess(db, masterOwner, 'clinic')).toBeNull();
    expect(accessibleBusinesses(db, masterOwner)).toEqual([]);
    expect(roleIn(db, masterOwner, 'clinic')).toBe('');
    expect(canManageOrganization(db, masterOwner, 'org')).toBe(false);
    expect(organizationsFor(db, masterOwner)).toEqual([]);

    // COM SupportSession: acesso MASTER (não OWNER)
    const ss = support({ masterUserId: masterOwner.id, businessId: 'clinic', mode: 'admin' });
    const ctx = resolveAccess(db, masterOwner, 'clinic', ss);
    expect(ctx?.role).toBe('MASTER');
    expect(ctx?.isOwner).toBe(false);
    expect(ctx?.isMaster).toBe(true);
    expect(ctx?.readOnly).toBe(false);
    expect(accessibleBusinesses(db, masterOwner, ss).map((b) => b.id)).toEqual(['clinic']);
  });

  it('Master + OrganizationAdmin: vínculo org NÃO concede unidades sem suporte', () => {
    const db = emptyDB();
    const masterAdmin = user('ma', 'master');
    const owner = user('owner');
    db.users.push(masterAdmin, owner);
    db.organizations.push(org('org-a', owner.id));
    db.organizationMembers.push({
      id: 'om', organizationId: 'org-a', userId: masterAdmin.id, role: 'ADMIN',
      active: true, createdAt: '', updatedAt: '',
    });
    db.businesses.push(unit('a1', owner.id, 'org-a'), unit('a2', owner.id, 'org-a'));

    expect(resolveAccess(db, masterAdmin, 'a1')).toBeNull();
    expect(resolveAccess(db, masterAdmin, 'a2')).toBeNull();
    expect(accessibleBusinesses(db, masterAdmin)).toEqual([]);
    expect(canManageOrganization(db, masterAdmin, 'org-a')).toBe(false);

    const ss = support({ masterUserId: masterAdmin.id, businessId: 'a1', mode: 'view' });
    expect(resolveAccess(db, masterAdmin, 'a1', ss)?.role).toBe('MASTER');
    expect(resolveAccess(db, masterAdmin, 'a2', ss)).toBeNull();
  });

  it('Master via MASTER_EMAILS + BusinessMember: mesma precedência, exige SupportSession', () => {
    process.env.MASTER_EMAILS = 'env-member@test.dev';
    const db = emptyDB();
    const envMember: User = { ...user('em', 'owner'), email: 'env-member@test.dev' };
    const owner = user('owner');
    db.users.push(envMember, owner);
    db.organizations.push(org('org', owner.id));
    db.businesses.push(unit('u1', owner.id, 'org'), unit('u2', owner.id, 'org'));
    db.members.push({
      id: 'mem', businessId: 'u1', userId: envMember.id, role: 'ADMIN',
      permissions: {}, active: true, note: '', invitedBy: owner.id, createdAt: '', updatedAt: '',
    });

    expect(isMasterUser(envMember)).toBe(true);
    expect(hasMasterRole(envMember)).toBe(false);
    // Membership antigo NÃO libera dashboard operacional
    expect(resolveAccess(db, envMember, 'u1')).toBeNull();
    expect(accessibleBusinesses(db, envMember)).toEqual([]);
    expect(roleIn(db, envMember, 'u1')).toBe('');

    const ss = support({ masterUserId: envMember.id, businessId: 'u1', mode: 'view' });
    expect(resolveAccess(db, envMember, 'u1', ss)?.role).toBe('MASTER');
    expect(resolveAccess(db, envMember, 'u2', ss)).toBeNull();
    expect(accessibleBusinesses(db, envMember, ss).map((b) => b.id)).toEqual(['u1']);
  });

  it('usuário NÃO-master com ownership continua acessando normalmente', () => {
    const db = emptyDB();
    const owner = user('owner', 'owner');
    db.users.push(owner);
    db.organizations.push(org('org', owner.id));
    db.businesses.push(unit('u1', owner.id, 'org'));
    const ctx = resolveAccess(db, owner, 'u1');
    expect(ctx?.role).toBe('OWNER');
    expect(ctx?.isMaster).toBe(false);
    expect(accessibleBusinesses(db, owner).map((b) => b.id)).toEqual(['u1']);
  });
});
