// ═══════════════════════════════════════════════════════════════
// Fixture SINTÉTICA da QA da Entrega 3 (Agenda · UX por papel · E2E final).
// Só roda contra servidor LOCAL com banco em arquivo (DATABASE_URL proibido) e
// cria tudo pela API real — autenticação, vínculo Profissional↔equipe, agenda,
// check-in e autoria clínica nascem pelos mesmos caminhos do produto.
//
// O cenário PRINCIPAL do E2E (agendar, check-in, atendimento, finalização)
// NÃO é semeado aqui: ele é executado pela própria UI no navegador. A fixture
// entrega só a base (clínica, equipe, tutores, pets) e um atendimento FUTURO
// existente, usado para validar Dashboard → "Ver na agenda" na data exata.
//
// Uso:
//   GODOUTOR_DB_FILE=/home/user/.cache/e3/db.json npx next start -p 3000 -H 0.0.0.0
//   E3_BASE_URL=http://127.0.0.1:3000 node scripts/seed-entrega3-qa.mjs
// Saída: ~/.cache/e3/fixture.json (ids + credenciais descartáveis, nunca no repo).
// ═══════════════════════════════════════════════════════════════
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

const base = process.env.E3_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || process.env.DATABASE_URL) {
  throw Error('Servidor local isolado apenas; DATABASE_URL proibido.');
}
const file = process.env.E3_FIXTURE || path.join(os.homedir(), '.cache/e3/fixture.json');
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

const owner = { email: `owner-${stamp}@example.invalid`, password, name: 'Dona da Clínica QA' };
token = (await api('/api/auth/register', owner)).token;
const business = await api('/api/businesses', {
  name: 'Clínica Vet Aurora · E3', slug: `e3aurora${stamp}`, niche: 'pet', clinicType: 'veterinaria', modes: ['services', 'bookings'],
});
const b = business.businessId;
await api(`/api/businesses/${b}`, { businessTimezone: 'America/Sao_Paulo' }, 'PATCH');

// Profissionais: Michele (atende o paciente do E2E) e Orlando (controle de escopo).
const micheleId = randomUUID();
const orlandoId = randomUUID();
const serviceId = randomUUID();
await api('/api/catalog', { businessId: b, action: 'professional.save', id: micheleId, name: 'Dra. Michele Martins', role: 'Médica veterinária' });
await api('/api/catalog', { businessId: b, action: 'professional.save', id: orlandoId, name: 'Dr. Orlando Prado', role: 'Clínica geral' });
await api('/api/catalog', {
  businessId: b, action: 'service.save', id: serviceId, name: 'Consulta clínica', description: 'Consulta veterinária sintética.',
  durationMin: 30, price: 18000, bookable: true, professionalIds: [micheleId, orlandoId],
});
await api('/api/catalog', {
  businessId: b, action: 'availability.save', scope: { professionalId: '', serviceId: '' },
  rules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '23:59', slotMin: 30 })),
});

// Equipe: recepção, Michele e Orlando. Cada Profissional tem vínculo real (professionalId).
const recepcao = { email: `recepcao-${stamp}@example.invalid`, password, name: 'Maria Recepção QA' };
const michele = { email: `michele-${stamp}@example.invalid`, password, name: 'Dra. Michele Martins' };
const orlando = { email: `orlando-${stamp}@example.invalid`, password, name: 'Dr. Orlando Prado' };
await api('/api/team', { businessId: b, name: recepcao.name, email: recepcao.email, password, role: 'SECRETARIA' });
await api('/api/team', { businessId: b, name: michele.name, email: michele.email, password, role: 'PROFISSIONAL', professionalId: micheleId });
await api('/api/team', { businessId: b, name: orlando.name, email: orlando.email, password, role: 'PROFISSIONAL', professionalId: orlandoId });

// Tutores e pets. Bernardo tem DOIS pets (o E2E precisa escolher o pet correto).
const bernardo = await api('/api/contacts', {
  businessId: b, name: 'Bernardo Almeida', phone: '21987650011', email: 'bernardo.almeida@example.invalid',
  note: 'Prefere contato por WhatsApp no fim da tarde.',
});
const bernardoId = bernardo.contact?.id || bernardo.id || bernardo.contactId;
const carolina = await api('/api/contacts', { businessId: b, name: 'Carolina Prado', phone: '21987650022', email: 'carolina@example.invalid' });
const carolinaId = carolina.contact?.id || carolina.id || carolina.contactId;
const thor = await api('/api/pets', { businessId: b, action: 'create', tutorId: bernardoId, pet: { name: 'Thor', species: 'cachorro', breed: 'Golden Retriever', sex: 'M', birthDate: '2019-03-02', weightKg: 31.4, notes: 'Dermatite atópica em acompanhamento.' } });
const thorId = thor.pet?.id || thor.id;
const luna = await api('/api/pets', { businessId: b, action: 'create', tutorId: bernardoId, pet: { name: 'Luna', species: 'gato', breed: 'SRD', sex: 'F', birthDate: '2021-08-20', weightKg: 4.2, notes: '' } });
const lunaId = luna.pet?.id || luna.id;
const mel = await api('/api/pets', { businessId: b, action: 'create', tutorId: carolinaId, pet: { name: 'Mel', species: 'cachorro', breed: 'Vira-lata', sex: 'F', birthDate: '2020-01-10', weightKg: 12.8, notes: '' } });
const melId = mel.pet?.id || mel.id;

// Atendimento FUTURO já existente (Michele · Thor · +9 dias às 10:00): alvo do
// teste Dashboard → "Ver na agenda" (a data PRECISA ser a do evento).
const today = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // dia local (UTC-3)
const plusDays = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const futureDate = plusDays(9);
const futureBooking = await api('/api/bookings', {
  businessId: b, asOwner: true, serviceId, date: futureDate, time: '10:00', professionalId: micheleId,
  customerName: 'Bernardo Almeida', customerPhone: '21987650011', customerEmail: 'bernardo.almeida@example.invalid',
  contactId: bernardoId, petId: thorId, petName: 'Thor',
});

// Atendimento de HOJE já com chegada (Michele · Thor): base do cenário B do E2E
// (profissional abre o paciente que chegou). Antecedência mínima da unidade pode
// recusar horários muito próximos: avança de 30 em 30 min pela MESMA regra da agenda.
const nowLocal = new Date(Date.now() - 3 * 3600000);
const slotAt = (offsetMin) => {
  const d = new Date(nowLocal.getTime() + offsetMin * 60000);
  const m = d.getUTCMinutes() < 30 ? '00' : '30';
  return { date: d.toISOString().slice(0, 10), time: `${String(d.getUTCHours()).padStart(2, '0')}:${m}` };
};
let todayBooking = null;
for (let off = 40; off < 40 + 24 * 60 && !todayBooking; off += 30) {
  const s2 = slotAt(off);
  if (s2.date !== today) continue;
  try {
    todayBooking = await api('/api/bookings', {
      businessId: b, asOwner: true, serviceId, date: s2.date, time: s2.time, professionalId: micheleId,
      customerName: 'Bernardo Almeida', customerPhone: '21987650011', customerEmail: 'bernardo.almeida@example.invalid',
      contactId: bernardoId, petId: thorId, petName: 'Thor',
    });
  } catch (e) { if (!/409|passou/.test(e.message)) throw e; }
}
if (!todayBooking) throw Error('Sem horário de hoje livre para o cenário B.');
await api('/api/bookings', { businessId: b, id: todayBooking.bookingId, action: 'check-in' }, 'PATCH');

await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, JSON.stringify({
  base, b, owner,
  recepcao, michele, orlando,
  micheleId, orlandoId, serviceId,
  tutor: { id: bernardoId, name: 'Bernardo Almeida', phone: '21987650011' },
  otherTutor: { id: carolinaId, name: 'Carolina Prado' },
  pets: { thorId, lunaId, melId },
  today, futureDate, futureBookingId: futureBooking.bookingId,
  todayBookingId: todayBooking.bookingId, todayBookingTime: todayBooking.time || null,
}, null, 2), { mode: 0o600 });
console.log('Fixture Entrega 3 pronta:', file);
