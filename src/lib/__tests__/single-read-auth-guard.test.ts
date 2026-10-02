import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import * as dbModule from '../db';
import { COOKIE_NAME, getUserBySessionFromDB, userFromRequest } from '../auth';
import {
  currentAccess, requireBusiness, requireMaster, supportFromDB, SUPPORT_COOKIE,
} from '../access';
import type { DB, SupportSession, User } from '../types';
import { GET as bookingsGET } from '@/app/api/bookings/route';
import { GET as catalogGET } from '@/app/api/catalog/get/route';
import { GET as businessGET } from '@/app/api/businesses/[id]/route';
import { GET as teamGET } from '@/app/api/team/route';
import { GET as masterBusinessesGET } from '@/app/api/admin/businesses/route';

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  return { ...actual, readDB: vi.fn(), updateDB: vi.fn() };
});
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

const BUSINESS_ID = 'clinic-single-read';
const OWNER_ID = 'owner-single-read';
const PROFESSIONAL_ID = 'professional-single-read';
const MASTER_ID = 'master-single-read';
const NOW = '2026-10-02T12:00:00.000Z';

function addUser(db: DB, id: string, sessionId: string, role = 'owner'): User {
  const user = {
    id, name: id, email: `${id}@local.test`, passwordHash: 'test-only',
    createdAt: NOW, lastLoginAt: '', role,
  } as User;
  db.users.push(user);
  db.sessions.push({
    id: sessionId, userId: id, createdAt: NOW,
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
  return user;
}

function fixture() {
  const db = dbModule.emptyDB();
  const owner = addUser(db, OWNER_ID, 'owner-session');
  const professional = addUser(db, PROFESSIONAL_ID, 'professional-session');
  const viewer = addUser(db, 'viewer-single-read', 'viewer-session');
  const stranger = addUser(db, 'stranger-single-read', 'stranger-session');
  const master = addUser(db, MASTER_ID, 'master-session', 'master');
  const business = {
    id: BUSINESS_ID, ownerId: OWNER_ID, organizationId: 'org-single-read',
    name: 'Clínica Snapshot', slug: 'clinica-snapshot', niche: 'veterinaria',
    clinicType: 'veterinaria', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    description: '', logo: '', cover: '', phone: '', whatsapp: '', email: '', instagram: '', tiktok: '',
    address: '', mapsUrl: '', hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '', booking: {
      teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0,
    }, nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  } as any;
  db.businesses.push(business);
  db.organizations.push({ id: 'org-single-read', name: 'Org Snapshot', ownerId: OWNER_ID, createdAt: NOW } as any);
  const professionalMember = {
    id: 'member-professional', businessId: BUSINESS_ID, userId: PROFESSIONAL_ID,
    role: 'PROFISSIONAL', permissions: { agenda: true, clientes: true, atendimento: true },
    active: true, createdAt: NOW, updatedAt: NOW,
  } as any;
  const viewerMember = {
    id: 'member-viewer', businessId: BUSINESS_ID, userId: viewer.id,
    role: 'VIEWER', permissions: {}, active: true, createdAt: NOW, updatedAt: NOW,
  } as any;
  db.members.push(professionalMember, viewerMember);
  const linkedProfessional = {
    id: 'pro-linked', businessId: BUSINESS_ID, userId: PROFESSIONAL_ID,
    name: 'Dra. Snapshot', role: 'Veterinária', active: true,
    followBusinessHours: true, createdAt: NOW,
  } as any;
  const colleague = {
    id: 'pro-colleague', businessId: BUSINESS_ID, userId: '',
    name: 'Dr. Colega', role: 'Veterinário', active: true,
    followBusinessHours: true, createdAt: NOW,
  } as any;
  db.professionals.push(linkedProfessional, colleague);
  db.bookings.push(
    {
      id: 'booking-own', businessId: BUSINESS_ID, customerId: '', serviceId: '', professionalId: linkedProfessional.id,
      date: '2026-10-06', time: '10:00', startAt: '2026-10-06T13:00:00.000Z',
      endAt: '2026-10-06T13:30:00.000Z', durationMin: 30, timeZone: 'America/Sao_Paulo',
      status: 'confirmed', checkedInAt: '', customerName: 'Tutor A', customerPhone: '',
      note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
    } as any,
    {
      id: 'booking-colleague', businessId: BUSINESS_ID, customerId: '', serviceId: '', professionalId: colleague.id,
      date: '2026-10-06', time: '11:00', startAt: '2026-10-06T14:00:00.000Z',
      endAt: '2026-10-06T14:30:00.000Z', durationMin: 30, timeZone: 'America/Sao_Paulo',
      status: 'confirmed', checkedInAt: '', customerName: 'Tutor B', customerPhone: '',
      note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
    } as any,
  );
  db.supportSessions.push({
    id: 'support-view', masterUserId: MASTER_ID, masterEmail: master.email,
    businessId: BUSINESS_ID, mode: 'view', reason: 'Teste local', createdAt: NOW,
    expiresAt: '2030-01-01T00:00:00.000Z', endedAt: '',
  } as SupportSession);
  return { db, owner, professional, viewer, stranger, master, business, professionalMember, linkedProfessional };
}

function request(options: {
  method?: string; session?: string; bearer?: string; support?: string; url?: string;
} = {}) {
  const headers = new Headers();
  if (options.bearer) headers.set('authorization', `Bearer ${options.bearer}`);
  const cookieParts = [
    options.session ? `${COOKIE_NAME}=${options.session}` : '',
    options.support ? `${SUPPORT_COOKIE}=${options.support}` : '',
  ].filter(Boolean);
  if (cookieParts.length) headers.set('cookie', cookieParts.join('; '));
  return new NextRequest(options.url || 'http://localhost/api/test', {
    method: options.method || 'GET', headers,
  });
}

function setSnapshot(db: DB) {
  vi.mocked(dbModule.readDB).mockResolvedValue(db);
}

function setServerCookies(sessionId?: string, supportId?: string) {
  const values: Record<string, string | undefined> = {
    [COOKIE_NAME]: sessionId,
    [SUPPORT_COOKIE]: supportId,
  };
  vi.mocked(cookies).mockReturnValue({
    get: (name: string) => values[name] ? { name, value: values[name] } : undefined,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dbModule.readDB).mockReset();
  vi.mocked(cookies).mockReset();
});

describe('P0 single-read auth/access guards', () => {
  it('requireBusiness resolves cookie auth and tenant from one snapshot', async () => {
    const { db, owner, business } = fixture();
    setSnapshot(db);

    const result = await requireBusiness(request({ session: 'owner-session' }), BUSINESS_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
    expect(result.db).toBe(db);
    expect(result.ctx.user).toBe(owner);
    expect(result.ctx.business).toBe(business);
  });

  it('falls back from an expired cookie to a valid Bearer in the same DB snapshot', async () => {
    const { db, professional, professionalMember, linkedProfessional } = fixture();
    db.sessions.push({
      id: 'expired-cookie-session', userId: OWNER_ID, createdAt: NOW,
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    setSnapshot(db);

    const result = await requireBusiness(request({ session: 'expired-cookie-session', bearer: 'professional-session' }), BUSINESS_ID, 'agenda');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
    expect(result.ctx.user).toBe(professional);
    expect(result.ctx.member).toBe(professionalMember);
    expect(result.ctx.professional).toBe(linkedProfessional);
    expect(result.ctx.professionalScope).toBe(linkedProfessional.id);
    expect(result.ctx.permissions.agenda).toBe(true);
  });

  it('resolves MASTER support from the same snapshot and keeps it read-only', async () => {
    const { db } = fixture();
    const session = db.supportSessions[0];
    setSnapshot(db);

    const get = await requireBusiness(request({ session: 'master-session', support: session.id }), BUSINESS_ID);
    expect(get.ok).toBe(true);
    if (!get.ok) return;
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
    expect(get.ctx.isMaster).toBe(true);
    expect(get.ctx.support).toBe(session);
    expect(get.ctx.readOnly).toBe(true);

    const mutation = await requireBusiness(request({ method: 'PATCH', session: 'master-session', support: session.id }), BUSINESS_ID);
    expect(mutation.ok).toBe(false);
    if (!mutation.ok) expect(mutation.res.status).toBe(403);
    expect(dbModule.readDB).toHaveBeenCalledTimes(2);
  });

  it('requireMaster returns the authenticating snapshot after one read', async () => {
    const { db, master } = fixture();
    setSnapshot(db);

    const result = await requireMaster(request({ session: 'master-session' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
    expect(result.db).toBe(db);
    expect(result.user).toBe(master);
  });

  it('currentAccess resolves session, support and access from one snapshot', async () => {
    const { db, business } = fixture();
    setSnapshot(db);
    setServerCookies('master-session', 'support-view');

    const ctx = await currentAccess(BUSINESS_ID);

    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
    expect(ctx?.business).toBe(business);
    expect(ctx?.user).toBe(db.users.find((u) => u.id === MASTER_ID));
    expect(ctx?.support).toBe(db.supportSessions[0]);
    expect(ctx?.readOnly).toBe(true);

    vi.mocked(dbModule.readDB).mockClear();
    setServerCookies();
    await expect(currentAccess(BUSINESS_ID)).resolves.toBeNull();
    expect(dbModule.readDB).toHaveBeenCalledTimes(0);
  });

  it('standalone userFromRequest reads once for cookie/Bearer fallback and zero times without credentials', async () => {
    const { db, owner, professional } = fixture();
    db.sessions.push({
      id: 'expired-cookie-session', userId: OWNER_ID, createdAt: NOW,
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    setSnapshot(db);

    await expect(userFromRequest(request({ session: 'owner-session' }))).resolves.toBe(owner);
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);

    vi.mocked(dbModule.readDB).mockClear();
    await expect(userFromRequest(request({ session: 'expired-cookie-session', bearer: 'professional-session' }))).resolves.toBe(professional);
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);

    vi.mocked(dbModule.readDB).mockClear();
    await expect(userFromRequest(request())).resolves.toBeNull();
    expect(dbModule.readDB).toHaveBeenCalledTimes(0);
  });

  it('returns 401/400/403 without weakening tenant or permission checks', async () => {
    const { db } = fixture();
    setSnapshot(db);

    const unauthenticated = await requireBusiness(request(), BUSINESS_ID);
    expect(unauthenticated.ok).toBe(false);
    if (!unauthenticated.ok) expect(unauthenticated.res.status).toBe(401);
    expect(dbModule.readDB).toHaveBeenCalledTimes(0);

    const missingBusiness = await requireBusiness(request({ session: 'owner-session' }), '');
    expect(missingBusiness.ok).toBe(false);
    if (!missingBusiness.ok) expect(missingBusiness.res.status).toBe(400);
    expect(dbModule.readDB).toHaveBeenCalledTimes(0);

    const noTenant = await requireBusiness(request({ session: 'stranger-session' }), BUSINESS_ID);
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.res.status).toBe(403);

    const noPermission = await requireBusiness(request({ session: 'viewer-session' }), BUSINESS_ID, 'config');
    expect(noPermission.ok).toBe(false);
    if (!noPermission.ok) expect(noPermission.res.status).toBe(403);
    expect(dbModule.readDB).toHaveBeenCalledTimes(2);
  });

  it('preserves cookie precedence when a different Bearer is also present', async () => {
    const { db, owner } = fixture();
    setSnapshot(db);

    const result = await requireBusiness(request({ session: 'owner-session', bearer: 'professional-session' }), BUSINESS_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.user).toBe(owner);
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
  });

  it('rejects expired user sessions and invalid support sessions (expired, ended, wrong master)', async () => {
    const { db } = fixture();
    db.sessions.push({ id: 'expired-session', userId: OWNER_ID, createdAt: NOW, expiresAt: '2000-01-01T00:00:00.000Z' });
    setSnapshot(db);

    const expiredUser = await requireBusiness(request({ session: 'expired-session' }), BUSINESS_ID);
    expect(expiredUser.ok).toBe(false);
    if (!expiredUser.ok) expect(expiredUser.res.status).toBe(401);

    const expiredSupport = { ...db.supportSessions[0], id: 'support-expired', expiresAt: '2000-01-01T00:00:00.000Z' };
    const endedSupport = { ...db.supportSessions[0], id: 'support-ended', endedAt: NOW };
    const otherMasterSupport = { ...db.supportSessions[0], id: 'support-other-master', masterUserId: 'different-master' };
    db.supportSessions.push(expiredSupport, endedSupport, otherMasterSupport);

    for (const supportId of [expiredSupport.id, endedSupport.id, otherMasterSupport.id]) {
      const result = await requireBusiness(request({ session: 'master-session', support: supportId }), BUSINESS_ID);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.res.status).toBe(403);
    }
    expect(dbModule.readDB).toHaveBeenCalledTimes(4);
  });

  it('supportFromDB is a pure lookup and still validates the master binding', () => {
    const { db } = fixture();
    const support = db.supportSessions[0];
    expect(supportFromDB(db, support.id, MASTER_ID)).toBe(support);
    expect(supportFromDB(db, support.id, 'another-master')).toBeNull();
    expect(dbModule.readDB).toHaveBeenCalledTimes(0);
  });

  it('uses the same snapshot for User, Business, Membership and professional permission scope', async () => {
    const { db, professional, business, professionalMember, linkedProfessional } = fixture();
    setSnapshot(db);

    const result = await requireBusiness(request({ session: 'professional-session' }), BUSINESS_ID, 'agenda');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db).toBe(db);
    expect(result.ctx.user).toBe(professional);
    expect(result.ctx.business).toBe(business);
    expect(result.ctx.member).toBe(professionalMember);
    expect(result.ctx.professional).toBe(linkedProfessional);
    expect(result.ctx.permissions.agenda).toBe(true);
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
  });
});

describe('representative API routes keep their response contracts and share the guard snapshot', () => {
  it('Agenda applies professionalScope and returns only the linked professional bookings', async () => {
    const { db } = fixture();
    setSnapshot(db);
    const req = request({
      session: 'professional-session',
      url: `http://localhost/api/bookings?businessId=${BUSINESS_ID}&mode=manage`,
    });

    const response = await bookingsGET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ total: 1, scope: { professionalId: 'pro-linked', unlinked: false } });
    expect(body.bookings.map((booking: { id: string }) => booking.id)).toEqual(['booking-own']);
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
  });

  it('Catalog, Settings and Team preserve their successful payload shapes', async () => {
    const { db } = fixture();
    setSnapshot(db);

    const catalog = await catalogGET(request({
      session: 'owner-session', url: `http://localhost/api/catalog/get?businessId=${BUSINESS_ID}`,
    }));
    const catalogBody = await catalog.json();
    expect(catalog.status).toBe(200);
    expect(catalogBody).toHaveProperty('business.id', BUSINESS_ID);
    expect(catalogBody).toHaveProperty('services');
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);

    vi.mocked(dbModule.readDB).mockClear();
    const settings = await businessGET(request({ session: 'owner-session' }), { params: { id: BUSINESS_ID } });
    const settingsBody = await settings.json();
    expect(settings.status).toBe(200);
    expect(settingsBody).toMatchObject({ business: { id: BUSINESS_ID, name: 'Clínica Snapshot' } });
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);

    vi.mocked(dbModule.readDB).mockClear();
    const team = await teamGET(request({
      session: 'owner-session', url: `http://localhost/api/team?businessId=${BUSINESS_ID}`,
    }));
    const teamBody = await team.json();
    expect(team.status).toBe(200);
    expect(teamBody).toHaveProperty('members');
    expect(teamBody).toHaveProperty('professionals');
    expect(teamBody.me).toMatchObject({ userId: OWNER_ID, role: 'OWNER', isOwner: true });
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
  });

  it('a representative MASTER route keeps its response contract with a single guard read', async () => {
    const { db } = fixture();
    setSnapshot(db);

    const response = await masterBusinessesGET(request({ session: 'master-session' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('businesses');
    expect(dbModule.readDB).toHaveBeenCalledTimes(1);
  });
});
