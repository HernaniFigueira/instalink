import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { can } from '@/lib/access';
import { summarizeDay, pendingClosures } from '@/lib/booking-ops';
import { integrationStatus } from '@/lib/whatsapp';
import { enabledFeatureIds } from '@/lib/features';
import { dashboardContext, recentActivityLists } from '@/lib/dashboard';
import {
  REVENUE_HINTS, REVENUE_LABELS, REVENUE_UNIT_LABELS, bookingRevenue, orderRevenue,
} from '@/lib/revenue';
import { nowHM, todayISO, addDaysISO } from '@/lib/tz';

// GET ?businessId=&period=7|30 — dados da Dashboard.
//
// PERMISSÃO: `dashboard` é independente (lib/permissions.ts). Quem não a tem
// recebe 403 — e o painel trata 403 com mensagem amigável SEM deslogar
// (somente 401 inicia fluxo de login; ver lib/http.ts e lib/client-auth.ts).
//
// CONTEXTUAL: a Dashboard é montada a partir dos MÓDULOS ATIVOS da empresa
// (lib/dashboard.ts + lib/features.ts). Uma clínica de serviços/agendamentos
// nunca recebe métricas de pedidos/produtos; um varejo recebe pedidos; um
// negócio híbrido recebe os dois — sempre separados.
//
// RECEITA (semântica documentada em lib/revenue.ts):
//   services/bookings → "Receita prevista" = valor dos atendimentos elegíveis
//                       (pendentes + confirmados + concluídos) no período,
//                       pela data do atendimento; cancelados e faltas ficam de
//                       fora e são exibidos separadamente. NÃO é dinheiro
//                       recebido: o sistema não sabe se o pagamento ocorreu.
//   orders            → "Receita" = pedidos não cancelados do período.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const period = req.nextUrl.searchParams.get('period') === '7' ? 7 : 30;
  const guard = await requireBusiness(req, businessId, 'dashboard');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = guard.ctx.business;
  // Financeiro só aparece para quem tem a permissão (e some do payload).
  const showMoney = can(guard.ctx, 'financeiro');

  const bId = business.id;
  const q = `?b=${bId}`;
  const events = db.events.filter((e) => e.businessId === bId);
  const orders = db.orders.filter((o) => o.businessId === bId);
  const bookings = db.bookings.filter((b) => b.businessId === bId);
  const leads = db.leads.filter((l) => l.businessId === bId);

  // ── Contexto: módulos ativos decidem o que a Dashboard mostra ──
  const context = dashboardContext(business);
  const m = context.modules;
  const activity = recentActivityLists(m);

  const today = todayISO();
  const from = addDaysISO(today, -(period - 1));
  const prevFrom = addDaysISO(today, -(period * 2 - 1));
  const prevTo = addDaysISO(today, -period);
  const periodWindow = { from, to: today };
  const prevWindow = { from: prevFrom, to: prevTo };

  // ── Preço dos serviços (fonte da receita prevista de atendimentos) ──
  const servicesById = Object.fromEntries(
    db.services.filter((s) => s.businessId === bId).map((s) => [s.id, s]),
  );
  const serviceNames = new Map(Object.entries(servicesById).map(([id, s]) => [id, (s as any).name as string]));

  // ── RECEITA PREVISTA (atendimentos) — só quando faz sentido p/ o negócio ──
  const bookingRevenueResult = bookingRevenue(
    bookings.map((b) => ({
      status: b.status,
      date: b.date,
      price: Number((servicesById[b.serviceId] as any)?.price) || 0,
    })),
    periodWindow,
    prevWindow,
  );

  // ── RECEITA (pedidos) — preservada para negócios com módulo de pedidos ──
  const orderRevenueResult = orderRevenue(
    orders.map((o) => ({ status: o.status, createdAt: o.createdAt, total: o.total })),
    periodWindow,
    prevWindow,
  );

  const revenueSources = context.revenue;
  // Payload de receita: só o que o negócio tem módulo para calcular, e só para
  // quem possui a permissão financeira. Sem módulo e sem dados → sem inventar.
  const revenuePayload = showMoney
    ? {
      sources: revenueSources,
      bookings: revenueSources.includes('bookings')
        ? { ...bookingRevenueResult, hidden: false }
        : null,
      orders: revenueSources.includes('orders')
        ? { ...orderRevenueResult, hidden: false }
        : null,
      labels: REVENUE_LABELS,
      hints: REVENUE_HINTS,
      unitLabels: REVENUE_UNIT_LABELS,
    }
    : { sources: [], bookings: null, orders: null, labels: REVENUE_LABELS, hints: REVENUE_HINTS, unitLabels: REVENUE_UNIT_LABELS };

  // Compatibilidade com o formato anterior (a tela nova usa `revenuePayload`,
  // mas manter o campo evita quebrar qualquer consumidor existente).
  const primaryRevenue = revenueSources.includes('orders') && !revenueSources.includes('bookings')
    ? orderRevenueResult
    : revenueSources.includes('bookings')
      ? bookingRevenueResult
      : orderRevenueResult;
  const revenue = showMoney
    ? {
      total: primaryRevenue.total,
      prev: primaryRevenue.prev,
      orders: primaryRevenue.count,
      ticket: primaryRevenue.ticket,
      period,
      kind: revenueSources.includes('orders') && !revenueSources.includes('bookings') ? 'orders' : 'bookings',
      label: primaryRevenue.label,
      hint: primaryRevenue.hint,
      unitLabel: primaryRevenue.unitLabel,
      hasData: primaryRevenue.hasData,
    }
    : { total: 0, prev: 0, orders: 0, ticket: 0, period, hidden: true, hasData: false };

  // Próximos agendamentos (pendentes/confirmados, por data do atendimento).
  const pros = new Map(db.professionals.filter((p) => p.businessId === bId).map((p) => [p.id, p.name]));
  const upcoming = m.bookings
    ? bookings
      .filter((b) => ['pending', 'confirmed'].includes(b.status) && b.date >= today)
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
      .slice(0, 5)
      .map((b) => ({
        id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status,
        service: serviceNames.get(b.serviceId) || 'Serviço',
        professional: b.professionalId ? pros.get(b.professionalId) || '' : '',
      }))
    : [];

  const vids = new Set(events.filter((e) => e.type === 'page_view' && e.meta?.vid).map((e) => String(e.meta.vid)));

  // ── Operação de HOJE + pendências de fechamento ──
  const todaySummary = m.bookings ? summarizeDay(bookings, today, servicesById, today, nowHM()) : null;
  const closures = m.bookings
    ? pendingClosures(bookings, servicesById, today, nowHM()).map((b) => ({
      id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status,
      service: serviceNames.get(b.serviceId) || 'Serviço',
    }))
    : [];

  // ── CRM: o que entrou de gente nova ──
  const contacts = db.contacts.filter((c) => c.businessId === bId);
  const crm = {
    contacts: contacts.length,
    newContacts: contacts.filter((c) => (c.createdAt || '').slice(0, 10) >= from).length,
    registered: contacts.filter((c) => !!c.customerId).length,
    withConsent: contacts.filter((c) => c.marketingOptIn === true).length,
    leads: leads.length,
    leadsNew: leads.filter((l) => l.status === 'new').length,
    // Converteu = cliente com histórico de agenda/pedido.
    customers: contacts.filter((c) => !!c.customerId).length,
  };

  // ── Página: o que ela produziu no período ──
  const pageStats = {
    views: events.filter((e) => e.type === 'page_view' && e.createdAt.slice(0, 10) >= from).length,
    clicks: events.filter((e) => (e.type === 'button_click' || e.type === 'whatsapp_click') && e.createdAt.slice(0, 10) >= from).length,
    bookings: bookings.filter((b) => b.createdAt.slice(0, 10) >= from).length,
    conversions: events.filter((e) => e.type === 'conversion' && e.createdAt.slice(0, 10) >= from).length,
    published: !!business.published,
    slug: business.slug,
  };

  // ── WhatsApp: estado honesto (nunca "conectado" de mentira) ──
  const conversations = db.conversations.filter((c) => c.businessId === bId);
  const whatsapp = m.whatsapp || m.agent
    ? {
      status: integrationStatus(business, true).status,
      open: conversations.filter((c) => c.status === 'open').length,
      unread: conversations.reduce((s, c) => s + (c.unread || 0), 0),
      pendingMessages: db.messages.filter((x) => x.businessId === bId && x.status === 'pending').length,
      link: business.whatsapp || '',
    }
    : null;

  // ── Pedidos: resumo só para quem tem o módulo ──
  const ordersPanel = m.orders
    ? {
      total: orders.length,
      new: orders.filter((o) => o.status === 'new').length,
      open: orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length,
      inWindow: orders.filter((o) => o.createdAt.slice(0, 10) >= from && o.createdAt.slice(0, 10) <= today).length,
    }
    : null;

  const productsPanel = m.products
    ? {
      total: db.products.filter((p) => p.businessId === bId).length,
      active: db.products.filter((p) => p.businessId === bId && p.active).length,
    }
    : null;

  const checklist: Array<{ done: boolean; label: string; href: string }> = [
    { done: true, label: 'Página criada', href: `/pagina${q}` },
    { done: !!business.whatsapp, label: 'WhatsApp configurado', href: `/configuracoes${q}` },
    ...(m.products || m.orders
      ? [{ done: db.products.some((p) => p.businessId === bId && p.active), label: 'Adicionar produtos', href: `/produtos${q}` }]
      : []),
    ...(m.services || m.bookings
      ? [{ done: db.services.some((s) => s.businessId === bId && s.active), label: 'Adicionar serviços', href: `/servicos${q}` }]
      : []),
    ...(m.bookings
      ? [{ done: db.availability.some((a) => a.businessId === bId), label: 'Configurar horários', href: `/servicos${q}` }]
      : []),
    { done: business.published, label: 'Publicar página', href: `/pagina${q}` },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return NextResponse.json({
    user: { name: guard.ctx.user.name },
    business: {
      id: business.id, name: business.name, slug: business.slug,
      logo: business.logo || '', published: business.published,
    },
    // ── Contexto da Dashboard (módulos → painéis/KPIs/áreas) ──
    context: {
      modules: m,
      panels: context.panels,
      kpis: context.kpis,
      revenue: revenueSources,
      areas: context.areas,
      labels: context.labels,
    },
    modules: enabledFeatureIds(business),
    hasBookingsModule: m.bookings,
    hasOrdersModule: m.orders,
    hasProductsModule: m.products,
    totals: {
      visitors: events.filter((e) => e.type === 'page_view').length,
      uniqueVisitors: vids.size,
      clicks: events.filter((e) => e.type === 'button_click' || e.type === 'whatsapp_click').length,
      leads: leads.length,
      leadsNew: leads.filter((l) => l.status === 'new').length,
      // Pedidos/produtos só existem no payload quando o módulo está ativo.
      orders: m.orders ? orders.length : 0,
      bookings: m.bookings ? bookings.length : 0,
      conversions: events.filter((e) => e.type === 'conversion').length,
      newOrders: m.orders ? orders.filter((o) => o.status === 'new').length : 0,
      pendingBookings: m.bookings ? bookings.filter((b) => b.status === 'pending').length : 0,
    },
    revenue,
    revenueDetail: revenuePayload,
    showMoney,
    today: todaySummary,
    needsClosure: closures,
    ordersPanel,
    productsPanel,
    crm,
    pageStats,
    whatsapp,
    upcoming,
    checklist,
    pct: Math.round((doneCount / checklist.length) * 100),
    period,
    window: periodWindow,
    recent: {
      orders: activity.orders
        ? [...orders].reverse().slice(0, 3).map((o) => ({ id: o.id, code: o.code, customerName: o.customerName, status: o.status, createdAt: o.createdAt }))
        : [],
      bookings: activity.bookings
        ? [...bookings].reverse().slice(0, 3).map((b) => ({ id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status }))
        : [],
      leads: activity.leads
        ? [...leads].reverse().slice(0, 3).map((l) => ({ id: l.id, name: l.name, phone: l.phone, origin: l.origin, status: l.status }))
        : [],
    },
  });
}
