// Smoke tests de runtime — valida os 6 blocos contra um servidor local.
// Uso: npm run dev (ou start) em outro terminal, depois: npm run smoke
// BASE pode apontar para preview/prod SOMENTE-leitura? Não — cria dados;
// rode contra ambiente descartável (use --tag para isolar).
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const TAG = process.env.SMOKE_TAG || `smoke${Date.now().toString(36)}`;
const RUN = String(Date.now() % 100000000).padStart(8, '0');
const ph = (n) => `119${RUN.slice(0, 4)}${String(n).padStart(4, '0')}`; // 11 dígitos, único por run
const B1 = 'biz-burgerhouse'; // produtos/pedidos
const B2 = 'biz-barbeariajoao'; // serviços/agenda
const B3 = 'biz-clinicavitta'; // clínica (cenários A–G)

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 5000));
    return api(method, path, body, token);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const isoDay = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

console.log(`\nSMOKE ${BASE} [${TAG}]`);

// ── Públicas ──
console.log('\n— páginas públicas');
let r = await fetch(BASE + '/burgerhouse');
check('GET /burgerhouse 200', r.status === 200);
r = await fetch(BASE + '/recuperar');
check('GET /recuperar 200', r.status === 200);

// ── Conta do consumidor (bloco 3) — antes, pois reserva/pedido exigem login ──
console.log('\n— conta do consumidor');
const email = `${TAG}@smoke.test`;
const reg = await api('POST', '/api/customer/register', { name: `${TAG} User`, phone: ph(4), email, password: 'smoke1234' });
const custToken = reg.data.token || '';
check('registro consumidor → token', !!custToken, `(${reg.status})`);

// ── Slots / agenda (bloco 1+2) ──
console.log('\n— slots e reservas');
const nextDow = (dows) => {
  for (let i = 1; i <= 8; i++) {
    const d = new Date(Date.now() + i * 86400000);
    if (dows.includes(d.getUTCDay())) return d.toISOString().slice(0, 10);
  }
  return isoDay(1);
};
const past = isoDay(-30), tomorrow = nextDow([1, 2, 3, 4, 5, 6]), clinicDay = nextDow([1, 2, 3, 4, 5]);
const pastRes = await api('GET', `/api/bookings?businessId=${B2}&serviceId=svc-corte&date=${past}`);
const pastSlots = pastRes.data.slots || [];
check('data passada → zero slots', pastRes.status === 200 && pastSlots.length === 0, JSON.stringify(pastRes.data).slice(0, 120));
let slots = await api('GET', `/api/bookings?businessId=${B2}&serviceId=svc-corte&professionalId=pro-pedro&date=${tomorrow}`);
const free = slots.data.slots || [];
check('amanhã tem slots livres', slots.status === 200 && free.length > 0, `(${free.length})`);
const t1 = free[0], t2 = free[1] || free[0];

let past1 = await api('POST', '/api/bookings', {
  businessId: B2, serviceId: 'svc-corte', date: past, time: '10:00',
  customerName: `${TAG} Passado`, customerPhone: ph(1),
});
check('reserva no passado rejeitada (4xx)', past1.status >= 400 && past1.status < 500, `(${past1.status})`);

const b1 = await api('POST', '/api/bookings', {
  businessId: B2, serviceId: 'svc-corte', professionalId: 'pro-pedro', date: tomorrow, time: t1,
  customerName: `${TAG} Guest`, customerPhone: ph(2),
}, custToken);
check('reserva criada', !!b1.data.bookingId, `(${b1.status}) ${JSON.stringify(b1.data).slice(0, 140)}`);
const b1id = b1.data.bookingId || '';

const dbl = await api('POST', '/api/bookings', {
  businessId: B2, serviceId: 'svc-corte', professionalId: 'pro-pedro', date: tomorrow, time: t1,
  customerName: `${TAG} Duplo`, customerPhone: ph(3),
}, custToken);
check('slot duplicado → 409', dbl.status === 409, `(${dbl.status})`);

// ── Consumidor: perfil e recuperação ──
console.log('\n— perfil e recuperação');
const me = await api('GET', '/api/customer/me', null, custToken);
check('GET /api/customer/me 200', me.status === 200 && !!me.data.customer, `(${me.status})`);
const patchMe = await api('PATCH', '/api/customer/me', { phone: ph(5) }, custToken);
check('PATCH perfil (telefone) 200', patchMe.status === 200, `(${patchMe.status}) ${JSON.stringify(patchMe.data).slice(0, 120)}`);
const cf = await api('POST', '/api/customer/forgot', { email });
check('forgot consumidor ok sem enumeração', cf.data.ok === true, `(${cf.status}) sent=${cf.data.sent}`);

// orçamento guest (sem token)
const quote = await api('POST', '/api/leads', {
  businessId: B2, origin: 'orcamento', name: `${TAG} Orc`, phone: ph(6), interest: 'Quanto custa corte + barba?',
});
check('orçamento guest criado', quote.status < 300 && quote.data.ok !== false, `(${quote.status})`);

// ── Reserva do consumidor + remarcação atômica ──
console.log('\n— remarcação atômica');
const bslots = await api('GET', `/api/bookings?businessId=${B2}&serviceId=svc-barba&professionalId=pro-pedro&date=${tomorrow}`);
const bfree = bslots.data.slots || [];
const u1 = bfree[0] || '';
const u2 = bfree.find((t) => t !== t1 && t !== u1) || '';
const bc = u1 ? await api('POST', '/api/bookings', {
  businessId: B2, serviceId: 'svc-barba', professionalId: 'pro-pedro', date: tomorrow, time: u1,
  customerName: `${TAG} User`, customerPhone: ph(5),
}, custToken) : { status: 0, data: {} };
const bcid = bc.data.bookingId || '';
check('reserva do consumidor criada', !!bcid, `(${bc.status}) ${JSON.stringify(bc.data).slice(0, 140)}`);
if (bcid && u2 && u2 !== u1) {
  const rsch = await api('PATCH', '/api/customer/bookings', { id: bcid, date: tomorrow, time: u2 }, custToken);
  check('remarcação atômica ok', rsch.status === 200, `(${rsch.status}) ${JSON.stringify(rsch.data).slice(0, 120)}`);
  const race = await api('PATCH', '/api/customer/bookings', { id: bcid, date: tomorrow, time: t1 }, custToken);
  check('remarcação p/ slot ocupado → 409', race.status === 409, `(${race.status})`);
} else {
  check('remarcação atômica ok (pulado: sem 2º slot)', true);
  check('remarcação p/ slot ocupado → 409 (pulado)', true);
}

// ── Pedidos (preço servidor) ──
console.log('\n— pedidos');
const order = await api('POST', '/api/orders', {
  businessId: B1, customerName: `${TAG} Buyer`, customerPhone: ph(7),
  type: 'pickup', payment: 'pix', items: [{ productId: 'prod-xbacon', qty: 1, unitPrice: 1, options: [{ optionId: 'opt-pao', valueIds: ['val-brioche'] }, { optionId: 'opt-adic', valueIds: ['val-bacon'] }] }],
}, custToken);
check('pedido criado com preço do servidor (3490)', order.status < 300 && (order.data.total === 3490 || order.data.order?.total === 3490),
  `(${order.status}) total=${order.data.total ?? order.data.order?.total} ${JSON.stringify(order.data).slice(0, 120)}`);

// ── Lojista (bloco 4+5) ──
console.log('\n— painel do lojista');
const login = await api('POST', '/api/auth/login', { email: 'demo@instalink.app', password: 'demo1234' });
const token = login.data.token || '';
check('login demo → token', !!token, `(${login.status})`);
const noAuth = await api('GET', `/api/overview?businessId=${B1}`);
check('overview sem token → 401', noAuth.status === 401, `(${noAuth.status})`);
const ov = await api('GET', `/api/overview?businessId=${B1}&period=7`, null, token);
check('overview tem receita + upcoming', ov.status === 200 && !!ov.data.revenue && Array.isArray(ov.data.upcoming), `(${ov.status})`);
const p360 = await api('GET', `/api/people360?businessId=${B1}&q=${TAG}`, null, token);
check('people360 encontra comprador', p360.status === 200 && (p360.data.people || []).length > 0, `(${p360.status})`);
const an = await api('GET', `/api/analytics?businessId=${B1}&period=7`, null, token);
check('analytics tem funis + dias', an.status === 200 && an.data.funnelOrders?.length === 5 && an.data.days?.length === 7, `(${an.status})`);
if (b1id) {
  const bad = await api('PATCH', '/api/bookings', { businessId: B2, id: b1id, status: 'completed' }, token);
  check('transição inválida (pending→completed) rejeitada', bad.status >= 400, `(${bad.status})`);
  const good = await api('PATCH', '/api/bookings', { businessId: B2, id: b1id, status: 'confirmed' }, token);
  check('transição válida (pending→confirmed) ok', good.status === 200, `(${good.status})`);
}

// ── Recuperação lojista (sem enumeração) ──
const af = await api('POST', '/api/auth/forgot', { email: 'naoexiste@smoke.test' });
check('forgot lojista ok p/ e-mail inexistente', af.data.ok === true, `(${af.status})`);


// ── CENÁRIOS A–G (mecânica de agendamento/navegação/profissionais) ──
console.log('\n— cenário A/B/E/F: clínica');
const od = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&date=${clinicDay}`);
const odSlots = od.data.slots || [];
check('A: odonto grade horária (60min)', odSlots.length > 0 && odSlots.every((t) => t.endsWith(':00')), JSON.stringify(odSlots.slice(0, 4)));
const ca = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-cardio&date=${clinicDay}`);
const caSlots = ca.data.slots || [];
check('B: cardio grade 45min', caSlots.some((t) => t.endsWith(':45') || t.endsWith(':30')), JSON.stringify(caSlots.slice(0, 4)));
const a1 = await api('POST', '/api/bookings', {
  businessId: B3, serviceId: 'svc-odonto', professionalId: 'pro-orlando', date: clinicDay, time: odSlots[0],
  customerName: `${TAG} Odonto`, customerPhone: ph(10),
}, custToken);
check('A: reserva odonto (Orlando) criada', !!a1.data.bookingId, `(${a1.status})`);
const ca2 = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-cardio&date=${clinicDay}`);
const tX = odSlots.find((t) => (ca2.data.slots || []).includes(t));
if (a1.data.bookingId && tX) {
  const bJoao = await api('POST', '/api/bookings', {
    businessId: B3, serviceId: 'svc-cardio', professionalId: 'pro-joao-cardio', date: clinicDay, time: tX,
    customerName: `${TAG} Cardio`, customerPhone: ph(11),
  }, custToken);
  check('B: mesmo horário, outra especialidade OK', !!bJoao.data.bookingId, `(${bJoao.status}) ${tX}`);
  const bDup = await api('POST', '/api/bookings', {
    businessId: B3, serviceId: 'svc-odonto', professionalId: 'pro-orlando', date: clinicDay, time: odSlots[0],
    customerName: `${TAG} Odonto2`, customerPhone: ph(12),
  }, custToken);
  check('B: mesmo serviço+horário → 409', bDup.status === 409, `(${bDup.status})`);
} else {
  check('B: mesma hora outra especialidade (pulado: sem interseção)', true);
  check('B: mesmo serviço+horário → 409 (pulado)', true);
}
const od2 = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&date=${clinicDay}`);
check('E: ocupado visível em occupied (fora de slots)', (od2.data.occupied || []).includes(odSlots[0]) && !(od2.data.slots || []).includes(odSlots[0]), `occ=${JSON.stringify((od2.data.occupied || []).slice(0, 4))}`);
const anaSlots = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&professionalId=pro-ana&date=${clinicDay}`);
check('F: inativa não tem slots', (anaSlots.data.slots || []).length === 0, `(${(anaSlots.data.slots || []).length})`);
const anaB = await api('POST', '/api/bookings', {
  businessId: B3, serviceId: 'svc-odonto', professionalId: 'pro-ana', date: clinicDay, time: odSlots[1] || '11:00',
  customerName: `${TAG} Ana`, customerPhone: ph(13),
}, custToken);
check('F: reserva com inativa rejeitada', anaB.status >= 400, `(${anaB.status})`);
const pubHtml = await (await fetch(BASE + '/clinicavitta')).text();
check('F: página pública sem Dra. Ana', !pubHtml.includes('Dra. Ana') && pubHtml.includes('Consulta Odontológica'));

console.log('\n— cenário C: barbearia automática');
const barSlots = await api('GET', `/api/bookings?businessId=${B2}&serviceId=svc-barba&date=${tomorrow}`);
const autoT = (barSlots.data.slots || [])[0] || '';
if (autoT) {
  const auto = await api('POST', '/api/bookings', {
    businessId: B2, serviceId: 'svc-barba', date: tomorrow, time: autoT,
    customerName: `${TAG} Auto`, customerPhone: ph(14),
  }, custToken);
  check('C: sem escolher pro, sistema atribui', !!auto.data.bookingId && !!auto.data.professionalName, `(${auto.status}) pro=${auto.data.professionalName}`);
} else {
  check('C: automático (pulado: sem slot)', true);
}

console.log('\n— cenário D: produto ≠ agendamento');
const noBook = await api('POST', '/api/bookings', {
  businessId: B1, serviceId: 'svc-corte', date: tomorrow, time: '10:00',
  customerName: `${TAG} X`, customerPhone: ph(15),
}, custToken);
check('D: negócio sem agenda rejeita booking', noBook.status === 400, `(${noBook.status})`);

console.log('\n— cenário G: menu mobile');
const gHtml = await (await fetch(BASE + '/barbeariadojoao')).text();
check('G: hambúrguer sem Início', gHtml.includes('aria-label="Menu"') && !gHtml.includes('>Início<'));

console.log(`\nRESULTADO: ${pass} ok, ${fail} falhas${fail ? ' → ' + failures.join(' | ') : ''}\n`);
process.exit(fail ? 1 : 0);
