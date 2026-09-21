// Offline seed of DISCONNECTED conversation history in a local synthetic DB.
// Run after test:360:setup, with the isolated server STOPPED. No provider credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const dbFile=path.resolve(process.env.INSTALINK_DB_FILE||'');
const fixtureFile=path.resolve(process.env.DESIGN_TEST_FIXTURE||'');
const cache=path.join(os.homedir(),'.cache')+path.sep;
if(process.env.DATABASE_URL||!dbFile.startsWith(cache)||!fixtureFile.startsWith(cache))throw Error('Only isolated files under ~/.cache; DATABASE_URL forbidden.');
const server=net.createServer();
await new Promise((resolve,reject)=>server.once('error',()=>reject(Error('Stop the local server before offline seeding.'))).listen(3000,'0.0.0.0',resolve));
try {
  const f=JSON.parse(await fs.readFile(fixtureFile,'utf8'));
  const db=JSON.parse(await fs.readFile(dbFile,'utf8'));
  if(!f.owner.email.endsWith('@example.invalid')||!db.businesses.some(b=>b.id===f.b&&b.name.includes('demonstração')))throw Error('Synthetic 360 fixture required.');
  const now=new Date().toISOString();
  for(let i=1;i<=2;i++) {
    const id=`direction-synthetic-chat-${i}`;
    if(db.conversations.some(c=>c.id===id))continue;
    db.conversations.push({id,businessId:f.b,channel:'whatsapp',contactId:'',customerId:'',name:i===1?'Marina · conversa sintética':'Rafael · conversa sintética',phone:i===1?'21987654321':'21987654322',status:'open',mode:'human',unread:0,lastMessageAt:now,lastMessagePreview:'Histórico sintético para revisão. Canal desconectado.',createdAt:now});
    db.messages.push({id:`${id}-msg`,businessId:f.b,conversationId:id,direction:'in',body:'Olá! Este histórico sintético serve apenas para revisar o painel. Não há conexão com um canal real.',status:'delivered',externalId:'',by:'contact',at:now});
  }
  await fs.writeFile(dbFile,JSON.stringify(db),{mode:0o600});
  console.log('Disconnected synthetic histories ready. No external channel configured.');
} finally {server.close();}
