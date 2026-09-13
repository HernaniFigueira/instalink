#!/usr/bin/env node
// Master da plataforma — promove/rebaixa um usuário pelo E-MAIL.
// Uso: node scripts/master.mjs email@dominio.com [--revoke]
// Nunca existe senha mestra no código: o acesso é um PAPEL no banco,
// validado a cada requisição (e MASTER_EMAILS ainda pode autorizar por env).
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const email = (process.argv[2] || '').trim().toLowerCase();
const revoke = process.argv.includes('--revoke');
if (!email) {
  console.error('Uso: node scripts/master.mjs email@dominio.com [--revoke]');
  process.exit(1);
}

async function readDoc() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = new pg.Client({ connectionString: url, ssl: process.env.PGSSLMODE === 'disable' ? false : undefined });
    await client.connect();
    const r = await client.query('select doc from instalink_doc where id = 1');
    await client.end();
    if (!r.rows.length) throw new Error('Documento do banco não encontrado.');
    return { doc: r.rows[0].doc, save: async (doc) => {
      const c = new pg.Client({ connectionString: url, ssl: process.env.PGSSLMODE === 'disable' ? false : undefined });
      await c.connect();
      await c.query('update instalink_doc set doc = $1, updated_at = now() where id = 1', [doc]);
      await c.end();
    } };
  }
  const file = path.join(process.cwd(), 'data', 'instalink.db.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { doc, save: async (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2)) };
}

const { doc, save } = await readDoc();
const user = (doc.users || []).find((u) => (u.email || '').toLowerCase() === email);
if (!user) {
  console.error(`Usuário não encontrado: ${email}`);
  const list = (doc.users || []).slice(0, 20).map((u) => `  - ${u.email}`).join('\n');
  console.error(list ? `Existentes:\n${list}` : 'Nenhum usuário cadastrado.');
  process.exit(1);
}
user.role = revoke ? 'owner' : 'master';
await save(doc);
console.log(`${revoke ? 'Removido' : 'Concedido'} acesso master para ${email} (role=${user.role}).`);
