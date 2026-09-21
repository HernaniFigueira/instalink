// Local synthetic fixture only. Never run against a deployment or production DB.
import fs from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
const base = process.env.DESIGN_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || process.env.DATABASE_URL) throw Error('Local isolated server only; DATABASE_URL forbidden.');
const file = process.env.DESIGN_TEST_FIXTURE || '/home/user/.cache/360/fixture.json';
try { await fs.access(file); throw Error('Fixture already exists; reuse it, do not duplicate accounts.'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
const stamp = Date.now().toString(36), password = randomBytes(18).toString('hex');
let token = '';
async function api(path, body, method = 'POST', auth = token) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type':'application/json', ...(auth ? {Authorization:`Bearer ${auth}`} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  const data=await res.json(); if(!res.ok) throw Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
}
const owner={email:`owner-${stamp}@example.invalid`,password,name:'Gestora · demonstração'};
token=(await api('/api/auth/register',owner)).token;
const business=await api('/api/businesses',{name:'Clínica Aurora · demonstração',slug:`aurora${stamp}`,niche:'clinica',modes:['services','bookings']});
const b=business.businessId;
const other=await api('/api/businesses',{name:'Clínica Aurora · unidade Jardim',slug:`jardim${stamp}`,organizationId:business.organizationId,niche:'clinica',modes:['services','bookings']});
await api(`/api/businesses/${b}`,{description:'Cuidado que começa com uma boa conversa. Conheça nossa equipe e encontre um horário para seu atendimento. Conteúdo sintético para revisão de interface.',logo:'/demo/clinic-illustrative.svg',address:'Rua de demonstração, 120 · Centro',businessTimezone:'America/Sao_Paulo'},'PATCH');
const p1=randomUUID(),p2=randomUUID(),serviceId=randomUUID();
await api('/api/catalog',{businessId:b,action:'professional.save',id:p1,name:'Helena · profissional sintética',role:'Clínica geral'});
await api('/api/catalog',{businessId:b,action:'professional.save',id:p2,name:'Pedro · profissional sintético',role:'Atendimento'});
await api('/api/catalog',{businessId:b,action:'service.save',id:serviceId,name:'Consulta demonstrativa',description:'Uma conversa inicial com a equipe. Serviço sintético, sem orientação médica.',durationMin:30,price:0,showPrice:false,bookable:true,professionalIds:[p1,p2]});
await api('/api/catalog',{businessId:b,action:'availability.save',scope:{professionalId:'',serviceId:''},rules:Array.from({length:7},(_,weekday)=>({weekday,start:'08:00',end:'18:00',slotMin:30}))});
const roles={};
for(const role of ['SECRETARIA','PROFISSIONAL','ADMIN','VIEWER']) {
 const email=`${role.toLowerCase()}-${stamp}@example.invalid`;
 await api('/api/team',{businessId:b,name:`${role} · demonstração`,email,password,role,...(role==='PROFISSIONAL'?{professionalId:p1}:{})});
 roles[role]={email,password};
}
const page=(await api(`/api/pages?businessId=${b}`,null,'GET')).page;
page.blocks=[{id:'profile-demo',type:'profile',enabled:true,order:0,settings:{}},{id:'cta-demo',type:'cta',enabled:true,order:1,settings:{label:'Agendar atendimento',target:'booking'}},{id:'services-demo',type:'services',enabled:true,order:2,settings:{title:'Encontre seu atendimento'}},{id:'professionals-demo',type:'professionals',enabled:true,order:3,settings:{title:'Quem cuida de você'}},{id:'faq-demo',type:'faq',enabled:true,order:4,settings:{title:'Antes da consulta',items:[{q:'Como agendar?',a:'Escolha o serviço e um horário disponível. Confira os dados antes de confirmar.'}]}},{id:'text-demo',type:'text',enabled:true,order:5,settings:{title:'Um espaço para acolher',body:'Esta clínica e seus dados são uma demonstração sintética da experiência.'}}];
await api('/api/pages',{businessId:b,blocks:page.blocks,theme:page.theme,published:true,about:{enabled:true,title:'Cuidado com atenção',text:'Da primeira visita ao retorno, uma experiência organizada para você e sua família. Demonstração de interface, não uma clínica real.',image:''}} ,'PUT');
const days=await api(`/api/bookings?businessId=${b}&serviceId=${serviceId}&date=${new Date().toISOString().slice(0,10)}`,null,'GET','');
const date=new Date(new Date((days.today||new Date().toISOString().slice(0,10))+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
const customer={name:'Marina · paciente sintética',phone:'21987654321',email:`paciente-${stamp}@example.invalid`,password};
await api('/api/customer/register',{...customer,businessId:b},'POST','');
const booking=await api('/api/bookings',{businessId:b,serviceId,date,time:'09:00',professionalId:p1,customerName:customer.name,customerPhone:customer.phone,customerEmail:customer.email});
await api('/api/bookings',{businessId:b,serviceId,date,time:'09:30',professionalId:p2,customerName:'Rafael · paciente sintético',customerPhone:'21987654322'});
const encounter=(await api('/api/encounters',{businessId:b,bookingId:booking.bookingId})).encounter;
await api('/api/encounters',{businessId:b,id:encounter.id,expectedVersion:encounter.version,complaint:'Registro sintético para testar apresentação e impressão.',evolution:'Conteúdo da via do paciente. '+('Linha de orientação sintética, sem conteúdo clínico real.\n'.repeat(70)),guidance:'MARCADOR-PUBLICO-FINAL',internalNote:'SEGREDO-INTERNO-NAO-IMPRIMIR'},'PATCH');
await fs.mkdir(new URL('.',`file://${file}`).pathname,{recursive:true});
await fs.writeFile(file,JSON.stringify({base,b,other:other.businessId,slug:business.slug,owner,roles,customer,serviceId,p1,p2,date,bookingId:booking.bookingId,encounterId:encounter.id},null,2),{mode:0o600});
console.log('Synthetic fixture ready:',file);
