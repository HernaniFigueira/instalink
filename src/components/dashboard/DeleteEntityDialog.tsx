'use client';
import { useEffect,useRef,useState } from 'react';
import { Drawer,Button,Field,Input } from '@/components/ui';
import { apiGet,apiRequest } from '@/lib/api-client';
import type { DeletionImpact,EntityKind } from '@/lib/entity-deletion';
export type DeleteTarget={kind:EntityKind;id:string;organizationId:string;name:string};
export function DeleteEntityDialog({target,onClose,onDeleted}:{target:DeleteTarget;onClose:()=>void;onDeleted:()=>void}) {
  const [impact,setImpact]=useState<DeletionImpact|null>(null),[error,setError]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
  const locked=useRef(false);
  const label=target.kind==='business'?'filial':'organização';
  useEffect(()=>{let live=true;apiGet<DeletionImpact>(`/api/entity-deletion?${new URLSearchParams({kind:target.kind,id:target.id,organizationId:target.organizationId})}`).then(r=>{if(!live)return;if(r.ok)setImpact(r.data);else setError(r.message);});return()=>{live=false;};},[target]);
  async function submit(e:React.FormEvent){e.preventDefault();if(locked.current||!impact?.allowed||name!==impact.name)return;locked.current=true;setBusy(true);setError('');const secret=password;setPassword('');
    const send=(method:string,extra:Record<string,string>)=>apiRequest<{token?:string;impact?:DeletionImpact}>('/api/entity-deletion',{method,headers:{'Content-Type':'application/json','X-Instalink-Action':'delete-empty-entity'},body:JSON.stringify({...target,name,...extra})});
    try {const auth=await send('POST',{password:secret});if(!auth.ok||!auth.data?.token){if(auth.data?.impact)setImpact(auth.data.impact);setError(auth.message);return;}
      const res=await send('DELETE',{token:auth.data.token});if(!res.ok){if(res.data?.impact)setImpact(res.data.impact);setError(res.message);return;}onDeleted();
    }finally{locked.current=false;setBusy(false);}
  }
  return <Drawer open onClose={()=>{if(!locked.current)onClose();}} title={`Excluir ${label}: ${target.name}`} width="max-w-xl"><div className="p-5 space-y-4">
    <p>Exclusão definitiva de {label}. Esta ação não retira uma filial da organização nem arquiva registros.</p>
    {error&&<p role="alert" className="text-[var(--danger-fg)]">{error}</p>}
    {!impact&&!error&&<p role="status">Verificando dependências no servidor…</p>}
    {impact&&<><h3 className="font-semibold">Impacto verificado pelo servidor</h3>{impact.allowed?<ul>{impact.removes.map(r=><li key={r.label}>{r.count} · {r.label}</li>)}</ul>:<div role="alert"><p className="font-semibold">Exclusão bloqueada</p><ul>{impact.blockers.map(b=><li key={b.type}>{b.count} · {b.label}</li>)}</ul><p>Nenhum desses registros será apagado. A organização só pode ser excluída sem filiais ou vínculos.</p></div>}<p className="text-sm text-[var(--text-muted)]">{impact.retained}</p></>}
    {impact?.allowed&&<form onSubmit={submit} className="space-y-4" autoComplete="off"><Field label={`Digite o nome exato: ${impact.name}`}><Input value={name} onChange={e=>setName(e.target.value)} required disabled={busy}/></Field><Field label="Senha atual"><Input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={512} disabled={busy}/></Field><Button type="submit" variant="danger" disabled={busy||!password||name!==impact.name}>{busy?'Verificando e excluindo…':`Excluir ${label} definitivamente`}</Button></form>}
  </div></Drawer>;
}
