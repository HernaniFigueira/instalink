import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { readDB, updateDB } from '@/lib/db';
import { COOKIE_NAME, getBearerToken, verifyPassword } from '@/lib/auth';
import { pushAudit } from '@/lib/audit';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { authorizationHash, deletionImpact, deletionTarget, type EntityKind } from '@/lib/entity-deletion';
import type { DB } from '@/lib/types';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const validKind=(v:unknown):v is EntityKind=>v==='business'||v==='organization';
/** Required for both cookie and bearer clients: same-origin JSON + non-simple action header. */
function safeMutation(req:NextRequest) {
  try {
    const origin=new URL(req.headers.get('origin')||'');
    const protocol=(req.headers.get('x-forwarded-proto')||req.nextUrl.protocol.replace(':','')).split(',')[0].trim();
    return ['http','https'].includes(protocol) && origin.origin===`${protocol}://${req.headers.get('host')||req.nextUrl.host}`
      && (!req.headers.get('sec-fetch-site') || req.headers.get('sec-fetch-site')==='same-origin')
      && req.headers.get('x-instalink-action')==='delete-empty-entity'
      && req.headers.get('content-type')?.split(';')[0]==='application/json';
  } catch{return false;}
}
function liveSession(db:DB,req:NextRequest,userId:string) {
  const candidates=[req.cookies.get(COOKIE_NAME)?.value,getBearerToken(req)];
  return candidates.map(id=>db.sessions.find(s=>s.id===id && s.userId===userId && Date.parse(s.expiresAt)>Date.now())).find(Boolean);
}
export async function GET(req:NextRequest) {
  const auth=await requireUser(req);if(!auth.ok)return auth.res;
  const q=req.nextUrl.searchParams,kind=q.get('kind'),id=q.get('id')||'',org=q.get('organizationId')||'';
  if(!validKind(kind))return reply({error:'Tipo de alvo inválido.'},400);
  try {const db=await readDB(),user=db.users.find(u=>u.id===auth.user.id);if(!user||!liveSession(db,req,user.id)||!deletionTarget(db,user,kind,id,org))return reply({error:'Você não pode excluir este alvo.'},403);
    return reply(deletionImpact(db,kind,id));
  }catch{return reply({error:'Não foi possível verificar as dependências.'},500);}
}
/** Password is checked now by existing scrypt; grant lasts two minutes, scoped to session/user/action/target. */
export async function POST(req:NextRequest) {return mutate(req,false);}
/** The grant is consumed inside the SAME transaction that rechecks ownership/dependencies and deletes. */
export async function DELETE(req:NextRequest) {return mutate(req,true);}
async function mutate(req:NextRequest,execute:boolean) {
  if(!safeMutation(req))return reply({error:'Origem ou proteção da requisição inválida.'},403);
  const auth=await requireUser(req);if(!auth.ok)return auth.res;
  const rl=rateLimit(`entity-deletion:${ipFrom(req)}:${auth.user.id}`,30,60000);
  if(!rl.ok)return reply({error:'Aguarde antes de tentar novamente.'},429);
  try {
    const text=await req.text();if(text.length>8192)return reply({error:'Requisição inválida.'},400);
    let body;try{body=JSON.parse(text);}catch{return reply({error:'JSON inválido.'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Requisição inválida.'},400);
    const {kind,id,organizationId,name}=body;
    if(!validKind(kind)||typeof id!=='string'||typeof organizationId!=='string'||typeof name!=='string'||id.length>128||organizationId.length>128||name.length>100)return reply({error:'Alvo inválido.'},400);
    const result=await updateDB(db=>{
      const now=Date.now(),user=db.users.find(u=>u.id===auth.user.id),session=liveSession(db,req,auth.user.id);
      if(!user||!session)return {status:401,data:{error:'Sessão expirada.'}};
      const target=deletionTarget(db,user,kind,id,organizationId);
      const denied=(message:string,status=403)=>{pushAudit(db,{action:'entity.deletion_denied',actor:user,meta:{kind,targetId:id,organizationId}});return {status,data:{error:message}};};
      if(!target)return denied('Alvo indisponível ou sem permissão.');
      if(name!==target.name)return denied('Digite o nome exato do alvo.',400);
      const impact=deletionImpact(db,kind,id);
      if(!impact.allowed)return {status:409,data:{error:'Exclusão bloqueada por dependências.',impact}};
      db.deletionAuthorizations=(db.deletionAuthorizations||[]).filter(g=>g.expiresAt>now);
      if(!execute) {
        // Persisted throttling is shared by instances, not just the best-effort IP bucket.
        const failures=db.audit.filter(a=>a.action==='entity.deletion_password_failed'&&a.actorUserId===user.id&&Date.parse(a.at)>now-15*60000).length;
        if(failures>=5)return {status:429,data:{error:'Limite de tentativas. Aguarde 15 minutos.'}};
        if(typeof body.password!=='string'||body.password.length>512||!verifyPassword(body.password,user.passwordHash)) {
          pushAudit(db,{action:'entity.deletion_password_failed',actor:user,meta:{kind,targetId:id,organizationId}});
          return {status:400,data:{error:'Senha atual incorreta.'}};
        }
        const token=randomBytes(32).toString('hex'),expiresAt=now+120000;
        // A new authorization for this session/target replaces older unused grants.
        db.deletionAuthorizations=db.deletionAuthorizations.filter(g=>!(g.userId===user.id&&g.sessionHash===authorizationHash(session.id)&&g.kind===kind&&g.targetId===id));
        db.deletionAuthorizations.push({tokenHash:authorizationHash(token),userId:user.id,sessionHash:authorizationHash(session.id),kind,targetId:id,organizationId,targetName:name,expiresAt,usedAt:0});
        pushAudit(db,{action:'entity.deletion_authorized',actor:user,meta:{kind,targetId:id,organizationId}});
        return {status:200,data:{token,expiresAt}};
      }
      const grant=typeof body.token==='string'&&body.token.length===64?db.deletionAuthorizations.find(g=>g.tokenHash===authorizationHash(body.token)):undefined;
      if(!grant||grant.usedAt||grant.userId!==user.id||grant.sessionHash!==authorizationHash(session.id)||grant.kind!==kind||grant.targetId!==id||grant.organizationId!==organizationId||grant.targetName!==target.name)return denied('Confirmação expirada, já utilizada ou inválida. Confirme novamente.',409);
      grant.usedAt=now;
      if(kind==='business') {
        db.businesses=db.businesses.filter(b=>b.id!==id);
        // Impact has proven these are untouched default templates, never patient/history records.
        db.pages=db.pages.filter(p=>p.businessId!==id);
      } else db.organizations=db.organizations.filter(o=>o.id!==id);
      pushAudit(db,{action:'entity.deleted',actor:user,meta:{kind,targetId:id,organizationId,name,removed:impact.removes}});
      return {status:200,data:{ok:true,deleted:{kind,id}}};
    });
    return reply(result.data,result.status);
  }catch{return reply({error:'Não foi possível concluir a exclusão. Nenhum histórico foi excluído.'},500);}
}
