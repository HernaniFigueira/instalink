'use client';
// Auditoria da plataforma: toda ação administrativa relevante fica registrada.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListSkeleton } from '@/components/ui';

interface Entry {
  id: string; action: string; actorEmail: string; actorRole: string; businessId: string;
  businessName: string; supportSessionId: string; createdAt: string; meta: any;
}

const LABEL: Record<string, string> = {
  'feature.updated': 'Módulo ligado/desligado',
  'business.updated_by_master': 'Empresa editada pelo suporte',
  'business.viewed': 'Empresa visualizada pelo suporte',
  'member.created': 'Acesso criado',
  'member.updated': 'Acesso alterado',
  'member.removed': 'Acesso removido',
  'agent.updated': 'Agente configurado',
  'whatsapp.connect_requested': 'Conexão do WhatsApp solicitada',
  'whatsapp.webhook_received': 'Mensagem recebida (webhook)',
  'campaign.created': 'Campanha criada',
  'campaign.ready': 'Campanha pronta',
  'campaign.sent': 'Campanha enviada',
  'support.view_started': 'Suporte iniciou leitura',
  'support.admin_started': 'Suporte iniciou modo administrador',
  'support.ended': 'Suporte encerrado',
};

export default function AuditoriaPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    fetch('/api/admin/audit?limit=200')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEntries(d?.audit || []))
      .catch(() => setEntries([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!entries) return <ListSkeleton rows={6} />;
  const shown = filter
    ? entries.filter((e) => (e.businessName + e.action + e.actorEmail).toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Auditoria</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Ações administrativas e de suporte, da mais recente para a mais antiga.</p>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por empresa, ação ou e-mail…"
        aria-label="Filtrar auditoria"
        className="w-full max-w-md bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-sm mb-4 outline-none focus:border-zinc-400" />

      {shown.length === 0 ? (
        <p className="bg-white border border-zinc-200 rounded-2xl text-center py-12 text-sm text-zinc-500">Nenhum registro.</p>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
          {shown.map((e) => (
            <div key={e.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-xs font-extrabold text-zinc-800">{LABEL[e.action] || e.action}</span>
              {e.businessName && (
                <Link href={`/admin/empresas/${e.businessId}`} className="text-xs font-bold text-emerald-700 hover:underline">{e.businessName}</Link>
              )}
              <span className="text-xs text-zinc-500">{e.actorEmail}{e.actorRole === 'master' ? ' (master)' : ''}</span>
              <span className="text-xs text-zinc-400 ml-auto">{e.createdAt.slice(0, 16).replace('T', ' ')}</span>
              {e.supportSessionId && <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">via suporte</span>}
              {e.meta && Object.keys(e.meta).length > 0 && (
                <span className="w-full text-[11px] text-zinc-400 font-mono">{JSON.stringify(e.meta)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
