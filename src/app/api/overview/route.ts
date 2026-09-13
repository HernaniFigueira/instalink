import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { readDB } from '@/lib/db';
import { can } from '@/lib/access';
import { summarizeDay, pendingClosures, bookingDuration } from '@/lib/booking-ops';
import { integrationStatus } from '@/lib/whatsapp';
import { enabledFeatureIds, isFeatureEnabled } from '@/lib/features';
import { nowHM } from '@/lib/tz';
import { todayISO, addDaysISO } from '@/lib/tz';

// GET ?businessId=&period=7|30 — dados da tela Início (dono).
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const period = req.nextUrl.searchParams.get('period') === '7' ? 7 : 30;
  const guard = await requireBusiness(req, businessId);
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

  const today = todayISO();
  const start = addDaysISO(today, -(period - 1));
  const prevStart = addDaysISO(today, -(period * 2 - 1));
  const inWin = (iso: string) => iso >= start;
  const inPrev = (iso: string) => iso >= prevStart && iso < start;

  // Receita do período (pedidos não cancelados) + janela anterior p/ comparar.
  const paid = orders.filter((o) => o.status !== 'cancelled');
  const rev = paid.filter((o) => inWin(o.createdAt.slice(0, 10)));
  const revPrev = paid.filter((o) => inPrev(o.createdAt.slice(0, 10)));
  const revenue = {
    total: rev.reduce((s, o) => s + o.total, 0),
    prev: revPrev.reduce((s, o) => s + o.total, 0),
    orders: rev.length,
    ticket: rev.length > 0 ? Math.round(rev.reduce((s, o) => s + o.total, 0) / rev.length) : 0,
    period,
  };

  // Próximos agendamentos (pendentes/confirmados, por data do atendimento).
  const services = new Map(db.services.filter((s) => s.businessId === bId).map((s) => [s.id, s.name]));
  const pros = new Map(db.professionals.filter((p) => p.businessId === bId).map((p) => [p.id, p.name]));
  const upcoming = bookings
    .filter((b) => ['pending', 'confirmed'].includes(b.status) && b.date >= today)
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
    .slice(0, 5)
    .map((b) => ({
      id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status,
      service: services.get(b.serviceId) || 'Serviço',
      professional: b.professionalId ? pros.get(b.professionalId) || '' : '',
    }));

  const vids = new Set(events.filter((e) => e.type === 'page_view' && e.meta?.vid).map((e) => String(e.meta.vid)));

  // ── Operação de HOJE + pendências de fechamento ──
  const servicesById = Object.fromEntries(db.services.filter((s) => s.businessId === bId).map((s) => [s.id, s]));
  const todaySummary = summarizeDay(bookings, today, servicesById, today, nowHM());
  const closures = pendingClosures(bookings, servicesById, today, nowHM()).map((b) => ({
    id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status,
    service: services.get(b.serviceId) || 'Serviço',
  }));

  // ── CRM: o que entrou de gente nova ──
  const contacts = db.contacts.filter((c) => c.businessId === bId);
  const crm = {
    contacts: contacts.length,
    newContacts: contacts.filter((c) => (c.createdAt || '').slice(0, 10) >= start).length,
    registered: contacts.filter((c) => !!c.customerId).length,
    withConsent: contacts.filter((c) => c.marketingOptIn === true).length,
    leads: leads.length,
    leadsNew: leads.filter((l) => l.status === 'new').length,
    // Converteu = cliente com histórico de agenda/pedido.
    customers: contacts.filter((c) => !!c.customerId).length,
  };

  // ── Página: o que ela produziu no período ──
  const pageStats = {
    views: events.filter((e) => e.type === 'page_view' && e.createdAt.slice(0, 10) >= start).length,
    clicks: events.filter((e) => (e.type === 'button_click' || e.type === 'whatsapp_click') && e.createdAt.slice(0, 10) >= start).length,
    bookings: bookings.filter((b) => b.createdAt.slice(0, 10) >= start).length,
    conversions: events.filter((e) => e.type === 'conversion' && e.createdAt.slice(0, 10) >= start).length,
    published: !!business.published,
    slug: business.slug,
  };

  // ── WhatsApp: estado honesto (nunca "conectado" de mentira) ──
  const conversations = db.conversations.filter((c) => c.businessId === bId);
  const whatsapp = {
    status: integrationStatus(business, true).status,
    open: conversations.filter((c) => c.status === 'open').length,
    unread: conversations.reduce((s, c) => s + (c.unread || 0), 0),
    pendingMessages: db.messages.filter((m) => m.businessId === bId && m.status === 'pending').length,
    link: business.whatsapp || '',
  };

  const checklist: Array<{ done: boolean; label: string; href: string }> = [
    { done: true, label: 'Página criada', href: `/pagina${q}` },
    { done: !!business.whatsapp, label: 'WhatsApp configurado', href: `/configuracoes${q}` },
    ...((business.modes.includes('products') || business.modes.includes('orders'))
      ? [{ done: db.products.some((p) => p.businessId === bId && p.active), label: 'Adicionar produtos', href: `/produtos${q}` }]
      : []),
    ...((business.modes.includes('services') || business.modes.includes('bookings'))
      ? [{ done: db.services.some((s) => s.businessId === bId && s.active), label: 'Adicionar serviços', href: `/servicos${q}` }]
      : []),
    ...(business.modes.includes('bookings')
      ? [{ done: db.availability.some((a) => a.businessId === bId), label: 'Configurar horários', href: `/servicos${q}` }]
      : []),
    { done: business.published, label: 'Publicar página', href: `/pagina${q}` },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return NextResponse.json({
    user: { name: guard.ctx.user.name },
    business: { id: business.id, name: business.name, slug: business.slug, published: business.published },
    totals: {
      visitors: events.filter((e) => e.type === 'page_view').length,
      uniqueVisitors: vids.size,
      clicks: events.filter((e) => e.type === 'button_click' || e.type === 'whatsapp_click').length,
      leads: leads.length,
      leadsNew: leads.filter((l) => l.status === 'new').length,
      orders: orders.length,
      bookings: bookings.length,
      conversions: events.filter((e) => e.type === 'conversion').length,
      newOrders: orders.filter((o) => o.status === 'new').length,
      pendingBookings: bookings.filter((b) => b.status === 'pending').length,
    },
    revenue: showMoney ? revenue : { total: 0, prev: 0, orders: 0, ticket: 0, period, hidden: true },
    showMoney,
    today: todaySummary,
    needsClosure: closures,
    crm,
    pageStats,
    whatsapp,
    modules: enabledFeatureIds(business),
    hasBookingsModule: isFeatureEnabled(business, 'bookings'),
    upcoming,
    checklist,
    pct: Math.round((doneCount / checklist.length) * 100),
    recent: {
      orders: [...orders].reverse().slice(0, 3).map((o) => ({ id: o.id, code: o.code, customerName: o.customerName, status: o.status, createdAt: o.createdAt })),
      bookings: [...bookings].reverse().slice(0, 3).map((b) => ({ id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status })),
      leads: [...leads].reverse().slice(0, 3).map((l) => ({ id: l.id, name: l.name, phone: l.phone, origin: l.origin, status: l.status })),
    },
  });
}
