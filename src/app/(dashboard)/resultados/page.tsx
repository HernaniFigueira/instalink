'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageSkeleton } from '@/components/ui';

interface Analytics {
  totals: { visitors: number; clicks: number; waClicks: number; leads: number; orders: number; bookings: number; conversions: number; rate: number };
  funnel: { visitors: number; actions: number; interested: number; leads: number; conversions: number };
  days: Array<{ day: string; label: string; visitors: number; conversions: number }>;
  topProducts: Array<{ name: string; views: number }>;
  origins: Array<{ name: string; value: number }>;
}

export default function ResultadosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<Analytics | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/analytics?businessId=${businessId}`).then((r) => r.json()).then(setData);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <PageSkeleton />;
  const { totals, funnel, days, topProducts, origins } = data;
  const maxDay = Math.max(1, ...days.map((d) => d.visitors));
  const funnelSteps: Array<[string, number]> = [
    ['Visitantes', funnel.visitors],
    ['Ações', funnel.actions],
    ['Interessados', funnel.interested],
    ['Leads', funnel.leads],
    ['Conversões', funnel.conversions],
  ];
  const maxFunnel = Math.max(1, funnel.visitors);

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Resultados</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">O que está acontecendo na sua página, em linguagem simples.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {([
          ['Visitantes', totals.visitors],
          ['Cliques', totals.clicks],
          ['Leads', totals.leads],
          ['Conversões', totals.conversions],
        ] as const).map(([label, value]) => (
          <div key={label} className="bg-white border border-zinc-200 rounded-2xl p-4">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="text-2xl font-extrabold tracking-tight">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <h3 className="font-bold text-sm mb-1">Funil de conversão</h3>
          <p className="text-xs text-zinc-500 mb-4">Taxa de conversão: <strong className="text-emerald-700">{totals.rate}%</strong></p>
          <div className="space-y-2.5">
            {funnelSteps.map(([label, value]) => (
              <div key={label}>
                <div className="flex justify-between text-xs font-bold mb-1"><span>{label}</span><span>{value}</span></div>
                <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.max(2, Math.round((value / maxFunnel) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-zinc-100 text-center">
            <div><p className="font-extrabold">{totals.orders}</p><p className="text-[11px] text-zinc-500">Pedidos</p></div>
            <div><p className="font-extrabold">{totals.bookings}</p><p className="text-[11px] text-zinc-500">Agendamentos</p></div>
            <div><p className="font-extrabold">{totals.waClicks}</p><p className="text-[11px] text-zinc-500">Cliques WhatsApp</p></div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-zinc-200 rounded-2xl p-5">
            <h3 className="font-bold text-sm mb-3">Últimos 14 dias</h3>
            <div className="flex items-end gap-1 h-28">
              {days.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.label}: ${d.visitors} visitantes, ${d.conversions} conversões`}>
                  <div className="w-full flex flex-col justify-end gap-0.5 h-20">
                    <div className="w-full bg-emerald-500/30 rounded-sm" style={{ height: `${Math.round((d.visitors / maxDay) * 100)}%`, minHeight: d.visitors ? 3 : 0 }} />
                    {d.conversions > 0 && <div className="w-full bg-emerald-600 rounded-sm" style={{ height: 4 }} />}
                  </div>
                  <span className="text-[9px] text-zinc-400">{d.label.slice(0, 5)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-5">
            <h3 className="font-bold text-sm mb-3">Produtos mais vistos</h3>
            {topProducts.length === 0 ? <p className="text-xs text-zinc-500">Ainda sem visualizações.</p> : (
              <ul className="space-y-1.5">
                {topProducts.map((p) => (
                  <li key={p.name} className="flex justify-between text-sm"><span className="font-medium">{p.name}</span><span className="text-zinc-500">{p.views} views</span></li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-5">
            <h3 className="font-bold text-sm mb-3">De onde vêm os leads</h3>
            {origins.length === 0 ? <p className="text-xs text-zinc-500">Ainda sem leads.</p> : (
              <ul className="space-y-1.5">
                {origins.map((o) => (
                  <li key={o.name} className="flex justify-between text-sm"><span className="font-medium capitalize">{o.name}</span><span className="text-zinc-500">{o.value}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
