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
import { isLegacyPagesEnabled } from '@/lib/product';
import { cn } from '@/lib/utils';
import { AccessDenied, PermissionNotice, useForbiddenNotice } from '@/components/dashboard/AccessNotice';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { PeriodSelector } from '@/components/dashboard/PeriodSelector';
import { canLoadOverview, loadOverview } from '@/lib/overview';
import { firstName } from '@/lib/greeting';
import { apiGet } from '@/lib/api-client';
import { money } from '@/lib/utils';
import { formatDateTimeBR, humanDay } from '@/lib/tz';
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
    /** §6 — Agendado · Realizado · Recebido · Em aberto (mesma função do Financeiro). */
    semantics?: {
      agendado: number; realizado: number; recebido: number; emAberto: number;
      previsto: number; pagamentos: number; hasBookings: boolean;
    } | null;
  };
  showMoney?: boolean;
  today?: {
    date: string; total: number; confirmed: number; pending: number; completed: number;
    cancelled: number; noShow: number; upcoming: number; needsClosure: number;
  } | null;
  /** Mesmo resumo, um dia antes — usado SÓ para a variação do dia. */
  yesterday?: {
    date: string; total: number; confirmed: number; pending: number; completed: number;
    cancelled: number; noShow: number; needsClosure: number;
  } | null;
  /** Registros de atendimento pendentes (fechamento/registro do serviço). */
  needsClosure?: Array<{ id: string; customerName: string; date: string; time: string; status: string; service: string }>;
  /** Pendências da equipe (mesma fonte do /api/tasks) — resumo, nunca lista. */
  tasksSummary?: { open: number; overdue: number; dueToday: number; mine: number } | null;
  ordersPanel?: { total: number; new: number; open: number; inWindow: number } | null;
  productsPanel?: { total: number; active: number } | null;
  crm?: { contacts: number; newContacts: number; registered: number; withConsent: number; leads: number; leadsNew: number; customers: number };
  pageStats?: { views: number; clicks: number; bookings: number; conversions: number; published: boolean; slug: string };
  whatsapp?: { status: string; open: number; unread: number; pendingMessages: number; link: string } | null;
  intelligence?: {
    automation: { completed: number };
    conversations: { waitingTeam: number; attendedByAi: number };
    followUp: { rescheduled: number };
    reactivation: { reactivated: number };
  } | null;
  intelligenceHealth?: Record<string, { state: string; reason: string }> | null;
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
  /* Missão 7 — tendência da página (série real do /api/analytics) e painel de
     pacientes (pets da clínica vet). Só consumo de APIs existentes. */
  const [trend, setTrend] = useState<Array<{ day: string; label: string; visitors: number }>>([]);
  const [petsPanel, setPetsPanel] = useState<{
    vet: boolean; total: number; newThisMonth: number; newLastMonth: number;
    bySpecies: Array<{ key: string; label: string; count: number }>;
  } | null>(null);
  useEffect(() => {
    // Renome com migração (bloco 5 da correção final): chave canônica
    // `godoutor-setup-hidden-<id>`; a antiga `il-setup-hidden-<id>` é lida
    // como fallback — quem já ocultou o checklist continua com ele oculto.
    try {
      const v = localStorage.getItem(`godoutor-setup-hidden-${businessId}`) ?? localStorage.getItem(`il-setup-hidden-${businessId}`);
      setSetupHidden(v === '1');
    } catch { /* noop */ }
  }, [businessId]);
  function hideSetup() {
    setSetupHidden(true);
    try { localStorage.setItem(`godoutor-setup-hidden-${businessId}`, '1'); localStorage.removeItem(`il-setup-hidden-${businessId}`); } catch { /* noop */ }
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
  // §A08/P0 — PERMISSÕES: hook chamado SEMPRE, antes de QUALQUER early return
  // (Rules of Hooks). O primeiro render acontece com data=null (skeleton);
  // se este hook ficasse depois do `if (!data)`, o render seguinte passaria a
  // ter MAIS hooks que o anterior → React error #310 e painel branco após o
  // login. A DERIVAÇÃO (canAdminUnit) continua onde é consumida, abaixo.
  const { permissions: panelPerms, ready: permsReady } = usePanelPermissions();
  // Estados completos (auditoria §12, mesma família do bug do /recursos):
  // uma falha de rede nunca pode virar skeleton eterno no Início.
  const [failed, setFailed] = useState('');
  const [retry, setRetry] = useState(0);

  // Tarefas abertas (resumo real do /api/tasks) para o bloco de atividade.
  const [taskSum, setTaskSum] = useState<{ open: number; overdue: number; dueToday: number; mine: number } | null>(null);
  // Nada de série/gráfico próprio: a Visão geral responde "como está HOJE" com
  // os dados do /api/overview (today + yesterday). A leitura analítica do
  // período vive em GESTÃO → Resultados, com a API dela.
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
  const overviewAllowed = canLoadOverview(permsReady, panelPerms);
  const load = useCallback(() => {
    if (!businessId) return;
    // Permissões ainda carregando: espera (nenhuma chamada especulativa).
    if (!permsReady) return;
    // Sem Visão geral: o aviso amigável aparece SEM tocar no servidor.
    if (!overviewAllowed) { setFailed(''); setDenied(true); return; }
    setFailed('');
    // §i — o MESMO payload já é pedido pelo shell (mini-card + sino): o loader
    // compartilhado divide a requisição em vez de repetir o trabalho de banco.
    loadOverview(businessId, period, { scope: 'area', area: 'Visão geral' })
      .then((res) => {
        // 403 → aviso amigável na tela; o usuário NÃO é deslogado.
        // 401 → o wrapper de fetch já iniciou o fluxo de login.
        if (!res.ok) {
          setDenied(res.status === 403);
          if (res.status !== 403) setFailed(res.message || 'Não foi possível carregar o painel.');
          return;
        }
        setDenied(false);
        setData(res.data as Overview | null);
      });
  }, [businessId, period, retry, permsReady, overviewAllowed]);

  useEffect(() => { load(); }, [load]);

  // Missão 7 — série da página (linha do card Presença online). Quem não tem
  // permissão financeira recebe 403: o gráfico simplesmente não aparece.
  useEffect(() => {
    if (!businessId || !data?.showMoney || !isLegacyPagesEnabled()) return;
    let cancelled = false;
    apiGet<{ days?: Array<{ day: string; label: string; visitors: number }> }>(
      `/api/analytics?businessId=${businessId}&period=${period}`,
      { scope: 'area', area: 'Visão geral' },
    ).then((res) => {
      if (!cancelled && res.ok && Array.isArray(res.data?.days)) {
        setTrend(res.data.days.map((d) => ({ day: d.day, label: d.label, visitors: d.visitors })));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [businessId, period, data?.showMoney]);

  // Missão 7 — "Nossos pacientes" (clínica vet): total, movimento do mês e
  // divisão por espécies, a partir do /api/pets existente.
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    apiGet<{ vet: boolean; pets: Array<{ active: boolean; species: string; createdAt: string }> }>(
      `/api/pets?businessId=${businessId}`,
      { scope: 'area', area: 'Visão geral' },
    ).then((res) => {
      if (cancelled || !res.ok || !res.data?.vet) return;
      const pets = (res.data.pets || []).filter((x) => x.active);
      const now = new Date();
      const monthKey = now.toISOString().slice(0, 7);
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
      const SPECIES: Record<string, string> = { cachorro: 'Cães', gato: 'Gatos' };
      const by: Record<string, number> = {};
      for (const x of pets) by[x.species] = (by[x.species] || 0) + 1;
      const bySpecies = [
        ...Object.keys(SPECIES).filter((k) => by[k]).map((k) => ({ key: k, label: SPECIES[k], count: by[k] })),
        { key: 'outros', label: 'Outros', count: Object.entries(by).filter(([k]) => !(k in SPECIES)).reduce((t, [, c]) => t + c, 0) },
      ].filter((x) => x.count > 0);
      setPetsPanel({
        vet: true,
        total: pets.length,
        newThisMonth: pets.filter((x) => (x.createdAt || '').slice(0, 7) === monthKey).length,
        newLastMonth: pets.filter((x) => (x.createdAt || '').slice(0, 7) === last).length,
        bySpecies,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [businessId]);
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
  const legacyPagesEnabled = isLegacyPagesEnabled();
  // BLOQUEIO final (PR #51): o item de Produtos NÃO existe no OFF — a API já
  // o supprime pela projeção operacional; não há mais "relabel" de revisão de
  // legado (Dashboard clínica não é lugar de módulo comercial). Sobram apenas
  // os filtros de superfície da Página fora do caminho.
  const operationalChecklist = legacyPagesEnabled
    ? checklist
    : checklist.filter((item) => item.href.split('?')[0] !== '/pagina');
  const operationalSetupPct = legacyPagesEnabled
    ? pct
    : operationalChecklist.length
      ? Math.round((operationalChecklist.filter((item) => item.done).length / operationalChecklist.length) * 100)
      : 100;
  const modules = context.modules;
  const results = data.results;
  const showMoney = data.showMoney === true;
  // Comparação com ONTEM: vem do MESMO /api/overview (campo `yesterday`).
  // Antes a tela buscava até 500 agendamentos em /api/bookings só para
  // reconstruir este número — requisição pesada e duplicada.
  const yday = data.yesterday
    ? {
        total: data.yesterday.total,
        byStatus: {
          confirmed: data.yesterday.confirmed, pending: data.yesterday.pending,
          completed: data.yesterday.completed, no_show: data.yesterday.noShow,
          cancelled: data.yesterday.cancelled,
        } as Record<string, number>,
      }
    : null;
  const operational = !showMoney;
  // TRÊS VISÕES, UM SÓ DASHBOARD (§11):
  //   • profissional (agendaScope 'own'/'none' ou papel PROFISSIONAL) → o SEU dia;
  //   • operação (sem acesso financeiro: recepção/atendente) → o que resolver agora;
  //   • gestão (OWNER/ADMIN com financeiro) → o dia + um resumo compacto do período.
  // Nada de receita global para quem atende ou recebe: o número que não serve
  // para decidir não ocupa a tela.
  const ownAgenda = workspace.agendaScope === 'own' || workspace.role === 'PROFISSIONAL';
  const proView = ownAgenda;
  const revenueDetail = data.revenueDetail;
  const bookingRevenue = revenueDetail?.bookings || null;
  const orderRevenue = revenueDetail?.orders || null;
  // §6 — os quatro conceitos reconciliados (mesma função do Financeiro):
  // a Visão geral nunca mais mostra um número que o Financeiro contradiz.
  const moneySemantics = revenueDetail?.semantics || null;
  const attention = data.attention || [];
  const links = data.links || {};
  // Same OR permission contract as /tarefas and /api/tasks, not a missing overview link flag.
  const canOpenTasks = panelPerms.agenda || panelPerms.clientes || panelPerms.leads || panelPerms.config;
  const q = `?b=${business.id}`;
  const hasSetupPending = operationalChecklist.some((c) => !c.done);
  // Defesa em camadas: a API já entrega recent.orders [] no OFF, mas a UI
  // também não conta pedido para "existe atividade" com a flag desligada.
  const hasActivity = recent.bookings.length + recent.leads.length + (legacyPagesEnabled ? recent.orders.length : 0) > 0;
  const canalConnected = whatsapp?.status === 'connected';
  // CLINICAL ACCESS: acesso clínico não concede Conversas. Sem a permissão
  // `whatsapp`, o card de Conversas e tarefas mostra APENAS as pendências do
  // profissional (o servidor também não envia o bloco `whatsapp`).
  const canWhats = permsReady && panelPerms.whatsapp === true;
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
  // §11 — o checklist é o ONBOARDING DA CLÍNICA (dados, serviços, horários,
  // página, canal): quem só atende não configura a clínica. Mostrá-lo ao
  // profissional criava uma lista de afazeres que não são dele — e cujos
  // links ele nem sempre pode abrir.
  // §A08 — o checklist "Sua clínica está pronta?" só tem destinos de ADMINISTRAÇÃO
  // (/configuracoes, /servicos, /disponibilidade, /pagina, /canais — permissão
  // 'config'). Quem não administra a unidade não vê os atalhos: nenhum "Fazer →"
  // pode terminar em "Sem permissão". (O hook já foi chamado lá em cima; aqui
  // só a derivação — nenhum hook depois de early return.)
  const canAdminUnit = !permsReady || panelPerms.config === true;
  const showSetup = hasSetupPending && !setupHidden && !proView && canAdminUnit;
  const showConnectChannel = !!whatsapp && !canalConnected && links.canais === true;
  const hasWhereToAct = showSetup || showConnectChannel;

  return (
    <>
      {welcome && (
        <div className="mb-4 bg-[var(--brand-soft)] border-l-[3px] border-l-[var(--brand)] rounded-r-md px-4 py-3 flex items-start gap-3">
          <span className="w-8 h-8 rounded-md bg-white text-[var(--brand-fg)] flex items-center justify-center shrink-0"><Icon n="checkCircle" size={18} /></span>
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">{business.name} está criado, {firstName(user.name)}!</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{legacyPagesEnabled ? 'Agenda, serviços e página já estão ativos.' : 'Agenda e serviços já estão ativos.'} Siga o “Comece por aqui” abaixo — ou ignore e use o que precisa primeiro.</p>
          </div>
        </div>
      )}
      <PermissionNotice message={notice?.title} hint={notice?.hint} onDismiss={dismiss} />

      {/* ── Saudação + resumo curto — header LIMPO (sem card amarelo, sem
          degradê): hierarquia só com tipografia e espaçamento ── */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        {/* MISSÃO 5 — título no padrão único do produto (chip de ícone + título
            + subtítulo): mesma linguagem de Agenda, Clientes, Pendências… */}
        <div className="flex items-start gap-3 min-w-0">
          <span className="il-page-header__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--accent)]">
            <Icon n="home" size={19} />
          </span>
          <div className="min-w-0">
        <h1 className="text-xl leading-tight font-semibold tracking-tight text-[var(--text)]">
          {proView ? `Meu dia, ${firstName(user.name)}` : `${greeting()}, ${firstName(user.name)}!`}
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {modules.bookings && today
            ? `${today.total} ${today.total === 1 ? 'atendimento' : 'atendimentos'} hoje · ${upcoming.length} próximo${upcoming.length === 1 ? '' : 's'} na agenda${showMoney && bookingRevenue ? ` · ${money(bookingRevenue.total)} previstos no período` : ''}.`
            : operational
              ? 'Chegadas, próximos horários e o que precisa de atenção.'
              : 'Acompanhe o dia e os resultados disponíveis da operação.'}
        </p>
          </div>
        </div>
        <div className="dsh-card flex items-center gap-2.5 px-3.5 py-2.5" title="Data de hoje">
          <Icon n="calendar" size={16} className="text-[var(--accent)]" />
          <span className="text-[12.5px] font-semibold text-[var(--text)]">
            Hoje, {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
      </header>

      {/* ── 1 · ATENÇÃO (dados do servidor, links só com permissão) ── */}
      {attention.length > 0 && (
        <div className="mb-4 border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg" role="status" aria-label="Itens que precisam de atenção">
          <span className="text-xs font-semibold tracking-wide uppercase text-[var(--warning-fg)] inline-flex items-center gap-1.5">
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

      {/* ── 2 · KPIs DO DIA — UM card único horizontal, divisórias sutis ── */}
      {modules.bookings && today && (
        <>
        <h3 className="sr-only">Hoje</h3>
        {/* colunas 2/3/6 nas mesmas faixas do card `.dsh-metrics` (contrato mobile de a12-block4) */}
        <div className="dsh-metrics grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <div className="dsh-metric">
            <span className="dsh-metric__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand-fg)' }}><Icon n="calendar" size={19} /></span>
            <span><span className="dsh-metric__num">{today.total}</span><span className="dsh-metric__label block">Atendimentos hoje</span>
              <KpiDelta now={today.total} prev={yday?.total ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-metric">
            <span className="dsh-metric__icon" style={{ background: 'var(--success-bg)', color: 'var(--success-fg)' }}><Icon n="checkCircle" size={19} /></span>
            <span><span className="dsh-metric__num">{today.confirmed}</span><span className="dsh-metric__label block">Confirmados</span>
              <KpiDelta now={today.confirmed} prev={yday?.byStatus['confirmed'] ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-metric">
            <span className="dsh-metric__icon" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}><Icon n="clock" size={19} /></span>
            <span><span className="dsh-metric__num">{today.pending}</span><span className="dsh-metric__label block">Aguardando</span>
              <KpiDelta now={today.pending} prev={yday?.byStatus['pending'] ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-metric">
            <span className="dsh-metric__icon" style={{ background: 'var(--ops-soft)', color: 'var(--ops-fg)' }}><Icon n="tasks" size={19} /></span>
            <span><span className="dsh-metric__num">{today.completed}</span><span className="dsh-metric__label block">Concluídos</span>
              <KpiDelta now={today.completed} prev={yday?.byStatus['completed'] ?? 0} has={yday !== null} />
            </span>
          </div>
          <div className="dsh-metric">
            <span className="dsh-metric__icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}><Icon n="alert" size={19} /></span>
            <span><span className="dsh-metric__num">{today.noShow}</span><span className="dsh-metric__label block">Faltas</span>
              <KpiDelta now={today.noShow} prev={yday?.byStatus['no_show'] ?? 0} has={yday !== null} />
            </span>
          </div>
          {/* Missão 7 — a 6ª métrica era "Agendado no período", Duplicata do
              card "Período · resumo" logo abaixo. Agora fecha o quadro do DIA
              (cancelados), mantendo o card único coerente. */}
          <div className="dsh-metric">
            <span className="dsh-metric__icon" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}><Icon n="x" size={19} /></span>
            <span><span className="dsh-metric__num">{today.cancelled}</span><span className="dsh-metric__label block">Cancelados</span>
              <KpiDelta now={today.cancelled} prev={yday?.byStatus['cancelled'] ?? 0} has={yday !== null} invert />
            </span>
          </div>
        </div>
        </>
      )}

      {/* ── 3 · Setup real + Indicadores do período (5 + 7, como o mockup) ──
          §11 — para quem ATENDE esta linha não existe: o checklist é da
          clínica (não dele), a presença online é de quem cuida da página e
          "aguardando confirmação/precisam de registro" são tarefas de
          recepção — os dois números já aparecem nos KPIs do dia logo acima.
          "Meu dia" fica com o que é DELE: agenda, próximos e atividade. */}
      {!proView && (
      <div className="grid items-start gap-4 lg:grid-cols-12 mb-4">
        {hasWhereToAct ? (
        <section className="lg:col-span-5 dsh-card min-w-0">
          {showSetup ? (
            <>
              <div className="dsh-card__head">
                <h3 className="dsh-card__title">Sua clínica está pronta?</h3>
                <span className="text-[12px] font-semibold text-[var(--brand-fg)]">{operationalSetupPct}%</span>
              </div>
              <div className="dsh-card__body">
                <div className="h-2 rounded-full bg-[var(--surface-3)] overflow-hidden mb-3" role="progressbar" aria-valuenow={operationalSetupPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${operationalSetupPct}%` }} />
                </div>
                <div className="space-y-2">
                  {operationalChecklist.map((c) => (
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
                          <span className="text-[11.5px] font-semibold text-[var(--brand-fg)]">Fazer →</span>
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
        ) : legacyPagesEnabled ? (
        <section className="lg:col-span-5 dsh-card min-w-0">
          <>
              <div className="dsh-card__head">
                <h3 className="dsh-card__title">Presença online</h3>
                {legacyPagesEnabled && links.pagina === true && <Link href={`/pagina${q}`} className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline">Editar página →</Link>}
              </div>
              <div className="dsh-card__body">
                {pageStats ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">Página · no período</p>
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
        ) : null}

        {showMoney ? (
        <section className={cn('dsh-card min-w-0', hasWhereToAct ? 'lg:col-span-7' : 'lg:col-span-12')}>
          <div className="dsh-card__head">
            <h3 className="dsh-card__title">
              Período <span className="text-[var(--text-muted)] font-semibold">· resumo</span>
            </h3>
            {links.resultados === true && (
              <Link href={`/resultados${q}`} className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline">
                Ver resultados →
              </Link>
            )}
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
          <div className="dsh-card__body">
            {showMoney && bookingRevenue ? (
              <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
                <div>
                  <p className="text-[30px] leading-none font-semibold tracking-tight text-[var(--text)]">{money(bookingRevenue.total)}</p>
                  <p className="text-[12px] text-[var(--text-muted)] mt-1.5">
                    {bookingRevenue.count} atendimentos elegíveis · ticket {money(bookingRevenue.ticket || 0)}
                  </p>
                  {/* Missão 7 — os quatro conceitos (MESMO cálculo do Financeiro)
                      saíram do card de métricas e vivem UMA vez aqui. */}
                  {moneySemantics && (
                    <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-1 tabular-nums">
                      Realizado {moneyKpi(moneySemantics.realizado)} · Recebido {moneyKpi(moneySemantics.recebido)} · Em aberto {moneyKpi(moneySemantics.emAberto)}
                    </p>
                  )}
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

            {/* Missão 7 — o espaço vazio do resumo ganha a linha de tendência
                (visitas à página por dia, série real do /api/analytics). */}
            {legacyPagesEnabled && trend.length >= 2 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">Presença online · visitas por dia</p>
                <MiniTrendChart points={trend.map((t) => t.visitors)} labels={trend.map((t) => t.label)} />
              </div>
            )}

            {results && results.items.length > 0 && (
              <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">Resultados · {results.periodLabel}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {results.items.slice(0, 4).map((it) => (
                  <div key={it.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-2.5 py-2">
                    <p className="text-[17px] font-semibold leading-tight text-[var(--text)] tabular-nums">
                      {it.unit === 'money' ? money(it.value) : it.unit === 'percent' ? `${it.value}%` : it.value}
                    </p>
                    <p className="text-[11px] font-semibold text-[var(--text-muted)] truncate">{it.label}</p>
                    {results.hasPrevious && <ComparisonBadge metric={it} hasPrevious={results.hasPrevious} />}
                  </div>
                ))}
              </div>
              </div>
            )}

            {/* GRÁFICOS NÃO MORAM AQUI (§11/§12): Visão geral responde
                "como está HOJE"; a leitura analítica (série por dia, mix de
                status, comparação) vive em GESTÃO → Resultados, com o mesmo
                dado real e navegação própria. Aqui fica só o atalho. */}
            {links.resultados === true ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-subtle)] px-3.5 py-3">
                <p className="text-[12.5px] text-[var(--text-secondary)]">
                  Comparecimento, serviços, profissionais e evolução histórica ficam em Resultados.
                </p>
                <Link href={`/resultados${q}`}
                  className="inline-flex items-center gap-1.5 h-[var(--control-h-sm)] px-3 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-white text-[12.5px] font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
                  Ver resultados <Icon n="chevronRight" size={13} />
                </Link>
              </div>
            ) : null}
          </div>
        </section>
        ) : (
        <section className={cn('dsh-card min-w-0', hasWhereToAct ? 'lg:col-span-7' : 'lg:col-span-12')}>
          <div className="dsh-card__head">
            <h3 className="dsh-card__title">O que resolver agora</h3>
            {links.agenda === true && (
              <Link href={`/agenda${q}`} className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline">Ver agenda →</Link>
            )}
          </div>
          <div className="dsh-card__body pt-2 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5">
                <p className="dsh-kpi__num text-[20px]">{today?.pending ?? 0}</p>
                <p className="text-[11.5px] font-semibold text-[var(--text-secondary)]">aguardando confirmação</p>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5">
                <p className="dsh-kpi__num text-[20px]">{today?.needsClosure ?? 0}</p>
                <p className="text-[11.5px] font-semibold text-[var(--text-secondary)]">precisam de registro</p>
              </div>
            </div>
            {(data.needsClosure || []).length > 0 ? (
              <ul className="space-y-1.5">
                {(data.needsClosure || []).slice(0, 5).map((b) => (
                  <li key={b.id}>
                    <ListRow allowed={links.agenda === true} href={`/agenda${q}&data=${b.date}`}
                      className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2 text-[12.5px]">
                      <span className="text-[11px] font-semibold text-[var(--text-muted)] w-[68px] shrink-0 tabular-nums">{humanDay(b.date)} {b.time}</span>
                      <span className="flex-1 min-w-0 truncate font-semibold text-[var(--text-primary)]">
                        {b.customerName} <span className="font-normal text-[var(--text-muted)]">· {b.service}</span>
                      </span>
                      <Icon n="chevronRight" size={14} className="text-[var(--text-faint)]" />
                    </ListRow>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] text-center py-4">Nada pendente de registro. Tudo em ordem.</p>
            )}
            {typeof data.tasksSummary?.open === 'number' && data.tasksSummary.open > 0 && (
              <p className="text-[12.5px] text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">{data.tasksSummary?.open}</strong> pendências abertas da equipe.
              </p>
            )}
          </div>
        </section>
        )}
      </div>
      )}

      {/* ── 4 · Próximos · Conversas/tarefas · Atividade recente ·
             Nossos pacientes (vet, missão 7) ── */}
      <div className={`grid items-start gap-4 mb-4 ${petsPanel ? 'lg:grid-cols-2 xl:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <section className="dsh-card min-w-0">
          <div className="dsh-card__head">
            <h3 className="dsh-card__title">Próximos atendimentos</h3>
            {links.agenda === true && <Link href={`/agenda${q}`} className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline">Ver agenda →</Link>}
          </div>
          <div className="dsh-card__body pt-2">
            {modules.bookings ? (
              upcoming.length === 0 ? (
                <p className="text-[12.5px] text-[var(--text-muted)] text-center py-6">Nenhum atendimento futuro.</p>
              ) : (
                <div className="space-y-1.5">
                  {upcoming.slice(0, 5).map((b) => (
                    <ListRow key={b.id} allowed={links.agenda === true} href={`/agenda${q}&data=${b.date}`}
                      className="flex flex-col items-stretch gap-1.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]"
                      style={{ borderLeft: `3px solid ${STATUS_BAR[b.status] || 'var(--border-strong)'}` }}>
                      <strong className="min-w-0 font-semibold leading-snug text-[var(--text)] break-words">{b.customerName}</strong>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-snug text-[var(--text-muted)]">
                        <span className="shrink-0 tabular-nums">{humanDay(b.date)} {b.time}</span>
                        {b.service && <span className="min-w-0 break-words">{b.service}</span>}
                        <span className="inline-flex shrink-0"><StatusBadge tone={b.status === 'confirmed' ? 'emerald' : b.status === 'pending' ? 'orange' : 'blue'}>{bookDef(b.status).panel}</StatusBadge></span>
                      </span>
                    </ListRow>
                  ))}
                </div>
              )
            // Pedidos só existem no RAMO DE COMPATIBILIDADE: módulo ligado E
            // páginas legadas habilitadas — nunca no Clinical OS padrão.
            ) : legacyPagesEnabled && modules.orders ? (
              recent.orders.length === 0 ? <p className="text-[12.5px] text-[var(--text-muted)] text-center py-6">Nenhum pedido ainda.</p> : (
                <div className="space-y-1.5">
                  {recent.orders.slice(0, 5).map((o) => {
                    const d = orderDef(o.status);
                    return (
                      <ListRow key={o.id} allowed={links.pedidos === true} href={`/pedidos${q}`}
                        className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)] w-16 shrink-0">{o.code}</span>
                        <span className="flex-1 min-w-0 truncate font-semibold text-[var(--text)]">{o.customerName}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium border ${toneCls(d.tone)}`}>{d.panel}</span>
                      </ListRow>
                    );
                  })}
                </div>
              )
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] text-center py-6">{legacyPagesEnabled ? 'Sem agenda ou pedidos neste contexto.' : 'Sem atendimentos agendados neste contexto.'}</p>
            )}
          </div>
        </section>

        <section className="dsh-card min-w-0">
          <div className="dsh-card__head">
            <h3 className="dsh-card__title">Conversas e tarefas</h3>
            {links.conversas === true && <Link href={`/conversas${q}`} className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline">Abrir →</Link>}
          </div>
          <div className="dsh-card__body pt-2 space-y-1.5">
            {canWhats && (whatsapp ? (
              <ListRow allowed={links.conversas === true} href={`/conversas${q}`}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                <span className="dsh-kpi__icon !w-7 !h-7" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon n="chat" size={15} /></span>
                <span className="flex-1 font-semibold text-[var(--text)]">Conversas não lidas</span>
                <span className="text-[13px] font-semibold tabular-nums text-[var(--text)]">{whatsapp.unread}</span>
              </ListRow>
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2">Canal de conversas não conectado.</p>
            ))}
            {canWhats && whatsapp && totals.leads > 0 && (
              <ListRow allowed={links.funil === true} href={`/funil${q}`}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                <span className="dsh-kpi__icon !w-7 !h-7" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}><Icon n="clock" size={15} /></span>
                <span className="flex-1 font-semibold text-[var(--text)]">Leads para follow-up</span>
                <span className="text-[13px] font-semibold tabular-nums text-[var(--text)]">{totals.leads}</span>
              </ListRow>
            )}
            {canWhats && canalConnected && (
              <div className="flex items-center gap-2.5 rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] px-2.5 py-2">
                <span className="dsh-kpi__icon !w-7 !h-7" style={{ background: 'var(--success)', color: '#fff' }}><Icon n="chat" size={15} /></span>
                <span className="flex-1 text-[11.5px] font-semibold text-[var(--success-fg)]">Envie mensagens para seus pacientes</span>
                {links.conversas === true && (
                  <Link href={`/conversas${q}`} className="text-[11.5px] font-semibold text-white bg-[var(--success)] hover:bg-[var(--success-strong)] px-2.5 py-1.5 rounded-md">Abrir conversas</Link>
                )}
              </div>
            )}
            {taskSum && taskSum.open > 0 ? (
              <>
                {(openTasks || []).slice(0, 4).map((t) => {
                  const lbl = dueLabel(t.dueAt);
                  const tone = lbl === 'atrasada' ? 'var(--danger)' : lbl === 'hoje' ? 'var(--warning)' : 'var(--border-strong)';
                  return (
                    <ListRow key={t.id} allowed={canOpenTasks === true} href={`/tarefas${q}`}
                      className="flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] px-2.5 py-2 text-[12.5px]">
                      <span className="w-4 h-4 rounded border-2 shrink-0" style={{ borderColor: tone }} aria-hidden="true" />
                      <span className="flex-1 min-w-0 truncate font-semibold text-[var(--text)]">{t.title}</span>
                      <span className="shrink-0 text-[10.5px] font-semibold tabular-nums" aria-label={lbl === 'atrasada' ? `Atrasada: ${formatDateTimeBR(t.dueAt)}` : formatDateTimeBR(t.dueAt)} style={{ color: lbl === 'atrasada' ? 'var(--danger-fg)' : lbl === 'hoje' ? 'var(--warning-fg)' : 'var(--text-faint)' }}>{t.dueAt ? formatDateTimeBR(t.dueAt) : lbl}</span>
                    </ListRow>
                  );
                })}
                <p className="text-[11px] text-[var(--text-faint)] px-1">
                  {canOpenTasks === true && <Link href={`/tarefas${q}`} className="underline underline-offset-2">Ver todas ({taskSum.open})</Link>}{canOpenTasks !== true && <>{taskSum.open} abertas</>}
                  {taskSum.overdue > 0 && <> · <span className="text-[var(--danger-fg)] font-semibold">{taskSum.overdue} atrasada{taskSum.overdue === 1 ? '' : 's'}</span></>}
                </p>
              </>
            ) : (
              <p className="text-[12.5px] text-[var(--text-muted)] rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2">Nenhuma tarefa pendente.</p>
            )}
            {/* F3-I · GoDoutor Intelligence — só métricas reais; vazio honesto. */}
      {(() => {
        const intel = data.intelligence;
        if (!intel) return null;
        const cards = [
          { label: 'conversas atendidas', value: intel.conversations.attendedByAi },
          { label: 'automações concluídas', value: intel.automation.completed },
          { label: 'retornos recuperados', value: intel.followUp.rescheduled + intel.reactivation.reactivated },
          { label: 'aguardando equipe', value: intel.conversations.waitingTeam },
        ];
        const empty = cards.every((c) => !c.value);
        return (
          <section className="dashboard-intelligence mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon n="spark" size={14} />
              <h3 className="text-sm font-semibold">GoDoutor Intelligence</h3>
            </div>
            {empty ? (
              <p className="text-xs text-[var(--text-muted)]">
                Ainda não há atividade registrada. Quando automações e conversas rodarem, os números aparecem aqui — sem estimativas.
              </p>
            ) : (
              <ul className="dashboard-intelligence__grid mt-2">
                {cards.map((c) => (
                  <li key={c.label} className="min-w-0 rounded-lg bg-[var(--bg)] p-2 border border-[var(--border)]">
                    <div className="text-lg font-semibold tabular-nums text-[var(--text)]">{c.value || '—'}</div>
                    <div className="text-[11px] leading-snug text-[var(--text-muted)]">{c.label}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}
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
                {legacyPagesEnabled && recent.orders.slice(0, 2).map((o) => (
                  <p key={o.id} className="text-[12px] text-[var(--text-soft)] truncate">
                    <strong className="font-semibold text-[var(--text)]">{o.customerName}</strong> · pedido {o.code}
                  </p>
                ))}
              </div>
            )}
          </div>
        </section>
        {petsPanel && (
          <PetsPatientsCard panel={petsPanel} q={q} allowed={links.clientes === true} />
        )}
      </div>

      {/* ── 5 · Ações rápidas (só rotas que este usuário pode abrir) ── */}
      <section className="dsh-card mb-4">
        <div className="dsh-card__head"><h3 className="dsh-card__title">Ações rápidas</h3></div>
        <div className="dsh-card__body">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {links.agenda === true && (
              <Link href={`/agenda${q}`} className="dsh-quick">
                <span className="dsh-quick__icon"><Icon n="calendarPlus" size={18} /></span>
                Novo agendamento
              </Link>
            )}
            {links.clientes === true && (
              <Link href={`/clientes${q}`} className="dsh-quick">
                <span className="dsh-quick__icon"><Icon n="users" size={18} /></span>
                Clientes
              </Link>
            )}
            {legacyPagesEnabled && links.pagina === true && (
              <Link href={`/pagina${q}`} className="dsh-quick">
                <span className="dsh-quick__icon"><Icon n="link" size={18} /></span>
                Editar página
              </Link>
            )}
            {canOpenTasks === true && (
              <Link href={`/tarefas${q}`} className="dsh-quick">
                <span className="dsh-quick__icon"><Icon n="tasks" size={18} /></span>
                Tarefas
              </Link>
            )}
            {links.resultados === true && (
              <Link href={`/resultados${q}`} className="dsh-quick">
                <span className="dsh-quick__icon"><Icon n="chart" size={18} /></span>
                Resultados
              </Link>
            )}
            {links.canais === true && (
              <Link href={`/canais${q}`} className="dsh-quick">
                <span className="dsh-quick__icon"><Icon n="chat" size={18} /></span>
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
/* ── Missão 7 · gráfico de linha elegante (SVG puro, sem libs) ──
   Série real do /api/analytics: visitas à página por dia. Área suave +
   linha + ponto final, na cor da identidade. */
function MiniTrendChart({ points, labels }: { points: number[]; labels: string[] }) {
  if (points.length < 2) return null;
  const W = 320, H = 74, PAD = 6;
  const max = Math.max(...points, 1);
  const step = (W - PAD * 2) / (points.length - 1);
  const xy = points.map((v, i) => [PAD + i * step, H - PAD - (v / max) * (H - PAD * 2)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[74px]" role="img" aria-label="Visitas à página por dia">
        <defs>
          <linearGradient id="dshTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#dshTrendFill)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3.5" fill="var(--brand)" />
        <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="6.5" fill="var(--brand)" opacity="0.18" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-[var(--text-faint)]">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/* ── Missão 7 · "Nossos pacientes" (clínica vet) ──
   O pet é o paciente: total de pacientes, movimento do mês e divisão por
   espécies, com ilustração acolhedora. Dados do /api/pets. */
function PetsPatientsCard({ panel, q, allowed }: {
  panel: { total: number; newThisMonth: number; newLastMonth: number; bySpecies: Array<{ key: string; label: string; count: number }> };
  q: string;
  allowed: boolean;
}) {
  const delta = panel.newLastMonth > 0
    ? Math.round(((panel.newThisMonth - panel.newLastMonth) / panel.newLastMonth) * 100)
    : null;
  const maxSpecies = Math.max(...panel.bySpecies.map((x) => x.count), 1);
  return (
    <section className="dsh-card min-w-0">
      <div className="dsh-card__head">
        <h3 className="dsh-card__title">Nossos pacientes</h3>
        {allowed && <Link href={`/clientes${q}`} className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline">Ver todos →</Link>}
      </div>
      <div className="dsh-card__body pt-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="dsh-kpi__num text-[30px] leading-none">{panel.total}</p>
            <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-1">pacientes cadastrados</p>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold">
              {delta === null ? (
                <span className="text-[var(--text-faint)]">+{panel.newThisMonth} este mês</span>
              ) : (
                <span className={`px-1.5 py-0.5 rounded ${delta >= 0 ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--danger-bg)] text-[var(--danger-fg)]'}`}>
                  {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
                </span>
              )}
              {delta !== null && <span className="text-[var(--text-faint)]">+{panel.newThisMonth} este mês</span>}
            </p>
          </div>
          <img
            src="/img/pacientes-pets.png" alt="" aria-hidden="true"
            className="h-[86px] w-[128px] shrink-0 rounded-[var(--radius-lg)] object-cover"
          />
        </div>
        {panel.bySpecies.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">Espécies</p>
            {panel.bySpecies.map((x) => (
              <div key={x.key} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[11px] font-semibold text-[var(--text-secondary)]">{x.label}</span>
                <span className="h-1.5 flex-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <span className="block h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.round((x.count / maxSpecies) * 100)}%` }} />
                </span>
                <span className="w-16 text-right text-[11px] font-semibold text-[var(--text)] tabular-nums">
                  {x.count} <span className="text-[var(--text-faint)]">({Math.round((x.count / Math.max(panel.total, 1)) * 100)}%)</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function KpiDelta({ now, prev, has, invert }: { now: number; prev: number; has: boolean; invert?: boolean }) {
  if (!has || prev <= 0) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  // `invert`: queda é boa (ex.: cancelados) — as cores acompanham a semântica.
  const up = invert ? pct <= 0 : pct >= 0;
  return (
    <span className="flex items-center gap-1.5 mt-1">
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${up ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--danger-bg)] text-[var(--danger-fg)]'}`}>
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

/* ── Donut SVG (contagens reais de hoje por status) ── */
