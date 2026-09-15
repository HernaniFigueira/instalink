'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Detail {
  organization: {
    id: string; name: string;
    owner: { id: string; name: string; email: string; lastLoginAt: string } | null;
    units: number; users: number; createdAt: string; lastActivityAt: string;
    unitSummaries: Array<{ id: string; name: string; slug: string; address: string; published: boolean; status: string }>;
  };
  users: Array<{ id: string; name: string; email: string; kind: string; lastLoginAt: string }>;
}

export default function MasterOrgDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/master/organizations/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Não encontrado ou acesso negado.'))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) return <p className="bg-red-600 text-white rounded-xl px-4 py-3 text-sm font-semibold">{error}</p>;
  if (!data) return <PageSkeleton />;
  const { organization: o, users } = data;

  return (
    <>
      <Link href="/master/organizacoes" className="text-xs font-bold text-zinc-500 hover:underline">← Organizações</Link>
      <h1 className="text-2xl font-extrabold tracking-tight mt-1">{o.name}</h1>
      <p className="text-xs text-zinc-500 mt-1">
        Proprietário {o.owner?.name || '—'} ({o.owner?.email || '—'}) · criada {(o.createdAt || '').slice(0, 10)}
        · {o.units} unidade(s) · {o.users} usuário(s)
      </p>

      <section className="bg-white border border-zinc-200 rounded-2xl p-4 mt-5">
        <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Unidades</p>
        {o.unitSummaries.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma unidade.</p>
        ) : (
          <ul className="space-y-2">
            {o.unitSummaries.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 border border-zinc-100 rounded-xl px-3 py-2.5">
                <div>
                  <p className="font-bold text-sm">{u.name}
                    <span className={cn('ml-2 text-[10px] font-extrabold px-2 py-0.5 rounded-full',
                      u.published ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>
                      {u.published ? 'PUBLICADA' : 'RASCUNHO'}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">/{u.slug}{u.address ? ` · ${u.address}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/master/unidades/${u.id}`} className="text-xs font-bold bg-zinc-900 text-white px-3 py-1.5 rounded-lg">Ver</Link>
                  <Link href={`/master/suporte?unit=${u.id}`} className="text-xs font-bold bg-amber-400 text-amber-950 px-3 py-1.5 rounded-lg">Suporte</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-zinc-200 rounded-2xl p-4 mt-4">
        <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Usuários vinculados ({users.length})</p>
        {users.length === 0 ? <p className="text-sm text-zinc-500">Nenhum.</p> : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id} className="text-sm flex flex-wrap gap-2 items-baseline">
                <span className="font-bold">{u.name}</span>
                <span className="text-xs text-zinc-500">{u.email}</span>
                <span className="text-[10px] font-extrabold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full uppercase">{u.kind}</span>
                <span className="text-xs text-zinc-400 ml-auto">{u.lastLoginAt ? `acesso ${u.lastLoginAt.slice(0, 10)}` : 'nunca acessou'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
