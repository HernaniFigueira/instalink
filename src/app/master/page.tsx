'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ListSkeleton } from '@/components/ui';
import { money } from '@/lib/utils';

interface Overview {
  organizations: number;
  units: number;
  users: number;
  masters: number;
  owners: number;
  admins: number;
  members: number;
  publishedUnits: number;
  supportSessionsActive: number;
  platformRevenueCents: number;
  platformRevenueLabel: string;
  platformRevenueHint: string;
  billing: { implemented: false };
  recentActivity: Array<{
    id: string; at: string; action: string; actorEmail: string; actorRole: string;
    businessName: string; organizationName: string;
  }>;
}

const ACTION_LABEL: Record<string, string> = {
  'organization.created': 'Organização criada',
  'unit.created': 'Unidade criada',
  'member.created': 'Membro criado',
  'master.created': 'Master criado',
  'master.promoted': 'Master promovido',
  'master.revoked': 'Master removido',
  'support.view_started': 'Suporte (leitura)',
  'support.admin_started': 'Suporte (admin)',
  'support.ended': 'Suporte encerrado',
  'user.login': 'Login',
  'business.viewed': 'Unidade visualizada',
};

export default function MasterOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/master/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Acesso negado ou falha ao carregar.'))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="bg-red-600 text-white rounded-xl px-4 py-3 text-sm font-semibold">{error}</p>;
  if (!data) return <ListSkeleton rows={5} />;

  const cards: Array<{ label: string; value: string | number; href?: string; hint?: string }> = [
    { label: 'Organizations', value: data.organizations, href: '/master/organizacoes' },
    { label: 'Unidades', value: data.units, href: '/master/unidades' },
    { label: 'Usuários', value: data.users, href: '/master/usuarios' },
    { label: 'Masters', value: data.masters, href: '/master/masters' },
    { label: 'Owners', value: data.owners },
    { label: 'Admins', value: data.admins },
    { label: 'Unidades publicadas', value: data.publishedUnits },
    { label: 'Suportes ativos', value: data.supportSessionsActive, href: '/master/suporte' },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight">Visão geral</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Camada Master do GoDoutor — acima de todas as Organizations. Dados reais da plataforma.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {cards.map((c) => {
          const inner = (
            <div className="bg-white border border-zinc-200 rounded-xl p-4 h-full hover:border-zinc-300 transition-colors">
              <p className="text-2xl font-extrabold tracking-tight">{c.value}</p>
              <p className="text-xs font-bold text-zinc-500 mt-1">{c.label}</p>
            </div>
          );
          return c.href ? <Link key={c.label} href={c.href}>{inner}</Link> : <div key={c.label}>{inner}</div>;
        })}
      </div>

      <section className="bg-white border border-zinc-200 rounded-xl p-5 mb-6">
        <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-2">{data.platformRevenueLabel}</p>
        <p className="text-3xl font-extrabold">{money(data.platformRevenueCents)}</p>
        <p className="text-xs text-zinc-500 mt-2 max-w-2xl">{data.platformRevenueHint}</p>
        {!data.billing.implemented && (
          <p className="mt-3 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
            Planos / assinaturas / MRR / inadimplência — reservados para etapa futura. Sem dados inventados.
          </p>
        )}
      </section>

      <section className="bg-white border border-zinc-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400">Atividade recente</p>
          <Link href="/master/atividade" className="text-xs font-bold text-emerald-700 hover:underline">Ver tudo</Link>
        </div>
        {data.recentActivity.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum evento registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {data.recentActivity.slice(0, 12).map((a) => (
              <li key={a.id} className="py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                <span className="font-extrabold text-zinc-800">{ACTION_LABEL[a.action] || a.action}</span>
                {a.organizationName && <span className="text-zinc-600">{a.organizationName}</span>}
                {a.businessName && <span className="text-zinc-500">{a.businessName}</span>}
                <span className="text-zinc-400">{a.actorEmail}</span>
                <span className="text-zinc-400 ml-auto">{(a.at || '').slice(0, 16).replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
