'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { money } from '@/lib/utils';

type Org = { id:string; name:string; canManage:boolean; units:Array<{id:string;name:string;slug:string;address:string;published:boolean}>; totals:{units:number;bookings:number;clients:number;predictedRevenue:number} };
export default function OrganizationPage() {
  const params = useSearchParams();
  const [orgs, setOrgs] = useState<Org[]|null>(null);
  const [adding, setAdding] = useState(() => params.get('add') === '1');
  const [name, setName] = useState(''); const [address, setAddress] = useState('');
  useEffect(() => { fetch('/api/organizations').then(r => r.ok ? r.json() : Promise.reject()).then(d => setOrgs(d.organizations)).catch(() => setOrgs([])); }, []);
  const org = orgs?.[0];
  async function addUnit(e: React.FormEvent) {
    e.preventDefault(); if (!org || !name.trim()) return;
    const r = await fetch('/api/businesses', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ name, address, organizationId:org.id }) });
    const d = await r.json(); if (r.ok) window.location.assign(`/dashboard?b=${d.businessId}`);
  }
  if (!orgs) return <p className="text-sm text-zinc-500">Carregando organização…</p>;
  if (!org) return <p className="text-sm text-zinc-500">Nenhuma organização disponível.</p>;
  return <div className="space-y-5">
    <header className="flex items-end justify-between border-b border-zinc-200 pb-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Organização</p><h1 className="text-xl font-semibold text-zinc-900 mt-1">{org.name}</h1><p className="text-sm text-zinc-500 mt-1">Visão consolidada das unidades às quais você tem acesso.</p></div>{org.canManage && <button onClick={()=>setAdding(!adding)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md">+ Adicionar unidade</button>}</header>
    {adding && <form onSubmit={addUnit} className="bg-white border border-zinc-200 rounded-lg p-4 grid sm:grid-cols-3 gap-3"><input required value={name} onChange={e=>setName(e.target.value)} placeholder="Nome da unidade" className="border border-zinc-200 rounded-md px-3 py-2 text-sm"/><input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Endereço" className="border border-zinc-200 rounded-md px-3 py-2 text-sm"/><button className="bg-zinc-900 text-white rounded-md text-sm font-semibold">Criar unidade independente</button></form>}
    <section className="grid sm:grid-cols-4 gap-px bg-zinc-200 border border-zinc-200 rounded-lg overflow-hidden">{[['Unidades',org.totals.units],['Agendamentos',org.totals.bookings],['Clientes',org.totals.clients],['Receita prevista',money(org.totals.predictedRevenue)]].map(([l,v])=><div key={String(l)} className="bg-white p-4"><p className="text-xs text-zinc-500">{l}</p><p className="text-xl font-semibold mt-1">{v}</p></div>)}</section>
    <section><h2 className="text-sm font-semibold mb-2">Unidades</h2><div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">{org.units.map(u=><Link key={u.id} href={`/dashboard?b=${u.id}`} className="p-4 flex justify-between hover:bg-zinc-50"><span><strong className="text-sm">{u.name}</strong><span className="block text-xs text-zinc-500 mt-1">{u.address || 'Endereço não informado'}</span></span><span className="text-xs font-semibold text-zinc-600">Abrir unidade →</span></Link>)}</div></section>
  </div>;
}
