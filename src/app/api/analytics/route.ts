import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { todayISO, addDaysISO, formatDateShort } from '@/lib/tz';
import { convRate, seriesByDay, topN, funnelRates } from '@/lib/analytics';
import { isFeatureEnabled } from '@/lib/features';
import { parsePeriodParam, periodWindows } from '@/lib/periods';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalRead } from '@/lib/relational/slice';
// Rótulo de origem: FONTE ÚNICA em lib/leads.ts (mesma usada em Resultados e
// Clientes). Origem desconhecida aparece como gravada — nada é inventado.
import { leadOriginLabel } from '@/lib/leads';

// GET ?businessId=&period=7|30|90|365|0 — métricas agregadas do período (dono).
// (0 = todo o período; fonte única dos períodos: lib/periods.ts.)
/** View PURA (DOIS motores): métricas agregadas a partir de um doc mínimo
 * da unidade (events/orders/bookings/leads/products). Regras idênticas nos
 * dois motores; nenhum acesso a banco aqui dentro. */
function analyticsPayload(db: any, businessId: string, biz: any, period: number) {
  const today = todayISO();
  const allEvents = db.events.filter((e: any) => e.businessId === businessId);
  const allOrders = db.orders.filter((o: any) => o.businessId === businessId);
  const allBookings = db.bookings.filter((b: any) => b.businessId === businessId);
  const allLeads = db.leads.filter((l: any) => l.businessId === businessId);

  let start: string;
  const daysList: string[] = [];
  if (period === 0) {
    // Todo o período: a série diária vai do primeiro movimento até hoje,
    // com teto de 732 dias para a resposta não explodir. Totais e funis
    // usam TUDO (o filtro casa com qualquer data quando start === '').
    const stamps = [
      ...allEvents.map((e: any) => e.createdAt),
      ...allOrders.map((o: any) => o.createdAt),
      ...allBookings.map((b: any) => b.createdAt || ''),
      ...allLeads.map((l: any) => l.createdAt),
    ].map((s: any) => (s || '').slice(0, 10)).filter((s: any) => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
    let d = stamps[0] && stamps[0] <= today ? stamps[0] : today;
    let steps = 0;
    while (d <= today && steps < 732) { daysList.push(d); d = addDaysISO(d, 1); steps++; }
    start = '';
  } else {
    const win = periodWindows(period, today);
    start = win.from;
    for (let i = period - 1; i >= 0; i--) daysList.push(addDaysISO(today, -i));
  }

  const events = allEvents.filter((e: any) => e.createdAt.slice(0, 10) >= start);
  const count = (t: string) => events.filter((e: any) => e.type === t).length;
  const pageViews = count('page_view');
  const uniqueVisitors = new Set(
    events.filter((e: any) => e.type === 'page_view' && e.meta?.vid).map((e: any) => String(e.meta.vid)),
  ).size;
  const conversions = count('conversion');

  const orders = allOrders.filter((o: any) => o.createdAt.slice(0, 10) >= start);
  const paid = orders.filter((o: any) => o.status !== 'cancelled');
  const revenue = paid.reduce((s: number, o: any) => s + o.total, 0);
  const bookings = allBookings.filter((b: any) => (b.createdAt || '').slice(0, 10) >= start);
  const leads = allLeads.filter((l: any) => l.createdAt.slice(0, 10) >= start);

  // Funis separados por objetivo (valores + taxas etapa-a-etapa).
  const funnelOrdersValues = [pageViews, count('product_view'), count('product_add'), count('checkout_started'), count('order_created')];
  const funnelOrders = [
    { id: 'views', label: 'Visitaram a página', value: funnelOrdersValues[0] },
    { id: 'pview', label: 'Viram produto', value: funnelOrdersValues[1] },
    { id: 'add', label: 'Adicionaram ao carrinho', value: funnelOrdersValues[2] },
    { id: 'checkout', label: 'Iniciaram checkout', value: funnelOrdersValues[3] },
    { id: 'order', label: 'Criaram pedido', value: funnelOrdersValues[4] },
  ].map((s, i, arr) => ({ ...s, rate: funnelRates(arr.map((x: any) => x.value))[i] }));
  const funnelBookingsValues = [pageViews, count('booking_started'), count('booking_created')];
  const funnelBookings = [
    { id: 'views', label: 'Visitaram a página', value: funnelBookingsValues[0] },
    { id: 'started', label: 'Iniciaram reserva', value: funnelBookingsValues[1] },
    { id: 'created', label: 'Reserva criada', value: funnelBookingsValues[2] },
  ].map((s, i, arr) => ({ ...s, rate: funnelRates(arr.map((x: any) => x.value))[i] }));

  // Série diária: visitas, conversões e receita.
  const series = seriesByDay(events, daysList, ['page_view', 'conversion']);
  const revByDay: Record<string, number> = {};
  for (const o of paid) {
    const d = o.createdAt.slice(0, 10);
    revByDay[d] = (revByDay[d] || 0) + o.total;
  }
  const days = series.map((s: any) => ({
    day: s.day,
    label: formatDateShort(s.day),
    visitors: s.counts.page_view,
    conversions: s.counts.conversion,
    revenue: revByDay[s.day] || 0,
  }));

  // Produtos: views + adds + receita.
  const views: Record<string, number> = {};
  const adds: Record<string, number> = {};
  for (const e of events) {
    const pid = e.meta?.productId ? String(e.meta.productId) : '';
    if (!pid) continue;
    if (e.type === 'product_view') views[pid] = (views[pid] || 0) + 1;
    if (e.type === 'product_add') adds[pid] = (adds[pid] || 0) + 1;
  }
  const revByProduct: Record<string, number> = {};
  for (const o of paid) {
    for (const it of o.items) revByProduct[it.productId] = (revByProduct[it.productId] || 0) + it.total;
  }
  const products = db.products.filter((p: any) => p.businessId === businessId);
  const topProducts = products
    .map((p: any) => ({ name: p.name, views: views[p.id] || 0, adds: adds[p.id] || 0, revenue: revByProduct[p.id] || 0 }))
    .filter((p: any) => p.views + p.adds + p.revenue > 0)
    .sort((a: any, b: any) => (b.revenue || b.views) - (a.revenue || a.views))
    .slice(0, 5);

  // CTAs mais clicados (rótulo resolvido).
  const ctas: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== 'button_click') continue;
    const label = e.meta?.label ? String(e.meta.label) : 'botão';
    ctas[label] = (ctas[label] || 0) + 1;
  }
  const topCtas = topN(ctas, 5).map(({ key, value }) => ({ label: key, clicks: value }));

  const origins: Record<string, number> = {};
  for (const l of leads) {
    const label = l.origin ? leadOriginLabel(l.origin) : 'Outro';
    origins[label] = (origins[label] || 0) + 1;
  }

  // Contexto de módulos: a tela decide o que mostrar (negócios de atendimento
  // NÃO veem funil/receita de pedidos; só existe receita de pedidos quem tem o
  // módulo legado ativo). A decisão vem da fonte única (lib/features.ts).
  const modules = {
    bookings: isFeatureEnabled(biz, 'bookings'),
    products: isFeatureEnabled(biz, 'products'),
    orders: isFeatureEnabled(biz, 'orders'),
    quote: isFeatureEnabled(biz, 'quote'),
  };

  return {
    period,
    modules,
    totals: {
      pageViews, uniqueVisitors,
      clicks: count('button_click'), waClicks: count('whatsapp_click'),
      leads: leads.length, leadsNew: leads.filter((l: any) => l.status === 'new').length,
      orders: orders.length, ordersRevenue: revenue,
      bookings: bookings.length, conversions,
      rate: convRate(conversions, uniqueVisitors || pageViews),
    },
    funnelOrders, funnelBookings,
    days, topProducts, topCtas,
    origins: Object.entries(origins).map(([name, value]) => ({ name, value })),
  };
}

// GET ?businessId=&period=7|30|90|365|0 — métricas agregadas do período (dono).
// (0 = todo o período; fonte única dos períodos: lib/periods.ts.)
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const period = parsePeriodParam(req.nextUrl.searchParams.get('period'));
  const guard = await requireBusiness(req, businessId, 'financeiro');
  if (!guard.ok) return guard.res;
  if (relationalActive()) {
    // Fatia DIRECIONADA: somente as coleções agregadas pela tela, todas da
    // unidade. Período 0 precisa do primeiro movimento (série desde sempre) —
    // a consulta continua presa a business_id.
    const db = await runRelationalRead(businessId, {
      events: {}, orders: {}, bookings: {}, leads: {}, products: {},
    });
    return NextResponse.json(analyticsPayload(db, businessId, guard.ctx.business, period));
  }
  return NextResponse.json(analyticsPayload(guard.db, businessId, guard.ctx.business, period));
}
