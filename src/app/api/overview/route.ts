import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/auth';
import { readDB } from '@/lib/db';

// GET ?businessId= — dados da tela Início do painel (cookie OU Bearer).
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
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

  const checklist: Array<{ done: boolean; label: string; href: string }> = [
    { done: true, label: 'Página criada', href: `/pagina${q}` },
    { done: !!business.whatsapp, label: 'WhatsApp configurado', href: `/configuracoes${q}` },
    ...((business.modes.includes('products') || business.modes.includes('orders'))
      ? [{ done: db.products.some((p) => p.businessId === bId), label: 'Adicionar produtos', href: `/produtos${q}` }]
      : []),
    ...((business.modes.includes('services') || business.modes.includes('bookings'))
      ? [{ done: db.services.some((s) => s.businessId === bId), label: 'Adicionar serviços', href: `/servicos${q}` }]
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
      clicks: events.filter((e) => e.type === 'button_click' || e.type === 'whatsapp_click').length,
      leads: leads.length,
      orders: orders.length,
      bookings: bookings.length,
      conversions: events.filter((e) => e.type === 'conversion').length,
      newOrders: orders.filter((o) => o.status === 'new').length,
      pendingBookings: bookings.filter((b) => b.status === 'pending').length,
    },
    checklist,
    pct: Math.round((doneCount / checklist.length) * 100),
    recent: {
      orders: [...orders].reverse().slice(0, 3).map((o) => ({ id: o.id, code: o.code, customerName: o.customerName, status: o.status })),
      bookings: [...bookings].reverse().slice(0, 3).map((b) => ({ id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status })),
      leads: [...leads].reverse().slice(0, 3).map((l) => ({ id: l.id, name: l.name, phone: l.phone, origin: l.origin, status: l.status })),
    },
  });
}
