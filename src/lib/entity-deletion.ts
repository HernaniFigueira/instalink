import { isDeepStrictEqual } from 'node:util';
import { defaultBlocks, defaultTheme } from './templates';
import { createHash } from 'node:crypto';
import type { DB, User } from './types';
import { isMasterUser } from './access-core';
export type EntityKind = 'business' | 'organization';
export const authorizationHash = (value:string) => createHash('sha256').update(value).digest('hex');
export function deletionTarget(db:DB,user:User,kind:EntityKind,id:string,organizationId:string) {
  if(isMasterUser(user))return null;
  const org=db.organizations.find(o=>o.id===organizationId && o.ownerId===user.id);
  if(!org)return null;
  if(kind==='organization')return id===org.id?org:null;
  return db.businesses.find(b=>b.id===id && b.organizationId===org.id && b.ownerId===user.id)||null;
}
const labels:Record<string,string>={businesses:'Filiais vinculadas',organizationMembers:'Vínculos de membros',pages:'Página personalizada',contacts:'Cadastros de pacientes',bookings:'Agendamentos',encounters:'Registros de atendimento',orders:'Pedidos / registros financeiros',services:'Serviços',professionals:'Profissionais',availability:'Disponibilidade',exceptions:'Exceções de horário',queue:'Fila de atendimento',members:'Acessos da equipe',conversations:'Conversas',messages:'Mensagens',integrations:'Integrações',integrationEvents:'Histórico de integrações',tasks:'Tarefas',automations:'Automações',automationRuns:'Execuções',leads:'Oportunidades',reviews:'Avaliações',events:'Eventos',pipelines:'Etapas do funil',agents:'Assistente',apiKeys:'Chaves de integração',webhooks:'Webhooks',supportSessions:'Sessões de suporte',idempotencyKeys:'Operações registradas'};
/** Conservative dependency inventory: new collections with tenant references also block. */
export function deletionImpact(db:DB,kind:EntityKind,id:string) {
  const target=kind==='business'?db.businesses.find(b=>b.id===id):db.organizations.find(o=>o.id===id);
  if(!target)throw Error('Target missing');
  const blockers:Array<{type:string;label:string;count:number}>=[];
  const add=(type:string,count:number,label=labels[type]||`Dependências: ${type}`)=>{if(count)blockers.push({type,label,count});};
  const field=kind==='business'?'businessId':'organizationId';
  function references(value:unknown):boolean {
    if(!value||typeof value!=='object')return false;
    if(Array.isArray(value))return value.some(references);
    return Object.entries(value).some(([key,v])=>key===field&&v===id || (typeof v==='object'&&references(v)));
  }
  for(const [key,rows] of Object.entries(db)) {
    if(['audit','deletionAuthorizations','pages'].includes(key)||!Array.isArray(rows))continue;
    add(key,rows.filter(references).length);
  }
  let defaultPages=0;
  if(kind==='business') {
    const b=db.businesses.find(b=>b.id===id)!;
    const pages=db.pages.filter(p=>p.businessId===id);
    // Only the untouched, unpublished template created with the unit is disposable.
    const withoutIds = (blocks: DB['pages'][number]['blocks']) => blocks.map(({id: _id,...block})=>block);
    defaultPages=pages.filter(p=>!!b.createdAt && p.updatedAt===b.createdAt && !b.published && isDeepStrictEqual(withoutIds(p.blocks),withoutIds(defaultBlocks(b.niche,b.modes))) && isDeepStrictEqual(p.theme,defaultTheme(b.niche))).length;
    add('pages',pages.length-defaultPages);
    add('published',b.published?1:0,'Página publicada');
    add('publicReference',db.organizations.filter(o=>o.publicBusinessId===id).length,'Página principal de organização');
    const connection=[b.whatsappIntegration,b.instagramIntegration].some(c=>c&&Object.entries(c).some(([k,v])=>k==='status'?v!=='not_connected':!!v));
    add('connection',connection?1:0,'Conexão ou histórico de canal');
    add('financial',b.subscription||b.pixKey?1:0,'Configuração financeira / assinatura');
    add('provider',b.googleApiKey||b.googlePlaceId?1:0,'Configuração de provedor');
  } else {
    const o=db.organizations.find(o=>o.id===id)!;
    add('metadata',o.publicBusinessId||Object.keys(o.metadata||{}).length?1:0,'Configuração da organização');
  }
  return {kind,id,name:target.name,organizationId:kind==='business'?(target as DB['businesses'][number]).organizationId!:id,allowed:blockers.length===0,blockers,
    removes:kind==='business'?[{label:'Filial vazia',count:1},...(defaultPages?[{label:'Página inicial não editada e não publicada',count:defaultPages}]:[])]:[{label:'Organização sem filiais',count:1}],
    retained:'A auditoria é preservada. Nenhum histórico operacional será excluído.'};
}
export type DeletionImpact=ReturnType<typeof deletionImpact>;
