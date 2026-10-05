// ═══════════════════════════════════════════════════════════════
// Fixture ADITIVA do QA F1B2 — acrescenta ao banco descartável do F1B1 o que o
// recorte B2 precisa e o F1B1 não tinha: um SEGUNDO profissional logável na
// MESMA unidade (Orlando, ligado a `pro-outro-a`) para provar por login REAL
// que "outro profissional da mesma unidade" não escreve no Encounter alheio.
// ═══════════════════════════════════════════════════════════════
// Não cria banco novo, não apaga nada, não toca dado real: lê e reescreve o
// mesmo arquivo do F1B1 (`.cache/f1b1/qa.json`), que é descartável.
//
// Uso (depois do seed do F1B1):
//   GODOUTOR_DB_FILE=.cache/f1b1/qa.json node scripts/seed-f1b1-qa.mjs
//   node scripts/seed-f1b2-qa.mjs
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';

if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent.');
const file = path.resolve(process.argv[2] || '.cache/f1b1/qa.json');
if (!file.startsWith(path.resolve('.cache/f1b1') + path.sep)) throw Error('Fixture path must stay in .cache/f1b1.');
if (!fs.existsSync(file)) throw Error('Rode antes o seed do F1B1 (este script é aditivo).');

const A = 'f1b1-vet-qa';
const password = 'GodoutorF1B12026!';
const now = new Date().toISOString();
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

if (db.users.some((user) => user.id === 'f1b2-orlando')) {
  console.log('F1B2 QA extra já aplicado — nada a fazer.');
} else {
  const salt = randomBytes(16).toString('hex');
  db.users.push({
    id: 'f1b2-orlando', name: 'Orlando Veterinário F1B2', email: 'orlando.f1b2@godoutor.local',
    passwordHash: `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    role: 'admin', createdAt: now, lastLoginAt: '',
  });
  db.members.push({
    id: 'f1b2-m-orlando', businessId: A, userId: 'f1b2-orlando', role: 'PROFISSIONAL',
    permissions: {}, note: 'Segundo profissional da MESMA unidade (QA F1B2)',
    invitedBy: 'f1b1-owner', active: true, createdAt: now, updatedAt: now,
  });
  // O profissional Orlando já existe no F1B1 (`pro-outro-a`) sem usuário: é ele
  // que ganha login agora — nenhuma identidade nova foi inventada.
  const orlando = db.professionals.find((professional) => professional.id === 'pro-outro-a');
  if (!orlando) throw Error('pro-outro-a ausente: rode o seed do F1B1 sem modificação.');
  orlando.userId = 'f1b2-orlando';
  fs.writeFileSync(file, JSON.stringify(db, null, 2), { mode: 0o600 });
  console.log(`F1B2 QA extra aplicado em ${file}`);
}
console.log('Login novo: orlando.f1b2@godoutor.local (Profissional da unidade A, NÃO é o responsável)');
