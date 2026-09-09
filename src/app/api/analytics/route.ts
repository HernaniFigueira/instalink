import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { toISODate } from '@/lib/utils';

// GET ?businessId= — métricas agregadas (dono)
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }
  const events = db.events.filter((e) => e.businessId === businessId);
  const count = (t: string) => events.filter((e) => e.type === t).length;
  const visitors = count('page_view');
  const actions = count('button_click') + count('product_add') + count('whatsapp_click') + count('ai_started');
  const interested = count('product_view') + count('checkout_started') + count('booking_started');
  const leads = db.leads.filter((l) => l.businessId === businessId).length;
  const conversions = count('conversion');
  const rate = visitors > 0 ? Math.round((conversions / visitors) * 100) : 0;

  // série 14 dias
  const days: Array<{ day: string; label: string; visitors: number; conversions: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = toISODate(d);
    const dayEvents = events.filter((e) => e.createdAt.slice(0, 10) === iso);
    days.push({
      day: iso,
      label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      visitors: dayEvents.filter((e) => e.type === 'page_view').length,
      conversions: dayEvents.filter((e) => e.type === 'conversion').length,
    });
  }

  // produtos mais vistos
  const views: Record<string, number> = {};
  for (const e of events) {
    if (e.type === 'product_view' && e.meta?.productId) views[e.meta.productId] = (views[e.meta.productId] || 0) + 1;
  }
  const topProducts = Object.entries(views)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pid, v]) => ({ name: db.products.find((p) => p.id === pid)?.name || '—', views: v }));

  // origens dos leads
  const origins: Record<string, number> = {};
  for (const l of db.leads.filter((x) => x.businessId === businessId)) {
    origins[l.origin || 'outro'] = (origins[l.origin || 'outro'] || 0) + 1;
  }

  return NextResponse.json({
    totals: { visitors, clicks: count('button_click'), waClicks: count('whatsapp_click'), leads, orders: db.orders.filter((o) => o.businessId === businessId).length, bookings: db.bookings.filter((b) => b.businessId === businessId).length, conversions, rate },
    funnel: { visitors, actions, interested, leads, conversions },
    days, topProducts,
    origins: Object.entries(origins).map(([name, value]) => ({ name, value })),
  });
}
