'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, Stat, Badge, PageSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { money } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { ORDER_STATUS, BOOKING_STATUS, LEAD_STATUS, toneCls, type StatusDef } from '@/lib/status';

interface Overview {
  user: { name: string };
  business: { id: string; name: string; slug: string; published: boolean };
  totals: {
    visitors: number; uniqueVisitors: number; clicks: number; leads: number; leadsNew: number;
    orders: number; bookings: number; conversions: number; newOrders: number; pendingBookings: number;
  };
  revenue: { total: number; prev: number; orders: number; ticket: number; period: number };
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
  }, [businessId, period]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <PageSkeleton />;

  const { user, business, totals, revenue, upcoming, checklist, pct, recent } = data;
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
        <div className="mb-6 rounded-2xl bg-emerald-600 text-white p-5">
          <p className="font-bold text-lg flex items-center gap-2"><Icon n="checkCircle" size={22} /> Sua estrutura está pronta, {user.name.split(' ')[0]}!</p>
          <p className="text-sm text-emerald-100 mt-1">Complete a configuração abaixo e publique sua página.</p>
        </div>
      )}

      {/* ── TOPO: cabeçalho operacional ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-700">{business.name}</span>
            {business.published ? <Badge tone="green"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-600" /> Publicada</span></Badge> : <Badge tone="amber"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border-2 border-amber-500" /> Rascunho</span></Badge>}
            <a href={`/${business.slug}`} target="_blank" className="text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1">instalink.app/{business.slug} <Icon n="external" size={12} /></a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-white border border-zinc-200 rounded-full p-1">
            {[7, 30].map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full ${period === p ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}>
                {p === 7 ? '7 dias' : '30 dias'}
              </button>
            ))}
          </div>
          <Link href={`/pagina${q}`} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl hover:bg-zinc-700">Editar página</Link>
        </div>
      </div>

      {next && (
        <Card className="mb-6 p-5 border-emerald-200 bg-emerald-50/50">
          <p className="text-sm font-semibold text-zinc-900">Próxima ação importante: <strong>{next.label}</strong></p>
          <Link href={next.href} className="inline-block mt-2 text-sm font-bold text-white bg-emerald-600 px-4 py-2 rounded-xl hover:bg-emerald-500">Fazer agora</Link>
        </Card>
      )}

      {/* ── MEIO: resumo principal ── */}
      <div className="grid xl:grid-cols-12 gap-4 mb-6">
        <Card className="xl:col-span-4 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Receita</p>
          <p className="text-3xl font-extrabold tracking-tight mt-1">{money(revenue.total)}</p>
          <p className={`text-xs font-bold mt-1 ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {delta >= 0 ? '▲' : '▼'} {money(Math.abs(delta))} vs. {revenue.period} dias anteriores
          </p>
          <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-zinc-100">
            <div><p className="text-sm font-extrabold">{revenue.orders}</p><p className="text-[11px] text-zinc-500">pedidos</p></div>
            <div><p className="text-sm font-extrabold">{money(revenue.ticket)}</p><p className="text-[11px] text-zinc-500">tíquete médio</p></div>
          </div>
        </Card>

        <Card className="xl:col-span-5 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Próximos atendimentos</p>
            <Link href={`/agenda${q}`} className="text-xs font-bold text-emerald-700 hover:underline">Ver agenda →</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum atendimento futuro.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcoming.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-zinc-50 last:border-0">
                  <span className="truncate"><strong>{b.customerName}</strong> <span className="text-zinc-500">· {b.service}{b.professional ? ` · ${b.professional}` : ''}</span></span>
                  <span className="text-xs font-bold text-zinc-500 shrink-0">{humanDay(b.date)} {b.time}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-3 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Movimento</p>
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-xl font-extrabold">{totals.uniqueVisitors}</p><p className="text-xs text-zinc-500">visitantes únicos</p></div>
            <div><p className="text-xl font-extrabold">{totals.clicks}</p><p className="text-xs text-zinc-500">cliques</p></div>
            <div><p className="text-xl font-extrabold">{totals.leads}</p><p className="text-xs text-zinc-500">leads{totals.leadsNew > 0 && <span className="font-bold text-amber-600"> · {totals.leadsNew} novo(s)</span>}</p></div>
            <div><p className="text-xl font-extrabold">{totals.conversions}</p><p className="text-xs text-zinc-500">conversões</p></div>
          </div>
          <Link href={`/resultados${q}`} className="inline-block mt-4 text-xs font-bold text-emerald-700 hover:underline">Ver resultados →</Link>
        </Card>
      </div>

      {/* ── BAIXO: operação + atividade ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Link href={`/pedidos${q}`}><Stat label="Pedidos" value={String(totals.orders)} hint={totals.newOrders ? `${totals.newOrders} novo(s)` : undefined} /></Link>
        <Link href={`/agenda${q}`}><Stat label="Agendamentos" value={String(totals.bookings)} hint={totals.pendingBookings ? `${totals.pendingBookings} pendente(s)` : undefined} /></Link>
        <Link href={`/clientes${q}`}><Stat label="Leads" value={String(totals.leads)} hint={totals.leadsNew ? `${totals.leadsNew} novo(s)` : undefined} /></Link>
        <Link href={`/pagina${q}`}><Stat label="Configuração" value={`${pct}%`} /></Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          {pct >= 100 && !showChecklist ? (
            <button onClick={() => setShowChecklist(true)} className="flex items-center gap-2 text-sm font-bold text-emerald-700">
              <Icon n="checkCircle" size={18} /> Tudo configurado — revisar checklist
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold">Configuração</h3>
                <span className="text-sm font-bold text-emerald-700">{pct}% pronta</span>
              </div>
              <div className="h-2 bg-zinc-100 rounded-full overflow-hidden mb-4">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <ul className="space-y-2">
                {checklist.map((c) => (
                  <li key={c.label}>
                    <Link href={c.href} className="flex items-center gap-2.5 text-sm hover:bg-zinc-50 rounded-lg px-2 py-1.5 -mx-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${c.done ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-500'}`}>
                        {c.done ? <Icon n="check" size={12} /> : <span className="w-2 h-2 rounded-full bg-zinc-400" />}
                      </span>
                      <span className={c.done ? 'text-zinc-500 line-through' : 'font-medium text-zinc-900'}>{c.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-bold mb-3">Atividade recente</h3>
          {!hasActivity ? (
            <p className="text-sm text-zinc-500">Nenhuma atividade ainda. Publique sua página e compartilhe o link!</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {recent.orders.map((o) => {
                const d = orderDef(o.status);
                return (
                  <li key={o.id} className="flex justify-between items-center gap-2">
                    <span className="flex items-center gap-1.5"><Icon n="receipt" size={15} className="text-zinc-400 shrink-0" /> <span>Pedido <strong>{o.code}</strong> — {o.customerName}</span></span>
                    <Link href={`/pedidos${q}`} className={`text-xs font-bold px-2 py-0.5 rounded-full ${toneCls(d.tone)}`}>{d.panel}</Link>
                  </li>
                );
              })}
              {recent.bookings.map((b) => {
                const d = bookDef(b.status);
                return (
                  <li key={b.id} className="flex justify-between items-center gap-2">
                    <span className="flex items-center gap-1.5"><Icon n="calendar" size={15} className="text-zinc-400 shrink-0" /> <span>Agendamento — {b.customerName} ({humanDay(b.date)} {b.time})</span></span>
                    <Link href={`/agenda${q}`} className={`text-xs font-bold px-2 py-0.5 rounded-full ${toneCls(d.tone)}`}>{d.panel}</Link>
                  </li>
                );
              })}
              {recent.leads.map((l) => {
                const d = leadDef(l.status);
                return (
                  <li key={l.id} className="flex justify-between items-center gap-2">
                    <span className="flex items-center gap-1.5"><Icon n="user" size={15} className="text-zinc-400 shrink-0" /> <span>Lead {l.name || l.phone || 'novo'}</span> <span className="text-zinc-400">via {l.origin}</span></span>
                    <Link href={`/clientes${q}`} className={`text-xs font-bold px-2 py-0.5 rounded-full ${toneCls(d.tone)}`}>{d.panel}</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
