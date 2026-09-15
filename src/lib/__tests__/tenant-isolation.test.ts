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
