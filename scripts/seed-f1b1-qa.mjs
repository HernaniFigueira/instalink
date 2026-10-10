// Local disposable fixture for the Clinical Encounter F1B1 QA (anamnese + avaliação).
// Refuses remote databases and existing files (never touches real data).
// Usage: node scripts/seed-f1b1-qa.mjs [file]
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent.');
const file = path.resolve(process.argv[2] || '.cache/f1b1/qa.json');
if (!file.startsWith(path.resolve('.cache/f1b1') + path.sep)) throw Error('Fixture path must stay in .cache/f1b1.');
if (fs.existsSync(file)) throw Error('QA fixture already exists; reuse it, never overwrite data.');

const now = new Date().toISOString();
const A = 'f1b1-vet-qa';        // clínica veterinária (tenant do fluxo)
const B = 'f1b1-outra-qa';      // SEGUNDO tenant (prova de isolamento)
const OD = 'f1b1-odonto-qa';    // clínica ODONTOLÓGICA (módulo vet NÃO pode aparecer)
const ES = 'f1b1-estetica-qa';  // clínica de ESTÉTICA (módulo vet NÃO pode aparecer)
const password = 'GodoutorF1B12026!';
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
  ['owner', 'Hernani QA F1B1', 'owner.f1b1', 'owner'],
  ['recepcao', 'Maria Recepção F1B1', 'recepcao.f1b1', 'admin'],
  ['michelle', 'Michelle Veterinária F1B1', 'michelle.f1b1', 'admin'],
  ['fora', 'Fora da Unidade F1B1', 'fora.f1b1', 'owner'],
  ['odonto', 'Dentista QA F1B1', 'odonto.f1b1', 'admin'],
  ['estetica', 'Esteticista QA F1B1', 'estetica.f1b1', 'admin'],
].map(([id, name, email, role]) => ({
  id: `f1b1-${id}`, name, email: `${email}@godoutor.local`, passwordHash: hash(),
  role, createdAt: now, lastLoginAt: '',
}));

const OWNER_OF = { [A]: 'f1b1-owner', [B]: 'f1b1-fora', [OD]: 'f1b1-odonto', [ES]: 'f1b1-estetica' };
const CLINIC_OF = { [A]: 'veterinaria', [B]: 'veterinaria', [OD]: 'odontologica', [ES]: 'estetica' };
const business = (id, name) => ({
  id, ownerId: OWNER_OF[id],
  organizationId: `org-${id}`, name, slug: id, niche: 'pet', clinicType: CLINIC_OF[id],
  modes: ['services', 'bookings'], description: 'Clínica descartável de QA — Clinical Encounter F1B1',
  logo: '', cover: '', phone: '', whatsapp: '11999990000', email: '', instagram: '', tiktok: '',
  address: '', mapsUrl: '', hours: {}, paymentMethods: ['pix'], pixKey: '', published: false,
  booking: { teamMode: 'auto', leadMin: 0, cancelUntilMin: 0, horizonDays: 365, bufferMin: 0 },
  createdAt: now, updatedAt: now, businessTimezone: 'America/Sao_Paulo',
});

const members = [
  { id: 'f1b1-m-recepcao', businessId: A, userId: 'f1b1-recepcao', role: 'SECRETARIA', permissions: {}, note: 'Recepção', invitedBy: 'f1b1-owner', active: true, createdAt: now, updatedAt: now },
  { id: 'f1b1-m-michelle', businessId: A, userId: 'f1b1-michelle', role: 'PROFISSIONAL', permissions: {}, note: 'Veterinária', invitedBy: 'f1b1-owner', active: true, createdAt: now, updatedAt: now },
  { id: 'f1b1-m-odonto', businessId: OD, userId: 'f1b1-odonto', role: 'PROFISSIONAL', permissions: {}, note: 'Dentista', invitedBy: 'f1b1-odonto', active: true, createdAt: now, updatedAt: now },
  { id: 'f1b1-m-estetica', businessId: ES, userId: 'f1b1-estetica', role: 'PROFISSIONAL', permissions: {}, note: 'Esteticista', invitedBy: 'f1b1-estetica', active: true, createdAt: now, updatedAt: now },
];

const professionals = [
  { id: 'pro-michelle', businessId: A, name: 'Michelle', role: 'Médica veterinária', photo: '', active: true, userId: 'f1b1-michelle', followBusinessHours: true },
  { id: 'pro-outro-a', businessId: A, name: 'Orlando', role: 'Médico veterinário', photo: '', active: true, userId: '', followBusinessHours: true },
  { id: 'pro-outra-b', businessId: B, name: 'Profissional de fora', role: '', photo: '', active: true, userId: '', followBusinessHours: true },
  { id: 'pro-odonto', businessId: OD, name: 'Dentista QA', role: 'Dentista', photo: '', active: true, userId: 'f1b1-odonto', followBusinessHours: true },
  { id: 'pro-estetica', businessId: ES, name: 'Esteticista QA', role: 'Esteticista', photo: '', active: true, userId: 'f1b1-estetica', followBusinessHours: true },
];

const services = [
  { id: 'svc-derma', businessId: A, name: 'Consulta dermatológica', durationMin: 30, price: 18000, description: '', categoryId: 'cat-f1b1', image: '', featured: false, questions: [], active: true, bookable: true, professionalIds: [] },
  { id: 'svc-restrito', businessId: A, name: 'Consulta restrita ao Orlando', durationMin: 30, price: 18000, description: '', categoryId: 'cat-f1b1', image: '', featured: false, questions: [], active: true, bookable: true, professionalMode: 'selected', professionalIds: ['pro-outro-a'] },
  { id: 'svc-outra-b', businessId: B, name: 'Consulta de outra unidade', durationMin: 30, price: 10000, description: '', categoryId: 'cat-f1b1-b', image: '', featured: false, questions: [], active: true, bookable: true, professionalIds: [] },
  { id: 'svc-odonto', businessId: OD, name: 'Avaliação odontológica', durationMin: 30, price: 15000, description: '', categoryId: '', image: '', featured: false, questions: [], active: true, bookable: true, professionalIds: [] },
  { id: 'svc-estetica', businessId: ES, name: 'Avaliação estética', durationMin: 30, price: 15000, description: '', categoryId: '', image: '', featured: false, questions: [], active: true, bookable: true, professionalIds: [] },
];

const contacts = [
  { id: 'ct-isabelle', businessId: A, customerId: '', name: 'Isabelle Tutora QA', phone: '11988880001', email: 'isabelle@example.invalid', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: true, note: 'Dado fictício de QA' },
  { id: 'ct-sempet', businessId: A, customerId: '', name: 'Tutor Sem Pet QA', phone: '11988880003', email: 'sempet@example.invalid', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: true, note: 'Dado fictício de QA' },
  { id: 'ct-unico', businessId: A, customerId: '', name: 'Tutor Único QA', phone: '11988880002', email: 'unico@example.invalid', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: true, note: 'Dado fictício de QA' },
  { id: 'ct-outra-b', businessId: B, customerId: '', name: 'Tutor de outra unidade', phone: '11977770002', email: '', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: false },
  { id: 'ct-odonto', businessId: OD, customerId: '', name: 'Paciente Odonto QA', phone: '11966660003', email: '', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: false },
  { id: 'ct-estetica', businessId: ES, customerId: '', name: 'Paciente Estética QA', phone: '11955550004', email: '', createdAt: now, updatedAt: now, source: 'manual', lastInteraction: now, marketingOptIn: false },
];

const pets = [
  // FIXTURE Quick Create (1 pet): tutor com exatamente UM pet → pré-seleção automática.
  {
    id: 'pet-bidu', businessId: A, tutorId: 'ct-unico', name: 'Bidu', photo: '',
    species: 'cachorro', breed: 'SRD', sex: 'M', birthDate: '', weightKg: 7, notes: 'Paciente fictício de QA (único pet)', active: true, createdAt: now, updatedAt: now,
  },
  // FIXTURE Quick Create: a tutora tem DOIS pets → o Quick Create exige escolha.
  {
    id: 'pet-thor', businessId: A, tutorId: 'ct-isabelle', name: 'Thor', photo: '',
    species: 'cachorro', breed: 'SRD', sex: 'M', birthDate: '', weightKg: 18, notes: 'Paciente fictício de QA (2º pet)', active: true, createdAt: now, updatedAt: now,
  },
  {
    id: 'pet-mel', businessId: A, tutorId: 'ct-isabelle', name: 'Mel', photo: '',
    species: 'cachorro', breed: 'SRD', sex: 'F', birthDate: `${Number(today.slice(0, 4)) - 2}-01-15`,
    weightKg: 9.4, notes: 'Paciente fictício de QA', active: true, createdAt: now, updatedAt: now,
  },
  // FIXTURE PROPOSITAL: a clínica odontológica tem um Pet LEGADO (veio de uma
  // migração antiga). Ele NÃO pode ligar o módulo veterinário — a vertical é a
  // única autoridade. É a prova viva de que nada é inferido do Pet.
  {
    id: 'pet-odonto-legado', businessId: OD, tutorId: 'ct-odonto', name: 'Pet legado (não é paciente desta vertical)', photo: '',
    species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: 12, notes: 'Registro antigo de outra vertical', active: true, createdAt: now, updatedAt: now,
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
  booking('bk-mel-2', A, { time: '15:00', checkedInAt: now, checkedInBy: 'f1b1-owner', checkedInByName: 'Hernani QA F1B1', ...utc(today, '15:00', 30) }),
  // 3 · chegou, mas SEM PROFISSIONAL na agenda: prova viva da invariante
  //     (atendimento clínico não nasce sem profissional responsável).
  booking('bk-sem-prof', A, { time: '16:30', checkedInAt: now, checkedInBy: 'f1b1-owner', checkedInByName: 'Hernani QA F1B1', professionalId: '', ...utc(today, '16:30', 30) }),
  // 4 · de OUTRA unidade (prova de isolamento).
  {
    id: 'bk-outra-b', businessId: B, customerId: '', serviceId: 'svc-outra-b', professionalId: 'pro-outra-b',
    date: today, time: '16:00', customerName: 'Tutor de outra unidade', customerPhone: '11977770002',
    status: 'confirmed', checkedInAt: now, note: '', answers: [], createdAt: now, updatedAt: now,
    history: [], petId: 'pet-outra-b', petName: 'Pet de fora', durationMin: 30,
    timeZone: 'America/Sao_Paulo', temporalSource: 'native', bookingKind: 'standard',
    ...utc(today, '16:00', 30),
  },
];

// Atendimento em andamento nas verticais NÃO veterinárias: a QA abre o
// workspace REAL e prova que só o CORE aparece (sem Anamnese/Avaliação).
const encounterFor = (id, businessId, serviceId, professionalId, contactId, customerName, createdBy) => ({
  id, businessId, bookingId: '', queueId: '', serviceId, professionalId,
  customerId: '', contactId, customerName, date: today, time: '10:00',
  complaint: '', evolution: '', guidance: '', followUp: '', internalNote: '', tags: [],
  status: 'draft', version: 1, startedAt: now, createdAt: now, updatedAt: now,
  createdBy, updatedBy: createdBy, finalizedAt: '', finalizedBy: '', signedBy: '', petId: '',
});
const encounters = [
  encounterFor('enc-odonto-qa', OD, 'svc-odonto', 'pro-odonto', 'ct-odonto', 'Paciente Odonto QA', 'f1b1-odonto'),
  encounterFor('enc-estetica-qa', ES, 'svc-estetica', 'pro-estetica', 'ct-estetica', 'Paciente Estética QA', 'f1b1-estetica'),
];

const db = {
  users, sessions: [],
  businesses: [
    business(A, 'Vet QA F1B1'), business(B, 'Outra Clínica QA F1B1'),
    business(OD, 'Odonto QA F1B1'), business(ES, 'Estética QA F1B1'),
  ],
  members, professionals, services, bookings, contacts, pets, encounters,
  categories: [
    { id: 'cat-f1b1', businessId: A, name: 'Consultas', kind: 'service', order: 0 },
    { id: 'cat-f1b1-b', businessId: B, name: 'Consultas', kind: 'service', order: 0 },
  ],
  availability: Array.from({ length: 7 }, (_, weekday) => ({
    id: `f1b1-av-${weekday}`, businessId: A, professionalId: '', serviceId: '',
    weekday, start: '09:00', end: '18:00', slotMin: 30,
  })),
  customers: [], orders: [], pages: [], products: [], leads: [], reviews: [], events: [],
  pipelines: [], tasks: [], automations: [], automationRuns: [], queue: [],
  conversations: [{
    // FIXTURE truncamento da prévia: mensagem longa → corte de 3 linhas + CTA "Ler conversa completa".
    // Conversa ANTIGA e inserida ANTES da recente: se a rota não ordenar por atividade, a prévia mostra esta.
    id: 'conv-qa-antiga', businessId: A, channel: 'whatsapp', channelUserId: '5511988880098', channelAccountId: 'qa-acc',
    status: 'closed', contactId: 'ct-isabelle', customerId: '', phone: '11988880098', name: 'Isabelle Tutora QA',
    lastMessageAt: '2001-01-01T00:00:00.000Z', lastMessagePreview: 'Conversa antiga de QA (não deve aparecer na prévia).',
    unread: 0, createdAt: '2001-01-01T00:00:00.000Z', updatedAt: '2001-01-01T00:00:00.000Z',
  },
  {
    id: 'conv-qa-longa', businessId: A, channel: 'whatsapp', channelUserId: '5511988880099', channelAccountId: 'qa-acc',
    status: 'open', contactId: 'ct-isabelle', customerId: '', phone: '11988880099', name: 'Isabelle Tutora QA',
    lastMessageAt: '2099-01-01T00:00:00.000Z', lastMessagePreview: 'Oi! Desde ontem a Mel está coçando muito as orelhas, principalmente à noite, e ontem ela sacudiu a cabeça e ficou com um cheiro forte. Consigo trazer ela antes da consulta de amanhã? Obrigada.',
    unread: 0, createdAt: now, updatedAt: now,
  }], messages: [], campaigns: [], campaignRecipients: [], audit: [],
  supportSessions: [], passwordResets: [], organizations: [], organizationMembers: [],
  apiKeys: [], webhooks: [], webhookDeliveries: [], idempotencyKeys: [], integrationLogs: [],
  integrations: [], integrationEvents: [], aiProposals: [], anamneseTemplates: [],
  anamneseResponses: [], financeEntries: [], followUpRules: [], followUpOutreach: [],
  deletionAuthorizations: [], scheduleBlocks: [], scheduleResources: [], exceptions: [],
  agents: [],
};

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(db, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`F1B1 QA ready: ${file}`);
console.log(`Clinic A(vet): ${A} · Clinic B: ${B} · Clinic OD: ${OD} · Clinic ES: ${ES} · password: ${password}`);
console.log('Logins: owner.f1b1@ · recepcao.f1b1@ · michelle.f1b1@ · fora.f1b1@ (B) · odonto.f1b1@ (OD) · estetica.f1b1@ (ES)');
console.log(`Encontros pré-criados (só CORE): enc-odonto-qa (${OD}) · enc-estetica-qa (${ES})`);
