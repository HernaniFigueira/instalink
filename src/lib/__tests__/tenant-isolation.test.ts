import { describe, expect, it } from 'vitest';
import { accessibleBusinesses, resolveAccess } from '../access';
import { canManageOrganization, organizationsFor, unitsForOrganization } from '../organization';
import { emptyDB } from '../db';
import type { Business, Organization, User } from '../types';

const user = (id:string):User => ({ id, name:id, email:`${id}@test.dev`, passwordHash:'', createdAt:'2026-01-01', role:'owner' });
const org = (id:string, ownerId:string):Organization => ({ id, ownerId, name:id, metadata:{}, createdAt:'2026-01-01', updatedAt:'2026-01-01' });
const unit = (id:string, ownerId:string, organizationId:string) => ({ id, ownerId, organizationId, name:id, slug:id, modes:[], features:{}, published:false } as unknown as Business);

describe('isolamento Organization → Unit', () => {
  it('não amplia acesso só porque organizationId foi informado', () => {
    const db=emptyDB(), a=user('a'), b=user('b'); db.users.push(a,b); db.organizations.push(org('oa','a'),org('ob','b')); db.businesses.push(unit('ua','a','oa'),unit('ub','b','ob'));
    expect(accessibleBusinesses(db,a).map(x=>x.id)).toEqual(['ua']);
    expect(organizationsFor(db,a).map(x=>x.id)).toEqual(['oa']);
    expect(unitsForOrganization(db,a,'ob')).toEqual([]);
    expect(canManageOrganization(db,a,'ob')).toBe(false);
    expect(resolveAccess(db,a,'ub')).toBeNull();
  });

  it('membro de uma unidade não ganha as demais unidades da organização', () => {
    const db=emptyDB(), owner=user('o'), staff=user('s'); db.users.push(owner,staff); db.organizations.push(org('org','o')); db.businesses.push(unit('u1','o','org'),unit('u2','o','org'));
    db.members.push({ id:'m', businessId:'u1', userId:'s', role:'ADMIN', permissions:{}, active:true, note:'', invitedBy:'o', createdAt:'', updatedAt:'' });
    expect(accessibleBusinesses(db,staff).map(x=>x.id)).toEqual(['u1']);
    expect(unitsForOrganization(db,staff,'org').map(x=>x.id)).toEqual(['u1']);
    expect(resolveAccess(db,staff,'u2')).toBeNull();
  });

  it('master exige sessão de suporte própria, vigente e escopada', () => {
    const db=emptyDB(), master={...user('master'),role:'master' as const}, owner=user('o'); db.users.push(master,owner); db.organizations.push(org('org','o')); db.businesses.push(unit('u1','o','org'),unit('u2','o','org'));
    const base={id:'ss',masterEmail:master.email,mode:'view' as const,reason:'teste',createdAt:'',endedAt:''};
    expect(resolveAccess(db,master,'u1')).toBeNull();
    expect(resolveAccess(db,master,'u1',{...base,masterUserId:'other',businessId:'u1',expiresAt:'2999-01-01'})).toBeNull();
    expect(resolveAccess(db,master,'u1',{...base,masterUserId:'master',businessId:'u1',expiresAt:'2000-01-01'})).toBeNull();
    const ctx=resolveAccess(db,master,'u1',{...base,masterUserId:'master',businessId:'u1',expiresAt:'2999-01-01'});
    expect(ctx?.readOnly).toBe(true); expect(resolveAccess(db,master,'u2',ctx!.support)).toBeNull();
  });
});

import { normalizeDB } from '../db';
import { requiresActiveBusiness } from '../business-context';

describe('migração e navegação multiunidade', () => {
  it('cria uma Organization independente por Business legado do mesmo owner e é idempotente', () => {
    const raw = emptyDB();
    const legacyA = unit('clinica', 'owner', '') as any;
    const legacyB = unit('agencia', 'owner', '') as any;
    delete legacyA.organizationId; delete legacyB.organizationId;
    raw.businesses.push(legacyA, legacyB);
    const once = normalizeDB(raw);
    expect(once.businesses.map((b) => b.organizationId)).toEqual(['org-clinica', 'org-agencia']);
    expect(once.organizations.map((o) => o.id)).toEqual(['org-clinica', 'org-agencia']);
    const twice = normalizeDB(once);
    expect(twice.organizations).toHaveLength(2);
    expect(twice.businesses.map((b) => b.organizationId)).toEqual(['org-clinica', 'org-agencia']);
  });

  it('nova unidade entra somente na Organization explicitamente escolhida e não copia dados operacionais', () => {
    const db = emptyDB(), owner = user('owner');
    db.users.push(owner); db.organizations.push(org('org-a', owner.id), org('org-b', owner.id));
    db.businesses.push(unit('a1', owner.id, 'org-a'), unit('b1', owner.id, 'org-b'));
    db.contacts.push({ id:'contact-a', businessId:'a1' } as any);
    db.services.push({ id:'service-a', businessId:'a1' } as any);
    // Semântica aplicada pelo POST /api/businesses: organizationId explícito,
    // Business novo; nenhum agregado operacional é clonado.
    db.businesses.push(unit('a2', owner.id, 'org-a'));
    expect(db.businesses.filter((b) => b.organizationId === 'org-a').map((b) => b.id)).toEqual(['a1', 'a2']);
    expect(db.businesses.filter((b) => b.organizationId === 'org-b').map((b) => b.id)).toEqual(['b1']);
    expect(db.contacts.filter((x) => x.businessId === 'a2')).toEqual([]);
    expect(db.services.filter((x) => x.businessId === 'a2')).toEqual([]);
  });

  it('/organizacao e /organizacao?add=1 não exigem unidade, outras rotas continuam protegidas', () => {
    expect(requiresActiveBusiness('/organizacao')).toBe(false);
    expect(requiresActiveBusiness('/organizacao/')).toBe(false);
    expect(requiresActiveBusiness('/dashboard')).toBe(true);
    expect(requiresActiveBusiness('/agenda')).toBe(true);
  });
});
