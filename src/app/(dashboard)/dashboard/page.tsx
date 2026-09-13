'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Badge, PageSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { money } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { ORDER_STATUS, BOOKING_STATUS, LEAD_STATUS, toneCls, type StatusDef } from '@/lib/status';

interface Overview {
  user: { name: string };
  business: { id: string; name: string; slug: string; logo?: string; description?: string; published: boolean };
  totals: {
    visitors: number; uniqueVisitors: number; clicks: number; leads: number; leadsNew: number;
    orders: number; bookings: number; conversions: number; newOrders: number; pendingBookings: number;
  };
  revenue: { total: number; prev: number; orders: number; ticket: number; period: number; hidden?: boolean };
  showMoney?: boolean;
  today?: {
    date: string; total: number; confirmed: number; pending: number; completed: number;
    cancelled: number; noShow: number; upcoming: number; needsClosure: number;
  };
  needsClosure?: Array<{ id: string; customerName: string; date: string; time: string; status: string; service: string }>;
  crm?: { contacts: number; newContacts: number; registered: number; withConsent: number; leads: number; leadsNew: number; customers: number };
  pageStats?: { views: number; clicks: number; bookings: number; conversions: number; published: boolean; slug: string };
  whatsapp?: { status: string; open: number; unread: number; pendingMessages: number; link: string };
  modules?: string[];
  hasBookingsModule?: boolean;
  upcoming: Array<{ id: string; customerName: string; date: string; time: string; status: string; service: string; professional: string }>;
  checklist: Array<{ done: boolean; label: string; href: string }>;
  pct: number;
  recent: {
    orders: Array<{ id: string; code: string; customerName: string; status: string; createdAt: string }>;
    bookings: Array<{ id: string; customerName: string; date: string; time: string; status: string }>;
    leads: Array<{ id: string; name: string; phone: string; origin: string; status: string }>;
  };
}

export default function DashboardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const businessId = params.get('b') || '';
  const welcome = params.get('welcome') === '1';
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/overview?businessId=${businessId}&period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Overview | null) => {
        if (!d) { router.replace('/login?session=expired'); return; }
        setData(d);
        setShowChecklist(d.pct < 100);
      })
      .catch(() => {});
  }, [businessId, period, router]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <PageSkeleton />;

  const { user, business, totals, revenue, upcoming, checklist, pct, recent, today, needsClosure = [], crm, pageStats, whatsapp, hasBookingsModule } = data;
  const showMoney = data.showMoney !== false;
  const pendencies = needsClosure;
  const q = `?b=${business.id}`;
  const next = checklist.find((c) => !c.done);
  const hasActivity = recent.orders.length + recent.bookings.length + recent.leads.length > 0;
  const delta = revenue.total - revenue.prev;
  const orderDef = (s: string): StatusDef => (ORDER_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };
  const bookDef = (s: string): StatusDef => (BOOKING_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };
  const leadDef = (s: string): StatusDef => (LEAD_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };

  return (
    <>
      {welcome && (
        <div className="mb-4 border border-zinc-900 bg-zinc-900 text-white px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-md bg-white text-zinc-900 flex items-center justify-center font-bold shrink-0">✓</div>
          <div>
            <p className="text-sm font-semibold">Sua estrutura está pronta, {user.name.split(' ')[0]}!</p>
            <p className="text-xs text-zinc-400 mt-0.5">Complete a configuração abaixo e publique sua página.</p>
          </div>
        </div>
      )}

      {/* Identidade da empresa — workspace header (assume marca do cliente) */}
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
            <a href={`/${business.slug}`} target="_blank" className="text-xs text-zinc-500 hover:text-zinc-700 inline-flex items-center gap-1">Ver site <Icon n="external" size={10} /></a>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 ml-auto">
          <div className="flex bg-white border border-zinc-200 rounded-md p-0.5">
            {[7, 30].map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`text-xs font-medium px-3 py-1 rounded ${period === p ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}>{p}d</button>
            ))}
          </div>
          <Link href={`/pagina${q}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md hover:bg-zinc-800">Editar página</Link>
        </div>
      </div>
      <div className="sm:hidden flex items-center gap-2 mb-4">
        <div className="flex bg-white border border-zinc-200 rounded-md p-0.5">
          {[7, 30].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`text-xs font-medium px-3 py-1 rounded ${period === p ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}>{p === 7 ? '7 dias' : '30 dias'}</button>
          ))}
        </div>
        <Link href={`/pagina${q}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md ml-auto">Editar página</Link>
      </div>

      <h2 className="text-sm font-semibold text-zinc-900 mb-3">Dashboard</h2>

      {pendencies.length > 0 && (
        <div className="mb-3 border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5"><Icon n="calendar" size={14} /> {pendencies.length} precisam de fechamento</span>
          <span className="text-xs text-amber-800 hidden sm:inline">· horário passou e continua em aberto</span>
          <span className="flex flex-wrap gap-1.5 ml-auto">
            {pendencies.slice(0, 3).map((b) => (
              <Link key={b.id} href={`/agenda${q}`} className="text-xs font-medium bg-white border border-amber-200 text-amber-900 px-2.5 py-1 rounded-md hover:bg-amber-50">
                {b.date.slice(8, 10)}/{b.date.slice(5, 7)} {b.time} · {b.customerName}
              </Link>
            ))}
            {pendencies.length > 3 && <Link href={`/agenda${q}`} className="text-xs font-medium text-amber-900 underline self-center">+{pendencies.length - 3}</Link>}
          </span>
        </div>
      )}

      {next && (
        <div className="mb-4 bg-white border border-zinc-200 px-3 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-700">Próxima ação: <strong className="text-zinc-900">{next.label}</strong></p>
          <Link href={next.href} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md shrink-0">Fazer agora</Link>
        </div>
      )}

      {/* Linha superior: Hoje + Próximos + Movimento — em painéis compactos sem cards gigantes */}
      {hasBookingsModule && today && (
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

      <div className="grid lg:grid-cols-12 gap-3 mb-3">
        {/* Receita - compacta */}
        <div className="lg:col-span-4 bg-white border border-zinc-200">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Receita</h3>
            <span className="text-xs text-zinc-400">{period}d</span>
          </div>
          <div className="px-4 py-4">
            {!showMoney ? <p className="text-sm text-zinc-500">Sem acesso financeiro.</p> : (
              <>
                <p className="text-2xl font-semibold tracking-tight">{money(revenue.total)}</p>
                <p className={`text-xs font-medium mt-1 ${delta >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{delta >= 0 ? '▲' : '▼'} {money(Math.abs(delta))} vs. {period}d anteriores</p>
                <div className="grid grid-cols-2 gap-0 mt-3 pt-3 border-t border-zinc-100 text-xs">
                  <div><p className="font-semibold text-zinc-900">{revenue.orders} pedidos</p><p className="text-zinc-500">no período</p></div>
                  <div><p className="font-semibold text-zinc-900">{money(revenue.ticket)}</p><p className="text-zinc-500">tíquete médio</p></div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Próximos — lista densa, sem cards */}
        <div className="lg:col-span-5 bg-white border border-zinc-200 flex flex-col">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Próximos atendimentos</h3>
            <Link href={`/agenda${q}`} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Ver agenda →</Link>
          </div>
          <div className="flex-1">
            {upcoming.length === 0 ? <p className="text-sm text-zinc-500 px-4 py-6 text-center">Nenhum futuro.</p> : (
              <div className="divide-y divide-zinc-100">
                {upcoming.slice(0, 5).map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50">
                    <span className="text-xs font-medium text-zinc-500 w-14 shrink-0">{humanDay(b.date)} {b.time}</span>
                    <span className="flex-1 min-w-0 truncate"><strong className="font-medium">{b.customerName}</strong> <span className="text-zinc-500">· {b.service}{b.professional ? ` · ${b.professional}` : ''}</span></span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${b.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>{b.status === 'confirmed' ? 'conf' : 'pend'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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

      {/* Linha CRM / Página / WhatsApp — painel único com divisórias, não 3 cards */}
      <div className="bg-white border border-zinc-200 mb-3">
        <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100">
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
              <span><strong>{pageStats?.bookings ?? 0}</strong> agends</span>
              <span><strong>{pageStats?.conversions ?? 0}</strong> convs</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp</p><Link href={`/whatsapp${q}`} className="text-xs font-medium text-zinc-600 hover:underline">Abrir →</Link></div>
            <p className={`text-sm font-semibold ${whatsapp?.status === 'connected' ? 'text-emerald-700' : 'text-zinc-600'}`}>{whatsapp?.status === 'connected' ? 'Conectado' : 'Não conectado'}</p>
            <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
              <span><strong>{whatsapp?.open ?? 0}</strong> abertas</span>
              <span><strong>{whatsapp?.unread ?? 0}</strong> não lidas</span>
              <span><strong>{whatsapp?.pendingMessages ?? 0}</strong> fila</span>
            </div>
          </div>
        </div>
      </div>

      {/* Atividade + checklist — workspace 2-col, linhas não cards */}
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="bg-white border border-zinc-200">
          <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Configuração</h3>
            <span className="text-xs font-medium text-zinc-500">{pct}%</span>
          </div>
          <div className="px-4 py-3">
            <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-3"><div className="h-full bg-zinc-900 rounded-full" style={{ width: `${pct}%` }} /></div>
            {pct >= 100 && !showChecklist ? (
              <button onClick={() => setShowChecklist(true)} className="text-xs font-medium text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1.5"><Icon n="check" size={12} /> Tudo configurado — revisar</button>
            ) : (
              <ul className="divide-y divide-zinc-100 -mx-4">
                {checklist.map((c) => (
                  <li key={c.label} className="px-4 py-2 flex items-center gap-2.5 text-sm hover:bg-zinc-50">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${c.done ? 'bg-zinc-900 text-white' : 'border border-zinc-300'}`}>{c.done ? <Icon n="check" size={10} /> : null}</span>
                    <Link href={c.href} className={c.done ? 'text-zinc-400 line-through' : 'text-zinc-700 font-medium'}>{c.label}</Link>
                    {!c.done && <Link href={c.href} className="ml-auto text-xs font-medium text-zinc-900 underline">Fazer</Link>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="bg-white border border-zinc-200">
          <div className="px-4 py-2.5 border-b border-zinc-100"><h3 className="text-sm font-semibold">Atividade recente</h3></div>
          <div className="px-2 py-2">
            {!hasActivity ? <p className="text-sm text-zinc-500 px-2 py-4">Nenhuma atividade ainda.</p> : (
              <ul className="divide-y divide-zinc-100">
                {recent.orders.map((o) => {
                  const d = orderDef(o.status);
                  return (
                    <li key={o.id} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0 truncate"><Icon n="receipt" size={14} className="text-zinc-400 shrink-0" /> Pedido <strong>{o.code}</strong> — {o.customerName}</span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                    </li>
                  );
                })}
                {recent.bookings.map((b) => {
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
