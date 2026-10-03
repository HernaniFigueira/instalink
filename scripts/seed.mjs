// Seed de DESENVOLVIMENTO/QA — GO DOUTOR Clinical OS.
// Cria a conta demo + TRÊS UNIDADES CLÍNICAS (veterinária, odontológica,
// geral) com equipe, agenda aberta de segunda a sábado, histórico de
// atendimentos e base de clientes. É o banco que as suítes de smoke/e2e
// (scripts/smoke*.mjs, e2e-merchant.mjs) esperam encontrar.
//
// PRODUTOS/PEDIDOS NASCEM VAZIOS DE PROPÓSITO: vitrine e pedidos são RAMO DE
// COMPATIBILIDADE do antigo fluxo "universal" (GODOUTOR_LEGACY_PAGES); a demo
// clínica não finge loja. Quem precisar do ramo comercial cria unidade com
// modes/payload legado pela API (o smoke-ux faz exatamente isso).
// Uso: npm run seed
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes, randomUUID } from 'node:crypto';

// Resolve o banco local em arquivo com a mesma regra do runtime (src/lib/db.ts):
// GODOUTOR_DB_FILE (canônico) → INSTALINK_DB_FILE (alias legado) →
// data/godoutor.db.json (preservando data/instalink.db.json se só ele existir).
function resolveLocalDbFile(cwd = process.cwd()) {
  const explicit = process.env.GODOUTOR_DB_FILE || process.env.INSTALINK_DB_FILE;
  if (explicit) return explicit;
  const canonical = path.join(cwd, 'data', 'godoutor.db.json');
  const legacy = path.join(cwd, 'data', 'instalink.db.json');
  try {
    if (!fs.existsSync(canonical) && fs.existsSync(legacy)) return legacy;
  } catch { /* segue o canônico */ }
  return canonical;
}
const FILE = resolveLocalDbFile();

function hash(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const now = new Date().toISOString();
// Datas do PASSADO para o histórico de demonstração (P2): a tela Resultados
// precisa de movimento real no período para mostrar comparação, funil e
// desempenho. Só status FINAIS (concluído/falta/cancelado): nada fica
// pendente no passado.
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const dayAhead = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const tsAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const pastBooking = (id, businessId, serviceId, professionalId, days, time, status, name, phone, note = '') => ({
  id, businessId, customerId: '', serviceId, professionalId, date: dayAgo(days), time,
  customerName: name, customerPhone: phone, status, note,
  createdAt: tsAgo(days + 5), updatedAt: tsAgo(days), history: [],
});
const VET = 'biz-vidavet';
const ODONTO = 'biz-odontovitta';
const GERAL = 'biz-clinicageral';

function blocksFor(cta, extra, target) {
  const b = [];
  let o = 0;
  const add = (type, settings = {}) => b.push({ id: `${cta}-${type}-${o}`, type, order: o++, enabled: true, settings });
  add('profile');
  add('cta', { label: cta, target });
  for (const e of extra) add(e[0], e[1] || {});
  add('testimonials', {
    title: 'O que dizem os pacientes',
    items: [
      { name: 'Maria S.', text: 'Atendimento pontual e humano. Recomendo demais!' },
      { name: 'João P.', text: 'Agendei pelo site em um minuto, sem telefonema.' },
    ],
  });
  add('faq', {
    title: 'Dúvidas frequentes',
    items: [
      { q: 'Quais as formas de pagamento?', a: 'PIX, cartão e dinheiro.' },
      { q: 'Como falo com vocês?', a: 'Pelo WhatsApp aqui da página. Respondemos rapidinho!' },
    ],
  });
  add('location');
  add('whatsapp', { label: 'Falar no WhatsApp' });
  add('contact', { title: 'Deixe seus dados' });
  add('concierge', { title: 'Precisa de ajuda?' });
  return b;
}

const db = {
  users: [
    { id: 'user-demo', name: 'Demo GoDoutor', email: 'demo@godoutor.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    // Logins de EQUIPE (FASE 3): testam papéis/permissões de verdade.
    { id: 'user-secretaria', name: 'Maria (secretária)', email: 'maria@godoutor.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    { id: 'user-vendedor', name: 'Vitor (recepção)', email: 'vitor@godoutor.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    // PROFISSIONAL (quem ATENDE): vinculado ao profissional 'pro-orlando' via
    // `professionals.userId` — é esse vínculo que produz o escopo "own" da
    // agenda e a Visão geral "Meu dia". Sem ele não dá para verificar o papel.
    { id: 'user-profissional', name: 'Orlando (dentista)', email: 'profissional@godoutor.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    // Segundo profissional com LOGIN (e2e do escopo "own"): o vínculo real do
    // Dr. Caio vive na UNIDADE VET; a rota do e2e resolve o login pela
    // business.members, não por hardcode de id.
    { id: 'user-caio', name: 'Caio (veterinário)', email: 'pro-caio@godoutor.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    // MASTER da PLATAFORMA: papel no banco (não é dono de nada; entra em
    // unidade só por sessão de suporte explícita e auditada).
    { id: 'user-master', name: 'Suporte GoDoutor', email: 'master@godoutor.app', passwordHash: hash('master1234'), createdAt: now, role: 'master', lastLoginAt: '' },
  ],
  sessions: [],
  businesses: [
    {
      id: VET, ownerId: 'user-demo', name: 'VidaVet Clínica Veterinária', slug: 'vidavet',
      description: 'Cuidado completo para quem latir, miar ou gorjear. Agende a consulta do seu pet.',
      logo: '', cover: '', niche: 'pet', clinicType: 'veterinaria', modes: ['services', 'bookings'],
      phone: '', whatsapp: '11999999999', email: 'contato@vidavet.com.br', instagram: 'vidavet', tiktok: '',
      address: 'Rua dos Mascotes, 123 — Pinheiros, São Paulo/SP', mapsUrl: 'https://maps.google.com/?q=Pinheiros+Sao+Paulo',
      hours: {}, paymentMethods: ['pix', 'card'], pixKey: '',
      deliveryFee: 0, minOrder: 0,
      googleUrl: '', googlePlaceId: '', googleApiKey: '',
      booking: { teamMode: 'auto', leadMin: 60, cancelUntilMin: 180, horizonDays: 60, bufferMin: 0 },
      published: true, createdAt: now, updatedAt: now,
    },
    {
      id: ODONTO, ownerId: 'user-demo', name: 'Clínica Odonto Vitta', slug: 'odontovitta',
      description: 'Odontologia completa com hora marcada. Sorria no seu tempo.',
      logo: '', cover: '', niche: 'saude', clinicType: 'odontologica', modes: ['services', 'bookings'],
      phone: '', whatsapp: '11988888888', email: '', instagram: 'odontovitta', tiktok: '',
      address: 'Av. Principal, 456 — Vila Nova, São Paulo/SP', mapsUrl: 'https://maps.google.com/?q=Vila+Nova+SP',
      hours: {}, paymentMethods: ['pix', 'card', 'cash'], pixKey: '',
      deliveryFee: 0, minOrder: 0,
      googleUrl: '', googlePlaceId: '', googleApiKey: '',
      booking: { teamMode: 'choosable', leadMin: 60, cancelUntilMin: 180, horizonDays: 30, bufferMin: 0 },
      published: true, createdAt: now, updatedAt: now,
    },
    {
      id: GERAL, ownerId: 'user-demo', name: 'Clínica Geral Horizonte', slug: 'clinicageral',
      description: 'Consultas e exames com equipe multidisciplinar. Escolha o profissional.',
      logo: '', cover: '', niche: 'saude', clinicType: 'geral', modes: ['services', 'bookings'],
      phone: '', whatsapp: '11977778888', email: '', instagram: 'clinicageral', tiktok: '',
      address: 'Rua Saúde, 789 — Moema, São Paulo/SP', mapsUrl: 'https://maps.google.com/?q=Moema+SP',
      hours: {}, paymentMethods: ['pix', 'card'], pixKey: '',
      deliveryFee: 0, minOrder: 0,
      googleUrl: '', googlePlaceId: '', googleApiKey: '',
      booking: { teamMode: 'choosable', leadMin: 60, cancelUntilMin: 180, horizonDays: 30, bufferMin: 0 },
      published: true, createdAt: now, updatedAt: now,
    },
  ],
  pages: [
    {
      id: 'page-vet', businessId: VET, presetId: 'clinica-veterinaria',
      theme: { primary: '#16a34a', secondary: '#bbf7d0', background: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', radius: 14, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Agendar consulta', [['services', { title: 'Serviços' }], ['booking', { title: 'Agende a consulta do seu pet' }]], 'booking'),
      updatedAt: now,
    },
    {
      id: 'page-odonto', businessId: ODONTO, presetId: 'clinica-odontologica',
      theme: { primary: '#0891b2', secondary: '#a5f3fc', background: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', radius: 14, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Agendar horário', [['services', { title: 'Procedimentos' }], ['booking', { title: 'Agende sua consulta' }]], 'booking'),
      updatedAt: now,
    },
    {
      id: 'page-geral', businessId: GERAL, presetId: 'clinica-geral',
      theme: { primary: '#0d9488', secondary: '#99f6e4', background: '#fafaf9', surface: '#ffffff', text: '#1c1917', muted: '#78716c', radius: 14, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Agendar atendimento', [['services', { title: 'Especialidades' }], ['booking', { title: 'Agende sua consulta' }]], 'booking'),
      updatedAt: now,
    },
  ],
  categories: [
    { id: 'cat-vet', businessId: VET, kind: 'service', name: 'Consultas e vacinas', order: 0, active: true },
    { id: 'cat-consulta', businessId: ODONTO, kind: 'service', name: 'Consultas', order: 0, active: true },
    { id: 'cat-especialidades', businessId: GERAL, kind: 'service', name: 'Especialidades', order: 0, active: true },
  ],
  // Vitrine/pedidos = RAMO DE COMPATIBILIDADE (GODOUTOR_LEGACY_PAGES). A demo
  // clínica nasce SEM produtos e SEM pedidos — nada de "cardápio" de mentira.
  products: [],
  options: [],
  optionValues: [],
  orders: [],
  services: [
    { id: 'svc-consulta-vet', businessId: VET, categoryId: 'cat-vet', name: 'Consulta veterinária', description: 'Avaliação completa do pet.', image: '', price: 18000, durationMin: 30, professionalIds: ['pro-caio', 'pro-marina'], active: true, featured: true, bookable: true, questions: ['Qual é o pet e a idade?'] },
    { id: 'svc-vacina', businessId: VET, categoryId: 'cat-vet', name: 'Vacinação', description: 'Aplicação com registro no cartão.', image: '', price: 8000, durationMin: 15, professionalIds: ['pro-caio', 'pro-marina'], active: true, featured: false, bookable: true },
    { id: 'svc-odonto', businessId: ODONTO, categoryId: 'cat-consulta', name: 'Consulta Odontológica', description: 'Avaliação completa com dentista.', image: '', price: 20000, durationMin: 60, professionalIds: ['pro-orlando', 'pro-bianca'], active: true, featured: true, bookable: true, questions: ['Possui convênio odontológico? Qual?'] },
    { id: 'svc-clareamento', businessId: ODONTO, categoryId: 'cat-consulta', name: 'Clareamento', description: 'Clareamento a laser em consultório.', image: '', price: 35000, durationMin: 45, professionalIds: ['pro-renan'], active: true, featured: true, bookable: true },
    { id: 'svc-consulta-geral', businessId: GERAL, categoryId: 'cat-especialidades', name: 'Consulta Clínica', description: 'Avaliação geral com clínico.', image: '', price: 15000, durationMin: 30, professionalIds: ['pro-rita', 'pro-sergio'], active: true, featured: true, bookable: true },
    { id: 'svc-exame', businessId: GERAL, categoryId: 'cat-especialidades', name: 'Check-up / Exames', description: 'Painel laboratorial completo.', image: '', price: 25000, durationMin: 45, professionalIds: ['pro-sergio'], active: true, featured: false, bookable: true },
  ],
  professionals: [
    { id: 'pro-caio', businessId: VET, name: 'Dr. Caio', role: 'Médico veterinário', photo: '', active: true, userId: 'user-caio' },
    { id: 'pro-marina', businessId: VET, name: 'Dra. Marina', role: 'Veterinária clínica', photo: '', active: true },
    { id: 'pro-orlando', businessId: ODONTO, name: 'Dr. Orlando', role: 'Dentista', photo: '', active: true, userId: 'user-profissional' },
    // INATIVA de propósito: a grade pública nunca a atribui (cenário F do smoke).
    { id: 'pro-bianca', businessId: ODONTO, name: 'Dra. Bianca', role: 'Orodontista', photo: '', active: false },
    { id: 'pro-rita', businessId: GERAL, name: 'Dra. Rita', role: 'Clínica geral', photo: '', active: true },
    { id: 'pro-sergio', businessId: GERAL, name: 'Dr. Sérgio', role: 'Cardiologista', photo: '', active: true },
    { id: 'pro-renan', businessId: ODONTO, name: 'Dr. Renan', role: 'Ortodontista', photo: '', active: true },
  ],
  // Agenda SEGUNDA A SÁBADO em todas as unidades. Sábado aberto é de
  // propósito: os e2es escolhem um "far saturday" (sábado a ≥8 dias) para
  // ter slot garantido fora do expediente do dia de execução.
  availability: [
    // VET: horário GERAL da empresa (seg–sáb) — os profissionais herdam. É o
    // cenário que o smoke-ux exercita (personalizar/aplicar a todos/voltar a
    // herdar parte da regra geral existir).
    ...[1, 2, 3, 4, 5, 6].map((weekday) => ({ id: `avv-gen-${weekday}`, businessId: VET, professionalId: '', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 })),
    ...[1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { id: `avo-o-${weekday}`, businessId: ODONTO, professionalId: 'pro-orlando', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 },
      { id: `avv-b-${weekday}`, businessId: ODONTO, professionalId: 'pro-bianca', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 },
      { id: `avo-r-${weekday}`, businessId: ODONTO, professionalId: 'pro-renan', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 },
      { id: `avg-r-${weekday}`, businessId: GERAL, professionalId: 'pro-rita', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 },
      { id: `avg-s-${weekday}`, businessId: GERAL, professionalId: 'pro-sergio', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 },
    ]),
  ],
  exceptions: [],
  bookings: [
    { id: 'book-caio', businessId: VET, customerId: '', serviceId: 'svc-consulta-vet', professionalId: 'pro-caio', date: dayAhead(1), time: '09:30', customerName: 'Rafael T.', customerPhone: '11966666666', status: 'pending', note: 'Tutor do Thor (pastor 4 anos)', createdAt: now, updatedAt: now, history: [] },
    { id: 'book-orlando', businessId: ODONTO, customerId: '', serviceId: 'svc-odonto', professionalId: 'pro-orlando', date: dayAhead(1), time: '10:00', customerName: 'Marlene S.', customerPhone: '11955554444', status: 'confirmed', note: '', createdAt: now, updatedAt: now, history: [] },
    { id: 'book-rita', businessId: GERAL, customerId: '', serviceId: 'svc-consulta-geral', professionalId: 'pro-rita', date: dayAhead(2), time: '14:00', customerName: 'Tiago P.', customerPhone: '11944445555', status: 'confirmed', note: '', createdAt: now, updatedAt: now, history: [] },
    // Histórico das unidades (dois profissionais, dois valores de serviço).
    pastBooking('hist-od-1', ODONTO, 'svc-odonto', 'pro-orlando', 3, '09:00', 'completed', 'Marlene S.', '11955554444'),
    pastBooking('hist-od-2', ODONTO, 'svc-odonto', 'pro-orlando', 10, '14:00', 'completed', 'Tiago P.', '11944445555'),
    pastBooking('hist-od-3', ODONTO, 'svc-clareamento', 'pro-orlando', 6, '10:00', 'completed', 'Helena R.', '11933334444'),
    pastBooking('hist-od-4', ODONTO, 'svc-odonto', 'pro-orlando', 12, '11:00', 'no_show', 'Bruno L.', '11922223333'),
    pastBooking('hist-od-5', ODONTO, 'svc-odonto', 'pro-orlando', 18, '15:00', 'cancelled', 'Cláudia M.', '11911112222'),
    pastBooking('hist-od-6', ODONTO, 'svc-clareamento', 'pro-renan', 7, '15:00', 'completed', 'Marlene S.', '11955554444'),
    pastBooking('hist-vt-1', VET, 'svc-consulta-vet', 'pro-caio', 4, '11:00', 'completed', 'Rafael T.', '11966666666'),
    pastBooking('hist-vt-2', VET, 'svc-vacina', 'pro-caio', 9, '16:00', 'completed', 'Diego S.', '11955556666'),
    pastBooking('hist-vt-3', VET, 'svc-consulta-vet', 'pro-marina', 20, '10:00', 'no_show', 'Pedro A.', '11944447777'),
    pastBooking('hist-ge-1', GERAL, 'svc-exame', 'pro-sergio', 5, '09:30', 'completed', 'Helena R.', '11933334444', 'Paciente preferida da manhã — sempre remanejar com antecedência.'),
    pastBooking('hist-ge-2', GERAL, 'svc-consulta-geral', 'pro-rita', 15, '13:00', 'completed', 'Bruno L.', '11922223333'),
  ],
  members: [
    { id: 'mem-secretaria', businessId: ODONTO, userId: 'user-secretaria', role: 'SECRETARIA', permissions: {}, active: true, note: 'Recepção da clínica', createdAt: now, updatedAt: now },
    { id: 'mem-vendedor', businessId: VET, userId: 'user-vendedor', role: 'VENDEDOR', permissions: { agenda: false }, active: true, note: 'Balcão do pet shop interno', createdAt: now, updatedAt: now },
    { id: 'mem-profissional', businessId: ODONTO, userId: 'user-profissional', role: 'PROFISSIONAL', permissions: { dashboard: true, agenda: true, clientes: true, whatsapp: true }, active: true, note: 'Atende na cadeira 1', createdAt: now, updatedAt: now },
    { id: 'mem-caio', businessId: VET, userId: 'user-caio', role: 'PROFISSIONAL', permissions: { dashboard: true, agenda: true, clientes: true }, active: true, note: 'Clínica veterinária — agenda própria', createdAt: now, updatedAt: now },
  ],
  agents: [
    {
      id: `agent-${ODONTO}`, businessId: ODONTO, name: 'Assistente Vitta', enabled: true,
      greeting: 'Olá! Sou o assistente virtual{empresa}. Posso ajudar com horários, serviços e valores.',
      tone: 'acolhedor', objectives: ['duvidas', 'servicos', 'orientar_agendamento', 'whatsapp'],
      instructions: 'Explique os tratamentos de forma simples, sem prometer resultados.',
      restrictions: 'Nunca criar, cancelar ou remarcar agendamento. Nunca citar valores que não estejam no cadastro.',
      handoffMessage: 'Vou te encaminhar para a nossa equipe no WhatsApp — eles ajudam você agora mesmo.',
      knowledgeOverride: 'Convênios: atendemos Amil e Bradesco Dental.\nEstacionamento: convênio com o estacionamento ao lado.',
      channels: { site: true, whatsapp: false }, createdAt: now, updatedAt: now,
    },
  ],
  conversations: [],
  messages: [],
  campaigns: [],
  campaignRecipients: [],
  audit: [],
  supportSessions: [],
  contacts: [
    { id: 'ct-rafael', businessId: VET, customerId: '', name: 'Rafael T.', phone: '11966666666', email: '', createdAt: now, updatedAt: now, source: 'agendamento', lastInteraction: now, marketingOptIn: true, note: 'Tutor do Thor — prefere o Dr. Caio.' },
    { id: 'ct-marlene', businessId: ODONTO, customerId: '', name: 'Marlene S.', phone: '11955554444', email: 'marlene@exemplo.com', createdAt: now, updatedAt: now, source: 'agendamento', lastInteraction: now, marketingOptIn: false, note: 'Paciente do Dr. Orlando — prefere manhã.' },
    // Base com datas de cadastro no passado (novos clientes por período).
    ...[
      ['ct-tiago', 'Tiago P.', '11944445555', 'tiago@exemplo.com', 10, ''],
      ['ct-helena', 'Helena R.', '11933334444', 'helena@exemplo.com', 6, 'Sempre reagendável para o período da manhã.'],
      ['ct-claudia', 'Cláudia M.', '11911112222', '', 18, ''],
    ].map(([id, name, phone, email, days, note]) => ({
      id, businessId: ODONTO, customerId: '', name, phone, email,
      createdAt: tsAgo(days), updatedAt: tsAgo(days), source: 'agendamento',
      lastInteraction: tsAgo(days), marketingOptIn: false, note,
    })),
    { id: 'ct-diego', businessId: VET, customerId: '', name: 'Diego S.', phone: '11955556666', email: '', createdAt: tsAgo(8), updatedAt: tsAgo(8), source: 'agendamento', lastInteraction: tsAgo(8), marketingOptIn: true, note: '' },
  ],
  leads: [
    { id: 'lead-1', businessId: ODONTO, customerId: '', name: 'Rafael T.', phone: '11966666666', email: '', instagram: '', origin: 'agendamento', interest: 'Consulta Odontológica', action: 'agendamento', status: 'converted', createdAt: now, lastInteraction: now },
    // Origens diferentes no passado (sem inventar origem: são as gravadas
    // pelo fluxo que gerou cada lead).
    ...[
      ['lead-3', VET, 'Helena R.', '11933334444', 'instagram', 'Consulta veterinária', 'new', 5],
      ['lead-4', ODONTO, 'Tiago P.', '11944445555', 'whatsapp', 'Clareamento', 'converted', 9],
      ['lead-5', ODONTO, 'Cláudia M.', '11911112222', 'instagram', 'Consulta Odontológica', 'lost', 17],
      ['lead-6', VET, 'Diego S.', '11955556666', 'whatsapp', 'Vacinação', 'converted', 8],
    ].map(([id, businessId, name, phone, origin, interest, status, days]) => ({
      id, businessId, customerId: '', name, phone, email: '', instagram: '', origin,
      interest, action: 'agendamento', status, createdAt: tsAgo(days), lastInteraction: tsAgo(days),
    })),
  ],
  events: [],
};

for (const slug of ['vidavet', 'odontovitta', 'clinicageral']) {
  const businessId = { vidavet: VET, odontovitta: ODONTO, clinicageral: GERAL }[slug];
  for (let i = 0; i < 14; i++) {
    db.events.push({ id: randomUUID(), businessId, type: 'page_view', path: `/${slug}`, meta: {}, createdAt: new Date(Date.now() - Math.floor(Math.random() * 13) * 86400000).toISOString() });
  }
}
for (let i = 0; i < 9; i++) {
  db.events.push({ id: randomUUID(), businessId: ODONTO, type: 'conversion', path: '/odontovitta', meta: { kind: 'booking' }, createdAt: new Date(Date.now() - Math.floor(Math.random() * 13) * 86400000).toISOString() });
}

// Destino: Postgres quando DATABASE_URL existe (Vercel/produção),
// arquivo JSON caso contrário (dev local). Sobrescreve tudo.
if (process.env.DATABASE_URL) {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });
  // Tabela LEGADAMENTE nomeada `instalink_doc` — o nome é técnico e congelado
  // (renomeação exige migração planejada; ver docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md).
  await pool.query('CREATE TABLE IF NOT EXISTS instalink_doc (id SMALLINT PRIMARY KEY, data JSONB NOT NULL)');
  let finalDb = db;
  let merged = false;
  // SEED_MERGE=1: adiciona os demos SEM apagar o que já existe
  // (contas, unidades e sessões atuais são preservados).
  if (process.env.SEED_MERGE === '1') {
    const res = await pool.query('SELECT data FROM instalink_doc WHERE id = 1');
    const cur = res.rows[0]?.data;
    if (cur && typeof cur === 'object') {
      const demoSlugs = new Set(['vidavet', 'odontovitta', 'clinicageral']);
      const hadDemos = (cur.businesses || []).some((b) => demoSlugs.has(b.slug));
      finalDb = { ...cur };
      for (const key of Object.keys(db)) {
        if (!Array.isArray(db[key])) continue;
        if (key === 'sessions' || key === 'customerSessions') { finalDb[key] = cur[key] || []; continue; }
        if (key === 'events' && hadDemos) { finalDb[key] = cur[key] || []; continue; }
        const have = new Set((cur[key] || []).map((r) => r.id));
        finalDb[key] = [...(cur[key] || []), ...db[key].filter((r) => !have.has(r.id))];
      }
      merged = true;
    }
  }
  await pool.query(
    'INSERT INTO instalink_doc (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
    [JSON.stringify(finalDb)],
  );
  await pool.end();
  console.log(merged ? 'Seed MERGE OK (Postgres) — demos adicionados, existente preservado.' : 'Seed OK (Postgres) — demo@godoutor.app / demo1234');
} else {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db));
  console.log('Seed OK — demo@godoutor.app / demo1234 (maria@, vitor@, pro-caio@ e profissional@ usam demo1234)');
}
console.log('   /vidavet · /odontovitta · /clinicageral');
