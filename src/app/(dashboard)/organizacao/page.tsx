'use client';
// ═══════════════════════════════════════════════════════════════
// ORGANIZAÇÃO — visão consolidada (P0 preservado + P2)
// ═══════════════════════════════════════════════════════════════
// Regras mantidas:
//   • só entram as unidades às quais o usuário TEM ACESSO (o servidor
//     resolve a lista — `?organization=` nunca amplia o escopo);
//   • Master não herda a visão por ownership (arquitetura do P0 intacta);
//   • criar unidade continua exigindo permissão de gestão da organização.
//
// P2 acrescenta: indicadores consolidados do PERÍODO (mesma engine da tela
// Resultados) + comparação, com quebra por unidade e atalho para a unidade.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { money } from '@/lib/utils';
import { PeriodPicker, ResultsView } from '@/components/dashboard/results-view';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';
import { apiGet, apiSend } from '@/lib/api-client';
import { resolvePeriodSpec, type PeriodKey } from '@/lib/periods';
import { todayISO } from '@/lib/tz';
import type { ResultsPayload } from '@/lib/insights';
import { Button } from '@/components/ui';

type Org = {
  id: string; name: string; canManage: boolean;
  units: Array<{ id: string; name: string; slug: string; address: string; published: boolean }>;
  totals: { units: number; bookings: number; clients: number; predictedRevenue: number };
};

interface ConsolidatedResponse {
  scope: 'organization';
  organization: { id: string; name: string };
  period: { key: string; from: string; to: string; prevFrom: string; prevTo: string; hasPrevious: boolean; custom: boolean };
  units: Array<{ id: string; name: string; slug: string; results: ResultsPayload }>;
  consolidated: ResultsPayload;
}

function unitMetrics(results: ResultsPayload) {
  const get = (id: string) => results.metrics.find((m) => m.id === id);
  const bookings = get('bookings');
  const completed = get('completed');
  const newClients = get('new_clients');
  return {
    bookings: bookings?.hasData ? bookings.value : 0,
    completed: completed?.hasData ? completed.value : 0,
    newClients: newClients?.hasData ? newClients.value : 0,
  };
}

export default function OrganizationPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [adding, setAdding] = useState(() => params.get('add') === '1');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [data, setData] = useState<ConsolidatedResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const requestedOrganization = params.get('organization');
  const org = orgs?.find((o) => o.id === requestedOrganization) || orgs?.[0];

  const spec = useMemo(() => resolvePeriodSpec({
    period: params.get('period'), from: params.get('from'), to: params.get('to'), today: todayISO(),
  }), [params]);

  useEffect(() => {
    apiGet<{ organizations: Org[] }>('/api/organizations')
      .then((res) => setOrgs(res.ok ? (res.data?.organizations || []) : []))
      .catch(() => setOrgs([]));
  }, []);

  const loadResults = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    const query = spec.key === 'custom'
      ? `period=custom&from=${spec.from}&to=${spec.to}`
      : `period=${spec.key === 'all' ? '0' : spec.key}`;
    const res = await apiGet<ConsolidatedResponse>(`/api/results?organizationId=${org.id}&${query}`, { scope: 'area', area: 'Resultados' });
    setLoading(false);
    if (res.ok && res.data) setData(res.data);
    else setData(null);
  }, [org?.id, spec.key, spec.from, spec.to]);

  useEffect(() => { loadResults(); }, [loadResults]);
  // Voltamos para a tela → consolidado é revalidado (sem polling).
  useRevalidateOnFocus(loadResults);

  async function addUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !name.trim()) return;
    const res = await apiSend<{ businessId?: string }>('/api/businesses', 'POST', { name, address, organizationId: org.id }, { scope: 'action', area: 'Organização' });
    if (res.ok && res.data?.businessId) {
      // A1.2 · Bloco 3: navegação INTERNA via router (sem recarregar a app).
      // O contexto do shell é revalidado pelo MESMO canal usado em Recursos
      // (`il:business-refresh`) — a unidade nova precisa entrar na lista do
      // /api/auth/me antes do painel abrir em `?b=` dela.
      window.dispatchEvent(new Event('il:business-refresh'));
      router.push(`/dashboard?b=${res.data.businessId}`);
    }
  }

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
    router.replace(`/organizacao?${sp.toString()}`);
  }

  if (!orgs) return <p className="text-sm text-zinc-500">Carregando organização…</p>;
  if (!org) return <p className="text-sm text-zinc-500">Nenhuma organização disponível.</p>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Organização</p>
          <h1 className="text-xl font-semibold text-zinc-900 mt-1">{org.name}</h1>
          {orgs.length > 1 && (
            <select
              aria-label="Selecionar organização"
              value={org.id}
              // A1.2 · Bloco 3: troca de organização é navegação interna
              // (router.replace) — o estado da organização é derivado da URL.
              onChange={(e) => router.replace(`/organizacao?organization=${e.target.value}`)}
              className="mt-2 border border-zinc-200 rounded-md px-2 py-1 text-xs bg-white"
            >
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <p className="text-sm text-zinc-500 mt-1">Visão consolidada das unidades às quais você tem acesso.</p>
        </div>
        {org.canManage && (
          <Button variant="primary" size="sm" onClick={() => setAdding(!adding)}>
            + Adicionar unidade
          </Button>
        )}
      </header>

      {adding && (
        <form onSubmit={addUnit} className="bg-white border border-zinc-200 rounded-lg p-4 grid sm:grid-cols-3 gap-3">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da unidade" className="border border-zinc-200 rounded-md px-3 py-2 text-sm" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Endereço" className="border border-zinc-200 rounded-md px-3 py-2 text-sm" />
          <Button type="submit" variant="primary">Criar unidade independente</Button>
        </form>
      )}

      <section className="grid sm:grid-cols-4 gap-px bg-zinc-200 border border-zinc-200 rounded-lg overflow-hidden">
        {[
          ['Unidades', String(org.totals.units)],
          ['Agendamentos (total)', String(org.totals.bookings)],
          ['Clientes na base', String(org.totals.clients)],
          ['Receita prevista (total)', money(org.totals.predictedRevenue)],
        ].map(([l, v]) => (
          <div key={l} className="bg-white p-4">
            <p className="text-xs text-zinc-500">{l}</p>
            <p className="text-xl font-semibold mt-1">{v}</p>
          </div>
        ))}
      </section>
      <p className="text-[11px] text-zinc-400 -mt-3">
        Totais gerais (histórico). Os indicadores do período selecionado estão logo abaixo.
      </p>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Resultados consolidados</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Soma apenas das unidades que você acessa — nada de outra organização entra aqui.</p>
          </div>
          <PeriodPicker value={spec} onChange={changePeriod} label="Período consolidado" />
        </div>

        {loading && <p className="text-xs text-zinc-400" role="status">Carregando resultados…</p>}
        {!loading && !data && (
          <p className="text-xs text-zinc-600 bg-white border border-zinc-200 rounded-lg px-4 py-3">
            Seu perfil não tem acesso aos resultados destas unidades.
          </p>
        )}
        {data && <ResultsView payload={data.consolidated} />}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Unidades</h2>
        <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
          {org.units.map((u) => {
            const unitResults = data?.units.find((x) => x.id === u.id)?.results;
            const m = unitResults ? unitMetrics(unitResults) : null;
            return (
              <div key={u.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-zinc-50">
                <div className="min-w-0">
                  <strong className="text-sm">{u.name}</strong>
                  <span className="block text-xs text-zinc-500 mt-1">
                    {u.address || 'Endereço não informado'}
                    {m && <> · {m.bookings} agendamento(s) · {m.completed} concluído(s) · {m.newClients} novo(s) cliente(s)</>}
                  </span>
                </div>
                <span className="flex items-center gap-2 shrink-0">
                  <Link href={`/resultados?b=${u.id}&period=${spec.key === 'custom' ? '30' : spec.key === 'all' ? '0' : spec.key}`}
                    className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-1.5 rounded-md">
                    Resultados
                  </Link>
                  <Link href={`/dashboard?b=${u.id}`} className="text-xs font-semibold text-zinc-600 px-1">Abrir unidade →</Link>
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
