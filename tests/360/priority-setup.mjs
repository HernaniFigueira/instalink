// Offline extension of an isolated synthetic fixture. Never use a production DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const file=path.resolve(process.env.INSTALINK_DB_FILE||''), fixture=path.resolve(process.env.DESIGN_TEST_FIXTURE||'');
const cache=path.join(os.homedir(),'.cache')+path.sep;
if(process.env.DATABASE_URL||!file.startsWith(cache)||!fixture.startsWith(cache))throw Error('Only isolated ~/.cache files; DATABASE_URL forbidden.');
const lock=net.createServer();
await new Promise((resolve,reject)=>lock.once('error',()=>reject(Error('Stop the isolated server first.'))).listen(3000,'0.0.0.0',resolve));
try {
 const f=JSON.parse(await fs.readFile(fixture,'utf8')), db=JSON.parse(await fs.readFile(file,'utf8'));
 if(!f.owner.email.endsWith('@example.invalid')||!db.businesses.some(b=>b.id===f.b&&b.name.includes('demonstração')))throw Error('Synthetic fixture required.');
 const base=db.bookings.find(b=>b.id===f.bookingId), service=db.services.find(s=>s.id===f.serviceId);
 if(!base||!service)throw Error('Missing synthetic booking/service.');
 const shortId='priority-short-service';
 if(!db.services.some(s=>s.id===shortId))db.services.push({...service,id:shortId,name:'Consulta curta sintética',durationMin:15});
 const outsideDate=new Date(new Date(f.date+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
 const add=(id,date,time,serviceId,professionalId,name)=>{if(!db.bookings.some(b=>b.id===id))db.bookings.push({...base,id,date,time,serviceId,professionalId,customerName:name,bookingKind:'fit_in',fitInReason:'Fixture sintética de geometria; não é reserva de produção.'});};
 add('priority-short-a',f.date,'10:00',shortId,f.p1,'Ana · consulta curta sintética');
 add('priority-short-b',f.date,'10:00',shortId,f.p1,'Bia · simultânea sintética');
 add('priority-short-c',f.date,'10:15',shortId,f.p1,'Caio · consulta curta sintética');
 add('priority-early',outsideDate,'06:30',f.serviceId,f.p1,'Cedo · fora do expediente');
 add('priority-late',outsideDate,'20:00',f.serviceId,f.p2,'Tarde · fora do expediente');
 if(!db.exceptions.some(e=>e.id==='priority-exception'))db.exceptions.push({id:'priority-exception',businessId:f.b,date:outsideDate,closed:false,start:'05:00',end:'21:30',note:'Janela excepcional sintética fora do expediente.'});
 await fs.writeFile(file,JSON.stringify(db),{mode:0o600});
 await fs.writeFile(fixture,JSON.stringify({...f,outsideDate}),{mode:0o600});
 console.log('Synthetic short, concurrent and out-of-hours fixtures prepared.');
} finally {lock.close();}
