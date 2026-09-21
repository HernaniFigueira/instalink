import './helpers/temp-db';
import { describe,it,expect } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB,writeDB } from '../db';
import { createSession,hashPassword } from '../auth';
import { GET } from '@/app/api/catalog/get/route';
import { biz } from './helpers/automation-fixtures';
describe('Agenda historical exception read remains tenant authorized',()=>{
 it('includes a past out-of-hours exception only when requested, and never another tenant',async()=>{
  const db=emptyDB();db.users.push({id:'owner',email:'synthetic@example.invalid',name:'Synthetic',passwordHash:hashPassword('Synthetic-only'),role:'owner',createdAt:''});db.businesses.push(biz('a',{ownerId:'owner'}),biz('b',{ownerId:'someone-else'}));
  for(const businessId of ['a','b'])db.exceptions.push({id:businessId,businessId,date:'2000-01-01',closed:true,start:'05:00',end:'06:00',note:'Synthetic past exception'});
  await writeDB(db);const token=await createSession('owner');
  const get=(query:string)=>GET(new NextRequest('https://localhost/api/catalog/get?'+query,{headers:{Authorization:`Bearer ${token}`}}));
  expect((await(await get('businessId=a')).json()).exceptions).toEqual([]);
  const scoped=await get('businessId=a&from=2000-01-01&to=2000-01-01');expect(scoped.status).toBe(200);expect((await scoped.json()).exceptions.map((e:any)=>e.id)).toEqual(['a']);
  expect((await get('businessId=b&from=2000-01-01')).status).toBe(403);
 });
});
