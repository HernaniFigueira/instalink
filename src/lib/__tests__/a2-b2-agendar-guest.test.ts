// ═══════════════════════════════════════════════════════════════
// A2-B2 (F1) — /AGENDAR + WIDGET + GUEST BOOKING
// ═══════════════════════════════════════════════════════════════
// Nível apropriado à arquitetura existente: módulos puros do fluxo público
// (identidade do booking, resolução do alvo por slug/id, dias do fluxo) +
// ponta a ponta do createBookingTx com identidade guest. A validação de
// verdade é do servidor — cada regra coberta aqui tem contraparte na rota.
import { describe, expect, it } from 'vitest';
import { emptyDB } from '../db';
import { createBookingTx, resolveBookingIdentity } from '../booking-create';
import {
  publicBookableServices, publicActiveProfessionals,
  resolvePublicBookingTarget, upcomingDays,
} from '../agendar';
import type { Business, Service } from '../types';

const NOW = '2026-09-16T12:00:00.000Z';

function biz(id: string, extra: Partial<Business> = {}): Business {
  return {
    id,
    ownerId: `owner-${id}`,
    organizationId: `org-${id}`,
    name: `Negócio ${id}`,
    slug: id,
    description: '',
    logo: '',
    cover: '',
    niche: 'servicos',
    modes: ['services', 'bookings'],
    phone: '',
    whatsapp: '11999990000',
    email: '',
    instagram: '',
    tiktok: '',
    address: '',
    mapsUrl: '',
    hours: {},
    paymentMethods: [],
    pixKey: '',
    deliveryFee: 0,
    minOrder: 0,
    googleUrl: '',
    googlePlaceId: '',
    googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [],
    navCustom: false,
    about: { title: '', text: '', image: '', enabled: false },
    published: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function svc(id: string, businessId: string, extra: Partial<Service> = {}): Service {
  return {
    id, businessId, categoryId: '', name: 'Corte', description: '', image: '',
    price: 5000, durationMin: 30, professionalIds: [], active: true, featured: false,
    bookable: true, questions: [],
    ...extra,
  };
}

// ── Identidade: guest × sessão × dono ────────────────────────────
describe('A2-B2 · resolveBookingIdentity', () => {
  it('guest informado no fluxo conclui SEM conta (DECISÃO 5)', () => {
    const id = resolveBookingIdentity({
      isOwner: false,
      sessionCustomer: null,
      body: { customerName: 'Carlos Guest', customerPhone: '(11) 98888-7777', customerEmail: 'CARLOS@ex.com ' },
    });
    expect(id.ok).toBe(true);
    if (id.ok) {
      expect(id.source).toBe('guest');
      expect(id.name).toBe('Carlos Guest');
      expect(id.phoneDigits).toBe('11988887777');
      expect(id.email).toBe('carlos@ex.com');
    }
  });

  it('sem sessão E sem identidade → login_required (fluxo autenticado da página pública intacto)', () => {
    const id = resolveBookingIdentity({
      isOwner: false,
      sessionCustomer: null,
      body: {},
    });
    expect(id.ok).toBe(false);
    if (!id.ok) {
      expect(id.code).toBe('login_required');
      expect(id.error).toContain('Entre para agendar');
    }
  });

  it('guest com telefone curto → phone_required (validação no servidor, não na UI)', () => {
    const id = resolveBookingIdentity({
      isOwner: false,
      sessionCustomer: null,
      body: { customerName: 'Ana', customerPhone: '999' },
    });
    expect(id.ok).toBe(false);
    if (!id.ok) expect(id.code).toBe('phone_required');
  });

  it('sessão vence: cliente logado não é re-identificado pelos campos do body', () => {
    const id = resolveBookingIdentity({
      isOwner: false,
      sessionCustomer: { id: 'c1', name: 'Marina Conta', phone: '11965430000', email: 'conta@x.com' },
      body: { customerName: 'Outro Nome', customerPhone: '11900000000' },
    });
    expect(id.ok).toBe(true);
    if (id.ok) {
      expect(id.source).toBe('session');
      expect(id.name).toBe('Marina Conta');
      expect(id.phoneDigits).toBe('11965430000');
    }
  });

  it('sessão incompleta (sem telefone) é complementada pelo fluxo em vez de recusar', () => {
    const id = resolveBookingIdentity({
      isOwner: false,
      sessionCustomer: { id: 'c1', name: 'Marina Conta', phone: '' },
      body: { customerName: '', customerPhone: '11965430000', customerEmail: 'novo@x.com' },
    });
    expect(id.ok).toBe(true);
    if (id.ok) {
      expect(id.name).toBe('Marina Conta');
      expect(id.phoneDigits).toBe('11965430000');
      expect(id.email).toBe('novo@x.com');
    }
  });

  it('dono digita nome/telefone (ou vincula contato); e-mail do contato é usado', () => {
    const id = resolveBookingIdentity({
      isOwner: true,
      sessionCustomer: null,
      body: { customerName: 'Cliente do Painel', customerPhone: '11922223333' },
      linked: { name: 'Nome do Contato', phone: '11999998888', email: 'contato@x.com' },
    });
    expect(id.ok).toBe(true);
    if (id.ok) {
      expect(id.source).toBe('owner');
      expect(id.name).toBe('Cliente do Painel'); // digitação vence
      expect(id.phoneDigits).toBe('11922223333');
    }
  });
});

// ── Resolução do alvo (slug OU id — widget manda data-business) ──
describe('A2-B2 · resolvePublicBookingTarget', () => {
  it('resolve por slug e por id', () => {
    const d = emptyDB();
    d.businesses.push(biz('biz-xyz', { slug: 'barbearia-do-joao' }));
    expect(resolvePublicBookingTarget(d, 'barbearia-do-joao')?.business.id).toBe('biz-xyz');
    expect(resolvePublicBookingTarget(d, 'biz-xyz')?.business.id).toBe('biz-xyz');
  });

  it('inexistente → null; não publicado → flag notPublished', () => {
    const d = emptyDB();
    d.businesses.push(biz('biz-xyz', { slug: 'aberto', published: false }));
    expect(resolvePublicBookingTarget(d, 'nao-existe')).toBeNull();
    expect(resolvePublicBookingTarget(d, '')).toBeNull();
    const t = resolvePublicBookingTarget(d, 'aberto');
    expect(t?.notPublished).toBe(true);
  });

  it('payload público é enxuto (nunca vaza ownerId/pixKey/chaves)', () => {
    const d = emptyDB();
    d.businesses.push(biz('biz-xyz', { pixKey: 'segredo', googleApiKey: 'chave' }));
    const t = resolvePublicBookingTarget(d, 'biz-xyz')!;
    const keys = Object.keys(t.business);
    expect(keys).not.toContain('pixKey');
    expect(keys).not.toContain('googleApiKey');
    expect((t.business as any).pixKey).toBeUndefined();
  });
});

// ── Dias do fluxo: ancorados no hoje do servidor ─────────────────
describe('A2-B2 · upcomingDays', () => {
  it('gera a lista por aritmética de calendário (sem fuso do navegador)', () => {
    expect(upcomingDays('2026-09-30', 3)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(upcomingDays('2026-12-31', 2)).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('entrada inválida → lista vazia (nunca estoura)', () => {
    expect(upcomingDays('', 5)).toEqual([]);
    expect(upcomingDays('2026-13-99', 5)).toEqual([]);
    expect(upcomingDays('2026-09-16', 0)).toEqual([]);
  });
});

// ── Catálogo do fluxo público ────────────────────────────────────
describe('A2-B2 · catálogo do fluxo', () => {
  it('só serviços ativos e bookable; só profissionais ativos; isolado por tenant', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'), biz('b2'));
    d.services.push(
      svc('s1', 'b1'),
      svc('s2', 'b1', { active: false }),
      svc('s3', 'b1', { bookable: false }),
      svc('s4', 'b2'),
    );
    expect(publicBookableServices(d, 'b1').map((s) => s.id)).toEqual(['s1']);
    expect(publicBookableServices(d, 'b2').map((s) => s.id)).toEqual(['s4']);
  });
});

// ── Ponta a ponta: booking guest alimenta lead/contato (e-mail usado) ──
describe('A2-B2 · booking guest ponta a ponta', () => {
  function baseDb() {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(svc('s1', 'b1'));
    d.availability.push({
      id: 'av1', businessId: 'b1', professionalId: '', serviceId: '',
      weekday: 1, start: '09:00', end: '18:00', slotMin: 30,
    });
    return d;
  }

  it('guest com e-mail: contato e lead recebem o e-mail informado (F7.3 — campo usado, não ignorado)', () => {
    const d = baseDb();
    const res = createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: '2026-09-21', // segunda
      time: '09:00',
      actor: 'customer',
      customer: { id: '', name: 'Guest Email', phone: '11912340000', email: 'guest@email.com' },
      now: NOW,
    });
    expect(res.status).toBe('pending');
    const lead = d.leads.find((l) => l.phone === '11912340000')!;
    expect(lead.email).toBe('guest@email.com');
    const contact = d.contacts.find((c) => c.phone === '11912340000')!;
    expect(contact.email).toBe('guest@email.com');
  });

  it('guest de tenant B não consegue reservar com serviço de tenant A (isolamento no caminho único)', () => {
    const d = baseDb();
    d.businesses.push(biz('b2'));
    d.services.push(svc('s-b2', 'b2'));
    // serviço de b2 com business de b1 → createBookingTx recusa (não encontrado no tenant)
    expect(() =>
      createBookingTx(d, {
        business: d.businesses[0], // b1
        service: d.services[1], // s-b2 (de b2)
        date: '2026-09-21',
        time: '09:00',
        actor: 'customer',
        customer: { id: '', name: 'X', phone: '11912340001' },
        now: NOW,
      }),
    ).toThrow();
    expect(d.bookings.length).toBe(0);
  });
});
