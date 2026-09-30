import { describe, it, expect } from 'vitest';
import { slotEligibleProfessionalIds } from '../booking';
import { computeSlots } from '../slots';
import { deriveIsTargetOwner, validatePrivilegeEscalation, personSaveTx, PersonSaveInput } from '../person-orchestration';
import { permissionsFor } from '../permissions';
import type { DB, Service, Professional, Business, BusinessMember, User } from '../types';

describe('PR46 P0 Fixes - Unit & Integration Tests', () => {

  describe('P0.1 - slotEligibleProfessionalIds & computeSlots', () => {
    it('service legacy + Professional inativo no mesmo tenant => ZERO slots', () => {
      const svc: Service = {
        id: 'svc-legacy', businessId: 'biz-1', name: 'Legacy Service', description: '', image: '',
        price: 1000, showPrice: true, durationMin: 30,
        active: true, featured: false, bookable: true, questions: [], createdAt: '', updatedAt: '',
      } as any;

      const proInactive: Professional = {
        id: 'pro-inactive', businessId: 'biz-1', name: 'Dr. Inativo', role: 'Médico', photo: '',
        active: false, followBusinessHours: true, createdAt: '', updatedAt: '',
      } as any;

      const eligible = slotEligibleProfessionalIds(svc, [proInactive]);
      expect(eligible).toEqual([]);

      const result = computeSlots({
        rules: [{ id: 'r1', businessId: 'biz-1', professionalId: '', weekday: 1, start: '08:00', end: '18:00', serviceId: '', slotMin: 30 } as any],
        exceptions: [], bookings: [], services: [svc], professionals: [proInactive],
        dateISO: '2026-10-05', weekday: 1, serviceId: svc.id, durationMin: 30, professionalId: '',
        eligibleProIds: eligible, nowHM: '', leadMin: 0, bufferMin: 0,
      });

      expect(result.slots).toEqual([]);
    });

    it('zero Professionals => legacy solo permitido (returns undefined)', () => {
      const svc: Service = {
        id: 'svc-legacy', businessId: 'biz-1', name: 'Legacy Service', description: '', image: '',
        price: 1000, showPrice: true, durationMin: 30,
        active: true, featured: false, bookable: true, questions: [], createdAt: '', updatedAt: '',
      } as any;

      const eligible = slotEligibleProfessionalIds(svc, []);
      expect(eligible).toBeUndefined();

      const result = computeSlots({
        rules: [{ id: 'r1', businessId: 'biz-1', professionalId: '', weekday: 1, start: '08:00', end: '12:00', serviceId: '', slotMin: 30 } as any],
        exceptions: [], bookings: [], services: [svc], professionals: [],
        dateISO: '2026-10-05', weekday: 1, serviceId: svc.id, durationMin: 30, professionalId: '',
        eligibleProIds: eligible, nowHM: '', leadMin: 0, bufferMin: 0,
      });

      expect(result.slots.length).toBeGreaterThan(0);
    });

    it('Professional apenas em outro tenant => não interfere no tenant sem profissionais', () => {
      const svc: Service = {
        id: 'svc-legacy', businessId: 'biz-A', name: 'Legacy Service', description: '', image: '',
        price: 1000, showPrice: true, durationMin: 30,
        active: true, featured: false, bookable: true, questions: [], createdAt: '', updatedAt: '',
      } as any;

      const proTenantB: Professional = {
        id: 'pro-B', businessId: 'biz-B', name: 'Dr. Outro Tenant', role: 'Médico', photo: '',
        active: true, followBusinessHours: true, createdAt: '', updatedAt: '',
      } as any;

      const prosTenantA = [proTenantB].filter(p => p.businessId === 'biz-A');
      const eligible = slotEligibleProfessionalIds(svc, prosTenantA);
      expect(eligible).toBeUndefined();
    });
  });

  describe('P0.2 - Privilege Escalation Protection', () => {
    const mockDb = (): DB => ({
      businesses: [{ id: 'biz-1', name: 'Biz 1', ownerId: 'user-owner' } as Business],
      users: [
        { id: 'user-owner', email: 'owner@test.com', name: 'Owner' } as User,
        { id: 'user-atendente', email: 'atendente@test.com', name: 'Atendente' } as User,
        { id: 'user-admin', email: 'admin@test.com', name: 'Admin' } as User,
      ],
      members: [
        { id: 'mem-atendente', businessId: 'biz-1', userId: 'user-atendente', role: 'ATENDENTE', permissions: { equipe: true }, active: true } as BusinessMember,
        { id: 'mem-admin', businessId: 'biz-1', userId: 'user-admin', role: 'ADMIN', permissions: {}, active: true } as BusinessMember,
      ],
      professionals: [],
      services: [],
      categories: [],
      availability: [],
      exceptions: [],
      bookings: [],
      leads: [],
      contacts: [],
      audits: [],
    } as any);

    it('self escalation por ATENDENTE => 403', () => {
      const db = mockDb();
      const atendenteCtx = {
        user: { id: 'user-atendente', email: 'atendente@test.com' },
        business: db.businesses[0],
        role: 'ATENDENTE',
        permissions: permissionsFor('ATENDENTE', { equipe: true }),
        isOwner: false,
      };

      const input: PersonSaveInput = {
        businessId: 'biz-1', mode: 'update',
        existingMemberId: 'mem-atendente', existingUserId: 'user-atendente',
        name: 'Atendente', hasAccess: true, hasClinical: false,
        permissionOverrides: { catalogo: true },
      };

      expect(() => validatePrivilegeEscalation(input, db, atendenteCtx)).toThrowError(/Sem permissão para conceder/);
    });

    it('conceder capability ausente => 403', () => {
      const db = mockDb();
      const atendenteCtx = {
        user: { id: 'user-atendente', email: 'atendente@test.com' },
        business: db.businesses[0],
        role: 'ATENDENTE',
        permissions: permissionsFor('ATENDENTE', { equipe: true }),
        isOwner: false,
      };

      const input: PersonSaveInput = {
        businessId: 'biz-1', mode: 'create',
        name: 'Novo Atendente Extra', email: 'novo@test.com',
        hasAccess: true, hasClinical: false, role: 'ATENDENTE',
        permissionOverrides: { config: true },
      };

      expect(() => validatePrivilegeEscalation(input, db, atendenteCtx)).toThrowError(/Sem permissão para conceder/);
    });

    it('role baseline acima das capabilities do ator => 403', () => {
      const db = mockDb();
      const atendenteCtx = {
        user: { id: 'user-atendente', email: 'atendente@test.com' },
        business: db.businesses[0],
        role: 'ATENDENTE',
        permissions: permissionsFor('ATENDENTE', { equipe: true }),
        isOwner: false,
      };

      const input: PersonSaveInput = {
        businessId: 'biz-1', mode: 'create',
        name: 'Novo Admin', email: 'admin2@test.com',
        hasAccess: true, hasClinical: false, role: 'ADMIN',
      };

      expect(() => validatePrivilegeEscalation(input, db, atendenteCtx)).toThrowError(/Sem permissão para conceder/);
    });

    it('nenhuma escrita parcial na falha de privilege escalation', () => {
      const db = mockDb();
      const initialUsersCount = db.users.length;
      const initialMembersCount = (db.members || []).length;

      const atendenteCtx = {
        user: { id: 'user-atendente', email: 'atendente@test.com' },
        business: db.businesses[0],
        role: 'ATENDENTE',
        permissions: permissionsFor('ATENDENTE', { equipe: true }),
        isOwner: false,
      };

      const input: PersonSaveInput = {
        businessId: 'biz-1', mode: 'create',
        name: 'Agressor', email: 'agressor@test.com', password: 'password123',
        hasAccess: true, hasClinical: true, role: 'ADMIN',
        pendingServices: [{ name: 'Consulta Escala', suggestedGroupName: 'Grupo X' }],
      };

      expect(() => personSaveTx(db, input, atendenteCtx)).toThrowError(/Sem permissão/);

      expect(db.users.length).toBe(initialUsersCount);
      expect((db.members || []).length).toBe(initialMembersCount);
      expect(db.services.length).toBe(0);
      expect(db.categories.length).toBe(0);
    });

    it('casos legítimos continuam funcionando para ator com permissões', () => {
      const db = mockDb();
      const atendenteCtx = {
        user: { id: 'user-atendente', email: 'atendente@test.com' },
        business: db.businesses[0],
        role: 'ATENDENTE',
        permissions: permissionsFor('ATENDENTE', { equipe: true }),
        isOwner: false,
      };

      const input: PersonSaveInput = {
        businessId: 'biz-1', mode: 'create',
        name: 'Novo Atendente Valido', email: 'atendente2@test.com', password: 'password123',
        hasAccess: true, hasClinical: false, role: 'ATENDENTE',
      };

      expect(() => validatePrivilegeEscalation(input, db, atendenteCtx)).not.toThrow();
    });

    it('OWNER continua autorizado a conceder qualquer papel/permissao', () => {
      const db = mockDb();
      const ownerCtx = {
        user: { id: 'user-owner', email: 'owner@test.com' },
        business: db.businesses[0],
        role: 'OWNER',
        permissions: permissionsFor('OWNER'),
        isOwner: true,
      };

      const input: PersonSaveInput = {
        businessId: 'biz-1', mode: 'create',
        name: 'Novo Admin Criado por Owner', email: 'novoadmin@test.com', password: 'password123',
        hasAccess: true, hasClinical: false, role: 'ADMIN',
      };

      expect(() => validatePrivilegeEscalation(input, db, ownerCtx)).not.toThrow();
    });
  });

  describe('P0.3 - deriveIsTargetOwner Tenant Safety', () => {
    const mockDb = (): DB => ({
      businesses: [
        { id: 'biz-A', name: 'Biz A', ownerId: 'user-owner-A' } as Business,
        { id: 'biz-B', name: 'Biz B', ownerId: 'user-owner-B' } as Business,
      ],
      users: [
        { id: 'user-owner-A', email: 'ownerA@test.com', name: 'Owner A' } as User,
        { id: 'user-owner-B', email: 'ownerB@test.com', name: 'Owner B' } as User,
      ],
      members: [
        { id: 'mem-A', businessId: 'biz-A', userId: 'user-owner-A', role: 'OWNER' } as BusinessMember,
        { id: 'mem-B', businessId: 'biz-B', userId: 'user-owner-B', role: 'OWNER' } as BusinessMember,
      ],
      professionals: [
        { id: 'pro-A', businessId: 'biz-A', userId: 'user-owner-A', name: 'Pro A' } as Professional,
        { id: 'pro-B', businessId: 'biz-B', userId: 'user-owner-B', name: 'Pro B' } as Professional,
      ],
    } as any);

    it('Member cross-tenant => false', () => {
      const db = mockDb();
      const input: PersonSaveInput = {
        businessId: 'biz-A', mode: 'update',
        existingMemberId: 'mem-B', name: 'Owner B',
        hasAccess: false, hasClinical: false,
      };

      expect(deriveIsTargetOwner(db, input)).toBe(false);
    });

    it('Professional cross-tenant => false', () => {
      const db = mockDb();
      const input: PersonSaveInput = {
        businessId: 'biz-A', mode: 'update',
        existingProfessionalId: 'pro-B', name: 'Pro B',
        hasAccess: false, hasClinical: false,
      };

      expect(deriveIsTargetOwner(db, input)).toBe(false);
    });

    it('email igual ao Owner enviado pelo cliente => false (no email heuristic)', () => {
      const db = mockDb();
      const input: PersonSaveInput = {
        businessId: 'biz-A', mode: 'create',
        email: 'ownerA@test.com', name: 'Impostor',
        hasAccess: false, hasClinical: false,
      };

      expect(deriveIsTargetOwner(db, input)).toBe(false);
    });

    it('IDs/vínculos reais no mesmo tenant => true', () => {
      const db = mockDb();

      expect(deriveIsTargetOwner(db, { businessId: 'biz-A', mode: 'update', existingUserId: 'user-owner-A', name: 'Owner A', hasAccess: false, hasClinical: false })).toBe(true);
      expect(deriveIsTargetOwner(db, { businessId: 'biz-A', mode: 'update', existingMemberId: 'mem-A', name: 'Owner A', hasAccess: false, hasClinical: false })).toBe(true);
      expect(deriveIsTargetOwner(db, { businessId: 'biz-A', mode: 'update', existingProfessionalId: 'pro-A', name: 'Owner A', hasAccess: false, hasClinical: false })).toBe(true);
    });
  });
});
