// ═══════════════════════════════════════════════════════════════
// Fixture SINTÉTICA da QA da Entrega 2 (Cliente 360 · Atendimento · Registro).
// Só roda contra servidor LOCAL com banco em arquivo (DATABASE_URL proibido) e
// cria tudo pela API real — autoria clínica, snapshot de finalização e trilha
// de auditoria nascem pelos mesmos caminhos do produto.
//
// Uso:
//   GODOUTOR_DB_FILE=/tmp/e2.json npm run dev   (outro terminal)
//   E2_BASE_URL=http://127.0.0.1:3000 node scripts/seed-entrega2-qa.mjs
// Saída: ~/.cache/entrega2/fixture.json (ids + credenciais descartáveis).
// ═══════════════════════════════════════════════════════════════
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

const base = process.env.E2_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || process.env.DATABASE_URL) {
  throw Error('Servidor local isolado apenas; DATABASE_URL proibido.');
}
const file = process.env.E2_FIXTURE || path.join(os.homedir(), '.cache/entrega2/fixture.json');
try { await fs.access(file); throw Error('Fixture já existe; reutilize, não duplique contas.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }

const stamp = Date.now().toString(36);
const password = randomBytes(12).toString('hex');
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

const owner = { email: `owner-${stamp}@example.invalid`, password, name: 'Hernani · gestor QA' };
token = (await api('/api/auth/register', owner)).token;
const business = await api('/api/businesses', {
  name: 'Clínica Vet Aurora · QA', slug: `vetaurora${stamp}`, niche: 'pet', clinicType: 'veterinaria', modes: ['services', 'bookings'],
});
const b = business.businessId;
await api(`/api/businesses/${b}`, { businessTimezone: 'America/Sao_Paulo' }, 'PATCH');

const proId = randomUUID();
const serviceId = randomUUID();
await api('/api/catalog', { businessId: b, action: 'professional.save', id: proId, name: 'Dra. Michelle Souza', role: 'Médica veterinária' });
await api('/api/catalog', { businessId: b, action: 'service.save', id: serviceId, name: 'Consulta clínica', description: 'Consulta veterinária sintética.', durationMin: 30, price: 18000, bookable: true, professionalIds: [proId] });
await api('/api/catalog', { businessId: b, action: 'availability.save', scope: { professionalId: '', serviceId: '' }, rules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '23:59', slotMin: 30 })) });

const vet = { email: `vet-${stamp}@example.invalid`, password };
await api('/api/team', { businessId: b, name: 'Dra. Michelle Souza', email: vet.email, password, role: 'PROFISSIONAL', professionalId: proId });

// Tutor principal (Bernardo) + um segundo cliente para a lista.
const contact = await api('/api/contacts', {
  businessId: b, name: 'Bernardo Almeida', phone: '21987650011', email: 'bernardo.almeida@example.invalid',
  note: 'Prefere contato por WhatsApp no fim da tarde.',
  profile: { birthDate: '1986-04-12', cpf: '529.982.247-25', gender: '', adminNote: 'Prefere contato por WhatsApp no fim da tarde.', tags: ['Indicação', 'Plano Pet'] },
});
const contactId = contact.contact?.id || contact.id || contact.contactId;
await api('/api/contacts', { businessId: b, name: 'Carolina Prado', phone: '21987650022', email: 'carolina@example.invalid' });

const thor = await api('/api/pets', { businessId: b, action: 'create', tutorId: contactId, pet: { name: 'Thor', species: 'cachorro', breed: 'Golden Retriever', sex: 'M', birthDate: '2019-03-02', weightKg: 31.4, notes: 'Dermatite atópica em acompanhamento.' } });
const thorId = thor.pet?.id || thor.id;
await api('/api/pets', { businessId: b, action: 'create', tutorId: contactId, pet: { name: 'Luna', species: 'gato', breed: 'SRD', sex: 'F', birthDate: '2021-08-20', weightKg: 4.2, notes: '' } });

const today = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // dia local (UTC-3)
const plusDays = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nowLocal = new Date(Date.now() - 3 * 3600000);
/** Próximo slot de 30 min a partir de agora + offset, com a DATA local correta. */
const slot = (offsetMin) => {
  const d = new Date(nowLocal.getTime() + offsetMin * 60000);
  const m = d.getUTCMinutes() < 30 ? '00' : '30';
  return { date: d.toISOString().slice(0, 10), time: `${String(d.getUTCHours()).padStart(2, '0')}:${m}` };
};
const book = (date, time) => api('/api/bookings', {
  businessId: b, asOwner: true, serviceId, date, time, professionalId: proId, customerName: 'Bernardo Almeida',
  customerPhone: '21987650011', customerEmail: 'bernardo.almeida@example.invalid', contactId, petId: thorId, petName: 'Thor',
});

// Antecedência mínima da unidade pode recusar slots próximos: avança de 30 em
// 30 min até o primeiro horário aceito pela MESMA regra da agenda.
async function bookNext(fromMin) {
  for (let off = fromMin; off < fromMin + 24 * 60; off += 30) {
    const s = slot(off);
    try { return { ...(await book(s.date, s.time)), off }; } catch (e) { if (!/409|passou/.test(e.message)) throw e; }
  }
  throw Error('Nenhum horário livre nas próximas 24 h.');
}
const finalBooking = await bookNext(40);
const liveBooking = await bookNext(finalBooking.off + 30);
const nextBooking = await book(plusDays(9), '10:00');
for (const id of [finalBooking.bookingId, liveBooking.bookingId]) {
  await api('/api/bookings', { businessId: b, id, action: 'check-in' }, 'PATCH');
}

const vetToken = (await api('/api/auth/login', { email: vet.email, password }, 'POST', '')).token;
const clinicalFull = {
  anamnesis: { history: 'Prurido intenso há 10 dias, piora à noite. Lambedura de patas.', diet: 'Ração super premium', appetite: 'usual', waterIntake: 'changed', vomiting: 'no', diarrhea: 'no', medicationsReported: 'Nenhuma', allergiesReported: 'Suspeita alimentar (frango)', observations: 'Banho semanal com shampoo neutro.' },
  assessment: { veterinary: { weightKg: 31.4, temperatureC: 38.6, heartRateBpm: 96, respiratoryRateRpm: 24, hydration: 'Normal', mucousMembranes: 'Róseas', capillaryRefillSeconds: 2, bodyCondition: '5/9', physicalExam: 'Eritema em região axilar e interdigital; otite externa bilateral leve.' } },
  problems: [{ id: randomUUID(), kind: 'diagnosis', label: 'Dermatite atópica canina', notes: '' }, { id: randomUUID(), kind: 'problem', label: 'Otite externa bilateral', notes: '' }],
  plan: { conduct: 'Oclacitinib 16 mg 1x/dia por 14 dias; limpeza otológica 2x/semana; dieta hipoalergênica por 8 semanas.' },
  procedures: [{ id: randomUUID(), name: 'Citologia otológica', notes: '' }],
};

async function startEncounter(bookingId) {
  return (await api('/api/encounters', { businessId: b, bookingId }, 'POST', vetToken)).encounter;
}
// 1) Atendimento FINALIZADO (snapshot + nota complementar).
let fin = await startEncounter(finalBooking.bookingId);
fin = (await api('/api/encounters', {
  businessId: b, id: fin.id, expectedVersion: fin.version,
  complaint: 'Coceira intensa e vermelhidão nas axilas.', evolution: 'Tutor relata melhora parcial após banho. Exame confirma lesões ativas.',
  guidance: 'Manter a dieta sem frango. Retornar se houver piora da coceira.', followUpMode: 'interval', followUpDays: 15,
  internalNote: 'Avaliar custo do tratamento com o tutor.', clinical: clinicalFull,
}, 'PATCH', vetToken)).encounter;
fin = (await api('/api/encounters', { businessId: b, id: fin.id, action: 'finalize', expectedVersion: fin.version, idempotencyKey: randomUUID() }, 'PATCH', vetToken)).encounter;
fin = (await api('/api/encounters', { businessId: b, id: fin.id, action: 'addendum', expectedVersion: fin.version, text: 'Tutor confirmou por telefone a compra da medicação.' }, 'PATCH', vetToken)).encounter;

// 2) Atendimento EM ANDAMENTO (timer real a partir do startedAt do servidor).
let live = await startEncounter(liveBooking.bookingId);
live = (await api('/api/encounters', {
  businessId: b, id: live.id, expectedVersion: live.version,
  complaint: 'Retorno da dermatite; tutor relata menos coceira.', evolution: 'Pele com menos eritema.',
  guidance: 'Continuar a limpeza otológica 2x por semana.',
  clinical: { anamnesis: { history: 'Seguiu a medicação conforme prescrito.' }, plan: { conduct: 'Reduzir oclacitinib para dias alternados.' } },
}, 'PATCH', vetToken)).encounter;

try {
  await api('/api/finance', { businessId: b, action: 'create', entry: { kind: 'receita', description: 'Consulta clínica · Thor', amount: 18000, status: 'pago', paidAt: today, contactId, method: 'pix' } });
} catch (e) { console.warn('finance opcional:', e.message); }

await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, JSON.stringify({
  base, b, owner, vet, contactId, thorId, proId, serviceId, today,
  finalEncounterId: fin.id, liveEncounterId: live.id, liveBookingId: liveBooking.bookingId,
  finalBookingId: finalBooking.bookingId, nextBookingId: nextBooking.bookingId,
}, null, 2), { mode: 0o600 });
console.log('Fixture Entrega 2 pronta:', file);
