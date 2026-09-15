'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ListSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface UnitRow {
  id: string; name: string; slug: string; organizationId: string; organizationName: string;
  address: string; status: string; published: boolean;
  owner: { id: string; name: string; email: string } | null;
  createdAt: string;
}

export default function MasterUnidadesPage() {
  const [rows, setRows] = useState<UnitRow[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback((term = '') => {
    fetch(`/api/master/units?q=${encodeURIComponent(term)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setRows(d.units); else setError('Não foi possível carregar.'); })
      .catch(() => setError('Não foi possível carregar.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Unidades</h1>
          <p className="text-sm text-zinc-500 mt-1">Todas as unidades (Business) da plataforma.</p>
        </div>
        {rows && <span className="text-xs font-bold bg-white border border-zinc-200 rounded-full px-3 py-1.5">{rows.length} unidades</span>}
      </div>

      <div className="relative mb-4 max-w-md">
        <Icon n="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, organização, endereço…"
          aria-label="Buscar unidade"
          className="w-full bg-white border border-zinc-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400" />
      </div>

      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}
      {!rows ? <ListSkeleton rows={4} /> : rows.length === 0 ? (
        <p className="bg-white border border-zinc-200 rounded-2xl text-center py-12 text-sm text-zinc-500">Nenhuma unidade.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((u) => (
            <div key={u.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold flex items-center gap-2 flex-wrap">
                    {u.name}
                    <span className={cn('text-[10px] font-extrabold px-2 py-0.5 rounded-full',
                      u.published ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>
                      {u.published ? 'PUBLICADA' : 'RASCUNHO'}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    /{u.slug} · org <Link href={`/master/organizacoes/${u.organizationId}`} className="font-bold text-emerald-700 hover:underline">{u.organizationName || '—'}</Link>
                    · proprietário {u.owner?.name || '—'} ({u.owner?.email || '—'})
                    · criada {(u.createdAt || '').slice(0, 10)}
                  </p>
                  {u.address && <p className="text-xs text-zinc-500 mt-0.5">{u.address}</p>}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Link href={`/master/unidades/${u.id}`} className="text-xs font-bold bg-zinc-900 text-white px-3.5 py-2 rounded-lg text-center">Ver unidade</Link>
                  <Link href={`/master/suporte?unit=${u.id}`} className="text-xs font-bold bg-amber-400 text-amber-950 px-3.5 py-2 rounded-lg text-center">Iniciar suporte</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
