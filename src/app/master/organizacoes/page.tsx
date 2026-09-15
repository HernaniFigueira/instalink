'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ListSkeleton } from '@/components/ui';

interface OrgRow {
  id: string; name: string;
  owner: { id: string; name: string; email: string; lastLoginAt: string } | null;
  units: number; users: number; createdAt: string; lastActivityAt: string;
  unitSummaries: Array<{ id: string; name: string; slug: string; address: string; published: boolean }>;
}

export default function MasterOrganizacoesPage() {
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback((term = '') => {
    fetch(`/api/master/organizations?q=${encodeURIComponent(term)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setRows(d.organizations); else setError('Não foi possível carregar.'); })
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
          <h1 className="text-2xl font-extrabold tracking-tight">Organizações</h1>
          <p className="text-sm text-zinc-500 mt-1">Todas as Organizations cadastradas na plataforma.</p>
        </div>
        {rows && <span className="text-xs font-bold bg-white border border-zinc-200 rounded-full px-3 py-1.5">{rows.length} organizações</span>}
      </div>

      <div className="relative mb-4 max-w-md">
        <Icon n="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou proprietário…"
          aria-label="Buscar organização"
          className="w-full bg-white border border-zinc-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400" />
      </div>

      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}
      {!rows ? <ListSkeleton rows={4} /> : rows.length === 0 ? (
        <p className="bg-white border border-zinc-200 rounded-2xl text-center py-12 text-sm text-zinc-500">Nenhuma organização.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((o) => (
            <div key={o.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold text-base">{o.name}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Proprietário: <strong>{o.owner?.name || '—'}</strong> ({o.owner?.email || 'sem e-mail'})
                    · criada {(o.createdAt || '').slice(0, 10)}
                    {o.lastActivityAt ? ` · atividade ${(o.lastActivityAt || '').slice(0, 10)}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-2 text-[11px] font-bold text-zinc-600">
                    <span>{o.units} unidade{o.units === 1 ? '' : 's'}</span>
                    <span>{o.users} usuário{o.users === 1 ? '' : 's'}</span>
                  </div>
                  {o.unitSummaries.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {o.unitSummaries.map((u) => (
                        <Link key={u.id} href={`/master/unidades/${u.id}`}
                          className="text-[10px] font-bold bg-zinc-50 border border-zinc-200 text-zinc-700 px-2 py-0.5 rounded-full hover:bg-zinc-100">
                          {u.name}{u.published ? '' : ' (rascunho)'}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                <Link href={`/master/organizacoes/${o.id}`}
                  className="text-xs font-bold bg-zinc-900 text-white px-3.5 py-2 rounded-lg shrink-0">
                  Abrir
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
