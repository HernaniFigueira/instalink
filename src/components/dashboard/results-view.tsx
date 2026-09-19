'use client';
// ═══════════════════════════════════════════════════════════════
// RESULTADOS — apresentação compartilhada (P2, Bloco 1)
// ═══════════════════════════════════════════════════════════════
// Usado pela tela Resultados (uma unidade) e pela visão consolidada da
// Organização. Toda a matemática vem de lib/insights.ts (puro e testado);
// aqui só existe apresentação:
//   • indicadores com comparação (período atual × anterior equivalente);
//   • estado NEUTRO quando não há base — nunca número decorativo;
//   • funil operacional com o estágio não rastreado declarado;
//   • desempenho por serviço/profissional e origem dos leads;
//   • responsivo: cartões no mobile, tabela no desktop (nunca tabela quebrada).
import { useState } from 'react';
import { money } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  MAIN_PERIOD_KEYS, MORE_PERIOD_KEYS, periodKeyLabel, periodParamFor,
  type PeriodKey, type PeriodSpec,
} from '@/lib/periods';
import type {
  Metric, ProfessionalPerformance, ResultsPayload, ServicePerformance,
} from '@/lib/insights';
import { Icon } from '@/components/icons';
import { Tabs } from '@/components/ui';

export interface PeriodSelection { key: PeriodKey; from: string; to: string }

/** Seletor de período simples (Hoje · 7 · 30 · Este mês · Personalizado). */
export function PeriodPicker({ value, onChange, label = 'Período dos resultados' }: {
  value: PeriodSpec;
  onChange: (next: PeriodSelection) => void;
  label?: string;
}) {
  const [openMore, setOpenMore] = useState(false);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(value.from || value.to);
  const [to, setTo] = useState(value.to);
  const isKey = (k: PeriodKey) => value.key === k && !custom;

  const chip = (k: PeriodKey) => (
    <button
      key={k}
      type="button"
      onClick={() => { setCustom(false); onChange({ key: k, from: '', to: '' }); }}
      aria-pressed={isKey(k)}
      className={cn(
        'text-xs font-medium px-2.5 py-1 rounded whitespace-nowrap transition-colors',
        isKey(k) ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50',
      )}
    >
      {periodKeyLabel(k)}
    </button>
  );

  return (
    <div className="max-w-full">
      <div role="group" aria-label={label} className="inline-flex items-center bg-white border border-zinc-200 rounded-md p-0.5 gap-0.5 max-w-full overflow-x-auto no-scrollbar">
        {MAIN_PERIOD_KEYS.map(chip)}
        <button
          type="button"
          onClick={() => setCustom((c) => !c)}
          aria-pressed={value.key === 'custom'}
          className={cn(
            'text-xs font-medium px-2.5 py-1 rounded whitespace-nowrap transition-colors inline-flex items-center gap-1',
            value.key === 'custom' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50',
          )}
        >
          <Icon n="calendar" size={12} /> Personalizado
        </button>
        <button
          type="button"
          onClick={() => setOpenMore((o) => !o)}
          aria-expanded={openMore}
          className="text-xs font-medium px-2.5 py-1 rounded whitespace-nowrap text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
        >
          Mais
        </button>
      </div>

      {openMore && (
        <div className="mt-2 inline-flex items-center bg-white border border-zinc-200 rounded-md p-0.5 gap-0.5">
          {MORE_PERIOD_KEYS.map(chip)}
        </div>
      )}

      {custom && (
        <div className="mt-2 flex flex-wrap items-end gap-2 bg-white border border-zinc-200 rounded-md p-2.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            De
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="block mt-1 border border-zinc-300 rounded-md px-2 py-1.5 text-xs font-normal text-zinc-800" />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Até
            <input type="date" value={to} max={value.to} onChange={(e) => setTo(e.target.value)}
              className="block mt-1 border border-zinc-300 rounded-md px-2 py-1.5 text-xs font-normal text-zinc-800" />
          </label>
          <button
            type="button"
            onClick={() => onChange({ key: 'custom', from, to })}
            className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md"
          >
            Aplicar
          </button>
        </div>
      )}

      <p className="text-[11px] text-zinc-500 mt-1.5">
        {value.hasPrevious && value.key !== 'all'
          ? <>Comparado com o período imediatamente anterior de mesma duração{value.custom ? ` (${value.prevFrom.split('-').reverse().join('/')} a ${value.prevTo.split('-').reverse().join('/')})` : ''}.</>
          : <>Sem comparação: este recorte não tem período anterior equivalente.</>}
      </p>
    </div>
  );
}

function fmt(metric: Metric): string {
  if (!metric.hasData) return '—';
  if (metric.unit === 'money') return money(metric.value);
  if (metric.unit === 'percent') return `${metric.value}%`;
  return String(metric.value);
}

/** Mudança objetiva vs período anterior (nunca interpretação artificial). */
export function ComparisonBadge({ metric, hasPrevious }: { metric: Metric; hasPrevious: boolean }) {
  if (!hasPrevious || metric.prev === null) return null;
  if (metric.deltaPct === null) {
    return <span className="text-[11px] text-zinc-400">sem base de comparação</span>;
  }
  const up = metric.deltaPct > 0;
  const flat = metric.deltaPct === 0;
  return (
    <span className={cn(
      'text-[11px] font-semibold inline-flex items-center gap-0.5',
      flat ? 'text-zinc-400' : up ? 'text-emerald-700' : 'text-red-600',
    )}>
      {flat ? '=' : up ? '▲' : '▼'} {Math.abs(metric.deltaPct)}%
      <span className="font-normal text-zinc-400">vs. anterior</span>
    </span>
  );
}

export function MetricGrid({ metrics, hasPrevious }: { metrics: Metric[]; hasPrevious: boolean }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
      {metrics.map((m) => (
        <div key={m.id} className={cn('bg-white border border-zinc-200 rounded-lg p-3.5', !m.hasData && 'bg-zinc-50/60')}>
          <p className="text-xs text-zinc-500">{m.label}</p>
          <p className={cn('text-xl font-extrabold tracking-tight mt-0.5', !m.hasData && 'text-zinc-300')}>{fmt(m)}</p>
          <div className="mt-1 min-h-[16px]"><ComparisonBadge metric={m} hasPrevious={hasPrevious} /></div>
          <p className="text-[11px] text-zinc-400 mt-1 leading-snug">{m.hasData ? m.hint : (m.noDataHint || m.hint)}</p>
        </div>
      ))}
    </div>
  );
}

export function FunnelView({ funnel }: { funnel: ResultsPayload['funnel'] }) {
  const steps = funnel.steps;
  const max = Math.max(1, ...steps.map((s) => s.value));
  let lastGroup = '';
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <h3 className="font-bold text-sm">Funil do período</h3>
      <p className="text-[11px] text-zinc-500 mt-0.5">Etapas contadas separadamente no período — o sistema não vincula cada lead a um agendamento.</p>
      <div className="mt-3 space-y-2.5">
        {steps.map((s) => {
          const groupHeader = s.group !== lastGroup;
          lastGroup = s.group;
          const width = s.tracked ? Math.max(s.value > 0 ? 4 : 0, Math.round((s.value / max) * 100)) : 100;
          return (
            <div key={s.id}>
              {groupHeader && (
                <p className="text-[10px] font-bold tracking-[0.08em] uppercase text-zinc-400 mb-1.5 mt-1">
                  {s.group === 'lead' ? 'Captação' : 'Atendimento'}
                </p>
              )}
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className={cn('font-medium', !s.tracked && 'text-zinc-400')}>{s.label}</span>
                <span className="tabular-nums">
                  {s.tracked
                    ? <>{s.value}{s.rate !== null && <span className="text-zinc-400 font-normal"> · {s.rate}%</span>}</>
                    : <span className="text-zinc-400 font-normal">não rastreado</span>}
                </span>
              </div>
              <div className="h-2.5 mt-1 rounded-full overflow-hidden bg-zinc-100">
                <div
                  className={cn('h-full rounded-full', s.tracked ? (s.group === 'lead' ? 'bg-zinc-400' : 'bg-emerald-500') : 'bg-zinc-200')}
                  style={s.tracked
                    ? { width: `${width}%` }
                    : { width: '100%', backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(0,0,0,0.08) 6px, rgba(0,0,0,0.08) 12px)' }}
                />
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{s.hint}</p>
            </div>
          );
        })}
      </div>

      {funnel.losses.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-100">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1.5">Onde houve perda</p>
          <div className="flex flex-wrap gap-1.5">
            {funnel.losses.map((l) => (
              <span key={l.id} title={l.hint}
                className={cn('text-[11px] font-semibold px-2 py-1 rounded border',
                  l.value > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-zinc-50 border-zinc-200 text-zinc-500')}>
                {l.label}: {l.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type PerfTab = 'services' | 'professionals';

function StatLine({ label, value, moneyValue }: { label: string; value: number; moneyValue?: number }) {
  return (
    <span className="text-[11px] text-zinc-500">
      {label} <strong className="text-zinc-800 tabular-nums font-semibold">{moneyValue !== undefined ? money(moneyValue) : value}</strong>
    </span>
  );
}

/** Desempenho por serviço/profissional — tabela no desktop, cartões no mobile. */
export function PerformanceView({ payload }: { payload: ResultsPayload }) {
  const [tab, setTab] = useState<PerfTab>('services');
  // As duas abas usam a MESMA apresentação; o que muda é o conjunto de
  // colunas (profissional tem "serviços realizados"). Tipadas pela união,
  // sem `any` — o compilador garante que a coluna existe na linha.
  const section = (tab === 'services' ? payload.services : payload.professionals) as
    { available: boolean; reason: string; rows: Array<ServicePerformance | ProfessionalPerformance> };
  const showRevenue = !!payload.revenue.forecast && payload.revenue.forecastPriced;

  return (
    <div className="ws-panel">
      <div className="px-4 pt-3.5 pb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-soft)]">
        <h3 className="font-bold text-sm text-[var(--text)]">Desempenho</h3>
        <Tabs
          items={[
            { id: 'services' as const, label: 'Serviços', icon: 'service' },
            { id: 'professionals' as const, label: 'Profissionais', icon: 'idcard' },
          ]}
          value={tab}
          onChange={(id) => setTab(id)}
          ariaLabel="Tipo de desempenho"
          size="sm"
        />
      </div>

      {section.rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-zinc-500">{section.reason}</p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto ws-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-100">
                  <th className="text-left font-semibold px-4 py-2">{tab === 'services' ? 'Serviço' : 'Profissional'}</th>
                  <th className="text-right font-semibold px-3 py-2">Agend.</th>
                  <th className="text-right font-semibold px-3 py-2">Concluídos</th>
                  {tab === 'professionals' && <th className="text-right font-semibold px-3 py-2">Serviços</th>}
                  <th className="text-right font-semibold px-3 py-2">Cancel.</th>
                  <th className="text-right font-semibold px-3 py-2">Faltas</th>
                  {showRevenue && <th className="text-right font-semibold px-4 py-2">Receita prevista</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {section.rows.map((r) => (
                  <tr key={r.id || r.name}>
                    <td className="px-4 py-2.5 font-medium">{r.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.bookings}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.completed}</td>
                    {tab === 'professionals' && <td className="px-3 py-2.5 text-right tabular-nums">{'servicesDone' in r ? r.servicesDone : 0}</td>}
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.cancelled}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.noShow}</td>
                    {showRevenue && <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(r.revenue)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — cartões, sem tabela apertada */}
          <ul className="md:hidden divide-y divide-zinc-100">
            {section.rows.map((r) => (
              <li key={r.id || r.name} className="px-4 py-3">
                <p className="text-sm font-medium">{r.name}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <StatLine label="Agendados" value={r.bookings} />
                  <StatLine label="Concluídos" value={r.completed} />
                  {tab === 'professionals' && <StatLine label="Serviços" value={'servicesDone' in r ? r.servicesDone : 0} />}
                  <StatLine label="Cancel." value={r.cancelled} />
                  <StatLine label="Faltas" value={r.noShow} />
                  {showRevenue && <StatLine label="Receita" value={0} moneyValue={r.revenue} />}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {!showRevenue && section.rows.length > 0 && (
        <p className="px-4 pb-3.5 text-[11px] text-zinc-400">
          Receita por linha aparece quando os serviços têm valor cadastrado.
        </p>
      )}
    </div>
  );
}

export function OriginsView({ origins }: { origins: ResultsPayload['origins'] }) {
  const max = Math.max(1, ...origins.rows.map((o) => o.leads));
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <h3 className="font-bold text-sm">De onde vêm os leads</h3>
      {origins.rows.length === 0 ? (
        <p className="text-xs text-zinc-500 mt-2">{origins.reason}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {origins.rows.map((o) => (
            <li key={o.name}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium truncate">{o.name}</span>
                <span className="tabular-nums text-zinc-500 shrink-0">
                  {o.leads} lead(s) · {o.converted} convertido(s) · {o.rate}%
                </span>
              </div>
              <div className="h-2 mt-1 rounded-full overflow-hidden bg-zinc-100">
                <div className="h-full bg-zinc-700 rounded-full" style={{ width: `${Math.max(4, Math.round((o.leads / max) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Bloco completo de resultados de um recorte (unidade ou organização). */
export function ResultsView({ payload, title, subtitle }: {
  payload: ResultsPayload;
  title?: string;
  subtitle?: string;
}) {
  const hasPrevious = payload.period.hasPrevious;
  return (
    <section className="space-y-4">
      {title && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
      )}

      <MetricGrid metrics={payload.metrics} hasPrevious={hasPrevious} />

      {!payload.hasAnyData && (
        <p className="text-xs text-zinc-500 bg-white border border-zinc-200 rounded-lg px-4 py-3">{payload.emptyHint}</p>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <FunnelView funnel={payload.funnel} />
        <OriginsView origins={payload.origins} />
      </div>

      <PerformanceView payload={payload} />

      {payload.limitations.length > 0 && (
        <details className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
          <summary className="text-xs font-semibold text-zinc-600 cursor-pointer">O que o sistema ainda não mede</summary>
          <ul className="mt-2 space-y-1.5 list-disc pl-4">
            {payload.limitations.map((l, i) => <li key={i} className="text-[11px] text-zinc-500 leading-snug">{l}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Link canônico de uma seleção de período (usado nos atalhos internos). */
export function periodHref(base: { pathname: string; businessId?: string; organizationId?: string }, sel: PeriodSelection): string {
  const params = new URLSearchParams();
  if (base.businessId) params.set('b', base.businessId);
  if (base.organizationId) params.set('organization', base.organizationId);
  if (sel.key === 'custom') {
    params.set('period', 'custom');
    if (sel.from) params.set('from', sel.from);
    if (sel.to) params.set('to', sel.to);
  } else {
    params.set('period', periodParamFor(sel.key));
  }
  return `${base.pathname}?${params.toString()}`;
}
