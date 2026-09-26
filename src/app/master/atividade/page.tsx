'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListSkeleton } from '@/components/ui';

interface Entry {
  id: string; at: string; action: string; label: string;
  actorEmail: string; actorRole: string;
  businessId: string; businessName: string;
  organizationId: string; organizationName: string;
  supportSessionId: string; meta: any;
}

export default function MasterAtividadePage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback((q = '') => {
    fetch(`/api/master/activity?limit=200&q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEntries(d?.activity || []))
      .catch(() => setEntries([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(filter), 300);
    return () => clearTimeout(t);
  }, [filter, load]);

  if (!entries) return <ListSkeleton rows={6} />;

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Atividade</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">
        Eventos reais da plataforma (criação de org/unidade/usuário, Master, suporte, logins). Sem eventos artificiais.
      </p>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por ação, e-mail, org…"
        aria-label="Filtrar atividade"
        className="w-full max-w-md bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-sm mb-4 outline-none focus:border-zinc-400" />

      {entries.length === 0 ? (
        <p className="bg-white border border-zinc-200 rounded-xl text-center py-12 text-sm text-zinc-500">Nenhum registro.</p>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
          {entries.map((e) => (
            <div key={e.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-xs font-extrabold text-zinc-800">{e.label}</span>
              {e.organizationName && (
                <Link href={`/master/organizacoes/${e.organizationId}`} className="text-xs font-bold text-emerald-700 hover:underline">
                  {e.organizationName}
                </Link>
              )}
              {e.businessName && (
                <Link href={`/master/unidades/${e.businessId}`} className="text-xs font-bold text-zinc-700 hover:underline">
                  {e.businessName}
                </Link>
              )}
              <span className="text-xs text-zinc-500">{e.actorEmail}{e.actorRole === 'master' ? ' (master)' : ''}</span>
              <span className="text-xs text-zinc-400 ml-auto">{(e.at || '').slice(0, 16).replace('T', ' ')}</span>
              {e.supportSessionId && <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">via suporte</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
