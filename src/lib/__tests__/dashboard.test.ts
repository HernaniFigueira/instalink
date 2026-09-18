import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_PANELS, dashboardContext, dashboardModules,
  dashboardPanelVisible, dashboardRevenueSources, recentActivityLists,
  visibleDashboardKpis, visibleDashboardPanels,
} from '../dashboard';
import type { Business } from '../types';

type Biz = Pick<Business, 'modes' | 'features'>;
type Feats = NonNullable<Business['features']>;

/** Features opcionais: o que não for informado fica desligado. */
function feats(partial: Partial<Feats> = {}): Feats {
  return { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false, ...partial };
}

const CLINICA: Biz = { modes: ['services', 'bookings'], features: feats({ whatsapp: true, agent: true, reviews: true }) };
const VAREJO: Biz = { modes: ['products', 'orders'], features: feats() };
const HIBRIDO: Biz = { modes: ['services', 'bookings', 'products', 'orders'], features: feats({ whatsapp: true }) };
const ORCAMENTO: Biz = { modes: ['quote'], features: feats() };

describe('dashboard — módulos ativos decidem tudo', () => {
  it('clínica: agenda e serviços ligados; pedidos e produtos desligados', () => {
    const m = dashboardModules(CLINICA);
    expect(m).toMatchObject({ bookings: true, services: true, orders: false, products: false });
  });

  it('varejo: pedidos e produtos ligados; agenda desligada', () => {
    const m = dashboardModules(VAREJO);
    expect(m).toMatchObject({ orders: true, products: true, bookings: false, services: false });
  });

  it('módulos opcionais vêm de features (whatsapp/agente/reviews)', () => {
    expect(dashboardModules(CLINICA).whatsapp).toBe(true);
    expect(dashboardModules(VAREJO).whatsapp).toBe(false);
    expect(dashboardModules(CLINICA).agent).toBe(true);
  });

  it('sem modes nem features, nada de módulo ativado', () => {
    const m = dashboardModules({ modes: [], features: undefined } as Biz);
    expect(m.bookings || m.orders || m.products || m.services).toBe(false);
  });
});

describe('dashboard — painéis por tipo de negócio', () => {
  it('clínica NÃO vê o painel de pedidos', () => {
    const m = dashboardModules(CLINICA);
    expect(dashboardPanelVisible('orders', m)).toBe(false);
    expect(dashboardPanelVisible('revenueOrders', m)).toBe(false);
    expect(visibleDashboardPanels(m)).not.toContain('orders');
  });

  it('clínica vê hoje, próximos atendimentos e receita prevista', () => {
    const m = dashboardModules(CLINICA);
    expect(dashboardPanelVisible('today', m)).toBe(true);
    expect(dashboardPanelVisible('upcomingBookings', m)).toBe(true);
    expect(dashboardPanelVisible('revenueBookings', m)).toBe(true);
  });

  it('varejo NÃO vê agenda (hoje/próximos atendimentos)', () => {
    const m = dashboardModules(VAREJO);
    expect(dashboardPanelVisible('today', m)).toBe(false);
    expect(dashboardPanelVisible('upcomingBookings', m)).toBe(false);
    expect(dashboardPanelVisible('orders', m)).toBe(true);
    expect(dashboardPanelVisible('revenueOrders', m)).toBe(true);
    // só serviços (sem agenda) ainda mostra o valor dos atendimentos
    expect(dashboardPanelVisible('revenueBookings', m)).toBe(false);
  });

  it('híbrido vê os dois, separados', () => {
    const m = dashboardModules(HIBRIDO);
    const panels = visibleDashboardPanels(m);
    expect(panels).toContain('today');
    expect(panels).toContain('orders');
    expect(panels).toContain('revenueBookings');
    expect(panels).toContain('revenueOrders');
  });

  it('painéis comuns (movimento, CRM, página, checklist) independem de módulo', () => {
    for (const id of ['movement', 'crm', 'page', 'checklist'] as const) {
      expect(dashboardPanelVisible(id, dashboardModules(ORCAMENTO))).toBe(true);
    }
  });

  it('whatsapp só aparece com o canal ligado', () => {
    expect(dashboardPanelVisible('whatsapp', dashboardModules(CLINICA))).toBe(true);
    expect(dashboardPanelVisible('whatsapp', dashboardModules(VAREJO))).toBe(false);
  });

  it('todo painel declarado tem decisão explícita (sem "undefined" solto)', () => {
    const m = dashboardModules(CLINICA);
    for (const id of DASHBOARD_PANELS) {
      expect(typeof dashboardPanelVisible(id, m)).toBe('boolean');
    }
  });
});

describe('dashboard — KPIs contextuais', () => {
  it('clínica: atendimentos + receita prevista, sem KPI de pedidos', () => {
    const k = visibleDashboardKpis(dashboardModules(CLINICA));
    expect(k).toContain('attendance');
    expect(k).toContain('revenueForecast');
    expect(k).not.toContain('orders');
    expect(k).not.toContain('revenueOrders');
  });

  it('varejo: pedidos + receita, sem KPI de atendimentos', () => {
    const k = visibleDashboardKpis(dashboardModules(VAREJO));
    expect(k).toContain('orders');
    expect(k).toContain('revenueOrders');
    expect(k).not.toContain('attendance');
    expect(k).not.toContain('revenueForecast');
  });

  it('híbrido: os dois, cada um com sua receita', () => {
    const k = visibleDashboardKpis(dashboardModules(HIBRIDO));
    expect(k).toEqual(expect.arrayContaining(['attendance', 'revenueForecast', 'orders', 'revenueOrders']));
  });

  it('KPIs comuns continuam para qualquer negócio', () => {
    const k = visibleDashboardKpis(dashboardModules(ORCAMENTO));
    expect(k).toEqual(expect.arrayContaining(['clients', 'visitors', 'leads', 'conversions']));
  });
});

describe('dashboard — receita contextual', () => {
  it('fonte de receita segue os módulos', () => {
    expect(dashboardRevenueSources(dashboardModules(CLINICA))).toEqual(['bookings']);
    expect(dashboardRevenueSources(dashboardModules(VAREJO))).toEqual(['orders']);
    expect(dashboardRevenueSources(dashboardModules(HIBRIDO))).toEqual(['bookings', 'orders']);
    expect(dashboardRevenueSources(dashboardModules(ORCAMENTO))).toEqual([]);
  });
});

describe('dashboard — vocabulário e contexto', () => {
  it('clínica fala "atendimentos" e não mostra pedidos', () => {
    const c = dashboardContext(CLINICA);
    expect(c.labels.activityUnit).toBe('atendimentos');
    expect(c.labels.showsBookings).toBe(true);
    expect(c.labels.showsOrders).toBe(false);
    expect(c.labels.showsProducts).toBe(false);
  });

  it('varejo fala "pedidos" e não mostra agenda', () => {
    const c = dashboardContext(VAREJO);
    expect(c.labels.activityUnit).toBe('pedidos');
    expect(c.labels.showsOrders).toBe(true);
    expect(c.labels.showsBookings).toBe(false);
  });

  it('híbrido fala "itens"', () => {
    const c = dashboardContext(HIBRIDO);
    expect(c.labels.activityUnit).toBe('itens');
  });

  // A1.2 · Bloco 4: `areas` saiu do contexto — repetia a navegação que o
  // shell (catálogo lib/panel.ts) já fornece. O contexto NÃO volta a ter.
  it('A1.2 B4 — contexto não traz mais "areas" (duplicação da navegação)', () => {
    const c = dashboardContext(CLINICA);
    expect(c).not.toHaveProperty('areas');
  });

  it('contexto traz painéis, KPIs e receitas já filtrados', () => {
    const c = dashboardContext(CLINICA);
    expect(c.panels).toEqual(visibleDashboardPanels(c.modules));
    expect(c.kpis).toEqual(visibleDashboardKpis(c.modules));
    expect(c.revenue).toEqual(['bookings']);
  });

  it('atividade recente: clínica nunca recebe lista de pedidos (nem vazia)', () => {
    expect(recentActivityLists(dashboardModules(CLINICA))).toEqual({ orders: false, bookings: true, leads: true });
    expect(recentActivityLists(dashboardModules(VAREJO))).toEqual({ orders: true, bookings: false, leads: true });
    expect(recentActivityLists(dashboardModules(HIBRIDO))).toEqual({ orders: true, bookings: true, leads: true });
  });
});
