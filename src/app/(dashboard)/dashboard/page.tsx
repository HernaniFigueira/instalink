'use client';
// ═══════════════════════════════════════════════════════════════
// DASHBOARD CONTEXTUAL
// ═══════════════════════════════════════════════════════════════
// O que aparece aqui é decidido pelos MÓDULOS ATIVOS da empresa (o servidor
// manda `context` — ver lib/dashboard.ts). Uma clínica de serviços nunca vê
// "Pedidos"/"Produtos"; um varejo vê pedidos; um híbrido vê os dois separados.
//
// RECEITA: sem contabilidade de mentira. Para agendamentos mostramos
// "Receita prevista" (valor dos atendimentos elegíveis), com a quebra por
// status. Sem dados calculáveis → "R$ 0" + "Sem dados suficientes".
//
// PERMISSÃO: 403 nesta tela mostra aviso amigável e o usuário CONTINUA
// logado. Somente 401 inicia o fluxo de login (lib/http.ts).
//
// Visual do PR #4 preservado: linhas, painéis, divisórias e KPIs compactos —
// nenhuma métrica vira card gigante.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageSkeleton, StatusBadge, AttentionStrip } from '@/components/ui';
import { Icon } from '@/components/icons';
import { AccessDenied, PermissionNotice, useForbiddenNotice } from '@/components/dashboard/AccessNotice';
import { PeriodSelector } from '@/components/dashboard/PeriodSelector';
import { apiGet } from '@/lib/api-client';
import { money } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { NO_DATA_MESSAGE, type RevenueResult } from '@/lib/revenue';
import { periodLabel } from '@/lib/periods';
import { ORDER_STATUS, BOOKING_STATUS, LEAD_STATUS, toneCls, type StatusDef } from '@/lib/status';

interface Modules {
  bookings: boolean; services: boolean; products: boolean; orders: boolean;
  quote: boolean; whatsapp: boolean; agent: boolean; reviews: boolean;
}

interface Overview {
  user: { name: string };
  business: { id: string; name: string; slug: string; logo?: string; published: boolean };
  context: {
    modules: Modules;
    panels: string[];
    kpis: string[];
    revenue: Array<'bookings' | 'orders'>;
    areas: string[];
    labels: { activityUnit: string; showsOrders: boolean; showsBookings: boolean; showsProducts: boolean };
  };
  totals: {
    visitors: number; uniqueVisitors: number; clicks: number; leads: number; leadsNew: number;
    orders: number; bookings: number; conversions: number; newOrders: number; pendingBookings: number;
  };
  revenueDetail: {
    sources: Array<'bookings' | 'orders'>;
    bookings: RevenueResult | null;
    orders: RevenueResult | null;
  };
  showMoney?: boolean;
  today?: {
    date: string; total: number; confirmed: number; pending: number; completed: number;
    cancelled: number; noShow: number; upcoming: number; needsClosure: number;
  } | null;
  needsClosure?: Array<{ id: string; customerName: string; date: string; time: string; status: string; service: string }>;
  ordersPanel?: { total: number; new: number; open: number; inWindow: number } | null;
  productsPanel?: { total: number; active: number } | null;
  crm?: { contacts: number; newContacts: number; registered: number; withConsent: number; leads: number; leadsNew: number; customers: number };
  pageStats?: { views: number; clicks: number; bookings: number; conversions: number; published: boolean; slug: string };
  whatsapp?: { status: string; open: number; unread: number; pendingMessages: number; link: string } | null;
  hasBookingsModule?: boolean;
  upcoming: Array<{ id: string; customerName: string; date: string; time: string; status: string; service: string; professional: string }>;
  checklist: Array<{ done: boolean; label: string; href: string }>;
  pct: number;
  pendingSetup?: number;
  period: number;
  recent: {
    orders: Array<{ id: string; code: string; customerName: string; status: string; createdAt: string }>;
    bookings: Array<{ id: string; customerName: string; date: string; time: string; status: string }>;
    leads: Array<{ id: string; name: string; phone: string; origin: string; status: string }>;
  };
}

export default function DashboardPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const welcome = params.get('welcome') === '1';
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);
  // "Comece por aqui" é descartável: ocultar some com o checklist (por
  // negócio) e pode voltar a qualquer momento — nada é perdido.
  const [setupHidden, setSetupHidden] = useState(false);
  useEffect(() => {
    try { setSetupHidden(localStorage.getItem(`il-setup-hidden-${businessId}`) === '1'); } catch { /* noop */ }
  }, [businessId]);
  function hideSetup() {
    setSetupHidden(true);
    try { localStorage.setItem(`il-setup-hidden-${businessId}`, '1'); } catch { /* noop */ }
  }
  const { notice, dismiss } = useForbiddenNotice('Dashboard');
  // Estados completos (auditoria §12, mesma família do bug do /recursos):
  // uma falha de rede nunca pode virar skeleton eterno no Início.
  const [failed, setFailed] = useState('');
  const [retry, setRetry] = useState(0);

  const load = useCallback(() => {
    if (!businessId) return;
    setFailed('');
    apiGet<Overview>(`/api/overview?businessId=${businessId}&period=${period}`, { scope: 'area', area: 'Dashboard' })
      .then((res) => {
        // 403 → aviso amigável na tela; o usuário NÃO é deslogado.
        // 401 → o wrapper de fetch já iniciou o fluxo de login.
        if (!res.ok) {
          setDenied(res.status === 403);
          if (res.status !== 403) setFailed(res.message || 'Não foi possível carregar o painel.');
          return;
        }
        setDenied(false);
        setData(res.data);
      });
  }, [businessId, period, retry]);

  useEffect(() => { load(); }, [load]);

  if (denied) {
    return (
      <AccessDenied
        area="Dashboard"
        hint="Seu perfil não possui acesso a esta área. Você continua conectado — para ver a Dashboard, peça ao proprietário para liberar a permissão “Dashboard” em Equipe."
        homeHref="/agenda"
      />
    );
  }

  if (failed) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg px-4 py-10 text-center" role="alert">
        <span className="mx-auto w-10 h-10 rounded-md bg-red-50 border border-red-200 text-red-600 flex items-center justify-center"><Icon n="alert" size={18} /></span>
        <p className="text-sm font-medium text-zinc-700 mt-3">{failed}</p>
        <button onClick={() => setRetry((r) => r + 1)} className="mt-4 text-xs font-bold bg-zinc-900 text-white px-4 py-2 rounded-md">Tentar de novo</button>
      </div>
    );
  }

  if (!data) return <PageSkeleton />;

  const { user, business, totals, upcoming, checklist, pct, recent, today, needsClosure = [], crm, pageStats, whatsapp, ordersPanel, productsPanel, context } = data;
  const modules = context.modules;
  const showMoney = data.showMoney !== false;
  const revenueDetail = data.revenueDetail;
  const bookingRevenue = revenueDetail?.bookings || null;
  const orderRevenue = revenueDetail?.orders || null;
  const pendencies = needsClosure;
  const q = `?b=${business.id}`;
  const next = checklist.find((c) => !c.done);
  const doneCount = checklist.filter((c) => c.done).length;
  const hasSetupPending = (data.pendingSetup ?? checklist.filter((c) => !c.done).length) > 0;
  const hasActivity = recent.orders.length + recent.bookings.length + recent.leads.length > 0;
  const orderDef = (s: string): StatusDef => (ORDER_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' } as StatusDef;
  const bookDef = (s: string): StatusDef => (BOOKING_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' } as StatusDef;
  const leadDef = (s: string): StatusDef => (LEAD_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' } as StatusDef;

  // Períodos (7/30/90 dias, 12 meses, todo o período): seletor
  // compartilhado com Resultados — fonte única em lib/periods.ts.

  return (
    <>
      {welcome && (
        <div className="mb-4 border border-zinc-900 bg-zinc-900 text-white px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-md bg-white text-zinc-900 flex items-center justify-center font-bold shrink-0">✓</div>
          <div>
            <p className="text-sm font-semibold">{business.name} está criado, {user.name.split(' ')[0]}!</p>
            <p className="text-xs text-zinc-400 mt-0.5">Agenda, serviços e página já estão ativos. Siga o “Comece por aqui” abaixo — ou ignore e use o que precisa primeiro.</p>
          </div>
        </div>
      )}

      {/* Identidade da empresa — a marca do cliente é a identidade do workspace */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-zinc-200">
        <div className="w-10 h-10 rounded-md overflow-hidden bg-zinc-900 text-white flex items-center justify-center font-bold shrink-0 border border-zinc-200">
          {business.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
          ) : business.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-none text-zinc-900 truncate">{business.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            {business.published ? <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" /> Publicada</span> : <span className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Rascunho</span>}
            <a href={`/${business.slug}`} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-zinc-700 inline-flex items-center gap-1">Ver site <Icon n="external" size={10} /></a>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 ml-auto">
          <PeriodSelector value={period} onChange={setPeriod} />
          <Link href={`/pagina${q}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md hover:bg-zinc-800">Editar página</Link>
        </div>
      </div>
      <div className="sm:hidden flex items-center gap-2 mb-4">
        <PeriodSelector value={period} onChange={setPeriod} compact />
        <Link href={`/pagina${q}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md ml-auto shrink-0">Editar página</Link>
      </div>

      {/* Áreas ativas deste negócio (contexto, não decoração) */}
      <h2 className="text-sm font-semibold text-zinc-900 mb-1">Dashboard</h2>
      <p className="text-xs text-zinc-500 mb-3">{context.areas.join(' · ')}</p>

      <PermissionNotice message={notice?.title} hint={notice?.hint} onDismiss={dismiss} />

      {/* ── HOJE (só para negócio com agenda): primeiro "como está a operação" ── */}
      {modules.bookings && today && (
        <div className="bg-white border border-zinc-200 mb-3">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Hoje</h3>
            <Link href={`/agenda${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Abrir agenda →</Link>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-zinc-100 divide-y sm:divide-y-0">
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none">{today.total}</p><p className="text-xs text-zinc-500 mt-1">atendimentos</p></div>
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none text-emerald-700">{today.confirmed}</p><p className="text-xs text-zinc-500 mt-1">confirmados</p></div>
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none text-amber-600">{today.pending}</p><p className="text-xs text-zinc-500 mt-1">aguardando</p></div>
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none">{today.completed}</p><p className="text-xs text-zinc-500 mt-1">concluídos</p></div>
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none text-zinc-500">{today.noShow}</p><p className="text-xs text-zinc-500 mt-1">faltas</p></div>
            <div className="px-4 py-3 bg-amber-50/50"><p className={`text-lg font-semibold leading-none ${today.needsClosure ? 'text-amber-700' : ''}`}>{today.needsClosure}</p><p className="text-xs text-zinc-500 mt-1">p/ fechar</p></div>
          </div>
        </div>
      )}

      {/* ── ATENÇÃO: depois dos KPIs, o que precisa de decisão ── */}
      {modules.bookings && pendencies.length > 0 && (
        <AttentionStrip
          title={`${pendencies.length} precisam de fechamento`}
          hint="horário passou e continua em aberto"
          action={(
            <>
              {pendencies.slice(0, 3).map((b) => (
                <Link key={b.id} href={`/agenda${q}`} className="text-xs font-medium bg-white border border-amber-200 text-amber-900 px-2.5 py-1 rounded-md hover:bg-amber-50">
                  {b.date.slice(8, 10)}/{b.date.slice(5, 7)} {b.time} · {b.customerName}
                </Link>
              ))}
              {pendencies.length > 3 && <Link href={`/agenda${q}`} className="text-xs font-medium text-amber-900 underline self-center">+{pendencies.length - 3}</Link>}
            </>
          )}
        />
      )}

      {next && (
        <div className="mb-4 bg-white border border-zinc-200 px-3 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-700">Próxima ação: <strong className="text-zinc-900">{next.label}</strong></p>
          <Link href={next.href} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md shrink-0">Fazer agora</Link>
        </div>
      )}

      {/* ── Linha principal: receita contextual + lista operacional + movimento ── */}
      <div className="grid lg:grid-cols-12 gap-3 mb-3">
        {/* RECEITA — rótulo e regra dependem dos módulos ativos */}
        <div className="lg:col-span-4 bg-white border border-zinc-200">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">
              {modules.orders && !modules.bookings && !modules.services ? 'Receita' : modules.bookings || modules.services ? 'Receita prevista' : 'Receita'}
            </h3>
            <span className="text-xs text-zinc-400">{periodLabel(period)}</span>
          </div>
          {!showMoney ? (
            <div className="px-4 py-4"><p className="text-sm text-zinc-500">Sem acesso financeiro.</p></div>
          ) : (revenueDetail?.sources || []).length === 0 ? (
            <div className="px-4 py-4">
              <p className="text-2xl font-semibold tracking-tight">{money(0)}</p>
              <p className="text-xs text-zinc-500 mt-1">{NO_DATA_MESSAGE}</p>
              <p className="text-[11px] text-zinc-400 mt-2">Ative um módulo comercial (agendamentos/serviços ou produtos/pedidos) em Recursos para acompanhar valores.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {/* Valor dos atendimentos (services/bookings) */}
              {bookingRevenue && (
                <div className="px-4 py-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-2xl font-semibold tracking-tight">{money(bookingRevenue.total)}</p>
                    {/* Variação só existe com janela anterior comparável. */}
                    {period !== 0 && (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${bookingRevenue.delta >= 0 ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                        {bookingRevenue.delta >= 0 ? '▲' : '▼'} {money(Math.abs(bookingRevenue.delta))}
                      </span>
                    )}
                  </div>
                  {bookingRevenue.hasData ? (
                    <p className="text-xs text-zinc-500 mt-1">
                      {bookingRevenue.count} {bookingRevenue.unitLabel} · tíquete {money(bookingRevenue.ticket)}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500 mt-1">{NO_DATA_MESSAGE}</p>
                  )}
                  {/* Quebra por status: separa o que é previsão do que não conta */}
                  {bookingRevenue.breakdown && bookingRevenue.breakdown.length > 0 && (
                    <ul className="mt-3 pt-3 border-t border-zinc-100 space-y-1 text-xs">
                      {bookingRevenue.breakdown.map((row) => (
                        <li key={row.status} className="flex items-center justify-between gap-2">
                          <span className={row.eligible ? 'text-zinc-600' : 'text-zinc-400'}>
                            {row.label}
                            {!row.eligible && <span className="text-[10px] ml-1">(fora da soma)</span>}
                          </span>
                          <span className={row.eligible ? 'font-semibold text-zinc-900' : 'text-zinc-400'}>
                            {row.count > 0 ? `${row.count} · ${money(row.total)}` : '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-zinc-400 mt-3 leading-snug">{bookingRevenue.hint}</p>
                </div>
              )}

              {/* Receita de pedidos (products/orders) — separada, nunca somada */}
              {orderRevenue && (
                <div className="px-4 py-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold tracking-wide uppercase text-zinc-400">Pedidos</p>
                      <p className="text-xl font-semibold tracking-tight mt-0.5">{money(orderRevenue.total)}</p>
                    </div>
                    {period !== 0 && (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${orderRevenue.delta >= 0 ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                        {orderRevenue.delta >= 0 ? '▲' : '▼'} {money(Math.abs(orderRevenue.delta))}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    {orderRevenue.hasData ? `${orderRevenue.count} pedidos · tíquete ${money(orderRevenue.ticket)}` : NO_DATA_MESSAGE}
                  </p>
                  {bookingRevenue && <p className="text-[11px] text-zinc-400 mt-2 leading-snug">{orderRevenue.hint}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Lista operacional: atendimentos (agenda) OU pedidos (varejo) */}
        {modules.bookings ? (
          <div className="lg:col-span-5 bg-white border border-zinc-200 flex flex-col">
            <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Próximos atendimentos</h3>
              <Link href={`/agenda${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Ver agenda →</Link>
            </div>
            <div className="flex-1">
              {upcoming.length === 0 ? <p className="text-sm text-zinc-500 px-4 py-6 text-center">Nenhum atendimento futuro.</p> : (
                <div className="divide-y divide-zinc-100">
                  {upcoming.slice(0, 5).map((b) => (
                    <div key={b.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50">
                      <span className="text-xs font-medium text-zinc-500 w-14 shrink-0">{humanDay(b.date)} {b.time}</span>
                      <span className="flex-1 min-w-0 truncate"><strong className="font-medium">{b.customerName}</strong> <span className="text-zinc-500">· {b.service}{b.professional ? ` · ${b.professional}` : ''}</span></span>
                      <StatusBadge tone={b.status === 'confirmed' ? 'emerald' : 'orange'}>{b.status === 'confirmed' ? 'conf' : 'pend'}</StatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : modules.orders ? (
          <div className="lg:col-span-5 bg-white border border-zinc-200 flex flex-col">
            <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Pedidos</h3>
              <Link href={`/pedidos${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Ver pedidos →</Link>
            </div>
            <div className="flex-1">
              {recent.orders.length === 0 ? <p className="text-sm text-zinc-500 px-4 py-6 text-center">Nenhum pedido ainda.</p> : (
                <div className="divide-y divide-zinc-100">
                  {recent.orders.map((o) => {
                    const d = orderDef(o.status);
                    return (
                      <div key={o.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50">
                        <span className="text-xs font-medium text-zinc-500 w-14 shrink-0">{o.code}</span>
                        <span className="flex-1 min-w-0 truncate"><strong className="font-medium">{o.customerName}</strong></span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${toneCls(d.tone)}`}>{d.panel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="lg:col-span-5 bg-white border border-zinc-200 flex flex-col">
            <div className="px-4 py-2.5 border-b border-zinc-100">
              <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Clientes</h3>
            </div>
            <div className="flex-1 px-4 py-6 text-center">
              <p className="text-sm text-zinc-500">{crm?.contacts ?? 0} contatos na base</p>
              <Link href={`/clientes${q}`} className="mt-3 inline-block text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md">Abrir clientes</Link>
            </div>
          </div>
        )}

        {/* Movimento — denso */}
        <div className="lg:col-span-3 bg-white border border-zinc-200">
          <div className="px-4 py-2.5 border-b border-zinc-100"><h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Movimento</h3></div>
          <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100">
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none">{totals.uniqueVisitors}</p><p className="text-xs text-zinc-500">visitantes únicos</p></div>
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none">{totals.clicks}</p><p className="text-xs text-zinc-500">cliques</p></div>
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none">{totals.leads}{totals.leadsNew > 0 && <span className="text-amber-600 text-xs"> +{totals.leadsNew}</span>}</p><p className="text-xs text-zinc-500">leads</p></div>
            <div className="px-4 py-3"><p className="text-lg font-semibold leading-none">{totals.conversions}</p><p className="text-xs text-zinc-500">conversões</p></div>
          </div>
          <div className="px-4 py-2.5 border-t border-zinc-100"><Link href={`/resultados${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Ver resultados →</Link></div>
        </div>
      </div>

      {/* ── Pedidos/Produtos: SOMENTE com módulo ativo ── */}
      {(modules.orders || modules.products) && (
        <div className="bg-white border border-zinc-200 mb-3">
          <div className={`grid divide-y divide-zinc-100 ${modules.orders && modules.products ? 'sm:grid-cols-2 sm:divide-y-0 sm:divide-x' : ''}`}>
            {modules.orders && ordersPanel && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Pedidos</p>
                  <Link href={`/pedidos${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Ver →</Link>
                </div>
                <p className="text-xl font-semibold leading-none">{ordersPanel.inWindow} <span className="text-xs font-normal text-zinc-500">no período</span></p>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                  <span className="text-zinc-600"><strong className="text-zinc-900">{ordersPanel.new}</strong> novos</span>
                  <span className="text-zinc-600"><strong className="text-zinc-900">{ordersPanel.open}</strong> abertos</span>
                  <span className="text-zinc-600"><strong className="text-zinc-900">{ordersPanel.total}</strong> total</span>
                </div>
              </div>
            )}
            {modules.products && productsPanel && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Vitrine de produtos</p>
                  <Link href={`/produtos${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Gerenciar →</Link>
                </div>
                <p className="text-xl font-semibold leading-none">{productsPanel.active} <span className="text-xs font-normal text-zinc-500">exibidos na página</span></p>
                <p className="text-xs text-zinc-600 mt-2">Interesse via WhatsApp — sem carrinho nem checkout</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CRM / Página / WhatsApp — painel único com divisórias ── */}
      <div className="bg-white border border-zinc-200 mb-3">
        <div className={`grid divide-y divide-zinc-100 ${whatsapp ? 'sm:grid-cols-3 sm:divide-y-0 sm:divide-x' : 'sm:grid-cols-2 sm:divide-y-0 sm:divide-x'}`}>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">CRM</p><Link href={`/clientes${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Ver →</Link></div>
            <p className="text-xl font-semibold leading-none">{crm?.contacts ?? 0} <span className="text-xs font-normal text-zinc-500">contatos</span></p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs leading-tight">
              <span className="text-zinc-600"><strong className="text-zinc-900">{crm?.customers ?? 0}</strong> cadastrados</span>
              <span className="text-zinc-600"><strong className="text-zinc-900">{crm?.withConsent ?? 0}</strong> c/ consentimento</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Página</p><Link href={`/pagina${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Editar →</Link></div>
            <p className="text-xl font-semibold leading-none">{pageStats?.views ?? totals.visitors} <span className="text-xs font-normal text-zinc-500">views</span></p>
            <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
              <span><strong>{pageStats?.clicks ?? 0}</strong> cliques</span>
              <span><strong>{modules.bookings ? (pageStats?.bookings ?? 0) : 0}</strong> agends</span>
              <span><strong>{pageStats?.conversions ?? 0}</strong> convs</span>
            </div>
          </div>
          {whatsapp && (
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp</p><Link href={`/whatsapp${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Abrir →</Link></div>
              <p className={`text-sm font-semibold ${whatsapp.status === 'connected' ? 'text-emerald-700' : 'text-zinc-600'}`}>{whatsapp.status === 'connected' ? 'Conectado' : 'Não conectado'}</p>
              <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                <span><strong>{whatsapp.open ?? 0}</strong> abertas</span>
                <span><strong>{whatsapp.unread ?? 0}</strong> não lidas</span>
                <span><strong>{whatsapp.pendingMessages ?? 0}</strong> fila</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Comece por aqui (checklist LEVE, não bloqueante) + Atividade recente ──
          Progresso REAL: os itens vêm de dados existentes (lib/dashboard.ts →
          setupChecklist). Sem pendências, a área simplesmente some — e pode ser
          ocultada a qualquer momento sem perder nada. */}
      <div className={hasSetupPending && !setupHidden ? 'grid lg:grid-cols-2 gap-3' : ''}>
        {hasSetupPending && !setupHidden && (
          <div className="bg-white border border-zinc-200">
            <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Comece por aqui</h3>
              <span className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-500">{doneCount}/{checklist.length}</span>
                <button onClick={hideSetup} className="text-xs font-medium text-zinc-400 hover:text-zinc-700 inline-flex items-center gap-1" title="Ocultar checklist">
                  <Icon n="x" size={12} /> Ocultar
                </button>
              </span>
            </div>
            <div className="px-4 py-3">
              <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-zinc-900 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <ul className="divide-y divide-zinc-100 -mx-4">
                {checklist.map((c) => (
                  <li key={c.label} className="px-4 py-2 flex items-center gap-2.5 text-sm hover:bg-zinc-50">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${c.done ? 'bg-zinc-900 text-white' : 'border border-zinc-300'}`}>{c.done ? <Icon n="check" size={10} /> : null}</span>
                    <Link href={c.href} className={c.done ? 'text-zinc-400 line-through' : 'text-zinc-700 font-medium'}>{c.label}</Link>
                    {!c.done && <Link href={c.href} className="ml-auto text-xs font-medium text-zinc-900 underline">Fazer</Link>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="bg-white border border-zinc-200">
          <div className="px-4 py-2.5 border-b border-zinc-100"><h3 className="text-sm font-semibold">Atividade recente</h3></div>
          <div className="px-2 py-2">
            {!hasActivity ? <p className="text-sm text-zinc-500 px-2 py-4">Nenhuma atividade ainda.</p> : (
              <ul className="divide-y divide-zinc-100">
                {/* Pedidos só entram quando o módulo existe (nunca em clínica). */}
                {modules.orders && recent.orders.map((o) => {
                  const d = orderDef(o.status);
                  return (
                    <li key={o.id} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0 truncate"><Icon n="receipt" size={14} className="text-zinc-400 shrink-0" /> Pedido <strong>{o.code}</strong> — {o.customerName}</span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                    </li>
                  );
                })}
                {modules.bookings && recent.bookings.map((b) => {
                  const d = bookDef(b.status);
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                      <span className="flex items-center gap-2 truncate"><Icon n="calendar" size={14} className="text-zinc-400 shrink-0" /> {b.customerName} · {humanDay(b.date)} {b.time}</span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                    </li>
                  );
                })}
                {recent.leads.map((l) => {
                  const d = leadDef(l.status);
                  return (
                    <li key={l.id} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                      <span className="flex items-center gap-2 truncate"><Icon n="user" size={14} className="text-zinc-400 shrink-0" /> {l.name || l.phone || 'novo'} <span className="text-zinc-400 text-xs">via {l.origin}</span></span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
