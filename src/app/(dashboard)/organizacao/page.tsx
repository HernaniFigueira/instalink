'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AreaLoadError } from '@/components/dashboard/AccessNotice';
import { PeriodPicker } from '@/components/dashboard/results-view';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';
import { apiGet, apiSend } from '@/lib/api-client';
import { money } from '@/lib/utils';
import type { OrganizationOverview } from '@/lib/organization-overview';
import type { PeriodSpec, PeriodKey } from '@/lib/periods';
import { DeleteEntityDialog, type DeleteTarget } from '@/components/dashboard/DeleteEntityDialog';
import { Button, Field, Input } from '@/components/ui';

type Response = {organizations:OrganizationOverview[];period:PeriodSpec;referenceTimezone:string};
export default function OrganizationPage() {
  const params=useSearchParams(), router=useRouter();
  const [data,setData]=useState<Response|null>(null), [error,setError]=useState(''), [loading,setLoading]=useState(true);
  const [adding,setAdding]=useState(params.get('add')==='1'), [name,setName]=useState(''), [address,setAddress]=useState(''), [saving,setSaving]=useState(false), [saveError,setSaveError]=useState('');
  const [deleting,setDeleting]=useState<DeleteTarget|null>(null);
  const generation=useRef(0);
  const requested=params.get('organization');
  const org=requested?data?.organizations.find(o=>o.id===requested):data?.organizations[0];
  const query=new URLSearchParams({period:params.get('period')||'30'});
  for(const key of ['from','to']) if(params.get(key)) query.set(key,params.get(key)!);
  if(requested)query.set('organizationId',requested);
  const request=query.toString();
  const load=useCallback(async()=>{const current=++generation.current;setLoading(true);setError('');const res=await apiGet<Response>(`/api/organizations?${request}`);if(current!==generation.current)return;setLoading(false);if(res.ok&&res.data)setData(res.data);else {setData(null);setError(res.message);}},[request]);
  useEffect(()=>{void load();return()=>{generation.current++;};},[load]);useRevalidateOnFocus(load);
  function changePeriod(next:{key:PeriodKey;from:string;to:string}) {
    const q=new URLSearchParams(params.toString());q.set('period',next.key==='all'?'0':next.key);q.delete('b');
    if(next.key==='custom'){q.set('from',next.from);q.set('to',next.to);}else{q.delete('from');q.delete('to');}
    router.push(`/organizacao?${q}`);
  }
  function changeOrganization(id:string) {
    const q=new URLSearchParams(params.toString());q.set('organization',id);q.delete('b');
    router.push(`/organizacao?${q}`);
  }
  async function addUnit(e:React.FormEvent) {
    e.preventDefault();if(!org||saving)return;setSaving(true);setSaveError('');
    const res=await apiSend<{businessId:string}>('/api/businesses','POST',{name,address,organizationId:org.id});setSaving(false);
    if(!res.ok){setSaveError(res.message);return;}
    window.dispatchEvent(new Event('il:business-refresh'));router.push(`/dashboard?b=${res.data?.businessId}`);
  }
  if(error)return <AreaLoadError area="Organização" message={error} onRetry={load}/>;
  if(loading)return <p role="status">Carregando visão geral da organização…</p>;
  if(!org||!data)return <p>Organização não disponível. Selecione uma organização autorizada.</p>;
  const number=(v:number|null|undefined)=>v===null||v===undefined?'Sem acesso':v;
  return <div className="space-y-5">
    <header className="flex flex-wrap justify-between items-start gap-3"><div><p className="text-sm text-[var(--text-muted)]">Visão geral da organização</p><h1 className="text-xl font-semibold">{org.name}</h1>
      <p className="text-sm text-[var(--text-muted)]">Somente as {org.units.length} filiais que você pode consultar. Escolha uma filial antes de agendar ou atender.</p></div>
      {org.canManage&&<Button onClick={()=>setAdding(!adding)}>Adicionar filial</Button>}
    </header>
    {data.organizations.length>1&&<select className="il-field-control" aria-label="Selecionar organização" value={org.id} onChange={e=>changeOrganization(e.target.value)}>{data.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>}
    {adding&&org.canManage&&<form onSubmit={addUnit} className="bg-white border rounded-lg p-4 space-y-3"><Field label="Nome da filial"><Input required value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="Endereço"><Input value={address} onChange={e=>setAddress(e.target.value)}/></Field>{saveError&&<p role="alert">{saveError}</p>}<Button disabled={saving}>{saving?'Criando…':'Criar filial'}</Button></form>}
    <PeriodPicker value={data.period} onChange={changePeriod}/>
    <p className="text-sm text-[var(--text-muted)]">{data.period.from||'Desde o início'} até {data.period.to}. Mesmas datas civis em todas as filiais; agendamentos pela data local, cadastros convertidos ao fuso indicado em cada filial. Referência de “Hoje”: {data.referenceTimezone}.</p>
    <section aria-label="Resumo consolidado" className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {[['Filiais visíveis',org.totals.units],['Agendamentos',number(org.totals.bookings)],['Concluídos',number(org.totals.completed)],['Cadastros nas filiais',number(org.totals.clients)]].map(([label,value])=><div key={label} className="bg-white border border-[var(--border)] rounded-lg p-4"><p className="text-sm text-[var(--text-muted)]">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}
      {org.totals.predictedRevenue!==undefined&&<div className="bg-white border rounded-lg p-4"><p>Receita prevista</p><strong>{money(org.totals.predictedRevenue)}</strong><p className="text-sm text-[var(--text-muted)]">Previsão de atendimentos, não pagamentos recebidos.</p></div>}
    </section>
    <p className="text-sm text-[var(--text-muted)]">Cadastros somam vínculos por filial no período, não pacientes únicos. A mesma pessoa pode ter mais de um vínculo. Totais com acesso parcial não são apresentados como zero.</p>
    <section aria-label="Filiais" className="space-y-3"><h2 className="font-semibold">Resumo por filial</h2>
      {org.units.length===0&&<p>Esta organização ainda não possui filiais.</p>}
      {org.units.map(u=><article key={u.id} className="bg-white border border-[var(--border)] rounded-lg p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{u.name}</h3><p className="text-sm text-[var(--text-muted)]">{u.address} · {u.timezone}</p></div><div className="flex flex-wrap gap-3"><Link className="workspace-link" href={`/dashboard?b=${u.id}`}>Abrir filial →</Link>{u.canAgenda&&<Link className="workspace-link" href={`/agenda?b=${u.id}`}>Abrir agenda desta filial</Link>}</div></div>
        <p className="mt-3">Agendamentos: {number(u.summary.bookings)} · Concluídos: {number(u.summary.completed)} · Cadastros: {number(u.summary.clients)}</p>{u.summary.predictedRevenue!==undefined&&<p>Receita prevista: {money(u.summary.predictedRevenue)}</p>}
        {u.canDelete&&<Button variant="danger" size="sm" className="mt-4" onClick={()=>setDeleting({kind:'business',id:u.id,organizationId:org.id,name:u.name})}>Excluir filial</Button>}
      </article>)}
    </section>
    {org.canDelete&&<section className="border border-[var(--danger-border)] rounded-lg p-4"><h2 className="font-semibold">Excluir organização</h2><p className="mb-3 text-sm">Somente quando não houver filiais ou dependências. Não exclui filiais em cascata.</p><Button variant="danger" onClick={()=>setDeleting({kind:'organization',id:org.id,organizationId:org.id,name:org.name})}>Verificar exclusão da organização</Button></section>}
    {deleting&&<DeleteEntityDialog target={deleting} onClose={()=>setDeleting(null)} onDeleted={()=>{const kind=deleting.kind;setDeleting(null);window.dispatchEvent(new Event('il:business-refresh'));if(kind==='organization')router.replace('/organizacao');else void load();}}/>}
  </div>;
}
