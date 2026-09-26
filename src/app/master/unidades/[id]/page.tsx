'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Detail {
  unit: {
    id: string; name: string; slug: string; niche: string; published: boolean; status: string;
    createdAt: string; updatedAt: string; address: string; organizationId: string; organizationName: string;
    subscription: string;
    whatsappIntegration: { status: string; label: { state: string; label: string; detail: string }; displayPhone: string };
  };
  owner: { id: string; name: string; email: string; createdAt: string; lastLoginAt: string } | null;
  team: Array<{ id: string; name: string; email: string; role: string; active: boolean; lastLoginAt: string }>;
  modules: Array<{ id: string; label: string; enabled: boolean }>;
  totals: Record<string, number>;
  agent: { name: string; enabled: boolean; tone: string; updatedAt: string } | null;
  recentAudit: Array<{ id: string; action: string; actorEmail: string; actorRole: string; supportSessionId: string; at: string; meta: any }>;
}

const TOTALS: Array<[string, string]> = [
  ['contacts', 'Contatos'], ['registeredCustomers', 'Clientes'], ['leads', 'Leads'],
  ['bookings', 'Agendamentos'], ['upcoming', 'Futuros'], ['orders', 'Pedidos'],
  ['professionals', 'Profissionais'], ['reviews', 'Avaliações'], ['conversations', 'Conversas'], ['campaigns', 'Campanhas'],
];

export default function MasterUnitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    fetch(`/api/master/units/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Não foi possível carregar.'))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  async function startSupport(mode: 'view' | 'admin') {
    setBusy(mode); setError('');
    try {
      const res = await fetch('/api/master/support', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: params.id, mode, reason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Não foi possível iniciar o suporte.');
      router.push(`/dashboard?b=${params.id}`);
    } catch (e: any) {
      setError(e.message);
      setBusy('');
    }
  }

  async function endSupport() {
    await fetch('/api/master/support', { method: 'DELETE' }).catch(() => {});
    router.refresh();
    load();
    setBusy('');
  }

  if (!data) {
    return error
      ? <p className="bg-red-600 text-white rounded-xl px-4 py-3 text-sm font-semibold">{error}</p>
      : <PageSkeleton />;
  }
  const { unit, owner, team, modules, totals, agent, recentAudit } = data;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <Link href="/master/unidades" className="text-xs font-bold text-zinc-500 hover:underline">← Unidades</Link>
          <h1 className="text-2xl font-extrabold tracking-tight mt-1 flex items-center gap-2 flex-wrap">
            {unit.name}
            <span className={cn('text-[10px] font-extrabold px-2 py-0.5 rounded-full',
              unit.published ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>
              {unit.published ? 'PUBLICADA' : 'RASCUNHO'}
            </span>
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            /{unit.slug} · org{' '}
            <Link href={`/master/organizacoes/${unit.organizationId}`} className="font-bold text-emerald-700 hover:underline">
              {unit.organizationName || '—'}
            </Link>
            · criada {(unit.createdAt || '').slice(0, 10)}
            {unit.address ? ` · ${unit.address}` : ''}
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <a href={`/${unit.slug}`} target="_blank" rel="noreferrer"
            className="text-xs font-bold bg-white border border-zinc-200 px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5">
            Página pública <Icon n="external" size={12} />
          </a>
          <div className="flex gap-2">
            <button onClick={() => startSupport('view')} disabled={!!busy}
              className="text-xs font-bold bg-amber-400 text-amber-950 px-3.5 py-2 rounded-lg disabled:opacity-50">
              {busy === 'view' ? 'Abrindo…' : 'Suporte (leitura)'}
            </button>
            <button onClick={() => startSupport('admin')} disabled={!!busy}
              className="text-xs font-bold bg-red-600 text-white px-3.5 py-2 rounded-lg disabled:opacity-50">
              {busy === 'admin' ? 'Abrindo…' : 'Suporte (admin)'}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="mb-4 text-sm font-semibold bg-amber-600 text-white rounded-xl px-4 py-3">{error}</p>}

      <div className="bg-white border border-zinc-200 rounded-xl p-4 mb-4">
        <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-2">Modo suporte</p>
        <p className="text-xs text-zinc-600 mb-2.5">
          Sessão de 60 minutos, auditada. Em <strong>leitura</strong> nenhuma escrita é permitida.
          O Master NÃO vira Owner da Organization — acesso só à unidade autorizada.
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="block flex-1 min-w-[240px]">
            <span className="text-[11px] font-bold text-zinc-500">MOTIVO (opcional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: cliente sem conseguir publicar"
              className="block w-full mt-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm" />
          </label>
          <button onClick={endSupport} className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg">Encerrar suporte</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <section className="bg-white border border-zinc-200 rounded-xl p-4 lg:col-span-2">
          <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Números</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {TOTALS.map(([k, label]) => (
              <div key={k}>
                <p className="text-lg font-extrabold">{totals[k] ?? 0}</p>
                <p className="text-[11px] text-zinc-500">{label}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="bg-white border border-zinc-200 rounded-xl p-4">
          <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">WhatsApp</p>
          <p className={cn('text-sm font-extrabold', unit.whatsappIntegration.status === 'connected' ? 'text-emerald-700' : 'text-zinc-700')}>
            {unit.whatsappIntegration.label.label}
          </p>
          <p className="text-xs text-zinc-500 mt-1">{unit.whatsappIntegration.label.detail}</p>
          <p className="text-xs text-zinc-500 mt-3">Assistente: <strong>{agent ? `${agent.name} (${agent.enabled ? 'ativo' : 'off'})` : 'não configurado'}</strong></p>
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="bg-white border border-zinc-200 rounded-xl p-4">
          <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Proprietário</p>
          {owner ? (
            <>
              <p className="font-bold">{owner.name}</p>
              <p className="text-xs text-zinc-500">{owner.email}</p>
              <p className="text-xs text-zinc-500 mt-1">criado {(owner.createdAt || '').slice(0, 10)}</p>
              <p className="text-xs text-zinc-500">último acesso: {owner.lastLoginAt ? owner.lastLoginAt.slice(0, 16).replace('T', ' ') : 'nunca'}</p>
            </>
          ) : <p className="text-sm text-zinc-500">Sem proprietário.</p>}
        </section>
        <section className="bg-white border border-zinc-200 rounded-xl p-4">
          <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Equipe ({team.length})</p>
          {team.length === 0 ? <p className="text-sm text-zinc-500">Só o proprietário.</p> : (
            <ul className="space-y-2">
              {team.map((m) => (
                <li key={m.id} className="text-sm">
                  <span className="font-bold">{m.name}</span>
                  <span className="text-[10px] font-extrabold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full ml-1.5">{m.role}</span>
                  <span className="block text-xs text-zinc-500">{m.email}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="bg-white border border-zinc-200 rounded-xl p-4">
          <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Módulos</p>
          <div className="flex flex-wrap gap-1.5">
            {modules.map((m) => (
              <span key={m.id} className={cn('text-[10px] font-extrabold px-2 py-1 rounded-full',
                m.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-400')}>
                {m.enabled ? '✓ ' : '— '}{m.label}
              </span>
            ))}
          </div>
        </section>
      </div>

      <section className="bg-white border border-zinc-200 rounded-xl p-4 mt-4">
        <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Auditoria recente</p>
        {recentAudit.length === 0 ? <p className="text-sm text-zinc-500">Nenhum registro.</p> : (
          <ul className="space-y-1.5 text-xs">
            {recentAudit.map((a) => (
              <li key={a.id} className="text-zinc-600">
                <span className="font-bold text-zinc-800">{a.action}</span> · {a.actorEmail} · {(a.at || '').slice(0, 16).replace('T', ' ')}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
