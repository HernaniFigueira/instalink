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
import { useWorkspace } from '@/components/dashboard/WorkspaceContext';
import { Button, DashboardSkeleton, EmptyState, PageSkeleton, StatusBadge } from '@/components/ui';
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
  checklist: Array<{ done: boolean; label: string; href: string; id?: string; optional?: boolean }>;
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
  const workspace = useWorkspace();
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
  // FASE 2 · P8 — pular um item OBRIGATÓRIO não existe: só os `optional`
  // têm este botão, e a gravação é no servidor (reabrir o painel mantém).
  const [skipping, setSkipping] = useState('');
  async function skipSetupItem(id: string) {
    if (!businessId || skipping) return;
    const current = (data?.checklist || []).filter((c) => c.optional && c.id && !c.done).map((c) => c.id!);
    const next = Array.from(new Set([...current, id])); // mantém os já pulados que ainda aparecem
    const already = (data?.checklist || []).filter((c) => c.done && c.optional && c.id).map((c) => c.id!);
    const payload = Array.from(new Set([...already, ...next]));
    setSkipping(id);
    try {
      const res = await fetch(`/api/businesses/${businessId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupSkipped: payload }),
      });
      if (res.ok) setRetry((r) => r + 1); // recarrega o overview com o progresso real
    } finally { setSkipping(''); }
  }
  const { notice, dismiss } = useForbiddenNotice('Início');
  // Estados completos (auditoria §12, mesma família do bug do /recursos):
  // uma falha de rede nunca pode virar skeleton eterno no Início.
  const [failed, setFailed] = useState('');
  const [retry, setRetry] = useState(0);

  // Tarefas abertas (resumo real do /api/tasks) para o bloco de atividade.
  const [taskSum, setTaskSum] = useState<{ open: number; overdue: number; dueToday: number; mine: number } | null>(null);
  // Série diária de agendamentos do período (contagem REAL vinda da mesma API
  // que a Agenda usa — nenhuma fórmula nova, nenhum dado inventado).
  const [series, setSeries] = useState<Array<{ date: string; count: number }> | null>(null);
  const [yday, setYday] = useState<{ total: number; byStatus: Record<string, number> } | null>(null);
  const [periodMix, setPeriodMix] = useState<Record<string, number> | null>(null);
  const [openTasks, setOpenTasks] = useState<Array<{ id: string; title: string; dueAt: string }> | null>(null);
  useEffect(() => {
    if (!businessId) return;
    let on = true;
    apiGet<{ summary?: { open: number; overdue: number; dueToday: number; mine: number }; tasks?: Array<{ id: string; title: string; dueAt: string; status?: string }> }>(
      `/api/tasks?businessId=${businessId}&status=open`, { scope: 'area', area: 'Início' },
    ).then((r) => {
      if (!on) return;
      setTaskSum(r.ok && r.data?.summary ? r.data.summary : null);
      const list = Array.isArray(r.data?.tasks) ? r.data.tasks : [];
      setOpenTasks(list.filter((t: { status?: string }) => (t.status || 'open') === 'open').slice(0, 4));
    }).catch(() => { if (on) { setTaskSum(null); setOpenTasks(null); } });
    return () => { on = false; };
  }, [businessId]);
  useEffect(() => {
    if (!businessId) return;
    let on = true;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const from = new Date(Date.now() - (period - 1) * 86400000);
    const to = new Date();
    apiGet<{ bookings?: Array<{ date: string; status: string }> }>(
      `/api/bookings?businessId=${businessId}&mode=manage&from=${iso(from)}&to=${iso(to)}&limit=500`,
      { scope: 'area', area: 'Início' },
    ).then((r) => {
      if (!on) return;
      if (!r.ok || !Array.isArray(r.data?.bookings)) { setSeries(null); setYday(null); setPeriodMix(null); return; }
      const map = new Map<string, number>();
      for (let i = 0; i < period; i++) map.set(iso(new Date(from.getTime() + i * 86400000)), 0);
      for (const b of r.data.bookings) if (map.has(b.date)) map.set(b.date, (map.get(b.date) || 0) + 1);
      setSeries([...map.entries()].map(([date, count]) => ({ date, count })));
      // Ontem (comparação REAL dos KPIs) e mix de status do período (donut).
      const y = iso(new Date(Date.now() - 86400000));
      const yb = r.data.bookings.filter((b) => b.date === y);
      const bySt: Record<string, number> = {};
      for (const b of yb) bySt[b.status] = (bySt[b.status] || 0) + 1;
      setYday({ total: yb.length, byStatus: bySt });
      const mix: Record<string, number> = {};
      for (const b of r.data.bookings) mix[b.status] = (mix[b.status] || 0) + 1;
      setPeriodMix(mix);
    }).catch(() => { if (on) { setSeries(null); setYday(null); setPeriodMix(null); } });
    return () => { on = false; };
  }, [businessId, period]);

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

  if (!data) return <DashboardSkeleton />;

  const { user, business, totals, upcoming, checklist, pct, recent, today, crm, pageStats, whatsapp, ordersPanel, productsPanel, context } = data;
  const modules = context.modules;
  const results = data.results;
  const showMoney = data.showMoney === true;
  const operational = !showMoney;
  const ownAgenda = workspace.agendaScope === 'own' || workspace.role === 'PROFISSIONAL';
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
  function ListRow({ href, allowed, className, children, style }: {
    href: string; allowed: boolean; className: string; children: React.ReactNode; style?: React.CSSProperties;
  }) {
    if (!allowed) return <div className={className} style={style}>{children}</div>;
    return <Link href={href} style={style} className={`${className} hover:bg-zinc-50 transition-colors`}>{children}</Link>;
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
      <PermissionNotice message={notice?.title} hint={notice?.hint} onDismiss={dismiss} />

      {/* ── Saudação + resumo curto (hierarquia do mockup) ── */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-[var(--text)]">
          {greeting()}, {user.name.split(' ')[0]}!
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {modules.bookings && today
            ? `${today.total} ${today.total === 1 ? 'atendimento' : 'atendimentos'} hoje · ${upcoming.length} próximo${upcoming.length === 1 ? '' : 's'} na agenda${showMoney && bookingRevenue ? ` · ${money(bookingRevenue.total)} previstos no período` : ''}.`
            : operational
              ? 'Chegadas, próximos horários e o que precisa de atenção.'
              : 'Acompanhe o dia e os resultados disponíveis da operação.'}
        </p>
        </div>
        <div className="dsh-card flex items-center gap-2.5 px-3.5 py-2.5" title="Data de hoje">
          <Icon n="calendar" size={16} className="text-[var(--brand-fg)]" />
          <span className="text-[12.5px] font-bold text-[var(--text)]">
            Hoje, {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
      </header>

      {/* ── 1 · ATENÇÃO (dados do servidor, links só com permissão) ── */}
      {attention.length > 0 && (
        <div className="mb-4 border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg" role="status" aria-label="Itens que precisam de atenção">
          <span className="text-xs font-bold tracking-wide uppercase text-[var(--warning-fg)] inline-flex items-center gap-1.5">
            <Icon n="alert" size={14} /> Atenção
          </span>
          {attention.map((a) => {
            const cls = 'text-xs font-medium bg-white border border-[var(--warning-border)] text-[var(--warning-fg)] px-2.5 py-1 rounded-md inline-flex items-center gap-1';
            const content = (<><strong>{a.count}</strong> {a.label}</>);
            return a.href
              ? <Link key={a.id} href={`${a.href}${q}`} className={`${cls} hover:bg-[var(--warning-bg)]`}>{content}</Link>
              : <span key={a.id} className={cls}>{content}</span>;
          })}
        </div>
      )}

      {/* ── 2 · KPIs DO DIA (cards com ícone, cor contextual e número grande) ── */}
      {modules.bookings && today && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
          <h3 className="sr-only">Hoje</h3>
          <div className="dsh-kpi">
            <span className="dsh-kpi__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}><Icon n="calendar" size={19} /></span>
            <span><span className="dsh-kpi__num">{today.total}</span><span className="dsh-kpi__label block">Atendimentos hoje</span>
              <KpiDelta now={today.total} prev={yday?.total ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-kpi">
            <span className="dsh-kpi__icon" style={{ background: 'var(--success-bg)', color: 'var(--success-fg)' }}><Icon n="checkCircle" size={19} /></span>
            <span><span className="dsh-kpi__num">{today.confirmed}</span><span className="dsh-kpi__label block">Confirmados</span>
              <KpiDelta now={today.confirmed} prev={yday?.byStatus['confirmed'] ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-kpi">
            <span className="dsh-kpi__icon" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}><Icon n="clock" size={19} /></span>
            <span><span className="dsh-kpi__num">{today.pending}</span><span className="dsh-kpi__label block">Aguardando</span>
              <KpiDelta now={today.pending} prev={yday?.byStatus['pending'] ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-kpi">
            <span className="dsh-kpi__icon" style={{ background: 'var(--ops-soft)', color: 'var(--ops-fg)' }}><Icon n="tasks" size={19} /></span>
            <span><span className="dsh-kpi__num">{today.completed}</span><span className="dsh-kpi__label block">Concluídos</span>
              <KpiDelta now={today.completed} prev={yday?.byStatus['completed'] ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-kpi">
            <span className="dsh-kpi__icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}><Icon n="alert" size={19} /></span>
            <span><span className="dsh-kpi__num">{today.noShow}</span><span className="dsh-kpi__label block">Faltas</span>
              <KpiDelta now={today.noShow} prev={yday?.byStatus['no_show'] ?? 0} has={yday !== null} />
            </span>
          </div>
          {showMoney && bookingRevenue ? (
            <div className="dsh-kpi">
              <span className="dsh-kpi__icon" style={{ background: 'var(--success-bg)', color: 'var(--success-fg)' }}><Icon n="cash" size={19} /></span>
              <span><span className="dsh-kpi__num" style={{ fontSize: 21 }}>{moneyKpi(bookingRevenue.total)}</span><span className="dsh-kpi__label block" title={`Período: ${results?.periodLabel || periodLabel(period)}`}>Receita prevista</span></span>
            </div>
          ) : (
            <div className="dsh-kpi">
              <span className="dsh-kpi__icon" style={{ background: today.needsClosure ? 'var(--warning-bg)' : 'var(--surface-2)', color: today.needsClosure ? 'var(--warning-fg)' : 'var(--text-muted)' }}><Icon n="shield" size={19} /></span>
              <span><span className="dsh-kpi__num">{today.needsClosure}</span><span className="dsh-kpi__label block">Precisam de fechamento</span></span>
            </div>
          )}
        </div>
      )}

      {/* ── 3 · Setup real + Indicadores do período (5 + 7, como o mockup) ── */}
      <div className="grid items-start gap-4 lg:grid-cols-12 mb-4">
        {hasWhereToAct ? (
        <section className="lg:col-span-5 dsh-card min-w-0">
          {showSetup ? (
            <>
              <div className="dsh-card__head">
                <h3 className="dsh-card__title">Sua clínica está pronta?</h3>
                <span className="text-[12px] font-bold text-[var(--brand-fg)]">{pct}%</span>
              </div>
              <div className="dsh-card__body">
                <div className="h-2 rounded-full bg-[var(--surface-3)] overflow-hidden mb-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="space-y-2">
                  {checklist.map((c) => (
                    c.done ? (
                      <div key={c.label} className="dsh-check">
                        <span className="dsh-check__mark dsh-check__mark--done" aria-hidden="true"><Icon n="check" size={12} /></span>
                        <span className="line-through opacity-70 flex-1">{c.label}</span>
                      </div>
                    ) : (
                      <div key={c.label} className="flex gap-1.5 items-stretch">
                        <Link href={`${c.href}${c.href.includes('?') ? '&' : '?'}b=${business.id}`} className="dsh-check hover:border-[var(--brand-border)] flex-1">
                          <span className="dsh-check__mark dsh-check__mark--todo" aria-hidden="true" />
                          <span className="flex-1">{c.label}{c.optional ? ' (opcional)' : ''}</span>
                          <span className="text-[11.5px] font-bold text-[var(--brand-fg)]">Fazer →</span>
                        </Link>
                        {/* FASE 2 · P8 — pular só o NÃO obrigatório (nunca trava o progresso). */}
                        {c.optional && c.id && (
                          <button type="button"
                            onClick={() => { void skipSetupItem(c.id!); }}
                            disabled={skipping === c.id}
                            className="rounded-md border border-[var(--border)] px-2 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-60"
                            title="Marcar como resolvido sem conectar agora">
                            {skipping === c.id ? '…' : 'Pular'}
                          </button>
                        )}
                      </div>
                    )
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-[var(--text-muted)]">Comece por aqui — na ordem que fizer sentido.</p>
                  <button type="button" onClick={hideSetup} className="text-[11px] font-semibold text-[var(--text-faint)] hover:text-[var(--text-muted)] underline underline-offset-2">Ocultar</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="dsh-card__head">
                <h3 className="dsh-card__title">Conectar canal de conversas</h3>
              </div>
              <div className="dsh-card__body">
                <p className="text-[12.5px] text-[var(--text-muted)] mb-3">
                  O WhatsApp ainda não está conectado nesta unidade. Sem canal, as conversas não chegam ao painel.
                </p>
                <Link href={`/canais?tab=canais&b=${business.id}`} className="pe-btn pe-btn--green inline-flex">Conectar canal</Link>
              </div>
            </>
          )}
        </section>
        ) : (
        <section className="lg:col-span-5 dsh-card min-w-0">
          <>
              <div className="dsh-card__head">
                <h3 className="dsh-card__title">Presença online</h3>
                {links.pagina === true && <Link href={`/pagina${q}`} className="text-[12px] font-bold text-[var(--brand-fg)] hover:underline">Editar página →</Link>}
              </div>
              <div className="dsh-card__body">
                {pageStats ? (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)] mb-2">Página · no período</p>
                    <p className="text-[12.5px] font-semibold text-[var(--text-soft)] mb-3">
                      {pageStats.published
                        ? <>Página <strong className="text-[var(--success-fg)]">publicada</strong> em /{pageStats.slug}.</>
                        : <>Página ainda <strong className="text-[var(--warning-fg)]">não publicada</strong>.</>}
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-[var(--surface-2)] py-2.5"><p className="dsh-kpi__num text-[18px]">{pageStats?.views ?? 0}</p><p className="text-[11px] font-semibold text-[var(--text-muted)]">visitas</p></div>
                      <div className="rounded-lg bg-[var(--surface-2)] py-2.5"><p className="dsh-kpi__num text-[18px]">{pageStats.clicks}</p><p className="text-[11px] font-semibold text-[var(--text-muted)]">cliques</p></div>
                      <div className="rounded-lg bg-[var(--surface-2)] py-2.5"><p className="dsh-kpi__num text-[18px]">{pageStats.bookings}</p><p className="text-[11px] font-semibold text-[var(--text-muted)]">reservas</p></div>
                    </div>
                    <p className="text-[11px] text-[var(--text-faint)] mt-3">Movimento · desde o início: {totals.uniqueVisitors} visitantes únicos.</p>
                  </>
                ) : (
                  <p className="text-[12.5px] text-[var(--text-muted)]">Sem módulo de página nesta unidade.</p>
                )}
              </div>
          </>
        </section>
        )}

        <section className="lg:col-span-7 dsh-card min-w-0">
          <div className="dsh-card__head">
            <h3 className="dsh-card__title">Período <span className="text-[var(--text-muted)] font-semibold">· indicadores e atividade</span></h3>
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
          <div className="dsh-card__body">
            {showMoney && bookingRevenue ? (
              <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
                <div>
                  <p className="text-[30px] leading-none font-extrabold tracking-tight text-[var(--text)]">{money(bookingRevenue.total)}</p>
                  <p className="text-[12px] text-[var(--text-muted)] mt-1.5">
                    {bookingRevenue.count} atendimentos elegíveis · ticket {money(bookingRevenue.ticket || 0)}
                  </p>
                  {!bookingRevenue.hasData && <p className="text-[11.5px] text-[var(--text-faint)] mt-1">{NO_DATA_MESSAGE}</p>}
                </div>
                {results?.hasPrevious && (() => {
                  const m = results.items.find((it) => it.unit === 'money');
                  return m ? <ComparisonBadge metric={m} hasPrevious={results.hasPrevious} /> : null;
                })()}
              </div>
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] mb-2">Sem acesso financeiro. O movimento aparece em atendimentos e resultados do período.</p>
            )}

            {results && results.items.length > 0 && (
              <div className="mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)] mb-2">Resultados · {results.periodLabel}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {results.items.slice(0, 4).map((it) => (
                  <div key={it.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-2.5 py-2">
                    <p className="text-[17px] font-extrabold leading-tight text-[var(--text)] tabular-nums">
                      {it.unit === 'money' ? money(it.value) : it.unit === 'percent' ? `${it.value}%` : it.value}
                    </p>
                    <p className="text-[11px] font-semibold text-[var(--text-muted)] truncate">{it.label}</p>
                    {results.hasPrevious && <ComparisonBadge metric={it} hasPrevious={results.hasPrevious} />}
                  </div>
                ))}
              </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)] mb-2">Agendamentos por dia · {period}d</p>
                {series && series.some((d) => d.count > 0) ? (
                  <BarsChart data={series} />
                ) : (
                  <p className="text-[12px] text-[var(--text-muted)] bg-[var(--surface-2)] rounded-lg px-3 py-6 text-center">
                    {series ? 'Sem agendamentos no período ainda.' : 'Sem dados de agenda para este período.'}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)] mb-2">Status dos atendimentos · período</p>
                {periodMix && Object.values(periodMix).some((v) => v > 0) ? (
                  <DonutChart parts={[
                    { label: 'Confirmados', value: periodMix.confirmed || 0, color: 'var(--success)' },
                    { label: 'Concluídos', value: periodMix.completed || 0, color: 'var(--ops)' },
                    { label: 'Aguardando', value: periodMix.pending || 0, color: 'var(--warning)' },
                    { label: 'Faltas', value: periodMix.no_show || 0, color: 'var(--danger)' },
                    { label: 'Cancelados', value: periodMix.cancelled || 0, color: 'var(--text-faint)' },
                  ].filter((p) => p.value > 0)} />
                ) : (
                  <p className="text-[12px] text-[var(--text-muted)] bg-[var(--surface-2)] rounded-lg px-3 py-6 text-center">Nenhum atendimento no período ainda.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── 4 · Próximos · Conversas/tarefas · Atividade recente ── */}
      <div className="grid items-start gap-4 lg:grid-cols-3 mb-4">
        <section className="dsh-card min-w-0">
          <div className="dsh-card__head">
            <h3 className="dsh-card__title">Próximos atendimentos</h3>
            {links.agenda === true && <Link href={`/agenda${q}`} className="text-[12px] font-bold text-[var(--brand-fg)] hover:underline">Ver agenda →</Link>}
          </div>
          <div className="dsh-card__body pt-2">
            {modules.bookings ? (
              upcoming.length === 0 ? (
                <p className="text-[12.5px] text-[var(--text-muted)] text-center py-6">Nenhum atendimento futuro.</p>
              ) : (
                <div className="space-y-1.5">
                  {upcoming.slice(0, 5).map((b) => (
                    <ListRow key={b.id} allowed={links.agenda === true} href={`/agenda${q}&data=${b.date}`}
                      className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]"
                      style={{ borderLeft: `3px solid ${STATUS_BAR[b.status] || 'var(--border-strong)'}` }}>
                      <span className="text-[11px] font-bold text-[var(--text-muted)] w-16 shrink-0 tabular-nums">{humanDay(b.date)} {b.time}</span>
                      <span className="flex-1 min-w-0 truncate font-semibold text-[var(--text)]">{b.customerName} <span className="font-normal text-[var(--text-muted)]">· {b.service}</span></span>
                      <StatusBadge tone={b.status === 'confirmed' ? 'emerald' : b.status === 'pending' ? 'orange' : 'blue'}>{bookDef(b.status).panel}</StatusBadge>
                    </ListRow>
                  ))}
                </div>
              )
            ) : modules.orders ? (
              recent.orders.length === 0 ? <p className="text-[12.5px] text-[var(--text-muted)] text-center py-6">Nenhum pedido ainda.</p> : (
                <div className="space-y-1.5">
                  {recent.orders.slice(0, 5).map((o) => {
                    const d = orderDef(o.status);
                    return (
                      <ListRow key={o.id} allowed={links.pedidos === true} href={`/pedidos${q}`}
                        className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                        <span className="text-[11px] font-bold text-[var(--text-muted)] w-16 shrink-0">{o.code}</span>
                        <span className="flex-1 min-w-0 truncate font-semibold text-[var(--text)]">{o.customerName}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium border ${toneCls(d.tone)}`}>{d.panel}</span>
                      </ListRow>
                    );
                  })}
                </div>
              )
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] text-center py-6">Sem agenda ou pedidos neste contexto.</p>
            )}
          </div>
        </section>

        <section className="dsh-card min-w-0">
          <div className="dsh-card__head">
            <h3 className="dsh-card__title">Conversas e tarefas</h3>
            {links.conversas === true && <Link href={`/conversas${q}`} className="text-[12px] font-bold text-[var(--brand-fg)] hover:underline">Abrir →</Link>}
          </div>
          <div className="dsh-card__body pt-2 space-y-1.5">
            {whatsapp ? (
              <ListRow allowed={links.conversas === true} href={`/conversas${q}`}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                <span className="dsh-kpi__icon !w-7 !h-7" style={{ background: 'var(--cyan-bg)', color: 'var(--cyan-fg)' }}><Icon n="chat" size={15} /></span>
                <span className="flex-1 font-semibold text-[var(--text)]">Conversas não lidas</span>
                <span className="text-[13px] font-extrabold tabular-nums text-[var(--text)]">{whatsapp.unread}</span>
              </ListRow>
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2">Canal de conversas não conectado.</p>
            )}
            {whatsapp && totals.leads > 0 && (
              <ListRow allowed={links.funil === true} href={`/funil${q}`}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                <span className="dsh-kpi__icon !w-7 !h-7" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}><Icon n="clock" size={15} /></span>
                <span className="flex-1 font-semibold text-[var(--text)]">Leads para follow-up</span>
                <span className="text-[13px] font-extrabold tabular-nums text-[var(--text)]">{totals.leads}</span>
              </ListRow>
            )}
            {canalConnected && (
              <div className="flex items-center gap-2.5 rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] px-2.5 py-2">
                <span className="dsh-kpi__icon !w-7 !h-7" style={{ background: 'var(--success)', color: '#fff' }}><Icon n="chat" size={15} /></span>
                <span className="flex-1 text-[11.5px] font-semibold text-[var(--success-fg)]">Envie mensagens para seus pacientes</span>
                <Link href={`/conversas${q}`} className="text-[11.5px] font-bold text-white bg-[var(--success)] hover:bg-[var(--success-strong)] px-2.5 py-1.5 rounded-md">Abrir conversas</Link>
              </div>
            )}
            {taskSum && taskSum.open > 0 ? (
              <>
                {(openTasks || []).map((t) => {
                  const lbl = dueLabel(t.dueAt);
                  const tone = lbl === 'atrasada' ? 'var(--danger)' : lbl === 'hoje' ? 'var(--warning)' : 'var(--border-strong)';
                  return (
                    <ListRow key={t.id} allowed={links.tarefas === true} href={`/tarefas${q}`}
                      className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                      <span className="w-4 h-4 rounded border-2 shrink-0" style={{ borderColor: tone }} aria-hidden="true" />
                      <span className="flex-1 min-w-0 truncate font-semibold text-[var(--text)]">{t.title}</span>
                      <span className="text-[10.5px] font-bold" style={{ color: lbl === 'atrasada' ? 'var(--danger-fg)' : lbl === 'hoje' ? 'var(--warning-fg)' : 'var(--text-faint)' }}>{lbl}</span>
                    </ListRow>
                  );
                })}
                <p className="text-[11px] text-[var(--text-faint)] px-1">
                  {taskSum.open} aberta{taskSum.open === 1 ? '' : 's'}
                  {taskSum.overdue > 0 && <> · <span className="text-[var(--danger-fg)] font-semibold">{taskSum.overdue} atrasada{taskSum.overdue === 1 ? '' : 's'}</span></>}
                </p>
              </>
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2">Nenhuma tarefa pendente.</p>
            )}
            {attention.length === 0 && !whatsapp && !taskSum && (
              <p className="text-[12.5px] text-[var(--text-muted)] text-center py-4">Nada pendente por aqui.</p>
            )}
          </div>
        </section>

        <section className="dsh-card min-w-0">
          <div className="dsh-card__head"><h3 className="dsh-card__title">Atividade recente</h3></div>
          <div className="dsh-card__body pt-2">
            {!hasActivity ? (
              <p className="text-[12.5px] text-[var(--text-muted)] text-center py-6">Nenhuma atividade ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {recent.bookings.slice(0, 3).map((b) => (
                  <p key={b.id} className="text-[12px] text-[var(--text-soft)] truncate">
                    <strong className="font-semibold text-[var(--text)]">{b.customerName}</strong> · {humanDay(b.date)} {b.time} · {bookDef(b.status).panel}
                  </p>
                ))}
                {recent.leads.slice(0, 2).map((l) => (
                  <ListRow key={l.id} allowed={links.funil === true} href={`/funil${q}`}
                    className="block text-[12px] text-[var(--text-soft)] truncate rounded-md px-1 -mx-1">
                    <strong className="font-semibold text-[var(--text)]">{l.name}</strong> · lead {leadDef(l.status).panel.toLowerCase()} · {l.origin}
                  </ListRow>
                ))}
                {recent.orders.slice(0, 2).map((o) => (
                  <p key={o.id} className="text-[12px] text-[var(--text-soft)] truncate">
                    <strong className="font-semibold text-[var(--text)]">{o.customerName}</strong> · pedido {o.code}
                  </p>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── 5 · Ações rápidas (só rotas que este usuário pode abrir) ── */}
      <section className="dsh-card mb-4">
        <div className="dsh-card__head"><h3 className="dsh-card__title">Ações rápidas</h3></div>
        <div className="dsh-card__body">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {links.agenda === true && (
              <Link href={`/agenda${q}`} className="dsh-quick">
                <span className="dsh-quick__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}><Icon n="calendarPlus" size={18} /></span>
                Novo agendamento
              </Link>
            )}
            {links.clientes === true && (
              <Link href={`/clientes${q}`} className="dsh-quick">
                <span className="dsh-quick__icon" style={{ background: 'var(--cyan-bg)', color: 'var(--cyan-fg)' }}><Icon n="users" size={18} /></span>
                Clientes
              </Link>
            )}
            {links.pagina === true && (
              <Link href={`/pagina${q}`} className="dsh-quick">
                <span className="dsh-quick__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}><Icon n="link" size={18} /></span>
                Editar página
              </Link>
            )}
            {links.tarefas === true && (
              <Link href={`/tarefas${q}`} className="dsh-quick">
                <span className="dsh-quick__icon" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}><Icon n="tasks" size={18} /></span>
                Tarefas
              </Link>
            )}
            {links.resultados === true && (
              <Link href={`/resultados${q}`} className="dsh-quick">
                <span className="dsh-quick__icon" style={{ background: 'var(--success-bg)', color: 'var(--success-fg)' }}><Icon n="chart" size={18} /></span>
                Resultados
              </Link>
            )}
            {links.canais === true && (
              <Link href={`/canais${q}`} className="dsh-quick">
                <span className="dsh-quick__icon" style={{ background: 'var(--ops-soft)', color: 'var(--ops-fg)' }}><Icon n="chat" size={18} /></span>
                {canalConnected ? 'Canais' : 'Conectar canal'}
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/** Rótulo curto de prazo (hoje/atrasada/amanhã/data) — apresentação honesta. */
function dueLabel(dueAt: string): string {
  if (!dueAt) return 'sem prazo';
  const d = dueAt.slice(0, 10);
  const t = new Date().toISOString().slice(0, 10);
  if (d < t) return 'atrasada';
  if (d === t) return 'hoje';
  if (d === new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return 'amanhã';
  return d.split('-').reverse().slice(0, 2).join('/');
}

/** Barra de estado das linhas de "Próximos atendimentos" (mockup). */
const STATUS_BAR: Record<string, string> = {
  confirmed: 'var(--success)', pending: 'var(--warning)', completed: 'var(--ops)',
  cancelled: 'var(--danger)', no_show: 'var(--text-faint)',
};

/** Delta REAL vs. ontem — só renderiza quando existe base de comparação. */
function KpiDelta({ now, prev, has }: { now: number; prev: number; has: boolean }) {
  if (!has || prev <= 0) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span className="flex items-center gap-1.5 mt-1">
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${up ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--danger-bg)] text-[var(--danger-fg)]'}`}>
        {up ? '↑' : '↓'} {Math.abs(pct)}%
      </span>
      <span className="text-[10px] text-[var(--text-faint)]">vs. ontem ({prev})</span>
    </span>
  );
}

/** Moeda compacta para o tile de KPI (sem centavos quando inteiros). */
function moneyKpi(cents: number): string {
  const v = cents / 100;
  return Number.isInteger(v) ? `R$ ${v.toLocaleString('pt-BR')}` : money(cents);
}

/* ── Apresentação: saudação por horário local (sem dado inventado) ── */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/* ── Gráfico de barras SVG (série real de agendamentos/dia) ── */
function BarsChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const W = 320, H = 96, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (W - pad * 2) / Math.max(1, data.length);
  const todayISO = new Date().toISOString().slice(0, 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[96px]" role="img" aria-label={`Agendamentos por dia, máximo ${max} em um dia`}>
      <line x1={pad} y1={H - 14} x2={W - pad} y2={H - 14} stroke="var(--surface-3)" strokeWidth={1} />
      {(() => {
        const pts = data.map((d, i) => [pad + i * bw + bw / 2, H - 14 - (d.count / max) * (H - 26)] as const);
        const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        const area = `${pad},${H - 14} ${line} ${(W - pad)},${H - 14}`;
        const last = pts[pts.length - 1];
        return (
          <>
            <polygon points={area} fill="var(--brand-soft)" />
            <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {last && <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--brand)" stroke="var(--surface)" strokeWidth={1.5} />}
          </>
        );
      })()}
      <text x={pad} y={H - 2} fontSize={9} fill="var(--text-faint)">{data[0]?.date.slice(8, 10)}/{data[0]?.date.slice(5, 7)}</text>
      <text x={W - pad} y={H - 2} fontSize={9} textAnchor="end" fill="var(--text-faint)">{data[data.length - 1]?.date.slice(8, 10)}/{data[data.length - 1]?.date.slice(5, 7)}</text>
    </svg>
  );
}

/* ── Donut SVG (contagens reais de hoje por status) ── */
function DonutChart({ parts }: { parts: Array<{ label: string; value: number; color: string }> }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 34, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 90 90" className="w-[104px] h-[104px] shrink-0" role="img" aria-label={`Distribuição de ${total} atendimentos de hoje por status`}>
        <circle cx={45} cy={45} r={R} fill="none" stroke="var(--surface-3)" strokeWidth={12} />
        {parts.map((p) => {
          const frac = p.value / total;
          const dash = `${frac * C} ${C}`;
          const off = -acc * C;
          acc += frac;
          return <circle key={p.label} cx={45} cy={45} r={R} fill="none" stroke={p.color} strokeWidth={12}
            strokeDasharray={dash} strokeDashoffset={off} transform="rotate(-90 45 45)" />;
        })}
        <text x={45} y={42} textAnchor="middle" fontSize={17} fontWeight={800} fill="var(--text)">{total}</text>
        <text x={45} y={55} textAnchor="middle" fontSize={8} fill="var(--text-faint)">hoje</text>
      </svg>
      <ul className="space-y-1 min-w-0">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-[11.5px] font-semibold text-[var(--text-soft)]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} aria-hidden="true" />
            <span className="flex-1 truncate">{p.label}</span>
            <span className="tabular-nums text-[var(--text)]">{p.value} ({Math.round((p.value / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
