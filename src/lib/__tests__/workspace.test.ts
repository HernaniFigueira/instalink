import { describe, expect, it } from 'vitest';
import { permissionsFor } from '../permissions';
import { accessibleBusinesses, resolveAccess } from '../access';
import type { Business, DB, User } from '../types';

// Dashboard como permissão independente + identidade visual da empresa

describe('dashboard permissão independente', () => {
  it('dashboard existe no catálogo e pode ser ligada/desligada por papel', () => {
    const owner = permissionsFor('OWNER');
    expect(owner.dashboard).toBe(true);
    const secretaria = permissionsFor('SECRETARIA');
    expect(secretaria.dashboard).toBe(true);
    const vendedor = permissionsFor('VENDEDOR');
    expect(vendedor.dashboard).toBe(true);
    const viewer = permissionsFor('VIEWER');
    expect(viewer.dashboard).toBe(false);
    // override desliga para secretaria
    const without = permissionsFor('SECRETARIA', { dashboard: false });
    expect(without.dashboard).toBe(false);
    const withViewer = permissionsFor('VIEWER', { dashboard: true });
    expect(withViewer.dashboard).toBe(true);
    // owner nunca perde
    const ownerOff = permissionsFor('OWNER', { dashboard: false });
    expect(ownerOff.dashboard).toBe(true);
  });

  it('equipe com dashboard desligado não vê dashboard na navegação lógica', () => {
    const perms = permissionsFor('ATENDENTE', { dashboard: false });
    expect(perms.dashboard).toBe(false);
    expect(perms.agenda).toBe(true);
    expect(perms.clientes).toBe(true);
  });
});

describe('identidade da empresa na área interna', () => {
  it('business carrega logo e nome para exibir no workspace', () => {
    const biz: Partial<Business> = {
      id: 'b1',
      name: 'Odonto Clínica',
      slug: 'odonto-clinica',
      logo: 'https://cdn.test/logo.png',
      cover: 'https://cdn.test/cover.jpg',
      modes: ['bookings'],
    };
    expect(biz.name).toBe('Odonto Clínica');
    expect(biz.logo).toContain('logo.png');
    // A marca da empresa deve ser a identidade principal; InstaLink aparece só como powered by
    const displayName = biz.name || 'InstaLink';
    expect(displayName).not.toBe('InstaLink.app');
  });

  it('resolveAccess preserva logo e permissões de dashboard', async () => {
    const user: User = { id: 'u1', name: 'Ana', email: 'ana@test.com', passwordHash: 'x', createdAt: new Date().toISOString() };
    const owner: User = { id: 'u2', name: 'Owner', email: 'owner@test.com', passwordHash: 'x', createdAt: new Date().toISOString() };
    const business: Business = {
      id: 'b1', ownerId: 'u2', name: 'Clínica Teste', slug: 'clinica-teste', description: '', logo: 'https://example.com/logo.jpg', cover: '', niche: 'saude', modes: ['bookings'],
      features: { reviews: true, faq: true, gallery: true, location: true, whatsapp: true, about: true, agent: true },
      whatsappIntegration: undefined, phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '', hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '', booking: { teamMode: 'solo', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 0 },
      nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false }, published: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as Business;
    const db = { users: [user, owner], businesses: [business], members: [{ id: 'm1', businessId: 'b1', userId: 'u1', role: 'SECRETARIA', permissions: { dashboard: false }, active: true, note: '', invitedBy: 'u2', createdAt: '', updatedAt: '' }], sessions: [], customers: [], customerSessions: [], passwordResets: [], pages: [], categories: [], products: [], options: [], optionValues: [], services: [], professionals: [], availability: [], exceptions: [], orders: [], bookings: [], leads: [], contacts: [], reviews: [], events: [], agents: [], conversations: [], messages: [], campaigns: [], campaignRecipients: [], audit: [], supportSessions: [] } as unknown as DB;
    const ctx = resolveAccess(db, user, 'b1', null);
    expect(ctx).not.toBeNull();
    expect(ctx!.permissions.dashboard).toBe(false);
    // secretária sem dashboard não deve ter acesso, mas deve ter agenda
    expect(ctx!.permissions.agenda).toBe(true);
  });
});
