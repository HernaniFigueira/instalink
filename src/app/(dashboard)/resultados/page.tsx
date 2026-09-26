'use client';
// ═══════════════════════════════════════════════════════════════
// RESULTADOS — "como está o meu negócio?" (P2, Bloco 1)
// ═══════════════════════════════════════════════════════════════
// DUAS camadas, na ordem em que o lojista pensa:
//   1. RESULTADOS DO NEGÓCIO (`/api/results` + lib/insights.ts): indicadores,
//      comparação com o período anterior, funil, desempenho por serviço e por
//      profissional e origem dos leads — tudo com dado REAL persistido;
//   2. PÁGINA PÚBLICA (`/api/analytics`, preservado): visitas, cliques,
//      produtos em destaque e os funis de página que já existiam.
//
// Período vive na URL (`?period=…`), então o recorte é compartilhável e
// sobrevive a recarregar a página/favoritos.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, PageSkeleton } from '@/components/ui';
import { AccessDenied, AreaLoadError, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { PeriodPicker, ResultsView } from '@/components/dashboard/results-view';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';
import { apiGet } from '@/lib/api-client';
import { money } from '@/lib/utils';
import { resolvePeriodSpec, type PeriodKey } from '@/lib/periods';
import { todayISO } from '@/lib/tz';
import type { ResultsPayload } from '@/lib/insights';

interface Analytics {
  period: number;
  modules: { bookings: boolean; products: boolean; orders: boolean; quote: boolean };
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

interface ResultsResponse {
  scope: 'business' | 'organization';
  business?: { id: string; name: string; slug: string };
  period: { key: string; label: string; from: string; to: string; prevFrom: string; prevTo: string; hasPrevious: boolean; custom: boolean };
  results: ResultsPayload;
}

function Funnel({ title, steps }: { title: string; steps: Analytics['funnelOrders'] }) {
  const max = Math.max(1, steps[0]?.value || 1);
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <h3 className="font-semibold text-sm mb-4">{title}</h3>
      <div className="space-y-2.5">
        {steps.map((s) => (
          <div key={s.id}>
            <div className="flex justify-between text-xs font-semibold mb-1">
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
  const router = useRouter();
  const businessId = params.get('b') || '';
  const periodParam = params.get('period');
  const fromParam = params.get('from');
  const toParam = params.get('to');

  const [data, setData] = useState<ResultsResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsRetry, setAnalyticsRetry] = useState(0);
  const [page, setPage] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  // 403 → aviso amigável (sessão preservada), nunca skeleton infinito.
  const { denied, failed, report } = useAreaLoad('Resultados');

  // Período resolvido pela FONTE ÚNICA (lib/periods.ts) — a mesma que a API usa.
  const spec = useMemo(
    () => resolvePeriodSpec({ period: periodParam, from: fromParam, to: toParam, today: todayISO() }),
    [periodParam, fromParam, toParam],
  );

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const query = spec.key === 'custom'
      ? `period=custom&from=${spec.from}&to=${spec.to}`
      : `period=${spec.key === 'all' ? '0' : spec.key}`;
    const res = await apiGet<ResultsResponse>(`/api/results?businessId=${businessId}&${query}`, { scope: 'area', area: 'Resultados' });
    if (!report(res) || !res.data) { setLoading(false); return; }
    setData(res.data);
    setLoading(false);
  }, [businessId, spec.key, spec.from, spec.to, report]);

  useEffect(() => { load(); }, [load]);
  // Voltar para a tela recarrega os números do período (sem polling).
  useRevalidateOnFocus(load);

  // Camada 2 (página pública): endpoint PRESERVADO. O `/api/analytics` entende
  // apenas os períodos numéricos antigos; para os novos recortes usamos 30
  // dias como aproximação do "movimento recente" — a matemática das METAS do
  // negócio nunca vem daqui.
  const analyticsPeriod = spec.key === 'custom' ? '30'
    : spec.key === 'today' ? '7'
      : spec.key === 'month' ? '30'
        : spec.key === 'all' ? '0'
          : spec.key;
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    setPage(null); setAnalyticsError(''); setAnalyticsLoading(true);
    apiGet<Analytics>(`/api/analytics?businessId=${businessId}&period=${analyticsPeriod}`, { scope: 'area', area: 'Resultados' })
      .then(res => { if (!alive) return; if (res.ok && res.data) setPage(res.data); else setAnalyticsError(res.message || 'Falha de conexão.'); setAnalyticsLoading(false); });
    return () => { alive = false; };
  }, [businessId, analyticsPeriod, analyticsRetry]);

  function changePeriod(next: { key: PeriodKey; from: string; to: string }) {
    const sp = new URLSearchParams(params.toString());
    if (next.key === 'custom') {
      sp.set('period', 'custom');
      if (next.from) sp.set('from', next.from); else sp.delete('from');
      if (next.to) sp.set('to', next.to); else sp.delete('to');
    } else {
      sp.set('period', next.key === 'all' ? '0' : next.key);
      sp.delete('from'); sp.delete('to');
    }
    router.replace(`/resultados?${sp.toString()}`);
  }

  if (denied) return <AccessDenied area="Resultados" />;
  if (failed) return <AreaLoadError area="Resultados" message={failed} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const pageTotals = page?.totals;
  const maxDay = Math.max(1, ...(page?.days || []).map((d) => d.visitors));

  return (
    <>
      <PageHeader
        icon="chart"
        title="Resultados"
        hint="Como está o negócio no período — números reais dos atendimentos, clientes e leads."
        action={<PeriodPicker value={spec} onChange={changePeriod} />}
      />

      {loading && <p className="text-xs text-zinc-400 mb-2" role="status">Atualizando…</p>}

      <ResultsView payload={data.results} />

      {/* ── Camada 2: o que a PÁGINA PÚBLICA produziu (endpoint preservado) ── */}
      {analyticsLoading && <p role="status" className="text-sm mt-6">Carregando estatísticas da página pública…</p>}
      {analyticsError && <AreaLoadError area="estatísticas da página pública" message={analyticsError} onRetry={() => setAnalyticsRetry(n => n+1)} />}
      {pageTotals && (
        <section className="mt-6 space-y-4">
          <div className="pt-4 border-t border-zinc-200">
            <h2 className="text-sm font-semibold text-zinc-900">Página pública</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Visitas, cliques e produtos em destaque (movimento recente da página).</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              ['Visitas à página', String(pageTotals.pageViews), `${pageTotals.uniqueVisitors} visitante(s) únicos`],
              ['Cliques', String(pageTotals.clicks), 'botões e WhatsApp'],
              ['Leads na página', String(pageTotals.leads), pageTotals.leadsNew ? `${pageTotals.leadsNew} novo(s)` : 'no recorte'],
              ['Conversões', `${pageTotals.rate}%`, `${pageTotals.conversions} conversão(ões)`],
            ].map(([label, value, hint]) => (
              <div key={label} className="bg-white border border-zinc-200 rounded-lg p-3.5">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="text-xl font-semibold tracking-tight mt-0.5">{value}</p>
                <p className="text-[11px] text-zinc-400 mt-1">{hint}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {page.modules.orders
              ? <Funnel title="Funil de pedidos" steps={page.funnelOrders} />
              : <Funnel title="Funil de agendamentos" steps={page.funnelBookings} />}
            <div className="bg-white border border-zinc-200 rounded-lg p-5">
              <h3 className="font-semibold text-sm mb-3">Movimento recente</h3>
              <div className="flex items-end gap-1 h-28 overflow-x-auto ws-scroll pb-1">
                {(page.days || []).map((d) => (
                  <div key={d.day} className="flex-1 min-w-[4px] flex flex-col items-center gap-1"
                    title={`${d.label}: ${d.visitors} visitas, ${d.conversions} conversões, ${money(d.revenue)}`}>
                    <div className="w-full flex flex-col justify-end gap-0.5 h-20">
                      <div className="w-full bg-emerald-500/30 rounded-sm" style={{ height: `${Math.round((d.visitors / maxDay) * 100)}%`, minHeight: d.visitors ? 3 : 0 }} />
                      {d.conversions > 0 && <div className="w-full bg-emerald-600 rounded-sm" style={{ height: 4 }} />}
                    </div>
                    {spec.key === '7' && <span className="text-[9px] text-zinc-400 whitespace-nowrap">{d.label}</span>}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-zinc-100 text-center">
                <div><p className="font-semibold">{pageTotals.clicks}</p><p className="text-[11px] text-zinc-500">Cliques na página</p></div>
                <div><p className="font-semibold">{pageTotals.bookings}</p><p className="text-[11px] text-zinc-500">Reservas criadas</p></div>
                <div><p className="font-semibold">{pageTotals.waClicks}</p><p className="text-[11px] text-zinc-500">Cliques WhatsApp</p></div>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {(page.modules.products || page.modules.orders) && (
              <div className="bg-white border border-zinc-200 rounded-lg p-5">
                <h3 className="font-semibold text-sm mb-3">{page.modules.orders ? 'Produtos em destaque' : 'Interesse na vitrine'}</h3>
                {page.topProducts.length === 0 ? <p className="text-xs text-zinc-500">Ainda sem movimento no período.</p> : (
                  <ul className="space-y-1.5">
                    {page.topProducts.map((p) => (
                      <li key={p.name} className="flex justify-between text-sm gap-2">
                        <span className="font-medium truncate">{p.name} <span className="text-zinc-400 font-normal">· {p.views} views{p.adds > 0 ? ` · ${p.adds} adds` : ''}</span></span>
                        {page.modules.orders && <span className="font-semibold shrink-0">{money(p.revenue)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="bg-white border border-zinc-200 rounded-lg p-5">
              <h3 className="font-semibold text-sm mb-3">Botões mais clicados</h3>
              {page.topCtas.length === 0 ? <p className="text-xs text-zinc-500">Ainda sem cliques no período.</p> : (
                <ul className="space-y-1.5">
                  {page.topCtas.map((c) => (
                    <li key={c.label} className="flex justify-between text-sm"><span className="font-medium">{c.label}</span><span className="text-zinc-500">{c.clicks}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
