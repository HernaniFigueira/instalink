import './helpers/temp-db';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import * as db from '../db';
import * as auth from '../auth';
import { POST } from '@/app/api/auth/login/route';
import { GET } from '@/app/api/auth/me/route';
import { loginFailure, LOGIN_NETWORK_FAILURE } from '../login-response';
const email='synthetic-login@example.invalid', password='Synthetic-local-password';
let ip='',userId='';
function request(body: unknown = {email,password}) { return new NextRequest('https://localhost/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify(body)}); }
beforeEach(async()=>{vi.restoreAllMocks();ip=randomUUID();userId=randomUUID();const data=db.emptyDB();data.users.push({id:userId,name:'Teste',email,passwordHash:auth.hashPassword(password),role:'owner',createdAt:new Date().toISOString()});await db.writeDB(data);});
afterEach(()=>vi.restoreAllMocks());
describe('Login: status, session persistence and fail-closed storage failures',()=>{
  it('authenticates and retains the same session on repeated independent requests',async()=>{
    const response=await POST(request());expect(response.status).toBe(200);const cookie=response.headers.get('set-cookie')!;
    for(const flag of ['httponly','secure','samesite=none','partitioned'])expect(cookie.toLowerCase()).toContain(flag);
    const {token}=await response.json();expect(token).toBeTruthy();
    for(let i=0;i<2;i++){const me=await GET(new NextRequest('https://localhost/api/auth/me',{headers:{cookie:`il_session=${token}`}}));expect(me.status).toBe(200);expect((await me.json()).user.id).toBe(userId);}
    expect((await db.readDB()).audit.filter(a=>a.action==='user.login')).toHaveLength(1);
  });
  it('distinguishes invalid credentials (401), not server failure',async()=>{expect((await POST(request({email,password:'incorrect'}))).status).toBe(401);expect((await db.readDB()).sessions).toHaveLength(0);});
  it('rejects malformed input with 400',async()=>{expect((await POST(request({email,password:{secret:true}}))).status).toBe(400);expect((await POST(new NextRequest('https://localhost/api/auth/login',{method:'POST',body:'{'}))).status).toBe(400);});
  it('keeps the existing rate limit and returns 429',async()=>{for(let i=0;i<15;i++)await POST(request({email,password:'incorrect'}));expect((await POST(request())).status).toBe(429);});
  it('reports expired sessions as 401',async()=>{const token=await auth.createSession(userId);await db.updateDB(d=>{d.sessions[0].expiresAt='2000-01-01T00:00:00Z';});expect((await GET(new NextRequest('https://localhost/api/auth/me',{headers:{cookie:`il_session=${token}`}}))).status).toBe(401);});
  for(const stage of ['login_read','login_session','login_audit','session_lookup'] as const)it(`reports ${stage} outage without leaking secrets or issuing a cookie`,async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});const error=new Error('CANARY-private-cookie-password-connection-string');
    if(stage==='login_read')vi.spyOn(db,'readDB').mockRejectedValueOnce(error);
    if(stage==='login_session')vi.spyOn(auth,'createSession').mockRejectedValueOnce(error);
    if(stage==='login_audit'){vi.spyOn(auth,'createSession').mockResolvedValueOnce('never-returned-session');vi.spyOn(db,'updateDB').mockRejectedValueOnce(error);}
    if(stage==='session_lookup')vi.spyOn(auth,'userFromRequest').mockRejectedValueOnce(error);
    const response=stage==='session_lookup'?await GET(new NextRequest('https://localhost/api/auth/me')):await POST(request());
    expect(response.status).toBe(503);expect(response.headers.get('set-cookie')).toBeNull();const body=await response.json();
    expect(body.code).toBe('AUTH_UNAVAILABLE');expect(body.requestId).toBe(response.headers.get('x-request-id'));
    expect(JSON.stringify(log.mock.calls)).toContain(stage);for(const sensitive of ['CANARY',email,password,'never-returned-session']){expect(JSON.stringify(log.mock.calls)).not.toContain(sensitive);expect(JSON.stringify(body)).not.toContain(sensitive);}
  });
  it('maps HTML/non-JSON outages and failed session confirmation independently from bad passwords',()=>{
    expect(loginFailure(503)).toContain('indisponível');expect(loginFailure(502,true)).toContain('indisponível');expect(loginFailure(429)).toContain('tentativas');expect(loginFailure(401)).toContain('senha');expect(loginFailure(401,true)).toContain('sessão');expect(LOGIN_NETWORK_FAILURE).toContain('conexão');
  });
});
