// ───────────────────────────────────────────────────────────────
// CLINICAL ACCESS — fixture descartável da homologação HTTP local.
// ───────────────────────────────────────────────────────────────
// Cria DOIS tenants e quatro personas para provar a continuidade
// assistencial sem vazar CRM/agenda alheia:
//   A · ca-andrioni-qa  — clínica veterinária (Orlando, Michele,
//       Recepção Maria, Owner) com a Pet Isabelle (paciente do
//       Orlando encaminhada à Michele) e o Pet Thor/Pet Nina.
//   B · ca-bioclin-qa   — SEGUNDO tenant (adversarial): nada dele
//       pode aparecer na clínica A.
//
// Uso: node scripts/seed-clinical-access-qa.mjs [file]
// Recusa sobrescrever: arquivo existente = QA já criado, reutilize.
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';

if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (disposable local fixture only).');
const file = path.resolve(process.argv[2] || '.cache/clinical-access/qa.json');
const root = path.resolve('.cache/clinical-access');
if (!file.startsWith(root + path.sep)) throw Error('Fixture path must stay in .cache/clinical-access.');
if (fs.existsSync(file)) throw Error('QA fixture already exists; reuse it, never overwrite.');
fs.mkdirSync(path.dirname(file), { recursive: true });

const now = new Date().toISOString();
const password = 'GodoutorCA2026!';
// Formato canônico do verificador: `scrypt:salt:hash`.
const pass = () => { const salt = randomBytes(16).toString('hex'); return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };

const A = 'ca-andrioni-qa';
const B = 'ca-bioclin-qa';
const TZ = 'America/Sao_Paulo';
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
const today = day(0);

const users = [
  ['u-owner', 'Dona da Clínica QA', 'owner.ca@godoutor.test'],
  ['u-maria', 'Maria Recepção QA', 'recepcao.ca@godoutor.test'],
  ['u-orlando', 'Dr. Orlando QA', 'orlando.ca@godoutor.test'],
  ['u-michele', 'Dra. Michele QA', 'michele.ca@godoutor.test'],
  ['u-fora', 'Dono da BioClin QA', 'fora.ca@godoutor.test'],
].map(([id, name, email]) => ({ id, name, email, passwordHash: pass(), createdAt: now, role: 'owner', lastLoginAt: '' }));

const businesses = [
  { id: A, ownerId: 'u-owner', name: 'Clínica Andrioni QA', slug: 'ca-andrioni-qa', clinicType: 'veterinaria', modes: [], businessTimezone: TZ, booking: { bufferMin: 0 }, createdAt: now, updatedAt: now, published: false },
  { id: B, ownerId: 'u-fora', name: 'BioClin QA', slug: 'ca-bioclin-qa', clinicType: 'veterinaria', modes: [], businessTimezone: TZ, booking: { bufferMin: 0 }, createdAt: now, updatedAt: now, published: false },
];

const member = (id, businessId, userId, role, permissions) => ({
  id, businessId, userId, role, active: true, permissions, note: '', invitedBy: 'u-owner', createdAt: now, updatedAt: now,
});
const members = [
  member('m-owner', A, 'u-owner', 'OWNER', {}),
  member('m-maria', A, 'u-maria', 'SECRETARIA', { dashboard: true, agenda: true, clientes: true, whatsapp: true }),
  member('m-orlando', A, 'u-orlando', 'PROFISSIONAL', { dashboard: true, agenda: true, clientes: true, atendimento: true }),
  member('m-michele', A, 'u-michele', 'PROFISSIONAL', { dashboard: true, agenda: true, clientes: true, atendimento: true }),
  member('m-fora', B, 'u-fora', 'OWNER', {}),
];

const professionals = [
  { id: 'pro-orlando', businessId: A, name: 'Dr. Orlando QA', role: 'veterinário', photo: '', active: true, userId: 'u-orlando', followBusinessHours: true, createdAt: now, updatedAt: now },
  { id: 'pro-michele', businessId: A, name: 'Dra. Michele QA', role: 'dermatologia', photo: '', active: true, userId: 'u-michele', followBusinessHours: true, createdAt: now, updatedAt: now },
];

const services = [
  { id: 's-consulta', businessId: A, name: 'Consulta Veterinária QA', categoryId: '', durationMin: 30, price: 15000, active: true, professionalIds: ['pro-orlando', 'pro-michele'], createdAt: now, updatedAt: now },
  { id: 's-fora', businessId: B, name: 'Consulta BioClin QA', categoryId: '', durationMin: 30, price: 15000, active: true, professionalIds: [], createdAt: now, updatedAt: now },
];
const availability = [];
for (let weekday = 0; weekday < 7; weekday++) availability.push({ id: `av-${weekday}`, businessId: A, weekday, start: '00:00', end: '23:59', slotMin: 30, professionalId: '', serviceId: '' });

const contact = (id, businessId, name, phone, extra = {}) => ({
  id, businessId, customerId: '', name, phone, email: '', createdAt: now, updatedAt: now,
  source: 'manual', lastInteraction: now, marketingOptIn: false, note: '', ...extra,
});
const contacts = [
  // Paciente da clínica: tutora da Isabelle — o Orlando atende, a Michele também.
  contact('ct-ana', A, 'Tutora Ana QA', '11911110001', { note: 'Observação administrativa do CRM — não é clínica.' }),
  // CRM puro: só lead/campanha, sem pegada clínica — não é paciente.
  contact('ct-lead', A, 'Contato Só Lead QA', '11999998888', { source: 'campanha' }),
  contact('ct-bruno', A, 'Tutor Bruno QA', '11922220002'),
  contact('ct-carla', A, 'Tutora Carla QA', '11933330003'),
  contact('ct-fora', B, 'Tutor Fora QA', '11944440004'),
];

const pet = (id, businessId, name, tutorId) => ({
  id, businessId, tutorId, name, photo: '', species: 'cachorro', breed: 'SRD', sex: '', birthDate: '', weightKg: 0,
  notes: '', active: true, createdAt: now, updatedAt: now,
});
const pets = [
  pet('pet-isabelle', A, 'Isabelle QA', 'ct-ana'),
  pet('pet-thor', A, 'Thor QA', 'ct-bruno'),
  pet('pet-nina', A, 'Nina QA', 'ct-carla'),
  pet('pet-fora', B, 'Pet Fora QA', 'ct-fora'),
];

const booking = (id, businessId, professionalId, serviceId, petId, customerName, customerPhone, date, status = 'confirmed') => ({
  id, businessId, customerId: '', serviceId, professionalId, petId, date, time: '10:00',
  customerName, customerPhone, status, note: '', answers: [], createdAt: now, updatedAt: now, history: [],
});
const bookings = [
  // Isabelle: histórico do Orlando + retorno de hoje com a Michele.
  booking('bk-orlando', A, 'pro-orlando', 's-consulta', 'pet-isabelle', 'Tutora Ana QA', '11911110001', day(1)),
  booking('bk-michele-isabelle', A, 'pro-michele', 's-consulta', 'pet-isabelle', 'Tutora Ana QA', '11911110001', today, 'arrived'),
  booking('bk-michele-thor', A, 'pro-michele', 's-consulta', 'pet-thor', 'Tutor Bruno QA', '11922220002', day(7)),
  booking('bk-orlando-nina', A, 'pro-orlando', 's-consulta', 'pet-nina', 'Tutora Carla QA', '11933330003', day(3)),
  booking('bk-fora', B, '', 's-fora', 'pet-fora', 'Tutor Fora QA', '11944440004', day(2)),
];

const encounter = (id, businessId, professionalId, contactId, petId, customerName, extra = {}) => ({
  id, businessId, bookingId: '', queueId: '', serviceId: 's-consulta', professionalId, customerId: '', contactId,
  customerName, date: today, time: '10:00', complaint: '', evolution: '', guidance: '', followUp: '',
  followUpMode: '', followUpDate: '', followUpDays: 0, internalNote: '', tags: [], files: [], petId,
  startedAt: now, status: 'draft', version: 3, createdAt: now, updatedAt: now, updatedBy: 'u-orlando',
  clinical: {
    anamnesis: { history: 'Paciente estável.', observations: '' },
    problems: [{ id: 'p1', kind: 'diagnosis', label: 'Dermatite', notes: '' }],
    plan: { conduct: 'Tratamento tópico.' },
    procedures: [{ id: 'pr1', name: 'Coleta de sangue', notes: '' }],
  },
  ...extra,
});
const encounters = [
  encounter('enc-orlando', A, 'pro-orlando', 'ct-ana', 'pet-isabelle', 'Tutora Ana QA', { bookingId: 'bk-orlando', evolution: 'Dermatite da Isabelle — conduta do Orlando.' }),
  encounter('enc-orlando-final', A, 'pro-orlando', 'ct-ana', 'pet-isabelle', 'Tutora Ana QA', {
    date: day(-20), status: 'finalized', version: 5, evolution: 'Retorno anterior finalizado.',
    finalizedAt: now, finalizedBy: 'u-orlando', signedBy: 'Dr. Orlando QA', finalizationRevisionId: 'rev-1',
  }),
  encounter('enc-michele-thor', A, 'pro-michele', 'ct-bruno', 'pet-thor', 'Tutor Bruno QA', { bookingId: 'bk-michele-thor', evolution: 'Thor — consulta da Michele.', updatedBy: 'u-michele' }),
  encounter('enc-fora', B, '', 'ct-fora', 'pet-fora', 'Tutor Fora QA', { professionalId: '', evolution: 'Registro da BioClin.' }),
];

const tasks = [
  { id: 'tk-orlando', businessId: A, title: 'Retorno da Isabelle', note: '', status: 'open', dueAt: '', createdAt: now, updatedAt: now, doneAt: '', assignedUserId: 'u-orlando', createdBy: 'u-maria', source: 'manual', bookingId: 'bk-orlando' },
  { id: 'tk-michele', businessId: A, title: 'Confirmar exame do Thor', note: '', status: 'open', dueAt: '', createdAt: now, updatedAt: now, doneAt: '', assignedUserId: 'u-michele', createdBy: 'u-maria', source: 'manual', bookingId: 'bk-michele-thor' },
];

const db = {
  users, businesses, members, professionals, services, availability, contacts, pets, bookings, encounters,
  tasks,
  encounterFinalizationRevisions: [{
    id: 'rev-1', businessId: A, encounterId: 'enc-orlando-final', revisionNumber: 1, encounterVersion: 5,
    finalizedAt: now, finalizedByUserId: 'u-orlando', finalizedByProfessionalId: 'pro-orlando', signedBy: 'Dr. Orlando QA',
    snapshot: { evolution: 'Retorno anterior finalizado.' }, fingerprint: 'fp-ca-1',
  }],
  conversations: [{ id: 'cv-ana', businessId: A, channel: 'whatsapp', contactId: '', customerId: '', phone: '11911110001', name: 'Tutora Ana QA', status: 'open', lastMessageAt: now, lastMessagePreview: 'oi', unread: 3, mode: 'automation', createdAt: now }],
  leads: [{ id: 'ld-ana', businessId: A, customerId: '', name: 'Tutora Ana QA', phone: '11911110001', email: '', origin: 'formulario', status: 'new', stageId: 'new', createdAt: now, priority: 'medium', stageHistory: [], interest: '', message: '' }],
  orders: [{ id: 'or-ana', businessId: A, code: 'QA1', customerName: 'Tutora Ana QA', customerPhone: '11911110001', customerId: '', status: 'new', total: 12345, createdAt: now, items: [] }],
  financeEntries: [{ id: 'fe-ana', businessId: A, kind: 'receita', description: 'Consulta QA', amount: 15000, date: today, status: 'pago', createdAt: now }],
};

fs.writeFileSync(file, JSON.stringify(db));
console.log(`OK · fixture Clinical Access em ${file}`);
console.log(`   logins (senha ${password}): owner.ca@ / recepcao.ca@ / orlando.ca@ / michele.ca@ / fora.ca@godoutor.test`);
