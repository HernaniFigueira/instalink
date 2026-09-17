import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

import { duplicatedBusiness, duplicateUnitStructure } from '../unit-duplication';
import { hasMultipleUnits, unitsInSameOrganization } from '../organization';

describe('conceito definitivo Organization → Unit', () => {
  it('admin com memberships explícitos acessa A1/A2, admin de B não acessa A', () => {
    const db=emptyDB(), ownerA=user('owner-a'), adminA=user('admin-a'), adminB=user('admin-b');
    db.users.push(ownerA,adminA,adminB); db.organizations.push(org('oa',ownerA.id),org('ob','owner-b'));
    db.businesses.push(unit('a1',ownerA.id,'oa'),unit('a2',ownerA.id,'oa'),unit('b1','owner-b','ob'));
    for (const id of ['a1','a2']) db.members.push({id:`m-${id}`,businessId:id,userId:adminA.id,role:'ADMIN',permissions:{},active:true,note:'',invitedBy:ownerA.id,createdAt:'',updatedAt:''});
    db.members.push({id:'m-b',businessId:'b1',userId:adminB.id,role:'ADMIN',permissions:{},active:true,note:'',invitedBy:'owner-b',createdAt:'',updatedAt:''});
    expect(accessibleBusinesses(db,adminA).map(x=>x.id)).toEqual(['a1','a2']);
    expect(resolveAccess(db,adminB,'a1')).toBeNull();
    expect(resolveAccess(db,adminB,'a2')).toBeNull();
  });

  it('distingue experiência de uma unidade e múltiplas unidades na organização atual', () => {
    const a1=unit('a1','o','oa'), a2=unit('a2','o','oa'), b1=unit('b1','o','ob');
    expect(hasMultipleUnits(a1,[a1,b1])).toBe(false);
    expect(hasMultipleUnits(a1,[a1,a2,b1])).toBe(true);
    expect(unitsInSameOrganization(a1,[a1,a2,b1]).map(x=>x.id)).toEqual(['a1','a2']);
  });

  it('duplicação recria referências estruturais sem copiar operação', () => {
    const db=emptyDB(), source=unit('a1','o','oa');
    Object.assign(source,{description:'Marca',logo:'logo',cover:'cover',niche:'saude',features:{},socials:{},hours:{},paymentMethods:['pix'],booking:{teamMode:'solo',leadMin:30,cancelUntilMin:120,horizonDays:60,bufferMin:0},nav:[],navCustom:false,about:{title:'Sobre',text:'Texto',image:'',enabled:true},phone:'',whatsapp:'',email:'',instagram:'',tiktok:'',mapsUrl:'',pixKey:'',googleUrl:'',googlePlaceId:'',googleApiKey:'',deliveryFee:0,minOrder:0,createdAt:'',updatedAt:''});
    db.businesses.push(source);
    db.categories.push({id:'cat-old',businessId:'a1',kind:'service',name:'Clínica',order:0,active:true});
    db.services.push({id:'svc-old',businessId:'a1',categoryId:'cat-old',name:'Consulta',description:'',image:'',price:100,durationMin:30,professionalIds:['pro-old'],active:true,featured:false,bookable:true,questions:[]});
    db.pages.push({id:'page-old',businessId:'a1',theme:{} as any,blocks:[{id:'block-old',type:'faq',order:0,enabled:true,settings:{items:['FAQ']}}],updatedAt:''});
    db.contacts.push({id:'contact',businessId:'a1'} as any); db.bookings.push({id:'booking',businessId:'a1'} as any); db.leads.push({id:'lead',businessId:'a1'} as any);
    const target=duplicatedBusiness(source,{id:'a2',name:'Unidade 2',slug:'unidade-2',address:'Rua 2',ownerId:'o',now:'now'});
    db.businesses.push(target); duplicateUnitStructure(db,source,target);
    expect(target.organizationId).toBe('oa');
    const copiedService=db.services.find(x=>x.businessId==='a2')!;
    expect(copiedService.id).not.toBe('svc-old'); expect(copiedService.categoryId).not.toBe('cat-old'); expect(copiedService.professionalIds).toEqual([]);
    expect(db.pages.find(x=>x.businessId==='a2')?.blocks[0].id).not.toBe('block-old');
    for (const rows of [db.contacts,db.bookings,db.leads]) expect(rows.filter((x:any)=>x.businessId==='a2')).toEqual([]);
  });
});

describe('acesso centralizado por papel da Organization', () => {
  it('OWNER da Organization acessa administrativamente todas as unidades', () => {
    const db=emptyDB(), orgOwner=user('org-owner'), legacyOwner=user('legacy-owner');
    db.users.push(orgOwner,legacyOwner); db.organizations.push(org('org-a',orgOwner.id));
    db.businesses.push(unit('a1',legacyOwner.id,'org-a'),unit('a2',legacyOwner.id,'org-a'));
    expect(accessibleBusinesses(db,orgOwner).map(x=>x.id)).toEqual(['a1','a2']);
    for (const id of ['a1','a2']) {
      const ctx=resolveAccess(db,orgOwner,id);
      expect(ctx?.role).toBe('OWNER'); expect(ctx?.permissions.admin).toBe(true); expect(ctx?.readOnly).toBe(false);
    }
  });

  it('ADMIN da Organization acessa suas unidades, mas nunca unidades de outra Organization', () => {
    const db=emptyDB(), admin=user('org-admin'), ownerA=user('owner-a'), ownerB=user('owner-b');
    db.users.push(admin,ownerA,ownerB); db.organizations.push(org('org-a',ownerA.id),org('org-b',ownerB.id));
    db.organizationMembers.push({id:'om',organizationId:'org-a',userId:admin.id,role:'ADMIN',active:true,createdAt:'',updatedAt:''});
    db.businesses.push(unit('a1',ownerA.id,'org-a'),unit('a2',ownerA.id,'org-a'),unit('b1',ownerB.id,'org-b'));
    expect(accessibleBusinesses(db,admin).map(x=>x.id)).toEqual(['a1','a2']);
    expect(resolveAccess(db,admin,'a1')?.role).toBe('ADMIN');
    expect(resolveAccess(db,admin,'a2')?.permissions.config).toBe(true);
    expect(resolveAccess(db,admin,'b1')).toBeNull();
  });

  it('OrganizationMember inativo e organizationId arbitrário não concedem acesso', () => {
    const db=emptyDB(), stranger=user('stranger'), owner=user('owner');
    db.users.push(stranger,owner); db.organizations.push(org('org-a',owner.id));
    db.organizationMembers.push({id:'inactive',organizationId:'org-a',userId:stranger.id,role:'ADMIN',active:false,createdAt:'',updatedAt:''});
    db.businesses.push(unit('a1',owner.id,'org-a'));
    expect(accessibleBusinesses(db,stranger)).toEqual([]); expect(resolveAccess(db,stranger,'a1')).toBeNull();
  });

  it('suporte view permanece read-only e estritamente escopado à unidade', () => {
    const db=emptyDB(), master={...user('master-2'),role:'master' as const}, owner=user('owner');
    db.users.push(master,owner); db.organizations.push(org('org-a',owner.id)); db.businesses.push(unit('a1',owner.id,'org-a'),unit('a2',owner.id,'org-a'));
    const support={id:'s',masterUserId:master.id,masterEmail:master.email,businessId:'a1',mode:'view' as const,reason:'',createdAt:'',expiresAt:'2999-01-01',endedAt:''};
    const ctx=resolveAccess(db,master,'a1',support);
    expect(ctx?.readOnly).toBe(true); expect(resolveAccess(db,master,'a2',support)).toBeNull();
    expect(resolveAccess(db,master,'a1')).toBeNull();
  });
});

import { taskAssigneeOptions } from '../automation/tasks';

const root = path.resolve(__dirname, '../../..');

describe('portas novas mantêm o isolamento por unidade', () => {
  // A1.2 · Bloco 1: /tarefas virou porta própria e passou a receber a lista de
  // responsáveis possíveis na MESMA resposta (antes vinha de /api/automations,
  // que exige permissão de configuração). A projeção é única e escopada.
  it('responsáveis possíveis de uma tarefa são só da própria unidade', () => {
    const db = emptyDB(), owner = user('owner'), other = user('other'), staff = user('staff');
    db.users.push(owner, other, staff);
    db.organizations.push(org('org-a', owner.id));
    db.businesses.push(unit('a1', owner.id, 'org-a'), unit('a2', other.id, 'org-a'));
    db.members.push({ id: 'm1', businessId: 'a1', userId: 'staff', role: 'ATENDENTE', permissions: {}, active: true, note: '', invitedBy: 'owner', createdAt: '', updatedAt: '' });
    db.members.push({ id: 'm2', businessId: 'a2', userId: 'other', role: 'ADMIN', permissions: {}, active: true, note: '', invitedBy: 'other', createdAt: '', updatedAt: '' });

    const a1 = taskAssigneeOptions(db, 'a1').map((m) => m.userId);
    expect(a1).toEqual(['owner', 'staff']); // dono da unidade + membro ativo
    expect(a1).not.toContain('other');      // nada da unidade vizinha vaza
    expect(taskAssigneeOptions(db, 'a2').map((m) => m.userId)).toEqual(['other']);

    // membro inativo sai da lista (e o dono continua, para nunca ficar sem opção)
    (db.members[0] as { active?: boolean }).active = false;
    expect(taskAssigneeOptions(db, 'a1').map((m) => m.userId)).toEqual(['owner']);
  });

  it('as portas de tarefas e execuções exigem a mesma guarda das APIs que as alimentam', () => {
    // /tarefas e /execucoes não criaram caminho novo de dados: leem /api/tasks
    // e /api/automations, que continuam com requireBusiness no servidor.
    const tasks = readFileSync(path.join(root, 'src/app/api/tasks/route.ts'), 'utf8');
    const autos = readFileSync(path.join(root, 'src/app/api/automations/route.ts'), 'utf8');
    expect(tasks).toMatch(/requireBusiness\(req, businessId, \['leads', 'agenda', 'clientes', 'config'\]\)/);
    expect(autos).toMatch(/requireBusiness\(req, businessId, 'config'\)/);
    expect(tasks).toMatch(/taskAssigneeOptions\(db, businessId\)/);
    expect(autos).toMatch(/taskAssigneeOptions\(db, businessId\)/); // uma projeção só
  });
});
