// PR #46 · Equipe UX closure + contrato de Disponibilidade/Serviços
// Cobre: presets de papel, troca de papel limpando overrides, normalização de
// override legado, Owner, filtro de permissões clínicas, preservação de
// Availability própria (follow ⇄ own), horário próprio sem configuração,
// serviço sugerido com duração editável e mensagens de erro em linguagem de produto.
import './helpers/temp-db';
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession, hashPassword } from '../auth';
import { GET as teamGET, POST as teamPOST } from '@/app/api/team/route';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import { TEMP_DB_FILE } from './helpers/temp-db';
import { PERMISSIONS, ROLES, permissionsFor } from '../permissions';
import {
  ADVANCED_PERMISSIONS, LEGACY_ONLY_PERMISSIONS, applyRolePreset, editorPermissions, hasRealAdjustments,
  humanizePersonError, isLegacyRole, minimalOverrides, overridesForOpenMember, presetSummary, splitRolesForEditor,
} from '../equipe-access';
import { followsBusinessHours, rulesForProfessional, hasOwnRules } from '../schedule';
import { durationSuggestionLabel, searchVetCatalog } from '../vet-service-catalog';
import type { Business, PermissionId } from '../types';

const NOW = '2026-09-30T12:00:00.000Z';
const BIZ = 'biz-ux';
const OWNER = 'owner-ux';

function business(): Business {
  return {
    id: BIZ, ownerId: OWNER, organizationId: `org-${BIZ}`, name: 'Clínica UX', slug: BIZ, description: '', logo: '', cover: '',
    niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '', hours: {}, paymentMethods: [],
    pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false }, published: true,
    createdAt: NOW, updatedAt: NOW,
  } as Business;
}
const req = (body: any, token: string) => new NextRequest('http://test/api/x', {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` } as any,
});
const getTeam = (token: string) => new NextRequest(`http://test/api/team?businessId=${BIZ}`, {
  headers: { authorization: `Bearer ${token}` } as any,
});
const team = (body: any, token: string): Promise<Response> => teamPOST(req({ businessId: BIZ, ...body }, token));
const catalog = (body: any, token: string): Promise<Response> => catalogPOST(req({ businessId: BIZ, ...body }, token));

const BASE_PERSON = {
  action: 'person.save', hasAccess: true, hasClinical: true, password: '123456',
  funcao: 'Veterinário', crmvUf: 'SP', crmvNumero: '12345', serviceIds: [], pendingServices: [],
};

describe('PR46 · Equipe — papéis como presets simples (puro)', () => {
  it('Recepção (SECRETARIA): só Agenda, Clientes e WhatsApp; Oportunidades requer override', () => {
    const def = ROLES.find((r) => r.id === 'SECRETARIA')!;
    expect(def.label).toBe('Recepção');
    expect([...def.permissions].sort()).toEqual(['agenda', 'clientes', 'whatsapp']);
    const p = permissionsFor('SECRETARIA');
    for (const id of ['leads', 'dashboard', 'pedidos', 'catalogo', 'pagina', 'agente', 'campanhas', 'equipe', 'config', 'financeiro', 'admin', 'atendimento'] as PermissionId[]) {
      expect(p[id], id).toBe(false);
    }
  });

  it('Profissional: agenda, clientes e atendimento; sem configuração/estrutura/página/pedidos/agente/admin', () => {
    const p = permissionsFor('PROFISSIONAL');
    expect(p.atendimento && p.agenda && p.clientes).toBe(true);
    for (const id of ['config', 'equipe', 'catalogo', 'pagina', 'pedidos', 'agente', 'admin', 'financeiro', 'campanhas'] as PermissionId[]) {
      expect(p[id], id).toBe(false);
    }
  });

  it('Administrador nunca recebe administração da plataforma; Owner tem acesso total', () => {
    expect(permissionsFor('ADMIN').admin).toBe(false);
    expect(PERMISSIONS.every((perm) => permissionsFor('OWNER')[perm.id])).toBe(true);
  });

  it('fluxo padrão mostra só Administrador/Recepção/Profissional; legados em "Outros papéis"', () => {
    const roles = ROLES.filter((r) => r.id !== 'OWNER');
    const s = splitRolesForEditor(roles, 'SECRETARIA');
    expect(s.primary.map((r) => r.id)).toEqual(['ADMIN', 'SECRETARIA', 'PROFISSIONAL']);
    expect(s.other.map((r) => r.id)).toEqual(['VENDEDOR', 'VIEWER']);
    expect(s.openOther).toBe(false);
    expect(splitRolesForEditor(roles, 'ATENDENTE').openOther).toBe(true); // registro legado continua editável
    expect(isLegacyRole('VIEWER')).toBe(true);
  });

  it('resumo do preset descreve o acesso padrão sem Pedidos/Página com legado OFF', () => {
    expect(presetSummary('SECRETARIA', { legacyPages: false })).toEqual(['Agenda', 'Clientes', 'WhatsApp']);
    expect(presetSummary('ADMIN', { legacyPages: false })).not.toContain('Pedidos');
    expect(presetSummary('ADMIN', { legacyPages: true })).toContain('Pedidos');
  });

  it('filtro clínico: com GODOUTOR_LEGACY_PAGES OFF, Página/Pedidos somem do editor (IDs continuam válidos)', () => {
    const off = editorPermissions(PERMISSIONS, { legacyPages: false });
    const ids = [...off.core, ...off.advanced].map((p) => p.id);
    for (const id of LEGACY_ONLY_PERMISSIONS) expect(ids).not.toContain(id);
    // avançadas só dentro de "Personalizar acesso" (grupo próprio)
    expect(off.core.map((p) => p.id)).not.toEqual(expect.arrayContaining(['agente']));
    for (const id of ['agente', 'admin', 'config'] as PermissionId[]) {
      expect(off.advanced.map((p) => p.id)).toContain(id);
      expect(ADVANCED_PERMISSIONS).toContain(id);
    }
    const on = editorPermissions(PERMISSIONS, { legacyPages: true });
    expect([...on.core, ...on.advanced].map((p) => p.id)).toEqual(expect.arrayContaining(['pagina', 'pedidos']));
    // catálogo de permissões intacto
    expect(PERMISSIONS.map((p) => p.id)).toEqual(expect.arrayContaining(['pagina', 'pedidos']));
  });

  it('`ajuste` só existe com diferença REAL do preset (override igual ao preset é normalizado)', () => {
    expect(minimalOverrides('SECRETARIA', { agenda: true, clientes: true, leads: true, whatsapp: true, dashboard: false })).toEqual({ leads: true });
    expect(hasRealAdjustments('SECRETARIA', { agenda: true, dashboard: false })).toBe(false);
    expect(minimalOverrides('SECRETARIA', { dashboard: true, agenda: true })).toEqual({ dashboard: true });
    expect(hasRealAdjustments('SECRETARIA', { dashboard: true })).toBe(true);
    // chaves inválidas / não-booleanas descartadas; OWNER sem overrides
    expect(minimalOverrides('SECRETARIA', { foo: true, dashboard: 'sim' } as any)).toEqual({});
    expect(minimalOverrides('OWNER', { dashboard: false })).toEqual({});
  });

  it('abrir Member legado deriva overrides mínimos contra permissionsFor(role)', () => {
    // só `permissions` (sem permissionOverrides): efetivas idênticas ao preset → nenhum ajuste
    expect(overridesForOpenMember({ role: 'SECRETARIA', permissions: permissionsFor('SECRETARIA') })).toEqual({});
    // legado com overrides redundantes
    expect(overridesForOpenMember({ role: 'SECRETARIA', permissionOverrides: { agenda: true, dashboard: false, pedidos: false } })).toEqual({});
    // diferença real preservada
    expect(overridesForOpenMember({ role: 'SECRETARIA', permissionOverrides: { agenda: true, financeiro: true } })).toEqual({ financeiro: true });
  });

  it('trocar de papel aplica preset limpo (sem overrides herdados)', () => {
    expect(applyRolePreset('PROFISSIONAL')).toEqual({ role: 'PROFISSIONAL', overrides: {} });
  });

  it('mensagens de erro não expõem Member/User/Professional nem ids', () => {
    const cases = [
      humanizePersonError('Membro não encontrado.', 404),
      humanizePersonError('Profissional não encontrado.', 404),
      humanizePersonError('Usuário não encontrado', 404),
      humanizePersonError('falha userId=3f2b1c4a-1111-2222-3333-444455556666 memberId x', 500),
    ];
    for (const m of cases) {
      expect(m).not.toMatch(/\b(membro|member|user|professional)\b/i);
      expect(m).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(m.length).toBeGreaterThan(10);
    }
    expect(humanizePersonError('CPF inválido.', 400)).toBe('CPF inválido.');
  });
});

describe('PR46 · Equipe — rotas reais (person.save / team GET / catalog)', () => {
  let ownerToken = '';
  beforeEach(async () => {
    fs.rmSync(TEMP_DB_FILE, { force: true });
    const db = emptyDB();
    db.users.push({ id: OWNER, name: 'Owner', email: 'owner@ux.com', passwordHash: hashPassword('x123456'), createdAt: NOW, role: 'owner' } as any);
    db.businesses.push(business());
    db.organizations.push({ id: `org-${BIZ}`, name: 'Org', ownerId: OWNER, createdAt: NOW } as any);
    await writeDB(db);
    ownerToken = await createSession(OWNER);
  });

  async function createPerson(extra: Record<string, any>) {
    const res = await team({ ...BASE_PERSON, mode: 'create', name: 'Pessoa', email: `p${Math.random().toString(36).slice(2, 8)}@ux.com`, ...extra }, ownerToken);
    expect(res.status).toBe(200);
    return await res.json() as any;
  }

  it('trocar papel limpa overrides antigos (payload da UI e payload sem overrides)', async () => {
    const created = await createPerson({ name: 'Ana', hasClinical: false, role: 'ATENDENTE', permissionOverrides: { financeiro: true } });
    let db = await readDB();
    expect(db.members.find((m) => m.id === created.memberId)!.permissions).toEqual({ financeiro: true });
    // UI: ao trocar papel envia overrides {} (preset limpo)
    let res = await team({ ...BASE_PERSON, mode: 'update', hasClinical: false, name: 'Ana', email: 'ana@ux.com', existingMemberId: created.memberId, existingUserId: created.userId, role: 'SECRETARIA', permissionOverrides: {} }, ownerToken);
    expect(res.status).toBe(200);
    db = await readDB();
    const m = db.members.find((x) => x.id === created.memberId)!;
    expect(m.role).toBe('SECRETARIA');
    expect(m.permissions).toEqual({});
    expect(permissionsFor(m.role, m.permissions)).toEqual(permissionsFor('SECRETARIA'));

    // API sem `permissionOverrides`: overrides do papel anterior também NÃO contaminam o novo
    res = await team({ ...BASE_PERSON, mode: 'update', hasClinical: false, name: 'Ana', email: 'ana@ux.com', existingMemberId: created.memberId, existingUserId: created.userId, role: 'ATENDENTE', permissionOverrides: { campanhas: true } }, ownerToken);
    expect(res.status).toBe(200);
    res = await team({ ...BASE_PERSON, mode: 'update', hasClinical: false, name: 'Ana', email: 'ana@ux.com', existingMemberId: created.memberId, existingUserId: created.userId, role: 'PROFISSIONAL' }, ownerToken);
    expect(res.status).toBe(200);
    db = await readDB();
    expect(db.members.find((x) => x.id === created.memberId)!.permissions).toEqual({});
  });

  it('override redundante (igual ao preset) é normalizado ao salvar; diferença real persiste', async () => {
    const created = await createPerson({ name: 'Maria', hasClinical: false, role: 'SECRETARIA', permissionOverrides: { agenda: true, leads: true, dashboard: true } });
    const db = await readDB();
    expect(db.members.find((m) => m.id === created.memberId)!.permissions).toEqual({ dashboard: true, leads: true });
  });

  it('GET /api/team normaliza Member legado (override idêntico ao preset não vira `ajuste`)', async () => {
    const db = await readDB();
    db.users.push({ id: 'u-maria', name: 'Maria', email: 'maria@ux.com', passwordHash: 'x', createdAt: NOW, role: 'owner' } as any);
    // legado: overrides gravados a partir do antigo preset (dashboard/pedidos ligados) + redundantes
    db.members.push({ id: 'm-maria', businessId: BIZ, userId: 'u-maria', role: 'SECRETARIA', permissions: { agenda: true, clientes: true, whatsapp: true, dashboard: false, pedidos: false }, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW } as any);
    await writeDB(db);
    const j = await (await teamGET(getTeam(ownerToken))).json() as any;
    const maria = j.members.find((m: any) => m.id === 'm-maria');
    expect(maria.permissionOverrides).toEqual({});
    expect(maria.permissions.dashboard).toBe(false); // efetivas seguem o preset
    expect(j.roles.find((r: any) => r.id === 'SECRETARIA').label).toBe('Recepção');
  });

  it('Owner: person.save nunca cria Member nem rebaixa/altera papel do proprietário', async () => {
    const before = await readDB();
    const membersBefore = before.members.length;
    const res = await team({ action: 'person.save', mode: 'update', existingUserId: OWNER, name: 'Owner', email: 'owner@ux.com', hasAccess: true, hasClinical: false, role: 'VIEWER', permissionOverrides: { agenda: false } }, ownerToken);
    expect([200, 400, 403]).toContain(res.status);
    const db = await readDB();
    expect(db.members.length).toBe(membersBefore);
    expect(db.members.some((m) => m.userId === OWNER)).toBe(false);
    expect(db.businesses.find((b) => b.id === BIZ)!.ownerId).toBe(OWNER);
    // proprietário segue com acesso total
    expect(PERMISSIONS.every((p) => permissionsFor('OWNER', { agenda: false })[p.id])).toBe(true);
    // Papel OWNER não pode ser atribuído a outra pessoa
    const bad = await team({ ...BASE_PERSON, mode: 'create', hasClinical: false, name: 'Golpe', email: 'golpe@ux.com', role: 'OWNER' }, ownerToken);
    expect(bad.status).toBe(400);
    expect((await readDB()).members.length).toBe(membersBefore);
  });

  it('Disponibilidade: horário próprio → seguir clínica → horário próprio = regras antigas preservadas', async () => {
    const created = await createPerson({ name: 'Dr Orlando', hasAccess: false, email: '', dispMode: 'follow' });
    const proId = created.professionalId as string;
    // configura horário próprio (janela explícita enviada pelo usuário)
    let res = await catalog({ action: 'professional.hours', id: proId, follow: false, rules: [{ weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }, { weekday: 3, start: '14:00', end: '18:00', slotMin: 30 }] }, ownerToken);
    expect(res.status).toBe(200);
    let db = await readDB();
    expect(db.availability.filter((a) => a.professionalId === proId)).toHaveLength(2);
    expect(followsBusinessHours(db.professionals.find((p) => p.id === proId)!, db.availability)).toBe(false);

    const update = (dispMode: 'follow' | 'own') => team({
      action: 'person.save', mode: 'update', hasAccess: false, hasClinical: true, name: 'Dr Orlando', email: '',
      existingProfessionalId: proId, funcao: 'Veterinário', crmvUf: 'SP', crmvNumero: '12345', serviceIds: [], pendingServices: [], dispMode,
    }, ownerToken);

    // → seguir clínica (via person.save, o drawer)
    res = await update('follow');
    expect(res.status).toBe(200);
    db = await readDB();
    let pro = db.professionals.find((p) => p.id === proId)!;
    expect(pro.followBusinessHours).toBe(true);
    expect(db.availability.filter((a) => a.professionalId === proId)).toHaveLength(2); // preservadas
    expect(rulesForProfessional(pro, db.availability).every((r) => !r.professionalId)).toBe(true); // inativas enquanto herda

    // → horário próprio novamente: regras antigas reaparecem
    res = await update('own');
    expect(res.status).toBe(200);
    db = await readDB();
    pro = db.professionals.find((p) => p.id === proId)!;
    expect(pro.followBusinessHours).toBe(false);
    const eff = rulesForProfessional(pro, db.availability);
    expect(eff).toHaveLength(2);
    expect(eff.map((r) => `${r.weekday}${r.start}${r.end}`).sort()).toEqual(['1' + '09:00' + '12:00', '3' + '14:00' + '18:00'].sort());
  });

  it('Disponibilidade: professional.hours(follow) e availability.applyToAll também preservam regras próprias', async () => {
    const created = await createPerson({ name: 'Dra Ana', hasAccess: false, email: '' });
    const proId = created.professionalId as string;
    await catalog({ action: 'availability.save', scope: { professionalId: '' }, rules: [{ weekday: 1, start: '08:00', end: '18:00', slotMin: 30 }] }, ownerToken);
    let res = await catalog({ action: 'professional.hours', id: proId, follow: false, rules: [{ weekday: 2, start: '10:00', end: '13:00', slotMin: 30 }] }, ownerToken);
    expect(res.status).toBe(200);
    res = await catalog({ action: 'professional.hours', id: proId, follow: true }, ownerToken);
    expect(res.status).toBe(200);
    let db = await readDB();
    expect(hasOwnRules(proId, db.availability)).toBe(true);
    expect(db.professionals.find((p) => p.id === proId)!.followBusinessHours).toBe(true);
    res = await catalog({ action: 'availability.applyToAll' }, ownerToken);
    expect(res.status).toBe(200);
    db = await readDB();
    expect(db.availability.filter((a) => a.professionalId === proId)).toHaveLength(1);
    // voltar ao próprio SEM enviar janelas: mantém as existentes (não copia a clínica por cima)
    res = await catalog({ action: 'professional.hours', id: proId, follow: false }, ownerToken);
    expect(res.status).toBe(200);
    db = await readDB();
    const own = db.availability.filter((a) => a.professionalId === proId);
    expect(own).toHaveLength(1);
    expect(own[0].weekday).toBe(2);
  });

  it('Horário próprio SEM regras não finge estar configurado (nada é copiado em silêncio)', async () => {
    const created = await createPerson({ name: 'Dr Novo', hasAccess: false, email: '', dispMode: 'follow' });
    const res = await team({
      action: 'person.save', mode: 'update', hasAccess: false, hasClinical: true, name: 'Dr Novo', email: '',
      existingProfessionalId: created.professionalId, funcao: 'Veterinário', crmvUf: 'SP', crmvNumero: '12345',
      serviceIds: [], pendingServices: [], dispMode: 'own',
    }, ownerToken);
    expect(res.status).toBe(200);
    const db = await readDB();
    const pro = db.professionals.find((p) => p.id === created.professionalId)!;
    expect(pro.followBusinessHours).toBe(false);
    expect(hasOwnRules(pro.id, db.availability)).toBe(false);
    expect(db.availability.filter((a) => a.professionalId === pro.id)).toHaveLength(0);
    expect(rulesForProfessional(pro, db.availability)).toEqual([]);
  });

  it('CRIAÇÃO direta: novo Professional + dispMode=own → followBusinessHours=false, zero Availability própria, persiste', async () => {
    const created = await createPerson({ name: 'Dr Own Direto', hasAccess: false, email: '', dispMode: 'own' }); // sem passar por follow
    const reloaded = await readDB(); // releitura do banco (persistência)
    const pro = reloaded.professionals.find((p) => p.id === created.professionalId)!;
    expect(pro.followBusinessHours).toBe(false);
    expect(followsBusinessHours(pro, reloaded.availability)).toBe(false);
    expect(reloaded.availability.filter((a) => a.professionalId === pro.id)).toHaveLength(0);
    expect(hasOwnRules(pro.id, reloaded.availability)).toBe(false);
    expect(rulesForProfessional(pro, reloaded.availability)).toEqual([]); // sem slots próprios, nada copiado
    // a clínica continua com suas regras intactas (nenhuma regra criada automaticamente)
    expect(reloaded.availability.every((a) => !!a.professionalId === false || a.professionalId !== pro.id)).toBe(true);
    // GET do catálogo/Equipe enxerga o mesmo estado (UI: aviso + Configurar horários)
    const team = await (await teamGET(getTeam(ownerToken))).json() as any;
    expect(team.professionals.some((p: any) => p.id === pro.id)).toBe(true);
  });

  it('CRIAÇÃO direta: novo Professional + dispMode=follow → followBusinessHours=true (e sem dispMode herda a clínica)', async () => {
    const f = await createPerson({ name: 'Dr Follow Direto', hasAccess: false, email: '', dispMode: 'follow' });
    const g = await createPerson({ name: 'Dr Sem Modo', hasAccess: false, email: '' });
    const db = await readDB();
    expect(db.professionals.find((p) => p.id === f.professionalId)!.followBusinessHours).toBe(true);
    expect(db.professionals.find((p) => p.id === g.professionalId)!.followBusinessHours).toBe(true);
  });

  it('CRIAÇÃO own → configurar horário → seguir → próprio: regras preservadas', async () => {
    const created = await createPerson({ name: 'Dr Ciclo', hasAccess: false, email: '', dispMode: 'own' });
    const proId = created.professionalId as string;
    let res = await catalog({ action: 'professional.hours', id: proId, follow: false, rules: [{ weekday: 2, start: '08:00', end: '12:00', slotMin: 30 }] }, ownerToken);
    expect(res.status).toBe(200);
    const upd = (dispMode: 'follow' | 'own') => team({ action: 'person.save', mode: 'update', hasAccess: false, hasClinical: true, name: 'Dr Ciclo', email: '', existingProfessionalId: proId, funcao: 'Veterinário', crmvUf: 'SP', crmvNumero: '12345', serviceIds: [], pendingServices: [], dispMode }, ownerToken);
    expect((await upd('follow')).status).toBe(200);
    let db = await readDB();
    expect(db.professionals.find((p) => p.id === proId)!.followBusinessHours).toBe(true);
    expect(db.availability.filter((a) => a.professionalId === proId)).toHaveLength(1);
    expect((await upd('own')).status).toBe(200);
    db = await readDB();
    const pro = db.professionals.find((p) => p.id === proId)!;
    expect(pro.followBusinessHours).toBe(false);
    expect(rulesForProfessional(pro, db.availability)).toHaveLength(1);
  });

  it('Serviço sugerido: duração da biblioteca é sugestão — a clínica altera antes de criar; sem duplicar Service', async () => {
    const sug = searchVetCatalog('cardiologista')[0];
    expect(sug.name).toBe('Consulta cardiológica');
    expect(sug.duracaoMin).toBe(40);
    expect(durationSuggestionLabel(sug.duracaoMin)).toBe('Duração sugerida · 40 min');
    expect(durationSuggestionLabel(0)).toBe('Sem duração sugerida');

    const orlando = await createPerson({
      name: 'Dr Orlando', hasAccess: false, email: '',
      pendingServices: [{ tempId: 't1', name: sug.name, suggestedGroupName: sug.grupo, durationMin: 50, price: '' }],
    });
    let db = await readDB();
    const svc = db.services.find((s) => s.name === 'Consulta cardiológica')!;
    expect(svc.durationMin).toBe(50); // valor EDITADO pela clínica, não os 40 da biblioteca
    expect(svc.professionalIds).toContain(orlando.professionalId);
    expect(db.categories.filter((c) => c.name === 'Cardiologia')).toHaveLength(1);

    // reabrir/salvar de novo: duração persiste, nenhum Service duplicado
    const again = await team({
      action: 'person.save', mode: 'update', hasAccess: false, hasClinical: true, name: 'Dr Orlando', email: '',
      existingProfessionalId: orlando.professionalId, funcao: 'Cardiologia', crmvUf: 'SP', crmvNumero: '12345',
      serviceIds: [svc.id], serviceSelectionExplicit: true, pendingServices: [], dispMode: 'follow',
    }, ownerToken);
    expect(again.status).toBe(200);
    // outro profissional realiza o MESMO Service existente (Service pertence à clínica)
    const outro = await createPerson({ name: 'Dra Bia', hasAccess: false, email: '', serviceIds: [svc.id], serviceSelectionExplicit: true });
    db = await readDB();
    const same = db.services.filter((s) => s.name === 'Consulta cardiológica');
    expect(same).toHaveLength(1);
    expect(same[0].durationMin).toBe(50);
    expect(same[0].professionalIds).toEqual(expect.arrayContaining([orlando.professionalId, outro.professionalId]));
  });

  it('erro server-side real: mensagem humana, sem Member/User/Professional nem ids', async () => {
    // CPF inválido
    let res = await team({ ...BASE_PERSON, mode: 'create', name: 'X', email: 'x@ux.com', cpf: '11111111111' }, ownerToken);
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toMatch(/CPF/i);
    // Member inexistente (ex.: lista desatualizada)
    res = await team({ ...BASE_PERSON, mode: 'update', hasClinical: false, name: 'Fantasma', email: 'f@ux.com', existingMemberId: 'id-que-nao-existe', existingUserId: 'u-x', role: 'SECRETARIA' }, ownerToken);
    expect(res.status).toBe(404);
    const err = (await res.json() as any).error as string;
    expect(err).not.toMatch(/\b(membro|member|professional|user)\b/i);
    expect(err).not.toContain('id-que-nao-existe');
    expect(humanizePersonError(err, 404)).toBe(err);
  });
});
