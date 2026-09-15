'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ListSkeleton } from '@/components/ui';

interface UnitRow {
  id: string; name: string; organizationId: string; organizationName: string; slug: string;
}
interface OrgRow {
  id: string; name: string;
  unitSummaries: Array<{ id: string; name: string; slug: string }>;
}

function SuporteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const preUnit = params.get('unit') || '';

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [orgId, setOrgId] = useState('');
  const [unitId, setUnitId] = useState(preUnit);
  const [mode, setMode] = useState<'view' | 'admin'>('view');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<any>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/master/organizations').then((r) => r.ok ? r.json() : null),
      fetch('/api/master/units').then((r) => r.ok ? r.json() : null),
      fetch('/api/master/support').then((r) => r.ok ? r.json() : null),
    ]).then(([o, u, s]) => {
      setOrgs(o?.organizations || []);
      setUnits(u?.units || []);
      setCurrent(s?.support || null);
      if (preUnit && u?.units) {
        const found = u.units.find((x: UnitRow) => x.id === preUnit);
        if (found) {
          setUnitId(found.id);
          setOrgId(found.organizationId);
        }
      }
    }).catch(() => setError('Falha ao carregar.'));
  }, [preUnit]);
  useEffect(() => { load(); }, [load]);

  const unitsOfOrg = orgId
    ? units.filter((u) => u.organizationId === orgId)
    : units;

  async function start() {
    if (!unitId) { setError('Escolha uma unidade.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/master/support', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: unitId, mode, reason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Falha ao iniciar suporte.');
      router.push(`/dashboard?b=${unitId}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function end() {
    await fetch('/api/master/support', { method: 'DELETE' }).catch(() => {});
    setCurrent(null);
    load();
  }

  if (!orgs.length && !units.length && !error) return <ListSkeleton rows={4} />;

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Suporte</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">
        Escolha Organization → unidade → modo. Sessão temporária (60 min), auditada, escopada à unidade.
        O Master não vira Owner e não acessa outras unidades pela URL.
      </p>

      {current && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5 text-sm">
          <p className="font-bold text-amber-900">Sessão ativa</p>
          <p className="text-xs text-amber-800 mt-1">
            Unidade {current.businessId} · modo {current.mode} · expira {(current.expiresAt || '').slice(0, 16).replace('T', ' ')}
          </p>
          <div className="flex gap-2 mt-3">
            <Link href={`/dashboard?b=${current.businessId}`} className="text-xs font-bold bg-zinc-900 text-white px-3 py-2 rounded-lg">Abrir painel</Link>
            <button onClick={end} className="text-xs font-bold bg-white border border-amber-300 px-3 py-2 rounded-lg">Encerrar</button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}

      <div className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-4 max-w-xl">
        <label className="block">
          <span className="text-[11px] font-bold text-zinc-500">ORGANIZATION</span>
          <select value={orgId} onChange={(e) => { setOrgId(e.target.value); setUnitId(''); }}
            className="block w-full mt-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm">
            <option value="">Todas / escolher…</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] font-bold text-zinc-500">UNIDADE</span>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}
            className="block w-full mt-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm">
            <option value="">Selecione…</option>
            {unitsOfOrg.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.organizationName || '—'})</option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-[11px] font-bold text-zinc-500">MODO</legend>
          <div className="flex gap-3 mt-2">
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="radio" name="mode" checked={mode === 'view'} onChange={() => setMode('view')} />
              View (somente leitura)
            </label>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="radio" name="mode" checked={mode === 'admin'} onChange={() => setMode('admin')} />
              Admin (escrita na unidade)
            </label>
          </div>
        </fieldset>

        <label className="block">
          <span className="text-[11px] font-bold text-zinc-500">MOTIVO (opcional, auditado)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente reportou falha na agenda"
            className="block w-full mt-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm" />
        </label>

        <button onClick={start} disabled={busy || !unitId}
          className="text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-xl disabled:opacity-50">
          {busy ? 'Iniciando…' : 'Iniciar suporte'}
        </button>
      </div>
    </>
  );
}

export default function MasterSuportePage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <SuporteForm />
    </Suspense>
  );
}
