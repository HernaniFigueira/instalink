'use client';
// ═══════════════════════════════════════════════════════════════
// DASHBOARD CONTEXTUAL — A1.2 · Bloco 4 (consolidação final)
// ═══════════════════════════════════════════════════════════════
// Estrutura canônica (auditoria A1.2), na ordem de leitura:
//   1 · ATENÇÃO    — o que precisa de decisão (dados já existentes;
//                    link só quando o usuário pode abrir a rota);
//   2 · HOJE       — como está a operação do dia (agenda);
//   3 · PRÓXIMOS   — próximos compromissos (ou pedidos/clientes no varejo);
//   4 · PERÍODO    — receita + resultados + página + movimento do período,
//                    num único bloco com o seletor (nenhuma fórmula nova);
//   5 · RECENTES   — últimas entradas;
//   6 · ONDE AGIR  — ações úteis existentes (checklist real, conectar canal).
//
// O que saiu na consolidação (B4.2 — duplicações):
//   • bloco "Próxima ação" (era o 1º item do checklist repetido);
//   • título "Dashboard" + context.areas (o shell já nomeia a tela;
//     `areas` repetia a navegação do catálogo);
//   • blocos separados de Receita / Resultados / Movimento / Página
//     competindo como métricas de contexto diferente — agora são subseções
//     do bloco Período, cada uma com a sua janela rotulada de forma honesta
//     (MÉTRICAS E FÓRMULAS INTACTAS — mesma origem de dados de antes).
//
// RECEITA: sem contabilidade de mentira — "Receita prevista" (valor dos
// atendimentos elegíveis), com quebra por status; R$ 0 honesto sem dados.
//
// PERMISSÃO: 403 nesta tela mostra aviso amigável e o usuário CONTINUA
// logado. Somente 401 inicia o fluxo de login (lib/http.ts). Os destinos
// dos links vêm do mapa `links` (servidor, catálogo de permissões): sem
// permissão, a linha vira texto — ninguém é mandado para rota proibida.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, EmptyState, PageSkeleton, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icons';
import { AccessDenied, PermissionNotice, useForbiddenNotice } from '@/components/dashboard/AccessNotice';
import { PeriodSelector } from '@/components/dashboard/PeriodSelector';
import { apiGet } from '@/lib/api-client';
import { money } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { NO_DATA_MESSAGE, type RevenueResult } from '@/lib/revenue';
import { periodLabel } from '@/lib/periods';
import { ComparisonBadge } from '@/components/dashboard/results-view';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';
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
    labels: { activityUnit: string; showsOrders: boolean; showsBookings: boolean; showsProducts: boolean };
  };
  /** A1.2 · B4: itens de atenção (servidor; link só com permissão). */
  attention?: Array<{ id: string; count: number; label: string; href: string | null }>;
  /** A1.2 · B4: portas que este usuário PODE abrir (servidor decide). */
  links?: Record<string, boolean>;
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
  /**
   * Resultados do período (P2): recorte curto dos indicadores REAIS, montado
   * no servidor pelo mesmo motor da tela Resultados. Ausente para quem não tem
   * a permissão de resultados — ninguém recebe número que não pode ver.
   */
  results?: {
    periodKey: string;
    periodLabel: string;
    from: string;
    to: string;
    hasPrevious: boolean;
    items: Array<{
      id: string; label: string; value: number; unit: 'count' | 'money' | 'percent';
      hint: string; hasData: boolean; noDataHint?: string;
      prev: number | null; deltaPct: number | null;
    }>;
  } | null;
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
  const { notice, dismiss } = useForbiddenNotice('Início');
  // Estados completos (auditoria §12, mesma família do bug do /recursos):
  // uma falha de rede nunca pode virar skeleton eterno no Início.
  const [failed, setFailed] = useState('');
  const [retry, setRetry] = useState(0);

  const load = useCallback(() => {
    if (!businessId) return;
    setFailed('');
    apiGet<Overview>(`/api/overview?businessId=${businessId}&period=${period}`, { scope: 'area', area: 'Início' })
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
  // Ao voltar para a tela, o painel se atualiza sozinho (sem polling).
  useRevalidateOnFocus(load);

  if (denied) {
    // Sem caminho hardcoded: a porta de volta vem do catálogo (shell →
    // PanelHomeProvider → firstAllowedPath), então um perfil sem agenda
    // também tem destino válido.
    return (
      <AccessDenied
        area="Início"
        hint="Seu perfil não possui acesso a esta área. Você continua conectado — para ver o Início, peça ao proprietário para liberar a permissão “Início” em Equipe."
      />
    );
  }

  if (failed) {
    return (
      <div role="alert">
        <EmptyState icon="alert" title="Não foi possível carregar o painel" hint={failed}
          action={<Button variant="primary" size="sm" onClick={() => setRetry((r) => r + 1)}>Tentar de novo</Button>} />
      </div>
    );
  }

  if (!data) return <PageSkeleton />;

  const { user, business, totals, upcoming, checklist, pct, recent, today, crm, pageStats, whatsapp, ordersPanel, productsPanel, context } = data;
  const modules = context.modules;
  const results = data.results;
  const showMoney = data.showMoney !== false;
  const revenueDetail = data.revenueDetail;
  const bookingRevenue = revenueDetail?.bookings || null;
  const orderRevenue = revenueDetail?.orders || null;
  const attention = data.attention || [];
  const links = data.links || {};
  const q = `?b=${business.id}`;
  const doneCount = checklist.filter((c) => c.done).length;
  const hasSetupPending = (data.pendingSetup ?? checklist.filter((c) => !c.done).length) > 0;
  const hasActivity = recent.orders.length + recent.bookings.length + recent.leads.length > 0;
  const canalConnected = whatsapp?.status === 'connected';
  const orderDef = (s: string): StatusDef => (ORDER_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' } as StatusDef;
  const bookDef = (s: string): StatusDef => (BOOKING_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' } as StatusDef;
  const leadDef = (s: string): StatusDef => (LEAD_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' } as StatusDef;

  /** Linha de lista: com permissão vira link (linha inteira clicável, com
      indicação visual); sem permissão vira texto — nunca um 403 à toa. */
  function ListRow({ href, allowed, className, children }: {
    href: string; allowed: boolean; className: string; children: React.ReactNode;
  }) {
    if (!allowed) return <div className={className}>{children}</div>;
    return <Link href={href} className={`${className} hover:bg-zinc-50 transition-colors`}>{children}</Link>;
  }

  // 6 · ONDE AGIR — só ações que EXISTEM: checklist real + conectar canal.
  const showSetup = hasSetupPending && !setupHidden;
  const showConnectChannel = !!whatsapp && !canalConnected && links.canais === true;
  const hasWhereToAct = showSetup || showConnectChannel;

  return (
    <>
      {welcome && (
        <div className="mb-4 bg-[var(--brand-soft)] border-l-[3px] border-l-[var(--brand)] rounded-r-md px-4 py-3 flex items-start gap-3">
          <span className="w-8 h-8 rounded-md bg-white text-[var(--brand-fg)] flex items-center justify-center shrink-0"><Icon n="checkCircle" size={18} /></span>
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">{business.name} está criado, {user.name.split(' ')[0]}!</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Agenda, serviços e página já estão ativos. Siga o “Comece por aqui” abaixo — ou ignore e use o que precisa primeiro.</p>
          </div>
        </div>
      )}

      {/* Identidade da empresa — a marca do cliente é a identidade do workspace.
          B4.2: sem título "Dashboard" repetido (o shell já nomeia a tela). */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-zinc-200">
        <div className="w-10 h-10 rounded-md overflow-hidden bg-[var(--brand-soft)] text-[var(--brand-fg)] flex items-center justify-center font-bold shrink-0 border border-[var(--brand-border)]">
          {business.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
          ) : business.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-none text-[var(--text)] truncate">{business.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            {business.published ? <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" /> Publicada</span> : <span className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Rascunho</span>}
            <a href={`/${business.slug}`} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-zinc-700 inline-flex items-center gap-1">Ver site <Icon n="external" size={10} /></a>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 ml-auto">
          <Link href={`/pagina${q}`}><Button variant="secondary" size="xs">Editar página</Button></Link>
        </div>
      </div>
      <div className="sm:hidden flex items-center gap-2 mb-4">
        <Link href={`/pagina${q}`} className="ml-auto shrink-0"><Button variant="secondary" size="xs">Editar página</Button></Link>
      </div>

      <PermissionNotice message={notice?.title} hint={notice?.hint} onDismiss={dismiss} />

      {/* ── 1 · ATENÇÃO: num único lugar, com dados que JÁ existem. Link
          contextual só quando o usuário pode abrir a rota (mapa `links`). ── */}
      {attention.length > 0 && (
        <div className="mb-3 border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" role="status" aria-label="Itens que precisam de atenção">
          <span className="text-xs font-bold tracking-wide uppercase text-amber-900 inline-flex items-center gap-1.5">
            <Icon n="alert" size={14} /> Atenção
          </span>
          {attention.map((a) => {
            const cls = 'text-xs font-medium bg-white border border-amber-200 text-amber-900 px-2.5 py-1 rounded-md inline-flex items-center gap-1';
            const content = (<><strong>{a.count}</strong> {a.label}</>);
            return a.href
              ? <Link key={a.id} href={`${a.href}${q}`} className={`${cls} hover:bg-amber-100`}>{content}</Link>
              : <span key={a.id} className={cls}>{content}</span>;
          })}
        </div>
      )}

      {/* ── 2 · HOJE (só para negócio com agenda) ── */}
      {modules.bookings && today && (
        <div className="bg-white border border-zinc-200 mb-3">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Hoje</h3>
            {links.agenda === true && <Link href={`/agenda${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Abrir agenda →</Link>}
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

      {/* ── 3 + 4 · grade coerente de 12 colunas (5 + 7): próximos à esquerda,
          período consolidado à direita. Em telas menores tudo empilha. ── */}
      <div className="grid lg:grid-cols-12 gap-3 mb-3">

        {/* 3 · PRÓXIMOS COMPROMISSOS (varejo: pedidos; sem módulo: clientes) */}
        {modules.bookings ? (
          <section className="lg:col-span-5 bg-white border border-zinc-200 flex flex-col min-w-0">
            <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Próximos atendimentos</h3>
              {links.agenda === true && <Link href={`/agenda${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Ver agenda →</Link>}
            </div>
            <div className="flex-1">
              {upcoming.length === 0 ? <p className="text-sm text-zinc-500 px-4 py-6 text-center">Nenhum atendimento futuro.</p> : (
                <div className="divide-y divide-zinc-100">
                  {upcoming.slice(0, 5).map((b) => (
                    <ListRow key={b.id} allowed={links.agenda === true} href={`/agenda${q}`}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="text-xs font-medium text-zinc-500 w-14 shrink-0">{humanDay(b.date)} {b.time}</span>
                      <span className="flex-1 min-w-0 truncate"><strong className="font-medium">{b.customerName}</strong> <span className="text-zinc-500">· {b.service}{b.professional ? ` · ${b.professional}` : ''}</span></span>
                      <StatusBadge tone={b.status === 'confirmed' ? 'emerald' : 'orange'}>{b.status === 'confirmed' ? 'conf' : 'pend'}</StatusBadge>
                    </ListRow>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : modules.orders ? (
          <section className="lg:col-span-5 bg-white border border-zinc-200 flex flex-col min-w-0">
            <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Pedidos</h3>
              {links.pedidos === true && <Link href={`/pedidos${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Ver pedidos →</Link>}
            </div>
            <div className="flex-1">
              {recent.orders.length === 0 ? <p className="text-sm text-zinc-500 px-4 py-6 text-center">Nenhum pedido ainda.</p> : (
                <div className="divide-y divide-zinc-100">
                  {recent.orders.map((o) => {
                    const d = orderDef(o.status);
                    return (
                      <ListRow key={o.id} allowed={links.pedidos === true} href={`/pedidos${q}`}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="text-xs font-medium text-zinc-500 w-14 shrink-0">{o.code}</span>
                        <span className="flex-1 min-w-0 truncate"><strong className="font-medium">{o.customerName}</strong></span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${toneCls(d.tone)}`}>{d.panel}</span>
                      </ListRow>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="lg:col-span-5 bg-white border border-zinc-200 flex flex-col min-w-0">
            <div className="px-4 py-2.5 border-b border-zinc-100">
              <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Clientes</h3>
            </div>
            <div className="flex-1 px-4 py-6 text-center">
              <p className="text-sm text-zinc-500">{crm?.contacts ?? 0} contatos na base</p>
              {links.clientes === true && (
                <Link href={`/clientes${q}`} className="mt-3 inline-block"><Button variant="soft" size="xs">Abrir clientes</Button></Link>
              )}
            </div>
          </section>
        )}

        {/* 4 · PERÍODO — receita + resultados + página + movimento num único
            bloco (B4.3), cada subseção com a JANELA honesta. Nenhuma fórmula
            nova: mesma origem de dados de antes, só hierarquia. */}
        <section className="lg:col-span-7 bg-white border border-zinc-200 min-w-0 flex flex-col">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Período <span className="normal-case font-medium text-zinc-400">· {periodLabel(period)}</span></h3>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <PeriodSelector value={period} onChange={setPeriod} compact />
              {results && links.resultados === true && (
                <Link href={`/resultados${q}&period=${results.periodKey === 'all' ? '0' : results.periodKey}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900 whitespace-nowrap">
                  Completo →
                </Link>
              )}
            </div>
          </div>

          {/* Receita — rótulo e regra dependem dos módulos ativos (intactos). */}
          <div className="border-b border-zinc-100">
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

          {/* Resultados do período (mesmo motor da tela Resultados — intacto). */}
          {results && results.items.length > 0 && (
            <div className="border-b border-zinc-100">
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide uppercase text-zinc-400">Resultados · {results.periodLabel}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-zinc-100 border-t border-zinc-100">
                {results.items.map((it) => (
                  <div key={it.id} className="px-4 py-3">
                    <p className="text-lg font-semibold leading-none">
                      {it.hasData ? (it.unit === 'money' ? money(it.value) : `${it.value}${it.unit === 'percent' ? '%' : ''}`) : <span className="text-zinc-400 text-sm font-medium">{'—'}</span>}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">{it.label}</p>
                    {it.hasData && <ComparisonBadge metric={it} hasPrevious={results.hasPrevious} />}
                    {!it.hasData && <p className="text-[11px] text-zinc-400 mt-1">{it.noDataHint}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Página · no período (mesmos números do painel "Página" de antes). */}
          <div className="px-4 py-3 border-b border-zinc-100">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[11px] font-semibold tracking-wide uppercase text-zinc-400">Página · no período</p>
              {links.pagina === true && <Link href={`/pagina${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Editar →</Link>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-xs">
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{pageStats?.views ?? 0}</strong> views</span>
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{pageStats?.clicks ?? 0}</strong> cliques</span>
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{modules.bookings ? (pageStats?.bookings ?? 0) : 0}</strong> agends</span>
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{pageStats?.conversions ?? 0}</strong> convs</span>
            </div>
          </div>

          {/* Movimento · desde o início (mesmos totais de antes, janela
              rotulada — sem competir com o recorte do período). */}
          <div className="px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wide uppercase text-zinc-400 mb-1.5">Movimento · desde o início</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-xs">
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{totals.uniqueVisitors}</strong> visitantes únicos</span>
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{totals.clicks}</strong> cliques</span>
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{totals.leads}{totals.leadsNew > 0 ? <span className="text-amber-600 text-xs"> +{totals.leadsNew}</span> : null}</strong> leads</span>
              <span className="text-zinc-600"><strong className="text-base text-zinc-900">{totals.conversions}</strong> conversões</span>
            </div>
          </div>

          <div className="px-4 py-2 border-t border-zinc-100 mt-auto">
            <p className="text-[11px] text-zinc-400 leading-snug">
              Cada indicador usa a data correta do seu significado (atendimento, cadastro do cliente ou criação do lead).
              “Receita” é previsão: a plataforma não registra o pagamento.
            </p>
          </div>
        </section>
      </div>

      {/* ── Pedidos/Produtos: SOMENTE com módulo ativo ── */}
      {(modules.orders || modules.products) && (
        <div className="bg-white border border-zinc-200 mb-3">
          <div className={`grid divide-y divide-zinc-100 ${modules.orders && modules.products ? 'sm:grid-cols-2 sm:divide-y-0 sm:divide-x' : ''}`}>
            {modules.orders && ordersPanel && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Pedidos</p>
                  {links.pedidos === true && <Link href={`/pedidos${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Ver →</Link>}
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
                  {links.produtos === true && <Link href={`/produtos${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Gerenciar →</Link>}
                </div>
                <p className="text-xl font-semibold leading-none">{productsPanel.active} <span className="text-xs font-normal text-zinc-500">exibidos na página</span></p>
                <p className="text-xs text-zinc-600 mt-2">Interesse via WhatsApp — sem carrinho nem checkout</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CRM / Conversas — painel único com divisórias (a "Página" do
          antigo painel triplo virou subseção do bloco Período: mesma origem
          de dados, sem competir como métrica separada). ── */}
      <div className="bg-white border border-zinc-200 mb-3">
        <div className={`grid divide-y divide-zinc-100 ${whatsapp ? 'sm:grid-cols-2 sm:divide-y-0 sm:divide-x' : 'grid-cols-1'}`}>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">CRM</p>{links.clientes === true && <Link href={`/clientes${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Ver →</Link>}</div>
            <p className="text-xl font-semibold leading-none">{crm?.contacts ?? 0} <span className="text-xs font-normal text-zinc-500">contatos</span></p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs leading-tight">
              <span className="text-zinc-600"><strong className="text-zinc-900">{crm?.customers ?? 0}</strong> cadastrados</span>
              <span className="text-zinc-600"><strong className="text-zinc-900">{crm?.withConsent ?? 0}</strong> c/ consentimento</span>
            </div>
          </div>
          {whatsapp && (
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Conversas</p>{links.conversas === true && <Link href={`/conversas${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Abrir →</Link>}</div>
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

      {/* ── 5 + 6 · RECENTES + ONDE AGIR ── */}
      <div className={hasWhereToAct ? 'grid lg:grid-cols-2 gap-3 items-start' : ''}>
        {/* 5 · RECENTES */}
        <section className={`bg-white border border-zinc-200 min-w-0 ${hasWhereToAct ? '' : 'mb-3'}`}>
          <div className="px-4 py-2.5 border-b border-zinc-100"><h3 className="text-sm font-semibold">Atividade recente</h3></div>
          <div className="px-2 py-2">
            {!hasActivity ? <p className="text-sm text-zinc-500 px-2 py-4">Nenhuma atividade ainda.</p> : (
              <ul className="divide-y divide-zinc-100">
                {/* Pedidos só entram quando o módulo existe (nunca em clínica). */}
                {modules.orders && recent.orders.map((o) => {
                  const d = orderDef(o.status);
                  return (
                    <li key={o.id}>
                      <ListRow allowed={links.pedidos === true} href={`/pedidos${q}`} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                        <span className="flex items-center gap-2 min-w-0 truncate"><Icon n="receipt" size={14} className="text-zinc-400 shrink-0" /> Pedido <strong>{o.code}</strong> — {o.customerName}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                      </ListRow>
                    </li>
                  );
                })}
                {modules.bookings && recent.bookings.map((b) => {
                  const d = bookDef(b.status);
                  return (
                    <li key={b.id}>
                      <ListRow allowed={links.agenda === true} href={`/agenda${q}`} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                        <span className="flex items-center gap-2 truncate"><Icon n="calendar" size={14} className="text-zinc-400 shrink-0" /> {b.customerName} · {humanDay(b.date)} {b.time}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                      </ListRow>
                    </li>
                  );
                })}
                {recent.leads.map((l) => {
                  const d = leadDef(l.status);
                  return (
                    <li key={l.id}>
                      <ListRow allowed={links.funil === true} href={`/funil${q}`} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                        <span className="flex items-center gap-2 truncate"><Icon n="user" size={14} className="text-zinc-400 shrink-0" /> {l.name || l.phone || 'novo'} <span className="text-zinc-400 text-xs">via {l.origin}</span></span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                      </ListRow>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* 6 · ONDE AGIR — só ações que existem e que este usuário pode abrir:
            checklist real (progresso calculado de dados, nada inventado) e
            conectar canal. Sem pendência, a área simplesmente não aparece. */}
        {hasWhereToAct && (
          <section className="space-y-3 min-w-0">
            {showSetup && (
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
                  <div className="h-1.5 bg-[var(--surface-2)] rounded-pill overflow-hidden mb-3">
                    <div className="h-full bg-[var(--brand)] rounded-full transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                  <ul className="divide-y divide-zinc-100 -mx-4">
                    {checklist.map((c) => (
                      <li key={c.label}>
                        {/* Linha inteira clicável: um único destino, indicação
                            visual de interação, sem segundo link duplicado. */}
                        <Link href={c.href} className={`flex items-center gap-2.5 text-sm px-4 py-2 hover:bg-zinc-50 transition-colors ${c.done ? 'text-zinc-400' : ''}`}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${c.done ? 'bg-[var(--success)] text-white' : 'border border-[var(--border-strong)]'}`}>{c.done ? <Icon n="check" size={10} /> : null}</span>
                          <span className={c.done ? 'line-through' : 'text-zinc-700 font-medium'}>{c.label}</span>
                          {!c.done && <span className="ml-auto text-xs font-medium text-zinc-900">Fazer →</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {showConnectChannel && (
              <div className="bg-white border border-zinc-200 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Conectar canal de mensagens</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Para conversar com os seus clientes por aqui.</p>
                </div>
                <Link href={`/canais?tab=canais&b=${business.id}`} className="shrink-0"><Button variant="primary" size="xs">Conectar</Button></Link>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
