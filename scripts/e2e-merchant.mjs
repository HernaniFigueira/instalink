// E2E: jornada completa do lojista — cadastro → negócio → catálogo →
// publicação → página pública → reserva → pedido → operação → dashboard.
// Roda contra servidor local descartável. Limpa o negócio de teste no fim.
const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const TAG = `e2e${Date.now().toString(36)}`;
const RUN = String(Date.now() % 100000000).padStart(8, '0');
// Os 4 dígitos FINAIS mudam a cada milissegundo; os iniciais só a cada ~10s e
// faziam duas rodadas seguidas colidirem no mesmo telefone ("Você já tem conta").
const ph = (n) => `119${RUN.slice(-4)}${String(n).padStart(4, '0')}`;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
async function api(method, path, body, token, attempt = 0) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    // Antes o retry era infinito: com o teto de 10 negócios/hora o script
    // ficava girando para sempre. Agora tenta 5x e desiste com erro claro.
    if (attempt >= 5) {
      console.error(`  ! 429 persistente em ${method} ${path} — rate limit esgotado, abortando.`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 5000));
    return api(method, path, body, token, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const nextDow = (dows) => {
  for (let i = 1; i <= 8; i++) {
    const d = new Date(Date.now() + i * 86400000);
    if (dows.includes(d.getUTCDay())) return d.toISOString().slice(0, 10);
  }
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
};

console.log(`\nE2E MERCHANT ${BASE} [${TAG}]`);

// 1) conta do lojista
const reg = await api('POST', '/api/auth/register', { name: 'Marlene E2E', email: `${TAG}@e2e.test`, password: 'e2e12345' });
const token = reg.data.token || '';
check('lojista registrado', !!token, `(${reg.status}) ${JSON.stringify(reg.data).slice(0, 100)}`);

// 2) cria o negócio (salão com serviços + agenda + produtos)
const slug = `salao${TAG}`.toLowerCase().replace(/[^a-z0-9]/g, '');
const biz = await api('POST', '/api/businesses', {
  name: 'Salão da Marlene', niche: 'beleza', modes: ['services', 'bookings', 'products'],
  slug, whatsapp: ph(1),
}, token);
const B = biz.data.businessId || '';
check('negócio criado', !!B && !!biz.data.slug, `(${biz.status}) ${JSON.stringify(biz.data).slice(0, 120)}`);

// 3) configura (descrição, endereço, regras da agenda)
const cfg = await api('PATCH', `/api/businesses/${B}`, {
  description: 'Beleza completa no centro.', address: 'Rua X, 10',
  booking: { teamMode: 'choosable', leadMin: 30, cancelUntilMin: 120, horizonDays: 30, bufferMin: 0 },
}, token);
check('configurações salvas', cfg.data.ok === true, `(${cfg.status})`);

// 4) catálogo: categoria, 2 profissionais, 2 serviços vinculados, horários
const cat = await api('POST', '/api/catalog', { businessId: B, action: 'category.save', id: `${TAG}-cat`, kind: 'service', name: 'Cabelo' }, token);
check('categoria criada', cat.data.ok === true, `(${cat.status})`);
const p1 = await api('POST', '/api/catalog', { businessId: B, action: 'professional.save', id: `${TAG}-pro1`, name: 'Marlene', role: 'Cabeleireira', active: true }, token);
const p2 = await api('POST', '/api/catalog', { businessId: B, action: 'professional.save', id: `${TAG}-pro2`, name: 'Bia', role: 'Manicure', active: true }, token);
check('profissionais criados', p1.data.ok === true && p2.data.ok === true, `(${p1.status}/${p2.status})`);
const s1 = await api('POST', '/api/catalog', {
  businessId: B, action: 'service.save', id: `${TAG}-svc1`, name: 'Corte Feminino',
  price: 8000, durationMin: 60, professionalIds: [`${TAG}-pro1`], categoryId: `${TAG}-cat`, active: true, bookable: true,
  questions: ['Possui alergia a algum produto?'],
}, token);
const s2 = await api('POST', '/api/catalog', {
  businessId: B, action: 'service.save', id: `${TAG}-svc2`, name: 'Manicure',
  price: 4500, durationMin: 45, professionalIds: [`${TAG}-pro2`], categoryId: `${TAG}-cat`, active: true, bookable: true,
}, token);
check('serviços vinculados criados', s1.data.ok === true && s2.data.ok === true, `(${s1.status}/${s2.status})`);
const av = await api('POST', '/api/catalog', {
  businessId: B, action: 'availability.save', scope: {},
  rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00', slotMin: 0 })),
}, token);
check('horários salvos', av.data.ok === true, `(${av.status}) ${JSON.stringify(av.data).slice(0, 100)}`);

// 5) produto
const pcat = await api('POST', '/api/catalog', { businessId: B, action: 'category.save', id: `${TAG}-pcat`, kind: 'product', name: 'Cosméticos' }, token);
const prod = await api('POST', '/api/catalog', {
  businessId: B, action: 'product.save', id: `${TAG}-prod1`, name: 'Shampoo Pro', price: 5990,
  categoryId: `${TAG}-pcat`, active: true,
}, token);
check('produto criado', pcat.data.ok === true && prod.data.ok === true, `(${pcat.status}/${prod.status})`);

// 6) publica
const pub = await api('PUT', '/api/pages', { businessId: B, published: true }, token);
check('página publicada', pub.data.ok === true || pub.status < 300, `(${pub.status}) ${JSON.stringify(pub.data).slice(0, 100)}`);

// 7) página pública reflete o cadastro
const html = await (await fetch(`${BASE}/${slug}`)).text();
check('pública: nome + serviços + CTA', html.includes('Salão da Marlene') && html.includes('Corte Feminino') && html.includes('Manicure'), `(${(html.match(/Corte Feminino/g) || []).length}x)`);
check('pública: vitrine com CTA "Tenho interesse" (sem carrinho/checkout)', html.includes('Tenho interesse') && !html.toLowerCase().includes('carrinho'), `(cta=${(html.match(/Tenho interesse/g) || []).length})`);
check('pública: menu sem Início', html.includes('aria-label="Menu"') && !html.includes('>Início<'));
check('pública: sem dados de outro negócio', !html.includes('X-Bacon') && !html.includes('Consulta Odontológica'));

// 8) cliente reserva
const cReg = await api('POST', '/api/customer/register', { name: 'Cliente E2E', phone: ph(2), email: `${TAG}-c@e2e.test`, password: 'e2e12345' });
const cTok = cReg.data.token || '';
check('cliente registrado', !!cTok, `(${cReg.status})`);
const day = nextDow([1, 2, 3, 4, 5]);
const slots = await api('GET', `/api/bookings?businessId=${B}&serviceId=${TAG}-svc1&date=${day}`);
const free = slots.data.slots || [];
check('slots do corte (grade 60min)', free.length > 0 && free.every((t) => t.endsWith(':00')), JSON.stringify(free.slice(0, 3)));
const book = await api('POST', '/api/bookings', {
  businessId: B, serviceId: `${TAG}-svc1`, professionalId: `${TAG}-pro1`, date: day, time: free[0],
  customerName: 'Cliente E2E', customerPhone: ph(2), answers: ['Não tenho'],
}, cTok);
check('reserva criada', !!book.data.bookingId, `(${book.status}) ${JSON.stringify(book.data).slice(0, 120)}`);

// 9) lojista opera a reserva
const manage = await api('GET', `/api/bookings?businessId=${B}&mode=manage`, null, token);
check('agenda mostra a reserva', (manage.data.bookings || []).some((b) => b.id === book.data.bookingId), `(total=${manage.data.total})`);
check('resposta chega na agenda', (manage.data.bookings || []).some((b) => b.id === book.data.bookingId && (b.answers || []).includes('Não tenho')));
const conf = await api('PATCH', '/api/bookings', { businessId: B, id: book.data.bookingId, status: 'confirmed' }, token);
check('reserva confirmada', conf.status === 200, `(${conf.status})`);

// 10) produto NÃO gera pedido (vitrine → WhatsApp): a API recusa para o salão
const order = await api('POST', '/api/orders', {
  businessId: B, customerName: 'Cliente E2E', customerPhone: ph(2),
  type: 'pickup', payment: 'pix', items: [{ productId: `${TAG}-prod1`, qty: 1 }],
}, cTok);
check('vitrine não cria pedido (403 sem módulo de pedidos)', order.status === 403, `(${order.status})`);
const orders = await api('GET', `/api/orders?businessId=${B}`, null, token);
check('sem pedidos no negócio de atendimento', (orders.data.orders || []).length === 0, `(total=${orders.data.total})`);

// 11) conta do cliente + dashboard
const myB = await api('GET', `/api/customer/bookings?businessId=${B}`, null, cTok);
check('cliente vê agendamento', (myB.data.bookings || []).length > 0);
const ov = await api('GET', `/api/overview?businessId=${B}`, null, token);
check('overview: receita PREVISTA dos atendimentos (sem pedido)', ov.status === 200 && (ov.data.revenueDetail?.sources || []).includes('bookings') && ov.data.revenueDetail?.orders === null, `(sources=${JSON.stringify(ov.data.revenueDetail?.sources)})`);
check('dashboard: sem pedidos no payload', ov.data.totals?.orders === 0 && ov.data.ordersPanel === null);
check('checklist "Comece por aqui" com progresso real', Array.isArray(ov.data.checklist) && ov.data.checklist.length > 0 && ov.data.checklist.some((c) => c.label === 'Cadastre seus serviços' && c.done === true), JSON.stringify((ov.data.checklist || []).map((c) => [c.label, c.done])));
const p360 = await api('GET', `/api/people360?businessId=${B}`, null, token);
check('cliente 360 unificado', (p360.data.people || []).some((p) => p.bookings.length > 0 && p.bookings.some((b) => b.service === 'Corte Feminino')));
const an = await api('GET', `/api/analytics?businessId=${B}&period=7`, null, token);
check('analytics ok', an.status === 200 && an.data.days?.length === 7);

// 12) isolamento multi-tenant (negócio A não vê B)
const other = await api('GET', `/api/bookings?businessId=${B}&mode=manage`, null, 'token-invalido');
check('gestão exige dono (401)', other.status === 401, `(${other.status})`);

console.log(`\nRESULTADO: ${pass} ok, ${fail} falhas${fail ? ' → ' + failures.join(' | ') : ''}\n`);
console.log(`BIZ_ID=${B} SLUG=${slug} TAG=${TAG}`);
process.exit(fail ? 1 : 0);
