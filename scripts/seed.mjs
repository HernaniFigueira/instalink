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
const B1 = 'biz-burgerhouse';
const B2 = 'biz-barbeariajoao';

function blocksFor(cta, extra) {
  const b = [];
  let o = 0;
  const add = (type, settings = {}) => b.push({ id: `${cta}-${type}-${o}`, type, order: o++, enabled: true, settings });
  add('profile');
  add('cta', { label: cta });
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
  users: [{ id: 'user-demo', name: 'Demo InstaLink', email: 'demo@instalink.app', passwordHash: hash('demo1234'), createdAt: now }],
  sessions: [],
  businesses: [
    {
      id: B1, ownerId: 'user-demo', name: 'Burger House', slug: 'burgerhouse',
      description: 'Hambúrgueres artesanais feitos na brasa. Peça em 1 minuto!',
      logo: '', cover: '', niche: 'alimentacao', modes: ['products', 'orders'],
      phone: '', whatsapp: '11999999999', email: '', instagram: 'burgerhouse', tiktok: '',
      address: 'Rua das Flores, 123 — Centro, São Paulo/SP', mapsUrl: 'https://maps.google.com/?q=Centro+Sao+Paulo',
      hours: {}, paymentMethods: ['pix', 'card', 'cash'], pixKey: 'contato@burgerhouse.com',
      published: true, createdAt: now, updatedAt: now,
    },
    {
      id: B2, ownerId: 'user-demo', name: 'Barbearia do João', slug: 'barbeariadojoao',
      description: 'Corte, barba e cuidado de verdade. Agende em segundos.',
      logo: '', cover: '', niche: 'beleza', modes: ['services', 'bookings'],
      phone: '', whatsapp: '11988888888', email: '', instagram: 'barbeariadojoao', tiktok: '',
      address: 'Av. Principal, 456 — Vila Nova, São Paulo/SP', mapsUrl: 'https://maps.google.com/?q=Vila+Nova+SP',
      hours: {}, paymentMethods: ['pix', 'card', 'cash'], pixKey: '',
      published: true, createdAt: now, updatedAt: now,
    },
  ],
  pages: [
    {
      id: 'page-burger', businessId: B1,
      theme: { primary: '#ea580c', secondary: '#fbbf24', background: '#fafaf9', surface: '#ffffff', text: '#1c1917', muted: '#78716c', radius: 16, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Pedir agora', [['products', { title: 'Cardápio' }]]),
      updatedAt: now,
    },
    {
      id: 'page-barbearia', businessId: B2,
      theme: { primary: '#111827', secondary: '#6b7280', background: '#fafaf9', surface: '#ffffff', text: '#1c1917', muted: '#78716c', radius: 14, font: 'inter', buttonStyle: 'solid' },
      blocks: blocksFor('Agendar horário', [['services', { title: 'Serviços' }], ['booking', { title: 'Agende seu horário' }]]),
      updatedAt: now,
    },
  ],
  categories: [
    { id: 'cat-burgers', businessId: B1, kind: 'product', name: 'Hambúrgueres', order: 0, active: true },
    { id: 'cat-combos', businessId: B1, kind: 'product', name: 'Combos', order: 1, active: true },
    { id: 'cat-bebidas', businessId: B1, kind: 'product', name: 'Bebidas', order: 2, active: true },
    { id: 'cat-cabelo', businessId: B2, kind: 'service', name: 'Cabelo & Barba', order: 0, active: true },
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
    { id: 'svc-corte', businessId: B2, categoryId: 'cat-cabelo', name: 'Corte', description: 'Corte moderno com acabamento.', image: '', price: 4500, durationMin: 45, active: true, featured: true, bookable: true },
    { id: 'svc-barba', businessId: B2, categoryId: 'cat-cabelo', name: 'Barba', description: 'Barba com toalha quente.', image: '', price: 3000, durationMin: 30, active: true, featured: false, bookable: true },
    { id: 'svc-combo', businessId: B2, categoryId: 'cat-cabelo', name: 'Corte + Barba', description: 'O combo completo.', image: '', price: 6500, durationMin: 60, active: true, featured: true, bookable: true },
  ],
  professionals: [
    { id: 'pro-joao', businessId: B2, name: 'João', role: 'Barbeiro master', photo: '', active: true },
    { id: 'pro-pedro', businessId: B2, name: 'Pedro', role: 'Barbeiro', photo: '', active: true },
  ],
  availability: [1, 2, 3, 4, 5, 6].map((weekday) => ({ id: `av-${weekday}`, businessId: B2, professionalId: '', weekday, start: '09:00', end: '18:00', slotMin: 30 })),
  exceptions: [],
  orders: [
    {
      id: 'order-sample', businessId: B1, code: '#0001', customerName: 'Carlos M.', customerPhone: '11977777777',
      customerAddress: 'Rua A, 100', type: 'delivery', payment: 'pix',
      items: [{ productId: 'prod-xbacon', name: 'X-Bacon', qty: 2, unitPrice: 3490, total: 6980, optionsLabel: 'Brioche, Bacon', note: '' }],
      subtotal: 6980, total: 6980, status: 'new', note: '', createdAt: now,
    },
  ],
  bookings: [
    { id: 'book-sample', businessId: B2, serviceId: 'svc-corte', professionalId: 'pro-joao', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: '10:00', customerName: 'Rafael T.', customerPhone: '11966666666', status: 'pending', note: '', createdAt: now },
  ],
  leads: [
    { id: 'lead-1', businessId: B1, name: 'Carlos M.', phone: '11977777777', email: '', instagram: '', origin: 'pedido', interest: 'X-Bacon', action: 'pedido', status: 'converted', createdAt: now, lastInteraction: now },
    { id: 'lead-2', businessId: B2, name: 'Rafael T.', phone: '11966666666', email: '', instagram: '', origin: 'agendamento', interest: 'Corte', action: 'agendamento', status: 'converted', createdAt: now, lastInteraction: now },
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
  await pool.query(
    'INSERT INTO instalink_doc (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
    [JSON.stringify(db)],
  );
  await pool.end();
  console.log('Seed OK (Postgres) — demo@instalink.app / demo1234');
} else {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db));
  console.log('Seed OK — demo@instalink.app / demo1234');
}
console.log('   /burgerhouse · /barbeariadojoao');
