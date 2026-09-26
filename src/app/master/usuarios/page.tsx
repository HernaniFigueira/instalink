'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { ListSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface UserRow {
  id: string; name: string; email: string; kind: string; platformRole: string;
  organizationNames: string[]; unitNames: string[];
  createdAt: string; lastLoginAt: string; isMaster: boolean;
}

const KIND_LABEL: Record<string, string> = {
  master: 'Master', owner: 'Owner', admin: 'Admin', member: 'Membro',
};
const KIND_TONE: Record<string, string> = {
  master: 'bg-amber-100 text-amber-900',
  owner: 'bg-emerald-100 text-emerald-800',
  admin: 'bg-blue-100 text-blue-800',
  member: 'bg-zinc-100 text-zinc-600',
};

export default function MasterUsuariosPage() {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');

  const load = useCallback((term = '', k = '') => {
    const params = new URLSearchParams();
    if (term) params.set('q', term);
    if (k) params.set('kind', k);
    fetch(`/api/master/users?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) { setRows(d.users); setCounts(d.counts || {}); }
        else setError('Não foi possível carregar.');
      })
      .catch(() => setError('Não foi possível carregar.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(q, kind), 300);
    return () => clearTimeout(t);
  }, [q, kind, load]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Usuários</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Visão global. Separados por Master · Owner · Admin · demais membros. Sem senhas, hashes ou tokens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          {(['master', 'owner', 'admin', 'member'] as const).map((k) => (
            <button key={k} onClick={() => setKind(kind === k ? '' : k)}
              className={cn('rounded-full px-3 py-1.5 border',
                kind === k ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200')}>
              {KIND_LABEL[k]} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
      </div>

      <div className="relative mb-4 max-w-md">
        <Icon n="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, e-mail, organização…"
          aria-label="Buscar usuário"
          className="w-full bg-white border border-zinc-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400" />
      </div>

      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}
      {!rows ? <ListSkeleton rows={5} /> : rows.length === 0 ? (
        <p className="bg-white border border-zinc-200 rounded-xl text-center py-12 text-sm text-zinc-500">Nenhum usuário.</p>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
          {rows.map((u) => (
            <div key={u.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={cn('text-[10px] font-extrabold px-2 py-0.5 rounded-full', KIND_TONE[u.kind] || KIND_TONE.member)}>
                {KIND_LABEL[u.kind] || u.kind}
              </span>
              <span className="font-bold text-sm">{u.name}</span>
              <span className="text-xs text-zinc-500">{u.email}</span>
              {u.organizationNames.length > 0 && (
                <span className="text-xs text-zinc-500">org: {u.organizationNames.slice(0, 2).join(', ')}{u.organizationNames.length > 2 ? '…' : ''}</span>
              )}
              {u.unitNames.length > 0 && (
                <span className="text-xs text-zinc-400">unid: {u.unitNames.slice(0, 2).join(', ')}{u.unitNames.length > 2 ? '…' : ''}</span>
              )}
              <span className="text-xs text-zinc-400 ml-auto">
                criado {(u.createdAt || '').slice(0, 10)}
                {u.lastLoginAt ? ` · acesso ${u.lastLoginAt.slice(0, 10)}` : ' · nunca acessou'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
