// Local synthetic fixture only. Never run against a deployment or production DB.
// Cria UMA clínica sintética com profissionais, serviços, disponibilidade e
// alguns atendimentos sintéticos — apenas para validar layout/scroll da Agenda
// em navegador real. Nada disso toca Supabase/produção: o servidor roda com
// banco local em arquivo (INSTALINK_DB_FILE) e o script recusa qualquer
// DATABASE_URL ou host remoto.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const base = process.env.DESIGN_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || process.env.DATABASE_URL) {
  throw Error('Local isolated server only; DATABASE_URL forbidden.');
}
const file = process.env.DESIGN_TEST_FIXTURE || path.join(os.homedir(), '.cache/agenda-viewport/fixture.json');
try {
  await fs.access(file);
  throw Error('Fixture already exists; reuse it, do not duplicate accounts.');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

const stamp = Date.now().toString(36);
const password = randomBytes(18).toString('hex');
let token = '';
async function api(p, body, method = 'POST', auth = token) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw Error(`${method} ${p}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const owner = { email: `agenda-view-${stamp}@example.invalid`, password, name: 'Gestora · viewport' };
token = (await api('/api/auth/register', owner)).token;
const business = await api('/api/businesses', {
  name: 'Clínica Aurora · viewport', slug: `agviewport${stamp}`, niche: 'clinica', modes: ['services', 'bookings'],
});
const b = business.businessId;

// Profissionais sintéticos: p1 COM foto real (prova de avatar), p2/p3 sem foto
// (prova do fallback de iniciais). p3 com nome longo para o cabeçalho da semana.
const p1 = randomUUID(), p2 = randomUUID(), p3 = randomUUID();
await api('/api/catalog', { businessId: b, action: 'professional.save', id: p1, name: 'Helena · sintética', role: 'Clínica geral', photo: '/demo/clinic-illustrative.svg' });
await api('/api/catalog', { businessId: b, action: 'professional.save', id: p2, name: 'Pedro · sintético', role: 'Atendimento' });
await api('/api/catalog', { businessId: b, action: 'professional.save', id: p3, name: 'Marina Albuquerque · sintética', role: 'Retorno' });

const svcA = randomUUID(), svcB = randomUUID();
await api('/api/catalog', {
  businessId: b, action: 'service.save', id: svcA, name: 'Consulta demonstrativa', durationMin: 30, price: 0,
  showPrice: false, bookable: true, professionalIds: [p1, p2, p3],
});
await api('/api/catalog', {
  businessId: b, action: 'service.save', id: svcB, name: 'Retorno demonstrativo', durationMin: 30, price: 0,
  showPrice: false, bookable: true, professionalIds: [p1],
});

// Grade sintética: 08:00–18:00 todos os dias (a grade tem ~1280px de altura
// interna — excede qualquer viewport alvo e prova o scroll interno).
await api('/api/catalog', {
  businessId: b, action: 'availability.save', scope: { professionalId: '', serviceId: '' },
  rules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '18:00', slotMin: 30 })),
});

// Atendimentos sintéticos (fixtures locais — nada de agenda real).
const today = new Date().toISOString().slice(0, 10);
const date = new Date(new Date(`${today}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
const bookings = [];
for (const [pro, time, name, phone, serviceId] of [
  [p1, '09:00', 'Ana · paciente sintética', '21999990001', svcA],
  [p2, '10:30', 'Rafael · paciente sintético', '21999990002', svcA],
  [p3, '14:00', 'Bia · paciente sintética', '21999990003', svcB],
]) {
  const r = await api('/api/bookings', {
    businessId: b, serviceId, date, time, professionalId: pro,
    customerName: name, customerPhone: phone,
  });
  bookings.push(r.bookingId);
}

await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, JSON.stringify({ base, b, owner, date, p1, p2, p3, svcA, svcB, bookings }, null, 2), { mode: 0o600 });
console.log('Synthetic agenda-viewport fixture ready:', file);
