// Seed de DESENVOLVIMENTO — cria demo user + 2 negócios de exemplo.
// Uso: npm run seed
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes, randomUUID } from 'node:crypto';

const FILE = path.join(process.cwd(), 'data', 'instalink.db.json');

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
const tsAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const pastBooking = (id, businessId, serviceId, professionalId, days, time, status, name, phone) => ({
  id, businessId, customerId: '', serviceId, professionalId, date: dayAgo(days), time,
  customerName: name, customerPhone: phone, status, note: '',
  createdAt: tsAgo(days + 5), updatedAt: tsAgo(days), history: [],
});
const B1 = 'biz-burgerhouse';
const B2 = 'biz-barbeariajoao';
const B3 = 'biz-clinicavitta';

function blocksFor(cta, extra, target) {
  const b = [];
  let o = 0;
  const add = (type, settings = {}) => b.push({ id: `${cta}-${type}-${o}`, type, order: o++, enabled: true, settings });
  add('profile');
  add('cta', { label: cta, target });
  for (const e of extra) add(e[0], e[1] || {});
  add('testimonials', {
    title: 'O que dizem por aí',
    items: [
      { name: 'Maria S.', text: 'Melhor atendimento da região, virei cliente fiel!' },
      { name: 'João P.', text: 'Rápido, fácil e de qualidade. Recomendo demais.' },
    ],
  });
  add('faq', {
    title: 'Dúvidas frequentes',
    items: [
      { q: 'Quais as formas de pagamento?', a: 'PIX, cartão e dinheiro.' },
      { q: 'Como falo com vocês?', a: 'Pelo botão de WhatsApp aqui da página. Respondemos rapidinho!' },
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
    { id: 'user-demo', name: 'Demo GoDoutor', email: 'demo@instalink.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    // Logins de EQUIPE (FASE 3): testam papéis/permissões de verdade.
    { id: 'user-secretaria', name: 'Sofia (secretária)', email: 'secretaria@instalink.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    { id: 'user-vendedor', name: 'Vitor (vendedor)', email: 'vendedor@instalink.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    // PROFISSIONAL (quem ATENDE): vinculado ao profissional 'pro-orlando' via
    // `professionals.userId` — é esse vínculo que produz o escopo "own" da
    // agenda e a Visão geral "Meu dia". Sem ele não dá para verificar o papel.
    { id: 'user-profissional', name: 'Orlando (dentista)', email: 'profissional@instalink.app', passwordHash: hash('demo1234'), createdAt: now, role: 'owner', lastLoginAt: '' },
    // MASTER da PLATAFORMA: papel no banco (não é dono de nada; entra em
    // empresa só por sessão de suporte explícita e auditada).
    { id: 'user-master', name: 'Suporte InstaLink', email: 'master@instalink.app', passwordHash: hash('master1234'), createdAt: now, role: 'master', lastLoginAt: '' },
  ],
  sessions: [],
  businesses: [
    {
      id: B1, ownerId: 'user-demo', name: 'Burger House', slug: 'burgerhouse',
      description: 'Hambúrgueres artesanais feitos na brasa. Peça em 1 minuto!',
      logo: '', cover: '', niche: 'alimentacao', modes: ['products', 'orders'],
      phone: '', whatsapp: '11999999999', email: '', instagram: 'burgerhouse', tiktok: '',
      address: 'Rua das Flores, 123 — Centro, São Paulo/SP', mapsUrl: 'https://maps.google.com/?q=Centro+Sao+Paulo',
      hours: {}, paymentMethods: ['pix', 'card', 'cash'], pixKey: 'contato@burgerhouse.com',
      deliveryFee: 500, minOrder: 0,
      googleUrl: '', googlePlaceId: '', googleApiKey: '',
      booking: { teamMode: 'solo', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 0 },
      published: true, createdAt: now, updatedAt: now,
    },
    {
      id: B2, ownerId: 'user-demo', name: 'Barbearia do João', slug: 'barbeariadojoao',
      description: 'Corte, barba e cuidado de verdade. Agende em segundos.',
      logo: '', cover: '', niche: 'beleza', modes: ['services', 'bookings'],
      phone: '', whatsapp: '11988888888', email: '', instagram: 'barbeariadojoao', tiktok: '',
      address: 'Av. Principal, 456 — Vila Nova, São Paulo/SP', mapsUrl: 'https://maps.google.com/?q=Vila+Nova+SP',
      hours: {}, paymentMethods: ['pix', 'card', 'cash'], pixKey: '',
      deliveryFee: 0, minOrder: 0,
      googleUrl: '', googlePlaceId: '', googleApiKey: '',
      booking: { teamMode: 'auto', leadMin: 60, cancelUntilMin: 180, horizonDays: 30, bufferMin: 10 },
      published: true, createdAt: now, updatedAt: now,
    },
    {
      id: B3, ownerId: 'user-demo', name: 'Clínica Vitta', slug: 'clinicavitta',
      description: 'Odonto e cardio com hora marcada. Escolha a especialidade.',
      logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'],
      phone: '', whatsapp: '11977778888', email: '', instagram: 'clinicavitta', tiktok: '',
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
      id: 'page-burger', businessId: B1,
      theme: { primary: '#ea580c', secondary: '#fbbf24', background: '#fafaf9', surface: '#ffffff', text: '#1c1917', muted: '#78716c', radius: 16, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Pedir agora', [['products', { title: 'Cardápio' }]], 'products'),
      updatedAt: now,
    },
    {
      id: 'page-barbearia', businessId: B2,
      theme: { primary: '#111827', secondary: '#6b7280', background: '#fafaf9', surface: '#ffffff', text: '#1c1917', muted: '#78716c', radius: 14, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Agendar horário', [['services', { title: 'Serviços' }], ['booking', { title: 'Agende seu horário' }]], 'booking'),
      updatedAt: now,
    },
    {
      id: 'page-clinica', businessId: B3,
      theme: { primary: '#0d9488', secondary: '#99f6e4', background: '#fafaf9', surface: '#ffffff', text: '#1c1917', muted: '#78716c', radius: 14, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Agendar atendimento', [['services', { title: 'Especialidades' }], ['booking', { title: 'Agende sua consulta' }]], 'booking'),
      updatedAt: now,
    },
  ],
  categories: [
    { id: 'cat-burgers', businessId: B1, kind: 'product', name: 'Hambúrgueres', order: 0, active: true },
    { id: 'cat-combos', businessId: B1, kind: 'product', name: 'Combos', order: 1, active: true },
    { id: 'cat-bebidas', businessId: B1, kind: 'product', name: 'Bebidas', order: 2, active: true },
    { id: 'cat-cabelo', businessId: B2, kind: 'service', name: 'Cabelo & Barba', order: 0, active: true },
    { id: 'cat-consulta', businessId: B3, kind: 'service', name: 'Consultas', order: 0, active: true },
  ],
  products: [
    { id: 'prod-xbacon', businessId: B1, categoryId: 'cat-burgers', name: 'X-Bacon', description: 'Pão, burger 180g, queijo, bacon crocante e molho da casa.', image: '', price: 2990, promoPrice: 0, active: true, featured: true, order: 0 },
    { id: 'prod-xsalada', businessId: B1, categoryId: 'cat-burgers', name: 'X-Salada', description: 'Burger 180g, queijo, alface, tomate e maionese.', image: '', price: 2790, promoPrice: 0, active: true, featured: false, order: 1 },
    { id: 'prod-duplo', businessId: B1, categoryId: 'cat-burgers', name: 'Duplo Smash', description: 'Dois smash 90g, queijo duplo e cebola caramelizada.', image: '', price: 3490, promoPrice: 2990, active: true, featured: true, order: 2 },
    { id: 'prod-combo', businessId: B1, categoryId: 'cat-combos', name: 'Combo Casal', description: '2 X-Bacon + batata G + 2 refrigerantes.', image: '', price: 5990, promoPrice: 4990, active: true, featured: true, order: 3 },
    { id: 'prod-refri', businessId: B1, categoryId: 'cat-bebidas', name: 'Refrigerante 350ml', description: 'Coca, Guaraná ou Pepsi.', image: '', price: 690, promoPrice: 0, active: true, featured: false, order: 4 },
  ],
  options: [
    { id: 'opt-pao', businessId: B1, productId: 'prod-xbacon', name: 'Escolha o pão', required: true, multiple: false, min: 1, max: 1, order: 0 },
    { id: 'opt-adic', businessId: B1, productId: 'prod-xbacon', name: 'Adicionais', required: false, multiple: true, min: 0, max: 0, order: 1 },
    { id: 'opt-ponto', businessId: B1, productId: 'prod-duplo', name: 'Ponto da carne', required: true, multiple: false, min: 1, max: 1, order: 0 },
  ],
  optionValues: [
    { id: 'val-trad', optionId: 'opt-pao', name: 'Tradicional', priceDelta: 0, active: true },
    { id: 'val-brioche', optionId: 'opt-pao', name: 'Brioche', priceDelta: 0, active: true },
    { id: 'val-bacon', optionId: 'opt-adic', name: 'Bacon', priceDelta: 500, active: true },
    { id: 'val-queijo', optionId: 'opt-adic', name: 'Queijo', priceDelta: 400, active: true },
    { id: 'val-ovo', optionId: 'opt-adic', name: 'Ovo', priceDelta: 300, active: true },
    { id: 'val-mal', optionId: 'opt-ponto', name: 'Mal passado', priceDelta: 0, active: true },
    { id: 'val-ao', optionId: 'opt-ponto', name: 'Ao ponto', priceDelta: 0, active: true },
    { id: 'val-bem', optionId: 'opt-ponto', name: 'Bem passado', priceDelta: 0, active: true },
  ],
  services: [
    { id: 'svc-corte', businessId: B2, categoryId: 'cat-cabelo', name: 'Corte', description: 'Corte moderno com acabamento.', image: '', price: 4500, durationMin: 45, professionalIds: ['pro-joao', 'pro-pedro'], active: true, featured: true, bookable: true },
    { id: 'svc-barba', businessId: B2, categoryId: 'cat-cabelo', name: 'Barba', description: 'Barba com toalha quente.', image: '', price: 3000, durationMin: 30, professionalIds: ['pro-pedro'], active: true, featured: false, bookable: true },
    { id: 'svc-combo', businessId: B2, categoryId: 'cat-cabelo', name: 'Corte + Barba', description: 'O combo completo.', image: '', price: 6500, durationMin: 60, professionalIds: ['pro-joao'], active: true, featured: true, bookable: true },
    { id: 'svc-odonto', businessId: B3, categoryId: 'cat-consulta', name: 'Consulta Odontológica', description: 'Avaliação completa com dentista.', image: '', price: 20000, durationMin: 60, professionalIds: ['pro-orlando'], active: true, featured: true, bookable: true, questions: ['Possui convênio odontológico? Qual?'] },
    { id: 'svc-cardio', businessId: B3, categoryId: 'cat-consulta', name: 'Consulta Cardiológica', description: 'Check-up do coração.', image: '', price: 25000, durationMin: 45, professionalIds: ['pro-joao-cardio'], active: true, featured: true, bookable: true },
  ],
  professionals: [
    { id: 'pro-orlando', businessId: B3, name: 'Dr. Orlando', role: 'Dentista', photo: '', active: true, userId: 'user-profissional' },
    { id: 'pro-joao-cardio', businessId: B3, name: 'Dr. João', role: 'Cardiologista', photo: '', active: true },
    { id: 'pro-ana', businessId: B3, name: 'Dra. Ana', role: 'Fisioterapeuta', photo: '', active: false },
    { id: 'pro-joao', businessId: B2, name: 'João', role: 'Barbeiro master', photo: '', active: true },
    { id: 'pro-pedro', businessId: B2, name: 'Pedro', role: 'Barbeiro', photo: '', active: true },
  ],
  availability: [
    ...[1, 2, 3, 4, 5, 6].map((weekday) => ({ id: `av-${weekday}`, businessId: B2, professionalId: '', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 })),
    ...[1, 2, 3, 4, 5].flatMap((weekday) => [
      { id: `avc-o-${weekday}`, businessId: B3, professionalId: 'pro-orlando', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 },
      { id: `avc-j-${weekday}`, businessId: B3, professionalId: 'pro-joao-cardio', serviceId: '', weekday, start: '09:00', end: '18:00', slotMin: 0 },
    ]),
  ],
  exceptions: [],
  orders: [
    {
      id: 'order-sample', businessId: B1, customerId: '', code: '#0001', customerName: 'Carlos M.', customerPhone: '11977777777',
      customerAddress: 'Rua A, 100', type: 'delivery', payment: 'pix',
      items: [{ productId: 'prod-xbacon', name: 'X-Bacon', qty: 2, unitPrice: 3490, total: 6980, optionsLabel: 'Brioche, Bacon', note: '' }],
      subtotal: 6980, total: 6980, status: 'new', note: '', createdAt: now, updatedAt: now, history: [],
    },
  ],
  bookings: [
    { id: 'book-sample', businessId: B2, customerId: '', serviceId: 'svc-corte', professionalId: 'pro-joao', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: '10:00', customerName: 'Rafael T.', customerPhone: '11966666666', status: 'pending', note: '', createdAt: now, updatedAt: now, history: [] },
    { id: 'book-orlando', businessId: B3, customerId: '', serviceId: 'svc-odonto', professionalId: 'pro-orlando', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: '10:00', customerName: 'Marlene S.', customerPhone: '11955554444', status: 'confirmed', note: '', createdAt: now, updatedAt: now, history: [] },
    // Histórico da clínica (dois profissionais, dois valores de serviço).
    pastBooking('hist-b3-1', B3, 'svc-odonto', 'pro-orlando', 3, '09:00', 'completed', 'Marlene S.', '11955554444'),
    pastBooking('hist-b3-2', B3, 'svc-odonto', 'pro-orlando', 10, '14:00', 'completed', 'Tiago P.', '11944445555'),
    pastBooking('hist-b3-3', B3, 'svc-cardio', 'pro-joao-cardio', 6, '10:00', 'completed', 'Helena R.', '11933334444'),
    pastBooking('hist-b3-4', B3, 'svc-cardio', 'pro-joao-cardio', 12, '11:00', 'no_show', 'Bruno L.', '11922223333'),
    pastBooking('hist-b3-5', B3, 'svc-odonto', 'pro-orlando', 18, '15:00', 'cancelled', 'Cláudia M.', '11911112222'),
    pastBooking('hist-b3-6', B3, 'svc-cardio', 'pro-joao-cardio', 24, '09:30', 'completed', 'Helena R.', '11933334444'),
    // Histórico da barbearia.
    pastBooking('hist-b2-1', B2, 'svc-corte', 'pro-joao', 4, '11:00', 'completed', 'Rafael T.', '11966666666'),
    pastBooking('hist-b2-2', B2, 'svc-barba', 'pro-joao', 9, '16:00', 'completed', 'Diego S.', '11955556666'),
    pastBooking('hist-b2-3', B2, 'svc-corte', 'pro-joao', 20, '10:00', 'no_show', 'Pedro A.', '11944447777'),
  ],
  members: [
    { id: 'mem-secretaria', businessId: B3, userId: 'user-secretaria', role: 'SECRETARIA', permissions: {}, active: true, note: 'Recepção da clínica', createdAt: now, updatedAt: now },
    { id: 'mem-vendedor', businessId: B1, userId: 'user-vendedor', role: 'VENDEDOR', permissions: { agenda: false }, active: true, note: 'Balcão', createdAt: now, updatedAt: now },
    { id: 'mem-profissional', businessId: B3, userId: 'user-profissional', role: 'PROFISSIONAL', permissions: { dashboard: true, agenda: true, clientes: true, whatsapp: true }, active: true, note: 'Atende na cadeira 1', createdAt: now, updatedAt: now },
  ],
  agents: [
    {
      id: `agent-${B3}`, businessId: B3, name: 'Assistente Vita', enabled: true,
      greeting: 'Olá! Sou o assistente virtual{empresa}. Posso ajudar com horários, serviços e valores.',
      tone: 'acolhedor', objectives: ['duvidas', 'servicos', 'orientar_agendamento', 'whatsapp'],
      instructions: 'Explique os tratamentos de forma simples, sem prometer resultados.',
      restrictions: 'Nunca criar, cancelar ou remarcar agendamento. Nunca citar valores que não estejam no cadastro.',
      handoffMessage: 'Vou te encaminhar para a nossa equipe no WhatsApp — eles ajudam você agora mesmo.',
      knowledgeOverride: 'Estacionamento: temos convênio com o estacionamento ao lado.\nFormas de pagamento: PIX, cartão e dinheiro.',
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
    { id: 'ct-carlos', businessId: B1, customerId: '', name: 'Carlos M.', phone: '11977777777', email: '', createdAt: now, updatedAt: now, source: 'pedido', lastInteraction: now, marketingOptIn: true, note: 'Prefere retirada no balcão.' },
    { id: 'ct-rafael', businessId: B2, customerId: '', name: 'Rafael T.', phone: '11966666666', email: '', createdAt: now, updatedAt: now, source: 'agendamento', lastInteraction: now, marketingOptIn: true, note: '' },
    { id: 'ct-marlene', businessId: B3, customerId: '', name: 'Marlene S.', phone: '11955554444', email: 'marlene@exemplo.com', createdAt: now, updatedAt: now, source: 'agendamento', lastInteraction: now, marketingOptIn: false, note: 'Cliente do Dr. Orlando — prefere manhã.' },
    // Base com datas de cadastro no passado (novos clientes por período).
    ...[
      ['ct-tiago', 'Tiago P.', '11944445555', 'tiago@exemplo.com', 10],
      ['ct-helena', 'Helena R.', '11933334444', 'helena@exemplo.com', 6],
      ['ct-claudia', 'Cláudia M.', '11911112222', '', 18],
    ].map(([id, name, phone, email, days]) => ({
      id, businessId: B3, customerId: '', name, phone, email,
      createdAt: tsAgo(days), updatedAt: tsAgo(days), source: 'agendamento',
      lastInteraction: tsAgo(days), marketingOptIn: false, note: '',
    })),
  ],
  leads: [
    { id: 'lead-1', businessId: B1, customerId: '', name: 'Carlos M.', phone: '11977777777', email: '', instagram: '', origin: 'pedido', interest: 'X-Bacon', action: 'pedido', status: 'converted', createdAt: now, lastInteraction: now },
    { id: 'lead-2', businessId: B2, customerId: '', name: 'Rafael T.', phone: '11966666666', email: '', instagram: '', origin: 'agendamento', interest: 'Corte', action: 'agendamento', status: 'converted', createdAt: now, lastInteraction: now },
    // Origens diferentes no passado (sem inventar origem: são as gravadas
    // pelo fluxo que gerou cada lead).
    ...[
      ['lead-3', B3, 'Helena R.', '11933334444', 'instagram', 'Consulta Cardiológica', 'new', 5],
      ['lead-4', B3, 'Tiago P.', '11944445555', 'whatsapp', 'Consulta Odontológica', 'converted', 9],
      ['lead-5', B3, 'Cláudia M.', '11911112222', 'instagram', 'Consulta Odontológica', 'lost', 17],
      ['lead-6', B2, 'Diego S.', '11955556666', 'whatsapp', 'Corte', 'converted', 8],
    ].map(([id, businessId, name, phone, origin, interest, status, days]) => ({
      id, businessId, customerId: '', name, phone, email: '', instagram: '', origin,
      interest, action: 'agendamento', status, createdAt: tsAgo(days), lastInteraction: tsAgo(days),
    })),
  ],
  events: [],
};

for (let i = 0; i < 42; i++) {
  db.events.push({ id: randomUUID(), businessId: B1, type: 'page_view', path: '/burgerhouse', meta: {}, createdAt: new Date(Date.now() - Math.floor(Math.random() * 13) * 86400000).toISOString() });
}
for (let i = 0; i < 9; i++) {
  db.events.push({ id: randomUUID(), businessId: B1, type: 'conversion', path: '/burgerhouse', meta: { kind: 'order' }, createdAt: new Date(Date.now() - Math.floor(Math.random() * 13) * 86400000).toISOString() });
}
for (let i = 0; i < 27; i++) {
  db.events.push({ id: randomUUID(), businessId: B2, type: 'page_view', path: '/barbeariadojoao', meta: {}, createdAt: new Date(Date.now() - Math.floor(Math.random() * 13) * 86400000).toISOString() });
}

// Destino: Postgres quando DATABASE_URL existe (Vercel/produção),
// arquivo JSON caso contrário (dev local). Sobrescreve tudo.
if (process.env.DATABASE_URL) {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });
  await pool.query('CREATE TABLE IF NOT EXISTS instalink_doc (id SMALLINT PRIMARY KEY, data JSONB NOT NULL)');
  let finalDb = db;
  let merged = false;
  // SEED_MERGE=1: adiciona os demos SEM apagar o que já existe
  // (contas, negócios e sessões atuais são preservados).
  if (process.env.SEED_MERGE === '1') {
    const res = await pool.query('SELECT data FROM instalink_doc WHERE id = 1');
    const cur = res.rows[0]?.data;
    if (cur && typeof cur === 'object') {
      const hadDemos = (cur.businesses || []).some((b) => b.slug === 'burgerhouse' || b.slug === 'barbeariadojoao');
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
  console.log(merged ? 'Seed MERGE OK (Postgres) — demos adicionados, existente preservado.' : 'Seed OK (Postgres) — demo@instalink.app / demo1234');
} else {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db));
  console.log('Seed OK — demo@instalink.app / demo1234');
}
console.log('   /burgerhouse · /barbeariadojoao · /clinicavitta');
