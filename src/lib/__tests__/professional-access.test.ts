import { describe, expect, it } from 'vitest';
import {
  NO_PROFESSIONAL_SCOPE, agendaScopeFor, canAccessBooking, can, professionalForUser,
  professionalScopeFor, resolveAccess, scopeBookings, scopeInfo, scopeProfessionals,
} from '../access';
import { accessibleBusinesses } from '../access';
import { unitsForOrganization } from '../organization';
import { permissionsFor } from '../permissions';
import { emptyDB } from '../db';
import type { Booking, Business, BusinessMember, DB, MemberRole, Organization, Professional, User } from '../types';

// ═══════════════════════════════════════════════════════════════
// ACESSO DO PROFISSIONAL (P2) — vínculo User → Professional
// ═══════════════════════════════════════════════════════════════
// Regras que os testes precisam provar (o backend é a autoridade):
//   • vínculo é POR UNIDADE (mesmo login pode não ter vínculo em outra);
//   • vinculado ⇒ agenda recortada só para ele, em qualquer caminho de dados;
//   • papel de atendimento SEM vínculo ⇒ agenda vazia (fecha, não abre);
//   • Owner/Admin/Master NUNCA são reduzidos pelo vínculo;
//   • nada disso dá acesso a outra unidade ou outra organização;
//   • cliente/histórico/observações continuam conforme as permissões atuais.
const user = (id: string, role: User['role'] = 'owner'): User =>
  ({ id, name: id, email: `${id}@test.dev`, passwordHash: '', createdAt: '2026-01-01', role });

const business = (id: string, ownerId: string, organizationId = ''): Business =>
  ({ id, ownerId, organizationId, name: id, slug: id, modes: ['services', 'bookings'], features: {} } as unknown as Business);

const member = (businessId: string, userId: string, role: MemberRole): BusinessMember =>
  ({ id: `m-${businessId}-${userId}`, businessId, userId, role, permissions: {}, active: true, note: '', invitedBy: '', createdAt: '', updatedAt: '' });

const pro = (id: string, businessId: string, userId = ''): Professional =>
  ({ id, businessId, name: id, role: 'Especialista', active: true, userId, serviceIds: [] } as unknown as Professional);

const booking = (id: string, businessId: string, professionalId: string, status: Booking['status'] = 'pending'): Booking =>
  ({ id, businessId, professionalId, status, date: '2026-09-15', time: '10:00', customerName: id, customerPhone: '11999999999' } as unknown as Booking);

function scenario(opts: { role: MemberRole; linked?: string }) {
  const db: DB = emptyDB();
  const staff = user('staff');
  const boss = user('boss');
  db.users.push(staff, boss);
  db.businesses.push(business('unit-a', 'boss'));
  db.members.push(member('unit-a', 'staff', opts.role));
  db.professionals.push(pro('pro-1', 'unit-a', opts.linked === 'pro-1' ? 'staff' : ''));
  db.professionals.push(pro('pro-2', 'unit-a'));
  db.bookings.push(
    booking('b1', 'unit-a', 'pro-1'),
    booking('b2', 'unit-a', 'pro-2'),
    booking('b3', 'unit-a', ''),
  );
  return { db, staff, boss };
}

describe('vínculo User → Professional', () => {
  it('profissionalForUser encontra apenas o vínculo ATIVO desta unidade', () => {
    const { db } = scenario({ role: 'PROFISSIONAL', linked: 'pro-1' });
    expect(professionalForUser(db, 'unit-a', 'staff')?.id).toBe('pro-1');
    expect(professionalForUser(db, 'unit-a', 'boss')).toBeNull();
    expect(professionalForUser(db, 'unit-b', 'staff')).toBeNull();
    // profissional inativo não conta como vínculo válido
    db.professionals[0].active = false;
    expect(professionalForUser(db, 'unit-a', 'staff')).toBeNull();
  });

  it('registro é por unidade: linkedUserName não vaza para outra unidade', () => {
    const db = emptyDB();
    db.users.push(user('ana'), user('bia'));
    db.businesses.push(business('u1', 'bia'), business('u2', 'bia'));
    db.professionals.push(pro('p-u1', 'u1', 'ana'), pro('p-u2', 'u2'));
    expect(professionalForUser(db, 'u1', 'ana')?.id).toBe('p-u1');
    expect(professionalForUser(db, 'u2', 'ana')).toBeNull();
    // o contexto de acesso de u2 não traz profissional nenhum
    db.members.push(member('u2', 'ana', 'PROFISSIONAL'));
    expect(resolveAccess(db, user('ana'), 'u2')?.professional).toBeNull();
  });

  it('papel administrativo nunca é reduzido pelo vínculo', () => {
    const { db } = scenario({ role: 'ADMIN', linked: 'pro-1' });
    const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
    expect(ctx.professionalScope).toBe('');
    expect(agendaScopeFor(ctx)).toBe('all');
    expect(scopeBookings(db.bookings, ctx.professionalScope)).toHaveLength(3);
    // OWNER dono do negócio também não é reduzido
    const ownerCtx = resolveAccess(db, user('boss'), 'unit-a')!;
    expect(ownerCtx.professionalScope).toBe('');
  });

  it('papel de atendimento SEM vínculo fecha a agenda (não abre a de todos)', () => {
    const { db } = scenario({ role: 'PROFISSIONAL' });
    const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
    expect(ctx.professionalScope).toBe(NO_PROFESSIONAL_SCOPE);
    expect(agendaScopeFor(ctx)).toBe('none');
    expect(scopeBookings(db.bookings, ctx.professionalScope)).toEqual([]);
    // e o aviso para a tela é honesto e não vaza id de profissional
    expect(scopeInfo(ctx)).toEqual({ professionalId: '', professionalName: '', unlinked: true });
  });

  it('outros papéis operacionais continuam como sempre foram', () => {
    for (const role of ['SECRETARIA', 'ATENDENTE', 'VENDEDOR', 'VIEWER'] as MemberRole[]) {
      const { db } = scenario({ role });
      const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
      expect(ctx.professionalScope).toBe('');
      expect(agendaScopeFor(ctx)).toBe('all');
    }
  });
});

describe('isolamento da agenda do profissional (backend)', () => {
  it('quem tem vínculo vê SÓ os próprios atendimentos, com filtro de dados', () => {
    const { db } = scenario({ role: 'PROFISSIONAL', linked: 'pro-1' });
    const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
    expect(ctx.professionalScope).toBe('pro-1');
    expect(agendaScopeFor(ctx)).toBe('own');
    const visible = scopeBookings(db.bookings, ctx.professionalScope);
    expect(visible.map((b) => b.id)).toEqual(['b1']);
    // um atendimento sem profissional definido não pertence a ele
    expect(visible.some((b) => b.professionalId === '')).toBe(false);
  });

  it('acesso direto por id (URL/params manipulados) é recusado pelo contexto', () => {
    const { db } = scenario({ role: 'PROFISSIONAL', linked: 'pro-1' });
    const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
    expect(canAccessBooking(ctx, booking('b1', 'unit-a', 'pro-1'))).toBe(true);
    expect(canAccessBooking(ctx, booking('b2', 'unit-a', 'pro-2'))).toBe(false);
    expect(canAccessBooking(ctx, booking('b9', 'unit-a', ''))).toBe(false);
    // trocar o id do profissional no corpo da requisição não muda o escopo:
    // o escopo vem do VÍNCULO, nunca do que o cliente enviou.
    expect(professionalScopeFor(db, user('staff'), 'unit-a', 'PROFISSIONAL')).toBe('pro-1');
  });

  it('a lista de profissionais também é recortada (nada de descobrir a equipe toda)', () => {
    const { db } = scenario({ role: 'PROFISSIONAL', linked: 'pro-1' });
    const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
    expect(scopeProfessionals(db.professionals, ctx.professionalScope).map((p) => p.id)).toEqual(['pro-1']);
  });

  it('o escopo é resolvido por unidade: em outra unidade o mesmo login não recorta', () => {
    const db = emptyDB();
    db.users.push(user('ana'), user('bia'));
    db.businesses.push(business('u1', 'bia'), business('u2', 'bia'));
    db.members.push(member('u1', 'ana', 'PROFISSIONAL'), member('u2', 'ana', 'SECRETARIA'));
    db.professionals.push(pro('p-u1', 'u1', 'ana'));
    db.bookings.push(booking('x1', 'u1', 'p-u1'), booking('x2', 'u1', ''), booking('y1', 'u2', ''));
    const a = resolveAccess(db, user('ana'), 'u1')!;
    const b = resolveAccess(db, user('ana'), 'u2')!;
    expect(a.professionalScope).toBe('p-u1');
    expect(b.professionalScope).toBe('');
    expect(scopeBookings(db.bookings.filter((x) => x.businessId === 'u1'), a.professionalScope).map((x) => x.id)).toEqual(['x1']);
    expect(scopeBookings(db.bookings.filter((x) => x.businessId === 'u2'), b.professionalScope).map((x) => x.id)).toEqual(['y1']);
  });

  it('permissões do papel continuam decidindo as áreas (escopo não amplia nada)', () => {
    const { db } = scenario({ role: 'PROFISSIONAL', linked: 'pro-1' });
    const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
    expect(can(ctx, 'agenda')).toBe(true);
    expect(can(ctx, 'clientes')).toBe(true);
    expect(can(ctx, 'dashboard')).toBe(true);
    expect(can(ctx, 'financeiro')).toBe(false); // ⇒ /resultados e /api/analytics negam
    expect(can(ctx, 'equipe')).toBe(false);     // ⇒ não mexe no próprio vínculo
    expect(can(ctx, 'catalogo')).toBe(false);
    expect(can(ctx, 'config')).toBe(false);
    // o catálogo de permissões do papel é o esperado pelo produto
    expect(permissionsFor('PROFISSIONAL').financeiro).toBe(false);
    expect(permissionsFor('PROFISSIONAL', { financeiro: true }).financeiro).toBe(true); // admin pode liberar
  });
});

describe('vínculo não fura isolamento de unidade/organização', () => {
  it('profissional de uma unidade não alcança unidade de outra organização', () => {
    const db = emptyDB();
    db.users.push(user('ana'), user('zio'));
    db.organizations.push(
      { id: 'org-a', ownerId: 'zio', name: 'A', metadata: {}, createdAt: '', updatedAt: '' } as Organization,
      { id: 'org-b', ownerId: 'zio', name: 'B', metadata: {}, createdAt: '', updatedAt: '' } as Organization,
    );
    db.businesses.push(business('a1', 'zio', 'org-a'), business('b1', 'zio', 'org-b'));
    db.members.push(member('a1', 'ana', 'PROFISSIONAL'));
    db.professionals.push(pro('pa', 'a1', 'ana'));
    db.bookings.push(booking('ba', 'a1', 'pa'), booking('bb', 'b1', 'pb'));
    expect(accessibleBusinesses(db, user('ana')).map((b) => b.id)).toEqual(['a1']);
    expect(resolveAccess(db, user('ana'), 'b1')).toBeNull();
    expect(unitsForOrganization(db, user('ana'), 'org-b')).toEqual([]);
    // e a unidade da organização dela continua recortada pelo vínculo
    const ctx = resolveAccess(db, user('ana'), 'a1')!;
    expect(scopeBookings(db.bookings.filter((b) => b.businessId === 'a1'), ctx.professionalScope).map((b) => b.id)).toEqual(['ba']);
  });

  it('master continua camada de plataforma: nada muda com vínculo de profissional', () => {
    const { db } = scenario({ role: 'PROFISSIONAL', linked: 'pro-1' });
    const master = user('master', 'master');
    db.users.push(master);
    expect(resolveAccess(db, master, 'unit-a')).toBeNull();
    const ctx = resolveAccess(db, master, 'unit-a', {
      id: 'ss', masterEmail: master.email, masterUserId: 'master', businessId: 'unit-a',
      mode: 'view', reason: 'teste', createdAt: '', endedAt: '', expiresAt: '2999-01-01',
    })!;
    expect(ctx.professionalScope).toBe('');
    expect(ctx.readOnly).toBe(true);
  });
});

describe('observações do cliente visíveis ao profissional (continuidade)', () => {
  it('a lista de clientes é a da UNIDADE (decisão de produto), não só a dele', () => {
    const { db } = scenario({ role: 'PROFISSIONAL', linked: 'pro-1' });
    const ctx = resolveAccess(db, user('staff'), 'unit-a')!;
    // clientes não passam pelo escopo de agenda: o profissional precisa do
    // histórico para dar continuidade ao atendimento.
    expect(can(ctx, 'clientes')).toBe(true);
    expect(scopeBookings(db.bookings, ctx.professionalScope).length).toBeLessThan(db.bookings.length);
  });
});
