import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/auth';
import { readDB } from '@/lib/db';
import { todayISO, addDaysISO } from '@/lib/tz';

// GET ?businessId=&period=7|30 — dados da tela Início (dono).
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const period = req.nextUrl.searchParams.get('period') === '7' ? 7 : 30;
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId && b.ownerId === user.id);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

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
    user: { name: user.name },
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
    revenue,
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
