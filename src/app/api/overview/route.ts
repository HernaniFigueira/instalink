import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness, scopeInfo } from '@/lib/access';
import { can } from '@/lib/access';
import { summarizeDay, pendingClosures } from '@/lib/booking-ops';
import { integrationStatus } from '@/lib/whatsapp';
import { enabledFeatureIds } from '@/lib/features';
import { dashboardAttention, dashboardContext, dashboardLinks, recentActivityLists, setupChecklist, setupProgress } from '@/lib/dashboard';
import { summarizeTasks } from '@/lib/automation/tasks';
import { scopeBookings } from '@/lib/access-core';
import type { PermissionId } from '@/lib/types';
import {
  REVENUE_HINTS, REVENUE_LABELS, REVENUE_UNIT_LABELS, bookingRevenue, orderRevenue,
} from '@/lib/revenue';
import { nowHM, todayISO } from '@/lib/tz';
import { timeToMin } from '@/lib/utils';
import { parsePeriodParam, periodWindows, resolvePeriodSpec } from '@/lib/periods';
import { collectResults, resultsSummary } from '@/lib/insights';
import { isFeatureEnabled } from '@/lib/features';

// GET ?businessId=&period=7|30|90|365|0 — dados da Dashboard.
// (0 = todo o período; fonte única dos períodos: lib/periods.ts.)
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
  const period = parsePeriodParam(req.nextUrl.searchParams.get('period'));
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
  const leads = db.leads.filter((l) => l.businessId === bId);
  // ESCOPO DO PROFISSIONAL (P2): o login vinculado a um profissional recebe
  // os painéis de AGENDA recortados para os próprios atendimentos (hoje,
  // pendências, próximos e atividade recente). CRM/página continuam no nível
  // da unidade — ele enxerga os clientes da unidade, por regra do produto.
  const professionalScope = guard.ctx.professionalScope;
  const allBookings = db.bookings.filter((b) => b.businessId === bId);
  const bookings = scopeBookings(allBookings, professionalScope);

  // ── Contexto: módulos ativos decidem o que a Dashboard mostra ──
  const context = dashboardContext(business);
  const m = context.modules;
  const activity = recentActivityLists(m);

  const today = todayISO();
  const win = periodWindows(period, today);
  const from = win.from;
  const periodWindow = { from: win.from, to: win.to };
  // Todo o período não tem janela anterior comparável: a variação é
  // omitida na UI (o delta viria zerado no `prev`, sem significado).
  const prevWindow = win.hasPrevious ? { from: win.prevFrom, to: win.prevTo } : undefined;

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

  // ── A1.2 · Bloco 4 — ATENÇÃO + LINKS POR PERMISSÃO ──
  // Tarefas: resumo da MESMA engine das automações (lib/automation/tasks) —
  // nenhum sistema novo. Entra no payload só para quem pode abrir /tarefas.
  const TASKS_PERMS: PermissionId[] = ['leads', 'agenda', 'clientes', 'config'];
  const canTasks = TASKS_PERMS.some((p) => can(guard.ctx, p));
  const tasksSummary = canTasks ? summarizeTasks(db, bId, today) : null;

  // Mapa de permissão das portas que a tela menciona (fonte: catálogo de
  // permissões do usuário no contexto autenticado — a tela nunca chuta).
  const links = dashboardLinks(guard.ctx.permissions);

  // Região de atenção: apenas dados já existentes e confiáveis, com link
  // contextual somente quando o usuário pode abrir a rota.
  // A3.4 · Bloco 4 — operação do balcão: fila de espera e chegadas de hoje
  // ainda sem check-in (mesma leitura para a Agenda e para o Início).
  const queueWaitingNow = (db.queue || []).filter((q) =>
    q.businessId === bId && (q.status === 'waiting' || q.status === 'called')).length;
  const arrivalsPendingNow = m.bookings
    ? bookings.filter((b) =>
      b.date === today && b.status === 'confirmed' &&
      !b.checkedInAt && timeToMin(b.time) <= timeToMin(nowHM())).length
    : 0;
  const attention = dashboardAttention({
    closures: closures.length,
    leadsNew: crm.leadsNew,
    tasksOverdue: tasksSummary?.overdue ?? 0,
    queueWaiting: queueWaitingNow,
    arrivalsPending: arrivalsPendingNow,
    permissions: { agenda: links.agenda, leads: links.funil, tasks: canTasks },
  });

  // ── Página: o que ela produziu no período ──
  const pageStats = {
    views: events.filter((e) => e.type === 'page_view' && e.createdAt.slice(0, 10) >= from).length,
    clicks: events.filter((e) => (e.type === 'button_click' || e.type === 'whatsapp_click') && e.createdAt.slice(0, 10) >= from).length,
    // Agendamentos CRIADOS no período (unidade), pela data de criação — é a
    // leitura correta para "o que a página produziu" (≠ agenda do período).
    bookings: allBookings.filter((b) => (b.createdAt || '').slice(0, 10) >= from).length,
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

  // ── "Comece por aqui": progresso REAL (nunca inventado) ──
  // Itens calculados a partir de dados existentes (lib/dashboard.ts);
  // nada é pré-marcado como concluído. A área é opcional e some quando
  // não há pendência.
  const setupItems = setupChecklist({
    business,
    modules: m,
    counts: {
      services: db.services.filter((s) => s.businessId === bId && s.active).length,
      availability: db.availability.filter((a) => a.businessId === bId).length,
      professionals: db.professionals.filter((p) => p.businessId === bId && p.active).length,
      products: db.products.filter((p) => p.businessId === bId && p.active).length,
    },
  });
  const checklist = setupItems.map((c) => ({ done: c.done, label: c.label, href: `${c.href}${q}` }));
  const pendingSetup = checklist.filter((c) => !c.done).length;

  // ── Resultados do período (P2, Bloco 1) ──
  // A Dashboard responde "como está o meu negócio?" com indicadores REAIS do
  // mesmo motor da tela Resultados (lib/insights.ts) — recorte curto, com
  // comparação, e link para a tela completa. Só entra no payload para quem tem
  // a permissão de resultados: ninguém recebe número que não pode ver.
  const resultsBlock = can(guard.ctx, 'financeiro')
    ? (() => {
      const spec = resolvePeriodSpec({ period: String(period), today: todayISO() });
      const payload = collectResults(
        db,
        [{
          id: bId,
          hasBookings: isFeatureEnabled(business, 'bookings') || isFeatureEnabled(business, 'services'),
          hasOrders: isFeatureEnabled(business, 'orders'),
        }],
        { from: spec.from, to: spec.to },
        spec.hasPrevious ? { from: spec.prevFrom, to: spec.prevTo } : null,
      );
      return {
        periodKey: spec.key,
        periodLabel: spec.label,
        from: spec.from,
        to: spec.to,
        hasPrevious: spec.hasPrevious,
        items: resultsSummary(payload),
      };
    })()
    : null;

  return NextResponse.json({
    user: { name: guard.ctx.user.name },
    business: {
      id: business.id, name: business.name, slug: business.slug,
      logo: business.logo || '', published: business.published,
    },
    // ── Contexto da Dashboard (módulos → painéis/KPIs/vocabulário) ──
    // A1.2 · Bloco 4: `areas` saiu do payload — repetia a navegação que o
    // shell já fornece (catálogo lib/panel.ts).
    context: {
      modules: m,
      panels: context.panels,
      kpis: context.kpis,
      revenue: revenueSources,
      labels: context.labels,
    },
    // A1.2 · Bloco 4: atenção consolidada + portas que o usuário PODE abrir.
    attention,
    links,
    tasksSummary,
    modules: enabledFeatureIds(business),
    hasBookingsModule: m.bookings,
    hasOrdersModule: m.orders,
    hasProductsModule: m.products,
    scope: scopeInfo(guard.ctx),
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
    results: resultsBlock,
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
    pct: setupProgress(setupItems),
    pendingSetup,
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
