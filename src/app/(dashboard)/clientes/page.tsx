'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Lead } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

const STATUS: Array<{ id: Lead['status']; label: string; cls: string }> = [
  { id: 'new', label: 'Novo', cls: 'bg-blue-100 text-blue-800' },
  { id: 'contacted', label: 'Contatado', cls: 'bg-amber-100 text-amber-800' },
  { id: 'qualified', label: 'Qualificado', cls: 'bg-purple-100 text-purple-800' },
  { id: 'converted', label: 'Convertido', cls: 'bg-emerald-100 text-emerald-800' },
  { id: 'lost', label: 'Perdido', cls: 'bg-zinc-100 text-zinc-500' },
];

export default function ClientesPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/leads?businessId=${businessId}`)
      .then((r) => r.json()).then((d) => { setLeads(d.leads || []); setLoaded(true); });
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, status }),
    });
    load();
  }

  const list = filter ? leads.filter((l) => l.status === filter) : leads;

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Todo contato que chega pela sua página cai aqui.</p>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setFilter('')} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === '' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>Todos ({leads.length})</button>
        {STATUS.map((s) => (
          <button key={s.id} onClick={() => setFilter(s.id)} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === s.id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>{s.label}</button>
        ))}
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : list.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl text-center py-14 px-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="user" size={24} /></div>
          <h3 className="font-bold mt-3">Ainda não existem leads</h3>
          <p className="text-sm text-zinc-500 mt-1">Quando um visitante entrar em contato, ele aparece aqui.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((l) => (
            <div key={l.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <p className="font-bold text-sm">{l.name || '(sem nome)'} {l.phone && <span className="font-normal text-zinc-500">· {l.phone}</span>}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">via {l.origin}{l.interest && ` · “${l.interest.slice(0, 80)}”`}</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS.find((s) => s.id === l.status)?.cls}`}>
                  {STATUS.find((s) => s.id === l.status)?.label}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <select value={l.status} onChange={(e) => setStatus(l.id, e.target.value)}
                  className="text-xs font-bold bg-zinc-100 rounded-lg px-2.5 py-2">
                  {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                {l.phone && (
                  <a href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                    className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg">Chamar no WhatsApp</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
