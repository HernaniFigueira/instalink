// ═══════════════════════════════════════════════════════════════
// QA UX CLOSURE — FIXTURE LOCAL (somente dados sintéticos)
// ═══════════════════════════════════════════════════════════════
// Cria a clínica sintética usada para a homologação visual da missão
// "App Shell + Agenda + Design System": profissionais, serviços, expediente,
// agendamentos com status variados, um bloqueio operacional e uma exceção de
// disponibilidade. NUNCA roda contra produção (localhost only, sem DATABASE_URL).
//
// Uso:  node scripts/qa-ux-closure-fixture.mjs
// Saída: /home/user/.cache/qa-ux/fixture.json (fora do Git)
import fs from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

const base = process.env.DESIGN_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || process.env.DATABASE_URL) {
  throw Error('Fixture local e isolada: somente servidor local, DATABASE_URL proibido.');
}
const file = process.env.QA_UX_FIXTURE || '/home/user/.cache/qa-ux/fixture.json';
try { await fs.access(file); throw Error('Fixture já existe — reutilize, não duplique contas.'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }

const stamp = Date.now().toString(36);
const password = randomBytes(18).toString('hex');
let token = '';
async function api(path, body, method = 'POST', auth = token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const owner = { email: `androni-${stamp}@example.invalid`, password, name: 'Ana Andrioni' };
token = (await api('/api/auth/register', owner)).token;
const business = await api('/api/businesses', {
  name: 'Andrioni Veterinaria', slug: `androni${stamp}`, niche: 'clinica',
  clinicType: 'veterinaria', modes: ['services', 'bookings'],
});
const b = business.businessId;
await api(`/api/businesses/${b}`, {
  description: 'Clínica veterinária sintética para homologação visual.',
  businessTimezone: 'America/Sao_Paulo',
}, 'PATCH');

// Preços em CENTAVOS (contrato do catálogo: `clampCents`), como a UI envia.
const p1 = randomUUID(), p2 = randomUUID(), serviceId = randomUUID(), vaccineId = randomUUID();
await api('/api/catalog', { businessId: b, action: 'professional.save', id: p1, name: 'Dra. Helena Andrioni', role: 'Clínica médica veterinária' });
await api('/api/catalog', { businessId: b, action: 'professional.save', id: p2, name: 'Dr. Pedro Andrioni', role: 'Vacinação e retorno' });
await api('/api/catalog', {
  businessId: b, action: 'service.save', id: serviceId, name: 'Consulta veterinária',
  description: 'Consulta clínica sintética.', durationMin: 30, price: 18000, showPrice: true, bookable: true,
  professionalIds: [p1, p2],
});
await api('/api/catalog', {
  businessId: b, action: 'service.save', id: vaccineId, name: 'Vacinação anual',
  description: 'Imunização sintética.', durationMin: 15, price: 12000, showPrice: true, bookable: true,
  professionalIds: [p1, p2],
});
await api('/api/catalog', {
  businessId: b, action: 'availability.save', scope: { professionalId: '', serviceId: '' },
  rules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '18:00', slotMin: 15 })),
});

const date = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z');
date.setUTCDate(date.getUTCDate() + 1);
const day = date.toISOString().slice(0, 10);

// Agenda realista de veterinária: PET primeiro (o tutor fica no contexto), todos
// os atendimentos DENTRO da janela especial do dia (08:00–13:00) — a exceção de
// disponibilidade é "sai mais cedo" e por isso o sombreamento cai só à tarde.
const rows = [
  { time: '08:30', professionalId: p1, serviceId, petName: 'Mel', customerName: 'Marina Souza', customerPhone: '21987650001', status: 'pending' },
  { time: '09:00', professionalId: p2, serviceId: vaccineId, petName: 'Thor', customerName: 'Rafael Lima', customerPhone: '21987650002', status: 'confirmed' },
  { time: '09:30', professionalId: p1, serviceId, petName: 'Nina', customerName: 'Bruno Alves', customerPhone: '21987650004', status: 'confirmed' },
  { time: '10:15', professionalId: p2, serviceId, petName: 'Luna', customerName: 'Carla Mendes', customerPhone: '21987650003', status: 'pending' },
  { time: '11:00', professionalId: p1, serviceId: vaccineId, petName: 'Bidu', customerName: 'Diego Rocha', customerPhone: '21987650006', status: 'confirmed' },
  { time: '12:30', professionalId: p2, serviceId: vaccineId, petName: 'Amora', customerName: 'Ana Prado', customerPhone: '21987650005', status: 'pending' },
];
const bookings = [];
for (const row of rows) {
  const created = await api('/api/bookings', {
    businessId: b, serviceId: row.serviceId, date: day, time: row.time, professionalId: row.professionalId,
    customerName: row.customerName, customerPhone: row.customerPhone, petName: row.petName,
  });
  bookings.push({ ...row, id: created.bookingId });
  if (row.status !== 'pending') {
    await api('/api/bookings', { businessId: b, id: created.bookingId, status: row.status }, 'PATCH');
  }
}

// Bloqueio operacional real (mesma rota da UI) + exceção de disponibilidade.
const block = await api('/api/schedule-operations', {
  businessId: b, action: 'block.save',
  professionalId: p1, reason: 'Almoço da equipe',
  startAt: `${day}T12:00:00-03:00`, endAt: `${day}T13:00:00-03:00`,
});
await api('/api/catalog', {
  businessId: b, action: 'exception.save', date: day,
  professionalId: p2, closed: false, start: '08:00', end: '13:00', note: 'Congresso veterinário',
});

await fs.mkdir(new URL('.', `file://${file}`).pathname, { recursive: true });
await fs.writeFile(file, JSON.stringify({
  base, b, slug: business.slug, day, owner, serviceId, vaccineId, p1, p2, bookings,
  blockId: block?.block?.id || '',
}, null, 2), { mode: 0o600 });
console.log('Fixture QA pronta:', file);
