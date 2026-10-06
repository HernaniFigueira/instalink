// Local disposable fixture. Refuses remote databases and existing files.
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent.');
const file = path.resolve(process.argv[2] || '.cache/design-system/qa.json');
if (!file.startsWith(path.resolve('.cache/design-system') + path.sep)) throw Error('Fixture path must stay in .cache/design-system.');
if (fs.existsSync(file)) throw Error('QA fixture already exists; reuse it, never overwrite data.');
const now = new Date().toISOString(), b = 'andrioni-vet-qa', password = 'GodoutorQA2026!';
// DS 1.0 · QA recorrente: os atendimentos caem em HOJE (fuso da clínica), não numa
// data fixa — senão o gate de Agenda/Lista degrada em silêncio a partir do dia seguinte.
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hash = () => { const salt = randomBytes(16).toString('hex'); return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const users = [['owner','Hernani QA','owner.qa'],['recepcao','Maria Recepção','recepcao.qa'],['orlando','Orlando Veterinário','orlando.qa']].map(([id,name,email]) => ({id:`qa-${id}`,name,email:`${email}@godoutor.local`,passwordHash:hash(),role:'owner',createdAt:now,lastLoginAt:''}));
const professionals = [['orlando','Orlando Veterinário','qa-orlando',true],['michele','Michelle','',false],['hernani','Hernani','qa-owner',true]].map(([id,name,userId,followBusinessHours])=>({id:`pro-${id}`,businessId:b,name,userId,role:'Médico veterinário',active:true,photo:'',followBusinessHours}));
const services = [['consulta','Consulta clínica',30,12000],['vacina','Vacinação',30,8000],['cirurgia','Cirurgia',120,50000]].map(([id,name,durationMin,price])=>({id:`svc-${id}`,businessId:b,name,durationMin,price,description:'Orientação interna QA preservada.',professionalMode:'all',professionalIds:[],categoryId:'qa-consultas',active:true,bookable:true,image:''}));
const bookings = [['confirmed','14:00','standard'],['cancelled','15:00','standard'],['confirmed','16:00','fit_in']].map(([status,time,bookingKind],i)=>({id:`qa-book-${i}`,businessId:b,professionalId:'pro-orlando',serviceId:'svc-consulta',contactId:'qa-tutor',customerId:'',petId:'qa-pet',petName:'Thor QA',customerName:'Ana Tutora QA',customerPhone:'11999990001',date:DAY,time,startAt:`${DAY}T${Number(time.slice(0,2))+3}:00:00.000Z`,endAt:`${DAY}T${Number(time.slice(0,2))+3}:30:00.000Z`,durationMin:30,timeZone:'America/Sao_Paulo',temporalSource:'staff',bookingKind,status,note:'Dado sintético para QA',createdAt:now,updatedAt:now,history:[]}));
// DS 1.0 · §5 — o painel de FECHAMENTO CLÍNICO agora usa ActionSection/Dialog
// canônicos. Sem um atendimento no fixture não há como RENDERIZAR esse contrato
// no browser real, então o QA cria um em andamento e um já finalizado.
const encounters = [
  { id:'qa-enc-draft', businessId:b, bookingId:'qa-book-0', queueId:'', serviceId:'svc-consulta',
    professionalId:'pro-hernani', customerId:'', contactId:'qa-tutor', customerName:'Ana Tutora QA',
    date:DAY, time:'14:00', complaint:'Coceira na pele há três dias.', evolution:'Exame físico sem alterações; iniciado protocolo tópico.',
    guidance:'Retornar se não melhorar em 5 dias.', followUp:'em 5 dias', internalNote:'Tutor orientado por telefone.',
    tags:['dermatologia'], status:'draft', version:2, createdAt:now, updatedAt:now, createdBy:'qa-owner', updatedBy:'qa-owner',
    finalizedAt:'', finalizedBy:'', signedBy:'', startedAt:now, petId:'qa-pet' },
  { id:'qa-enc-done', businessId:b, bookingId:'qa-book-2', queueId:'', serviceId:'svc-consulta',
    professionalId:'pro-hernani', customerId:'', contactId:'qa-tutor', customerName:'Ana Tutora QA',
    date:DAY, time:'16:00', complaint:'Consulta de rotina.', evolution:'Animal sadio; vacinas em dia.',
    guidance:'Manter vermifugação anual.', followUp:'', internalNote:'', tags:[], status:'finalized', version:3,
    createdAt:now, updatedAt:now, createdBy:'qa-owner', updatedBy:'qa-owner',
    finalizedAt:now, finalizedBy:'qa-owner', signedBy:'Orlando Veterinário', startedAt:now, petId:'qa-pet' },
];
// Oportunidades: uma por etapa de trabalho, para RENDERIZAR a EsteiraView com os
// `Select` canônicos (filtros de responsável/prioridade, mover etapa, etc.).
const leads = [['Leandro QA','new','high'],['Bruna QA','in_progress','urgent'],['Caio QA','qualifying','medium'],['Dora QA','scheduled','low']]
  .map(([name,stageId,priority],i)=>({ id:`qa-lead-${i}`, businessId:b, customerId:'', name, phone:`1199999000${i}`,
    email:`${name.split(' ')[0].toLowerCase()}@example.invalid`, instagram:'', origin:'instagram', channel:'instagram',
    interest:'Consulta clínica', action:'Responder DM', status: stageId==='scheduled'?'converted':'new',
    createdAt:now, lastInteraction:now, stageId, assignedUserId:'qa-owner', priority,
    nextAction:'Ligar amanhã', stageHistory:[], notes:[], metadata:{} }));
const db = {users,sessions:[],businesses:[{id:b,ownerId:'qa-owner',name:'Andrioni Veterinária QA',slug:b,niche:'pet',clinicType:'veterinaria',modes:['services','bookings'],description:'Clínica descartável de homologação local',logo:'',cover:'',phone:'',whatsapp:'11999990000',email:'',instagram:'',tiktok:'',address:'',mapsUrl:'',hours:{},paymentMethods:['pix'],pixKey:'',published:false,booking:{teamMode:'auto',leadMin:0,cancelUntilMin:0,horizonDays:365,bufferMin:0},createdAt:now,updatedAt:now}],members:[{id:'qa-recepcao-member',businessId:b,userId:'qa-recepcao',role:'SECRETARIA',permissions:{},active:true,createdAt:now,updatedAt:now},{id:'qa-orlando-member',businessId:b,userId:'qa-orlando',role:'PROFISSIONAL',permissions:{},active:true,createdAt:now,updatedAt:now}],professionals,services,bookings,categories:[{id:'qa-consultas',businessId:b,name:'Consultas',kind:'service',order:0}],availability:[...Array.from({length:7},(_,weekday)=>({id:`qa-av-${weekday}`,businessId:b,professionalId:'',serviceId:'',weekday,start:'09:00',end:'18:00',slotMin:30})),{id:'qa-av-michele',businessId:b,professionalId:'pro-michele',serviceId:'',weekday:1,start:'09:00',end:'12:00',slotMin:30}],contacts:[{id:'qa-tutor',businessId:b,customerId:'',name:'Ana Tutora QA',phone:'11999990001',email:'ana@example.invalid',createdAt:now,updatedAt:now,source:'manual',lastInteraction:now,marketingOptIn:true,note:'Dados exclusivamente fictícios'}],pets:[{id:'qa-pet',businessId:b,tutorId:'qa-tutor',name:'Thor QA',photo:'',species:'cachorro',breed:'SRD',sex:'M',birthDate:'2022-01-01',weightKg:12,notes:'Paciente fictício',active:true,createdAt:now,updatedAt:now}],encounters,leads};
fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(db,null,2),{flag:'wx',mode:0o600});console.log(`DS QA ready: ${file}. Clinic: ${b}`);
