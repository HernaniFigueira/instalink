// Local disposable fixture for the Clinical Encounter F1A browser QA.
// Refuses remote databases and existing files (never touches real data).
// Usage: node scripts/seed-f1a-qa.mjs [file]
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent.');
const file = path.resolve(process.argv[2] || '.cache/f1a/qa.json');
if (!file.startsWith(path.resolve('.cache/f1a') + path.sep)) throw Error('Fixture path must stay in .cache/f1a.');
if (fs.existsSync(file)) throw Error('QA fixture already exists; reuse it, never overwrite data.');

const now = new Date().toISOString();
const A = 'f1a-vet-qa';        // clínica veterinária (tenant do fluxo)
const B = 'f1a-outra-qa';      // SEGUNDO tenant (prova de isolamento)
const password = 'GodoutorF1A2026!';
const hash = () => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const today = day(0);
/** startAt/endAt em UTC para um horário local (America/Sao_Paulo = UTC-3). */
const utc = (date, time, minutes) => {
  const [h, m] = time.split(':').map(Number);
  const start = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m + 180) * 60000;
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + minutes * 60000).toISOString(),
  };
};

const users = [
  ['owner', 'Hernani QA F1A', 'owner.f1a', 'owner'],
  ['recepcao', 'Maria Recepção F1A', 'recepcao.f1a', 'admin'],
  ['michelle', 'Michelle Veterinária F1A', 'michelle.f1a', 'admin'],
  ['fora', 'Fora da Unidade F1A', 'fora.f1a', 'owner'],
].map(([id, name, email, role]) => ({
  id: `f1a-${id}`, name, email: `${email}@godoutor.local`, passwordHash: hash(),
  role, createdAt: now, lastLoginAt: '',
}));

const business = (id, name) => ({
  id, ownerId: id === A ? 'f1a-owner' : 'f1a-fora',
  organizationId: `org-${id}`, name, slug: id, niche: 'pet', clinicType: 'veterinaria',
  modes: ['services', 'bookings'], description: 'Clínica descartável de QA — Clinical Encounter F1A',
  logo: '', cover: '', phone: '', whatsapp: '11999990000', email: '', instagram: '', tiktok: '',
  address: '', mapsUrl: '', hours: {}, paymentMethods: ['pix'], pixKey: '', published: false,
  booking: { teamMode: 'auto', leadMin: 0, cancelUntilMin: 0, horizonDays: 365, bufferMin: 0 },
  createdAt: now, updatedAt: now, businessTimezone: 'America/Sao_Paulo',
});

const members = [
  { id: 'f1a-m-recepcao', businessId: A, userId: 'f1a-recepcao', role: 'SECRETARIA', permissions: {}, note: 'Recepção', invitedBy: 'f1a-owner', active: true, createdAt: now, updatedAt: now },
  { id: 'f1a-m-michelle', businessId: A, userId: 'f1a-michelle', role: 'PROFISSIONAL', permissions: {}, note: 'Veterinária', invitedBy: 'f1a-owner', active: true, createdAt: now, updatedAt: now },
];

const professionals = [
  { id: 'pro-michelle', businessId: A, name: 'Michelle', role: 'Médica veterinária', photo: '', active: true, userId: 'f1a-michelle', followBusinessHours: true },
  { id: 'pro-outro-a', businessId: A, name: 'Orlando', role: 'Médico veterinário', photo: '', active: true, userId: '', followBusinessHours: true },
  { id: 'pro-outra-b', businessId: B, name: 'Profissional de fora', role: '', photo: '', active: true, userId: '', followBusinessHours: true },
];

const services = [
  { id: 'svc-derma', businessId: A, name: 'Consulta dermatológica', durationMin: 30, price: 18000, description: '', categoryId: 'cat-f1a', image: '', featured: false, questions: [], active: true, bookable: true, professionalIds: [] },
  { id: 'svc-outra-b', businessId: B, name: 'Consulta de outra unidade', durationMin: 30, price: 10000, description: '', categoryId: 'cat-f1a-b', image: '', featured: false, questions: [], active: true, bookable: true, professionalIds: [] },
];

const contacts = [
  { id: 'ct-isabelle', businessId: A, customerId: '', name: 'Isabelle Tutora QA', phone: '11988880001', email: 'isabelle@example.invalid', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: true, note: 'Dado fictício de QA' },
  { id: 'ct-outra-b', businessId: B, customerId: '', name: 'Tutor de outra unidade', phone: '11977770002', email: '', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: false },
];

const pets = [
  {
    id: 'pet-mel', businessId: A, tutorId: 'ct-isabelle', name: 'Mel', photo: '',
    species: 'cachorro', breed: 'SRD', sex: 'F', birthDate: `${Number(today.slice(0, 4)) - 2}-01-15`,
    weightKg: 9.4, notes: 'Paciente fictício de QA', active: true, createdAt: now, updatedAt: now,
  },
  {
    id: 'pet-outra-b', businessId: B, tutorId: 'ct-outra-b', name: 'Pet de fora', photo: '',
    species: 'felina', breed: '', sex: '', birthDate: '', weightKg: 0, notes: '', active: true, createdAt: now, updatedAt: now,
  },
];

const booking = (id, businessId, over) => ({
  id, businessId, customerId: '', serviceId: 'svc-derma', professionalId: 'pro-michelle',
  date: today, time: '14:00', customerName: 'Isabelle Tutora QA', customerPhone: '11988880001',
  status: 'confirmed', note: '', answers: [], createdAt: now, updatedAt: now, history: [],
  petId: 'pet-mel', petName: 'Mel', durationMin: 30, timeZone: 'America/Sao_Paulo',
  temporalSource: 'native', bookingKind: 'standard',
  ...utc(today, '14:00', 30), ...over,
});

const bookings = [
  // 1 · fluxo principal: sem check-in (a QA registra a chegada pela UI).
  booking('bk-mel', A),
  // 2 · já com check-in (etapa `arrived`): usado por Profissional/Recepção.
  booking('bk-mel-2', A, { time: '15:00', checkedInAt: now, checkedInBy: 'f1a-owner', checkedInByName: 'Hernani QA F1A', ...utc(today, '15:00', 30) }),
  // 3 · de OUTRA unidade (prova de isolamento).
  {
    id: 'bk-outra-b', businessId: B, customerId: '', serviceId: 'svc-outra-b', professionalId: 'pro-outra-b',
    date: today, time: '16:00', customerName: 'Tutor de outra unidade', customerPhone: '11977770002',
    status: 'confirmed', checkedInAt: now, note: '', answers: [], createdAt: now, updatedAt: now,
    history: [], petId: 'pet-outra-b', petName: 'Pet de fora', durationMin: 30,
    timeZone: 'America/Sao_Paulo', temporalSource: 'native', bookingKind: 'standard',
    ...utc(today, '16:00', 30),
  },
];

const db = {
  users, sessions: [], businesses: [business(A, 'Vet QA F1A'), business(B, 'Outra Clínica QA F1A')],
  members, professionals, services, bookings, contacts, pets,
  categories: [
    { id: 'cat-f1a', businessId: A, name: 'Consultas', kind: 'service', order: 0 },
    { id: 'cat-f1a-b', businessId: B, name: 'Consultas', kind: 'service', order: 0 },
  ],
  availability: Array.from({ length: 7 }, (_, weekday) => ({
    id: `f1a-av-${weekday}`, businessId: A, professionalId: '', serviceId: '',
    weekday, start: '09:00', end: '18:00', slotMin: 30,
  })),
  customers: [], orders: [], pages: [], products: [], leads: [], reviews: [], events: [],
  pipelines: [], tasks: [], automations: [], automationRuns: [], queue: [], encounters: [],
  conversations: [], messages: [], campaigns: [], campaignRecipients: [], audit: [],
  supportSessions: [], passwordResets: [], organizations: [], organizationMembers: [],
  apiKeys: [], webhooks: [], webhookDeliveries: [], idempotencyKeys: [], integrationLogs: [],
  integrations: [], integrationEvents: [], aiProposals: [], anamneseTemplates: [],
  anamneseResponses: [], financeEntries: [], followUpRules: [], followUpOutreach: [],
  deletionAuthorizations: [], scheduleBlocks: [], scheduleResources: [], exceptions: [],
  agents: [],
};

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(db, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`F1A QA ready: ${file}`);
console.log(`Clinic A: ${A} · Clinic B: ${B} · password: ${password}`);
console.log('Logins: owner.f1a@ · recepcao.f1a@ · michelle.f1a@ · fora.f1a@ (tenant B)');
