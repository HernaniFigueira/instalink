#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP / GESTÃO DO MASTER DA PLATAFORMA
// ═══════════════════════════════════════════════════════════════
//
// A conta Master NÃO usa senha universal nem credencial hardcoded.
// Ela usa o mesmo sistema de autenticação do InstaLink (e-mail +
// senha com hash scrypt + sessão).
//
// COMO O PROPRIETÁRIO DEFINE AS PRÓPRIAS CREDENCIAIS
// ─────────────────────────────────────────────────
//
// Opção A — criar Master novo com e-mail e senha escolhidos por você:
//
//   MASTER_BOOTSTRAP_EMAIL=voce@seudominio.com \
//   MASTER_BOOTSTRAP_PASSWORD='sua-senha-forte' \
//   npm run master -- --bootstrap
//
//   (opcional) MASTER_BOOTSTRAP_NAME="Seu Nome"
//
// Opção B — promover um usuário que JÁ existe (cadastrou-se em /register
//           ou foi criado por outro fluxo, com a senha que ELE definiu):
//
//   npm run master -- voce@seudominio.com
//
// Opção C — autorizar por ambiente SEM alterar o banco (fallback
//           operacional). O e-mail precisa existir e autenticar normal:
//
//   MASTER_EMAILS=voce@seudominio.com
//
// Remover privilégio Master (nunca remove o último):
//
//   npm run master -- voce@seudominio.com --revoke
//
// Nunca imprime a senha. Nunca grava senha em texto puro.
//
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function usage() {
  console.error(`Uso:
  # Promover usuário existente
  node scripts/master.mjs email@dominio.com

  # Remover privilégio Master (bloqueia se for o último)
  node scripts/master.mjs email@dominio.com --revoke

  # Bootstrap: cria OU promove com SUAS credenciais (env)
  MASTER_BOOTSTRAP_EMAIL=voce@seudominio.com \\
  MASTER_BOOTSTRAP_PASSWORD='sua-senha' \\
  node scripts/master.mjs --bootstrap

  # Listar masters atuais
  node scripts/master.mjs --list
`);
}

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const bootstrap = args.includes('--bootstrap');
const listOnly = args.includes('--list');
const emailArg = args.find((a) => !a.startsWith('--')) || '';

async function readDoc() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = new pg.Client({
      connectionString: url,
      ssl: process.env.PGSSLMODE === 'disable' ? false : undefined,
    });
    await client.connect();
    const r = await client.query('select doc from instalink_doc where id = 1');
    await client.end();
    if (!r.rows.length) throw new Error('Documento do banco não encontrado.');
    return {
      doc: r.rows[0].doc,
      save: async (doc) => {
        const c = new pg.Client({
          connectionString: url,
          ssl: process.env.PGSSLMODE === 'disable' ? false : undefined,
        });
        await c.connect();
        await c.query('update instalink_doc set doc = $1, updated_at = now() where id = 1', [doc]);
        await c.end();
      },
    };
  }
  const file = path.join(process.cwd(), 'data', 'instalink.db.json');
  if (!fs.existsSync(file)) {
    const empty = {
      users: [], sessions: [], customers: [], customerSessions: [],
      passwordResets: [], organizations: [], organizationMembers: [],
      businesses: [], pages: [], categories: [], products: [], options: [],
      optionValues: [], services: [], professionals: [], availability: [],
      exceptions: [], orders: [], bookings: [], leads: [], contacts: [],
      reviews: [], events: [], members: [], agents: [], conversations: [],
      messages: [], campaigns: [], campaignRecipients: [], audit: [],
      supportSessions: [],
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(empty, null, 2));
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(doc.users)) doc.users = [];
  if (!Array.isArray(doc.audit)) doc.audit = [];
  return {
    doc,
    save: async (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2)),
  };
}

function pushAudit(doc, action, actor, meta = {}) {
  doc.audit = doc.audit || [];
  doc.audit.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    action,
    actorUserId: actor?.id || 'cli',
    actorEmail: actor?.email || 'cli@local',
    actorRole: 'cli',
    businessId: '',
    supportSessionId: '',
    meta,
  });
}

function countRoleMasters(doc) {
  return (doc.users || []).filter((u) => u.role === 'master').length;
}

const { doc, save } = await readDoc();

if (listOnly) {
  const masters = (doc.users || []).filter((u) => u.role === 'master');
  if (!masters.length) {
    console.log('Nenhum Master (role=master) no banco.');
    console.log('Crie o primeiro com --bootstrap ou promova um e-mail existente.');
  } else {
    console.log(`Masters (${masters.length}):`);
    for (const m of masters) {
      console.log(`  - ${m.email}  (${m.name || '—'})  criado ${(m.createdAt || '').slice(0, 10)}  último acesso ${(m.lastLoginAt || 'nunca').toString().slice(0, 10)}`);
    }
  }
  process.exit(0);
}

if (bootstrap) {
  const email = String(process.env.MASTER_BOOTSTRAP_EMAIL || emailArg || '').trim().toLowerCase();
  const password = String(process.env.MASTER_BOOTSTRAP_PASSWORD || '');
  const name = String(process.env.MASTER_BOOTSTRAP_NAME || '').trim() || email.split('@')[0] || 'Master InstaLink';

  if (!email.includes('@')) {
    console.error('Defina MASTER_BOOTSTRAP_EMAIL (ou passe o e-mail) com um endereço válido.');
    usage();
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Defina MASTER_BOOTSTRAP_PASSWORD com ao menos 8 caracteres. A senha NÃO é gravada em texto puro.');
    process.exit(1);
  }

  let user = (doc.users || []).find((u) => (u.email || '').toLowerCase() === email);
  let created = false;
  if (!user) {
    user = {
      id: randomUUID(),
      name: name.slice(0, 80),
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      role: 'master',
      lastLoginAt: '',
    };
    doc.users.push(user);
    created = true;
    pushAudit(doc, 'master.created', { id: 'cli', email: 'cli@local' }, { email, via: 'bootstrap' });
  } else {
    // Atualiza a senha para a que O PROPRIETÁRIO escolheu agora (hash scrypt).
    user.passwordHash = hashPassword(password);
    if (name) user.name = name.slice(0, 80);
    const wasMaster = user.role === 'master';
    user.role = 'master';
    pushAudit(doc, wasMaster ? 'master.promoted' : 'master.promoted', { id: 'cli', email: 'cli@local' }, {
      email, via: 'bootstrap', passwordRotated: true, alreadyMaster: wasMaster,
    });
  }
  await save(doc);
  console.log(created
    ? `Master criado: ${email} (role=master). Use este e-mail e a senha que você definiu em MASTER_BOOTSTRAP_PASSWORD para entrar em /login → /master.`
    : `Master provisionado: ${email} (role=master, senha atualizada). Entre em /login com este e-mail e a senha definida.`);
  console.log('A senha NÃO é exibida e NÃO fica em texto puro no banco.');
  process.exit(0);
}

const email = emailArg.trim().toLowerCase();
if (!email) {
  usage();
  process.exit(1);
}

const user = (doc.users || []).find((u) => (u.email || '').toLowerCase() === email);
if (!user) {
  console.error(`Usuário não encontrado: ${email}`);
  console.error('Cadastre-se em /register com este e-mail (definindo sua senha) e rode de novo,');
  console.error('ou use --bootstrap com MASTER_BOOTSTRAP_EMAIL + MASTER_BOOTSTRAP_PASSWORD.');
  const list = (doc.users || []).slice(0, 20).map((u) => `  - ${u.email}`).join('\n');
  console.error(list ? `Existentes:\n${list}` : 'Nenhum usuário cadastrado.');
  process.exit(1);
}

if (revoke) {
  if (user.role !== 'master') {
    console.error(`${email} não é Master (role=${user.role || 'owner'}).`);
    process.exit(1);
  }
  if (countRoleMasters(doc) <= 1) {
    console.error('Não é possível remover o último Master da plataforma.');
    process.exit(1);
  }
  user.role = 'owner';
  pushAudit(doc, 'master.revoked', { id: 'cli', email: 'cli@local' }, { email, via: 'cli' });
  await save(doc);
  console.log(`Removido acesso master de ${email} (role=owner).`);
  process.exit(0);
}

user.role = 'master';
pushAudit(doc, 'master.promoted', { id: 'cli', email: 'cli@local' }, { email, via: 'cli' });
await save(doc);
console.log(`Concedido acesso master para ${email} (role=master).`);
console.log('Entre em /login com o e-mail e a senha que este usuário já possui → redireciona para /master.');
