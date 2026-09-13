'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageSkeleton } from '@/components/ui';
import { money } from '@/lib/utils';

interface Analytics {
  period: number;
  totals: {
    pageViews: number; uniqueVisitors: number; clicks: number; waClicks: number;
    leads: number; leadsNew: number; orders: number; ordersRevenue: number;
    bookings: number; conversions: number; rate: number;
  };
  funnelOrders: Array<{ id: string; label: string; value: number; rate: number }>;
  funnelBookings: Array<{ id: string; label: string; value: number; rate: number }>;
  days: Array<{ day: string; label: string; visitors: number; conversions: number; revenue: number }>;
  topProducts: Array<{ name: string; views: number; adds: number; revenue: number }>;
  topCtas: Array<{ label: string; clicks: number }>;
  origins: Array<{ name: string; value: number }>;
}

function Funnel({ title, steps }: { title: string; steps: Analytics['funnelOrders'] }) {
  const max = Math.max(1, steps[0]?.value || 1);
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <h3 className="font-bold text-sm mb-4">{title}</h3>
      <div className="space-y-2.5">
        {steps.map((s) => (
          <div key={s.id}>
            <div className="flex justify-between text-xs font-bold mb-1">
              <span>{s.label}</span>
              <span>{s.value} <span className="text-zinc-400 font-semibold">· {s.rate}%</span></span>
            </div>
            <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.max(2, Math.round((s.value / max) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResultadosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/analytics?businessId=${businessId}&period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); });
  }, [businessId, period]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <PageSkeleton />;
  const { totals, funnelOrders, funnelBookings, days, topProducts, topCtas, origins } = data;
  const maxDay = Math.max(1, ...days.map((d) => d.visitors));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resultados</h1>
          <p className="text-sm text-zinc-500 mt-1">O que está acontecendo na sua página, em linguagem simples.</p>
        </div>
        <div className="flex gap-1 bg-white border border-zinc-200 rounded-full p-1">
          {[7, 30].map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${period === p ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}>
              {p === 7 ? '7 dias' : '30 dias'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {([
          ['Receita', money(totals.ordersRevenue), `${totals.orders} pedido(s)`],
          ['Visitas à página', String(totals.pageViews), `${totals.uniqueVisitors} visitante(s) únicos`],
          ['Taxa de conversão', `${totals.rate}%`, `${totals.conversions} conversão(ões)`],
          ['Leads', String(totals.leads), totals.leadsNew ? `${totals.leadsNew} novo(s)` : 'no período'],
        ] as const).map(([label, value, hint]) => (
          <div key={label} className="bg-white border border-zinc-200 rounded-lg p-4">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="text-2xl font-extrabold tracking-tight">{value}</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">{hint}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Funnel title="Funil de pedidos" steps={funnelOrders} />
        <Funnel title="Funil de agendamentos" steps={funnelBookings} />
      </div>

      <div className="grid xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 bg-white border border-zinc-200 rounded-lg p-5">
          <h3 className="font-bold text-sm mb-3">Últimos {period} dias</h3>
          <div className="flex items-end gap-1 h-28">
            {days.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.label}: ${d.visitors} visitas, ${d.conversions} conversões, ${money(d.revenue)}`}>
                <div className="w-full flex flex-col justify-end gap-0.5 h-20">
                  <div className="w-full bg-emerald-500/30 rounded-sm" style={{ height: `${Math.round((d.visitors / maxDay) * 100)}%`, minHeight: d.visitors ? 3 : 0 }} />
                  {d.conversions > 0 && <div className="w-full bg-emerald-600 rounded-sm" style={{ height: 4 }} />}
                </div>
                {period <= 7 && <span className="text-[9px] text-zinc-400">{d.label}</span>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-zinc-100 text-center">
            <div><p className="font-extrabold">{totals.orders}</p><p className="text-[11px] text-zinc-500">Pedidos</p></div>
            <div><p className="font-extrabold">{totals.bookings}</p><p className="text-[11px] text-zinc-500">Agendamentos</p></div>
            <div><p className="font-extrabold">{totals.waClicks}</p><p className="text-[11px] text-zinc-500">Cliques WhatsApp</p></div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold text-sm mb-3">Produtos em destaque</h3>
            {topProducts.length === 0 ? <p className="text-xs text-zinc-500">Ainda sem movimento no período.</p> : (
              <ul className="space-y-1.5">
                {topProducts.map((p) => (
                  <li key={p.name} className="flex justify-between text-sm gap-2">
                    <span className="font-medium truncate">{p.name} <span className="text-zinc-400 font-normal">· {p.views} views · {p.adds} adds</span></span>
                    <span className="font-bold shrink-0">{money(p.revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold text-sm mb-3">Botões mais clicados</h3>
            {topCtas.length === 0 ? <p className="text-xs text-zinc-500">Ainda sem cliques no período.</p> : (
              <ul className="space-y-1.5">
                {topCtas.map((c) => (
                  <li key={c.label} className="flex justify-between text-sm"><span className="font-medium">{c.label}</span><span className="text-zinc-500">{c.clicks}</span></li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold text-sm mb-3">De onde vêm os leads</h3>
            {origins.length === 0 ? <p className="text-xs text-zinc-500">Ainda sem leads no período.</p> : (
              <ul className="space-y-1.5">
                {origins.map((o) => (
                  <li key={o.name} className="flex justify-between text-sm"><span className="font-medium">{o.name}</span><span className="text-zinc-500">{o.value}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
