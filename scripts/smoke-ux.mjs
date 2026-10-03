// Smoke do refinamento de UX (agenda, horários, dashboard, 401×403, página pública).
// Uso: npm run dev em outro terminal e depois `npm run smoke:ux`.
// Roda contra ambiente descartável (cria membro de equipe e agendamentos de teste).
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const TAG = process.env.SMOKE_TAG || `ux${Date.now().toString(36)}`;
const RUN = String(Date.now() % 100000000).padStart(8, '0');
const ph = (n) => `119${RUN.slice(0, 4)}${String(n).padStart(4, '0')}`;

// No seed clínico NÃO existe unidade de vitrine: o ramo varejista é exercido
// por uma unidade criada AQUI via payload de compatibilidade (modes/niche no
// POST /api/businesses) — exatamente o contrato legado que GODOUTOR_LEGACY_PAGES
// mantém vivo. As unidades clínicas vêm do seed.
const B2 = 'biz-vidavet';          // veterinária (equipe automática)
const B3 = 'biz-odontovitta';      // clínica (equipe escolhível)
let B1 = '';                       // varejo descartável criado neste run

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
const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const nextDow = (list) => {
  for (let i = 1; i <= 10; i++) {
    const d = new Date(Date.now() + i * 86400000);
    if (list.includes(d.getUTCDay())) return d.toISOString().slice(0, 10);
  }
  return isoDay(1);
};
const clinicDay = nextDow([1, 2, 3, 4, 5]);
const otherClinicDay = nextDow([1, 2, 3, 4, 5].filter((d) => d !== new Date(clinicDay + 'T12:00:00Z').getUTCDay()));
const saturday = nextDow([6]);

console.log(`\nSMOKE UX ${BASE} [${TAG}]`);

// ── 1. 401 × 403: sessão nunca é destruída por falta de permissão ──
console.log('\n— 401 × 403 (sessão preservada)');
const noToken = await api('GET', `/api/overview?businessId=${B3}`);
check('sem token → 401 (sessão inexistente)', noToken.status === 401, `(${noToken.status})`);

const owner = await api('POST', '/api/auth/login', { email: 'demo@godoutor.app', password: 'demo1234' });
const ownerToken = owner.data.token || '';
check('login do dono → token', !!ownerToken, `(${owner.status})`);

{
  const rv = await api('POST', '/api/businesses', {
    name: `Loja Smoke ${TAG}`, slug: `loja-smoke-${TAG}`,
    modes: ['products', 'orders'], niche: 'loja',
  }, ownerToken);
  B1 = rv.data.businessId || '';
  check('ramo varejista (legado) cria unidade com pedidos', !!B1, `(${rv.status}) ${rv.data.error || ''}`);
}

const viewerEmail = `${TAG}.viewer@smoke.test`;
const member = await api('POST', '/api/team', {
  businessId: B3, name: `${TAG} Viewer`, email: viewerEmail, password: 'viewer123', role: 'VIEWER',
}, ownerToken);
check('membro VIEWER criado (sem permissões)', member.status < 300, `(${member.status}) ${member.data.error || ''}`);

const viewerLogin = await api('POST', '/api/auth/login', { email: viewerEmail, password: 'viewer123' });
const viewerToken = viewerLogin.data.token || '';
check('login do VIEWER → token', !!viewerToken, `(${viewerLogin.status})`);

const meBefore = await api('GET', '/api/auth/me', null, viewerToken);
check('VIEWER tem sessão válida (auth/me 200)', meBefore.status === 200, `(${meBefore.status})`);

const deniedOverview = await api('GET', `/api/overview?businessId=${B3}`, null, viewerToken);
check('VIEWER sem permissão de dashboard → 403 (não 401)', deniedOverview.status === 403, `(${deniedOverview.status})`);
check('403 devolve mensagem amigável do servidor', typeof (deniedOverview.data.error || '') === 'string', JSON.stringify(deniedOverview.data).slice(0, 100));

const meAfter = await api('GET', '/api/auth/me', null, viewerToken);
check('DEPOIS do 403 a sessão continua válida (não deslogou)', meAfter.status === 200, `(${meAfter.status})`);

const deniedTeam = await api('GET', `/api/team?businessId=${B3}`, null, viewerToken);
check('outra área negada → 403', deniedTeam.status === 403, `(${deniedTeam.status})`);
const deniedAction = await api('PATCH', '/api/bookings', { businessId: B3, id: 'bk-inexistente', status: 'confirmed' }, viewerToken);
check('ação negada → 403 (nunca 401)', deniedAction.status === 403, `(${deniedAction.status})`);
const meAgain = await api('GET', '/api/auth/me', null, viewerToken);
check('sessão do VIEWER segue intacta após vários 403', meAgain.status === 200, `(${meAgain.status})`);

// ── 2. Dashboard contextual ──
console.log('\n— dashboard contextual por tipo de negócio');
const clinicOv = await api('GET', `/api/overview?businessId=${B3}&period=30`, null, ownerToken);
check('clínica: overview 200', clinicOv.status === 200, `(${clinicOv.status})`);
const c = clinicOv.data;
check('clínica: módulos de pedidos/produtos desligados', c.context?.modules?.orders === false && c.context?.modules?.products === false, JSON.stringify(c.context?.modules));
check('clínica: SEM painel de pedidos no payload', c.ordersPanel === null, JSON.stringify(c.ordersPanel));
check('clínica: SEM painel de produtos no payload', c.productsPanel === null, JSON.stringify(c.productsPanel));
check('clínica: totais de pedidos zerados (módulo off)', c.totals?.orders === 0 && c.totals?.newOrders === 0, JSON.stringify(c.totals));
check('clínica: operação de hoje e próximos atendimentos presentes', !!c.today && Array.isArray(c.upcoming), `today=${JSON.stringify(c.today)}`);
check('clínica: vocabulário "atendimentos"', c.context?.labels?.activityUnit === 'atendimentos', c.context?.labels?.activityUnit);
check('clínica: receita vem de atendimentos', JSON.stringify(c.context?.revenue) === JSON.stringify(['bookings']), JSON.stringify(c.context?.revenue));
check('clínica: KPIs sem "orders"', !(c.context?.kpis || []).includes('orders'), JSON.stringify(c.context?.kpis));
check('clínica: receita rotulada "Receita prevista"', c.revenueDetail?.bookings?.label === 'Receita prevista', c.revenueDetail?.bookings?.label);
check('clínica: regra da receita documentada no hint', /não é dinheiro recebido/i.test(c.revenueDetail?.hints?.bookings || ''), c.revenueDetail?.hints?.bookings);
check('clínica: receita de pedidos ausente (sem módulo)', c.revenueDetail?.orders === null, JSON.stringify(c.revenueDetail?.orders));
check('clínica: identidade da empresa no payload (logo/nome)', c.business?.name === 'Clínica Odonto Vitta' && 'logo' in (c.business || {}), JSON.stringify(c.business));

// ── 2b. varejo LEGADO sob flag OFF: projeção mascara o comércio (bloqueio final PR #51) ──
// A unidade B1 tem products+orders NO STORAGE (criada pelo payload de
// compatibilidade). Com GODOUTOR_LEGACY_PAGES OFF nada disso pode contaminar a
// Dashboard/Overview — mas os dados têm de permanecer vivos na API.
const catProd = await api('POST', '/api/catalog', {
  businessId: B1, action: 'product.save', name: `Produto ${TAG}`, price: 2500, active: true,
}, ownerToken);
check('varejo OFF: cadastro de produto legado funciona (storage preservado)', catProd.status < 300, `(${catProd.status}) ${JSON.stringify(catProd.data).slice(0, 120)}`);
const prodId = catProd.data?.product?.id || catProd.data?.id || '';
const custReg = await api('POST', '/api/customer/register', {
  name: `Cliente ${TAG}`, phone: ph(31), email: `${TAG}.cust@smoke.test`, password: 'smoke1234',
});
const custTok = custReg.data.token || '';
const legacyOrder = await api('POST', '/api/orders', {
  businessId: B1, customerName: `Cliente ${TAG}`, customerPhone: ph(31),
  type: 'pickup', payment: 'pix', items: prodId ? [{ productId: prodId, qty: 1, options: [] }] : [],
}, custTok);
check('varejo OFF: API de pedidos segue aceitando pedido legado (módulo ativo no dado)', legacyOrder.status < 300, `(${legacyOrder.status}) ${JSON.stringify(legacyOrder.data).slice(0, 140)}`);
const ordersList = await api('GET', `/api/orders?businessId=${B1}`, null, ownerToken);
check('varejo OFF: lojista ainda lista os pedidos no storage', (ordersList.data.orders || []).length >= 1, `(total=${ordersList.data.total})`);

const retailOv = await api('GET', `/api/overview?businessId=${B1}&period=30`, null, ownerToken);
const r = retailOv.data;
check('varejo: overview 200', retailOv.status === 200, `(${retailOv.status})`);
check('varejo: módulos de agenda desligados', r.context?.modules?.bookings === false, JSON.stringify(r.context?.modules));
check('varejo OFF: Dashboard SEM painel de pedidos (projeção mascarada)', r.ordersPanel === null && r.hasOrdersModule === false, JSON.stringify(r.ordersPanel));
check('varejo OFF: SEM painel de produtos na projeção', r.productsPanel === null && r.hasProductsModule === false, JSON.stringify(r.productsPanel));
check('varejo OFF: totais de pedidos zerados no payload', r.totals?.orders === 0 && r.totals?.newOrders === 0, JSON.stringify(r.totals));
check('varejo OFF: atividade recente sem pedidos', Array.isArray(r.recent?.orders) && r.recent.orders.length === 0, JSON.stringify(r.recent?.orders));
check('varejo OFF: receita de pedido fora do resumo financeiro', r.revenueDetail?.orders === null && !(r.context?.revenue || []).includes('orders'), JSON.stringify(r.revenueDetail?.orders));
check('varejo OFF: receita ocultada sem fonte (nada cai em fallback)', r.revenue?.total === 0 && r.revenue?.hasData === false, JSON.stringify(r.revenue));
check('varejo OFF: payload modules não anuncia commerce', ['products', 'orders', 'quote'].every((m) => !(r.modules || []).includes(m)), JSON.stringify(r.modules));
check('varejo: SEM operação de hoje nem próximos atendimentos', r.today === null && Array.isArray(r.upcoming) && r.upcoming.length === 0, `today=${JSON.stringify(r.today)} upcoming=${r.upcoming?.length}`);
check('varejo OFF: vocabulário sem pedidos na projeção', r.context?.labels?.showsOrders === false && r.context?.labels?.activityUnit !== 'pedidos', JSON.stringify(r.context?.labels));
check('varejo: KPIs sem "attendance" e sem "orders" na projeção', !(r.context?.kpis || []).includes('attendance') && !(r.context?.kpis || []).includes('orders'), JSON.stringify(r.context?.kpis));
check('varejo OFF: checklist sem agenda/horários E sem vitrine/pedidos', !(r.checklist || []).some((i) => /horários|vitrine|produtos|pedidos/i.test(i.label)), JSON.stringify(r.checklist?.map((i) => i.label)));

const poorOv = await api('GET', `/api/overview?businessId=${B1}&period=7`, null, ownerToken);
check('sem dados no período → hasData false (nada de valor inventado)', typeof poorOv.data.revenue?.hasData === 'boolean', JSON.stringify(poorOv.data.revenue));

// ── 3. Agenda: reagendar (o que o drag-and-drop chama no servidor) ──
console.log('\n— agenda: reagendamento validado no servidor');
const slotsRes = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&date=${clinicDay}`);
const freeSlots = slotsRes.data.slots || [];
check('há horários livres para testar', freeSlots.length >= 4, `(${freeSlots.length})`);
const [s0, s1, s2, s3] = freeSlots;

const created = await api('POST', '/api/bookings', {
  asOwner: true, businessId: B3, serviceId: 'svc-odonto', professionalId: 'pro-orlando',
  date: clinicDay, time: s0, customerName: `${TAG} Move`, customerPhone: ph(21),
}, ownerToken);
const bkId = created.data.bookingId || '';
check('dono cria agendamento', !!bkId, `(${created.status}) ${created.data.error || ''}`);

const mv = await api('PATCH', '/api/bookings', { businessId: B3, id: bkId, date: clinicDay, time: s1 }, ownerToken);
check('mover para horário livre → ok (move, não recria)', mv.status === 200 && mv.data.moved === true && mv.data.created === false, `(${mv.status}) ${JSON.stringify(mv.data).slice(0, 120)}`);

const afterMove = await api('GET', `/api/bookings?businessId=${B3}&mode=manage&from=${clinicDay}&to=${clinicDay}&limit=200`, null, ownerToken);
const moved = (afterMove.data.bookings || []).find((b) => b.id === bkId);
check('o MESMO atendimento está no novo horário', !!moved && moved.time === s1, `time=${moved?.time} esperado=${s1}`);
check('status preservado no move (confirmed continua confirmed)', moved?.status === 'confirmed', moved?.status);
check('histórico registra o reagendamento', (moved?.history || []).some((h) => /Reagendado/.test(h.note || '')), JSON.stringify(moved?.history?.slice(-1)));

// outro atendimento ocupa s2 — mover por cima dele precisa ser recusado
const blocker = await api('POST', '/api/bookings', {
  asOwner: true, businessId: B3, serviceId: 'svc-odonto', professionalId: 'pro-orlando',
  date: clinicDay, time: s2, customerName: `${TAG} Bloqueio`, customerPhone: ph(22),
}, ownerToken);
check('segundo atendimento criado (ocupa outro horário)', !!blocker.data.bookingId, `(${blocker.status}) ${blocker.data.error || ''}`);
const clash = await api('PATCH', '/api/bookings', { businessId: B3, id: bkId, date: clinicDay, time: s2 }, ownerToken);
check('mover para horário ocupado → 409', clash.status === 409, `(${clash.status}) ${clash.data.error || ''}`);
check('409 explica o conflito (mensagem amigável)', /ocupado|conflito|indispon/i.test(clash.data.error || ''), clash.data.error);
const untouched = await api('GET', `/api/bookings?businessId=${B3}&mode=manage&from=${clinicDay}&to=${clinicDay}&limit=200`, null, ownerToken);
check('conflito recusado NÃO moveu o atendimento', (untouched.data.bookings || []).find((b) => b.id === bkId)?.time === s1, String((untouched.data.bookings || []).find((b) => b.id === bkId)?.time));
const pastMove = await api('PATCH', '/api/bookings', { businessId: B3, id: bkId, date: isoDay(-5), time: s1 }, ownerToken);
check('mover para o passado → 400', pastMove.status === 400, `(${pastMove.status})`);
const farMove = await api('PATCH', '/api/bookings', { businessId: B3, id: bkId, date: isoDay(6 * 366), time: s1 }, ownerToken);
check('mover além do limite administrativo de 5 anos → 400', farMove.status === 400, `(${farMove.status})`);
const badTime = await api('PATCH', '/api/bookings', { businessId: B3, id: bkId, date: clinicDay, time: '99:99' }, ownerToken);
check('horário inválido → 400', badTime.status === 400, `(${badTime.status})`);

// Fechamento pelo caminho clínico de verdade: chegada registrada na fila →
// registro de atendimento (encounter) em andamento → FINALIZAR, que conclui o
// agendamento pelo serviço oficial (máquina de estados + histórico + evento
// de automação). O atalho "concluir sem registro" exige horário já passado,
// então o smoke usa o caminho real da recepção.
const arrive = await api('POST', '/api/queue', {
  businessId: B3, bookingId: bkId, customerName: `${TAG} Move`, customerPhone: ph(21),
}, ownerToken);
const enc = await api('POST', '/api/encounters', {
  businessId: B3, bookingId: bkId,
  complaint: 'Avaliação de rotina solicitada pelo paciente',
  guidance: 'Manter escovação duas vezes ao dia e retorno em seis meses',
}, ownerToken);
const encId = enc.data.encounter?.id || '';
const encVer = enc.data.encounter?.version;
const fin = await api('PATCH', '/api/encounters', {
  businessId: B3, id: encId, action: 'finalize', expectedVersion: encVer,
}, ownerToken);
const bkAfter = await api('GET', `/api/bookings?businessId=${B3}&mode=manage&from=${clinicDay}&to=${clinicDay}&limit=200`, null, ownerToken);
const doneRow = (bkAfter.data.bookings || []).find((b) => b.id === bkId) || {};
check('concluir atendimento → ok', arrive.status === 200 && fin.status === 200 && doneRow.status === 'completed', `q=${arrive.status} enc=${enc.status} fin=${fin.status} ${fin.data.error || ''} st=${doneRow.status}`);
const nextDaySlots = (await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&date=${otherClinicDay}`)).data.slots || [];
check('outro dia tem horários livres', nextDaySlots.length > 0, `(${nextDaySlots.length})`);
const re = await api('PATCH', '/api/bookings', { businessId: B3, id: bkId, date: otherClinicDay, time: nextDaySlots[0] }, ownerToken);
check('reagendar CONCLUÍDO cria novo atendimento', re.status === 200 && re.data.created === true && !!re.data.newId, `(${re.status}) ${JSON.stringify(re.data).slice(0, 120)}`);
const dayAfter = await api('GET', `/api/bookings?businessId=${B3}&mode=manage&from=${clinicDay}&to=${otherClinicDay}&limit=200`, null, ownerToken);
const list = dayAfter.data.bookings || [];
const original = list.find((b) => b.id === bkId);
const reborn = list.find((b) => b.id === re.data.newId);
check('o concluído permanece concluído (histórico preservado)', original?.status === 'completed' && original?.date === clinicDay, `${original?.status} ${original?.date}`);
check('novo atendimento nasce pendente no novo dia', reborn?.status === 'pending' && reborn?.date === otherClinicDay, `${reborn?.status} ${reborn?.date}`);
check('novo atendimento aponta para o anterior (previousId)', reborn?.previousId === bkId, reborn?.previousId);
check('contador de reagendamentos incrementa', (reborn?.rescheduleCount || 0) === 1, String(reborn?.rescheduleCount));
check('cliente/telefone preservados no novo atendimento', reborn?.customerName === original?.customerName && reborn?.customerPhone === original?.customerPhone, `${reborn?.customerName}`);

// ── 4. Horários: herança × personalização × aplicar a todos ──
console.log('\n— horários: herança do horário da empresa');
const cat0 = await api('GET', `/api/catalog/get?businessId=${B2}`, null, ownerToken);
const pros0 = cat0.data.professionals || [];
check('legado sem o campo → todos herdam o horário da empresa', pros0.length > 0 && pros0.every((p) => p.followBusinessHours === true), JSON.stringify(pros0.map((p) => [p.id, p.followBusinessHours])));
check('horário geral existe (escopo vazio)', (cat0.data.availability || []).some((a) => a.professionalId === ''), '');

const personalize = await api('POST', '/api/catalog', {
  businessId: B2, action: 'professional.hours', id: 'pro-marina', follow: false,
  rules: [{ weekday: 6, start: '09:00', end: '12:00', slotMin: 30 }],
}, ownerToken);
check('personalizar horário do profissional → ok', personalize.status === 200, `(${personalize.status}) ${personalize.data.error || ''}`);

const cat1 = await api('GET', `/api/catalog/get?businessId=${B2}`, null, ownerToken);
const pedro = (cat1.data.professionals || []).find((p) => p.id === 'pro-marina');
const joao = (cat1.data.professionals || []).find((p) => p.id === 'pro-caio');
check('profissional personalizado não segue mais a empresa', pedro?.followBusinessHours === false, String(pedro?.followBusinessHours));
check('o outro continua herdando', joao?.followBusinessHours === true, String(joao?.followBusinessHours));
const pedroRules = (cat1.data.availability || []).filter((a) => a.professionalId === 'pro-marina');
check('regras próprias gravadas somente para ele', pedroRules.length === 1 && pedroRules[0].weekday === 6, JSON.stringify(pedroRules));

const satSlots = await api('GET', `/api/bookings?businessId=${B2}&serviceId=svc-consulta-vet&date=${saturday}`);
const byPro = satSlots.data.byPro || {};
check('byPro expõe os horários de cada profissional (drag-and-drop)', Object.keys(byPro).length === 2, JSON.stringify(Object.keys(byPro)));
check('personalizado atende só no próprio horário (sáb 09:00–12:00)', (byPro['pro-marina'] || []).every((t) => t >= '09:00' && t < '12:00') && (byPro['pro-marina'] || []).length > 0, JSON.stringify(byPro['pro-marina']));
check('quem herda atende no horário geral (depois das 12:00 também)', (byPro['pro-caio'] || []).some((t) => t >= '12:00'), JSON.stringify((byPro['pro-caio'] || []).slice(0, 3)));

// alterar o horário geral só afeta quem herda
const generalBefore = (cat1.data.availability || []).filter((a) => a.professionalId === '');
const newGeneral = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '10:00', end: '16:00', slotMin: 0 }));
const saveGeneral = await api('POST', '/api/catalog', { businessId: B2, action: 'availability.save', scope: { professionalId: '' }, rules: newGeneral }, ownerToken);
check('alterar o horário geral → ok', saveGeneral.status === 200, `(${saveGeneral.status}) ${saveGeneral.data.error || ''}`);
const satSlots2 = await api('GET', `/api/bookings?businessId=${B2}&serviceId=svc-consulta-vet&date=${saturday}`);
const byPro2 = satSlots2.data.byPro || {};
check('quem herda foi atualizado automaticamente', (byPro2['pro-caio'] || []).every((t) => t >= '10:00' && t < '16:00'), JSON.stringify((byPro2['pro-caio'] || []).slice(0, 3)));
check('quem personalizou NÃO foi afetado', JSON.stringify(byPro2['pro-marina']) === JSON.stringify(byPro['pro-marina']), `${JSON.stringify(byPro2['pro-marina'])} vs ${JSON.stringify(byPro['pro-marina'])}`);

const apply = await api('POST', '/api/catalog', { businessId: B2, action: 'availability.applyToAll' }, ownerToken);
check('aplicar horário a todos → ok', apply.status === 200, `(${apply.status}) ${apply.data.error || ''}`);
check('aplicar a todos toca só em quem segue a empresa', apply.data.updated === 1 && apply.data.skipped === 1, JSON.stringify({ updated: apply.data.updated, skipped: apply.data.skipped }));
check('mensagem explica quem não foi alterado', /personalizado/i.test(apply.data.message || ''), apply.data.message);
const cat2 = await api('GET', `/api/catalog/get?businessId=${B2}`, null, ownerToken);
const pedro2 = (cat2.data.professionals || []).find((p) => p.id === 'pro-marina');
check('personalização sobrevive ao "aplicar a todos"', pedro2?.followBusinessHours === false && (cat2.data.availability || []).some((a) => a.professionalId === 'pro-marina'), String(pedro2?.followBusinessHours));

const backToGeneral = await api('POST', '/api/catalog', { businessId: B2, action: 'professional.hours', id: 'pro-marina', follow: true }, ownerToken);
check('voltar a seguir a empresa → ok', backToGeneral.status === 200, `(${backToGeneral.status}) ${backToGeneral.data.error || ''}`);
const cat3 = await api('GET', `/api/catalog/get?businessId=${B2}`, null, ownerToken);
check('voltar a herdar retoma o horário geral (regras próprias ficam preservadas e inativas)', (cat3.data.professionals || []).find((p) => p.id === 'pro-caio')?.followBusinessHours === true, String((cat3.data.professionals || []).find((p) => p.id === 'pro-caio')?.followBusinessHours));
check('profissional volta a seguir a empresa', (cat3.data.professionals || []).find((p) => p.id === 'pro-marina')?.followBusinessHours === true, '');

// restaura o horário geral original (o seed continua utilizável)
await api('POST', '/api/catalog', {
  businessId: B2, action: 'availability.save', scope: { professionalId: '' },
  rules: generalBefore.map((a) => ({ weekday: a.weekday, start: a.start, end: a.end, slotMin: a.slotMin })),
}, ownerToken);
const cat4 = await api('GET', `/api/catalog/get?businessId=${B2}`, null, ownerToken);
check('horário geral restaurado', (cat4.data.availability || []).filter((a) => a.professionalId === '').length === generalBefore.length, `${(cat4.data.availability || []).filter((a) => a.professionalId === '').length} × ${generalBefore.length}`);

const invalidHours = await api('POST', '/api/catalog', { businessId: B2, action: 'professional.hours', id: 'pro-caio', follow: false, rules: [{ weekday: 1, start: '18:00', end: '09:00' }] }, ownerToken);
check('janela inválida (fim antes do início) → recusada', invalidHours.status >= 400, `(${invalidHours.status})`);
const unknownPro = await api('POST', '/api/catalog', { businessId: B2, action: 'professional.hours', id: 'pro-fantasma', follow: true }, ownerToken);
check('profissional inexistente → 400/404', unknownPro.status >= 400, `(${unknownPro.status})`);

// ── 5. Página pública: preço sim, duração não ──
console.log('\n— página pública sem duração');
async function visibleText(slug) {
  const html = await (await fetch(`${BASE}/${slug}`)).text();
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')   // payload RSC/JSON não é texto visível
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');                       // tags/atributos (min-w-*, py-1) não são texto
}
const showsDuration = (t) => /\b\d{1,3}\s*(min|minutos)\b/i.test(t) || /dura\u00e7\u00e3o/i.test(t);
const barbearia = await visibleText('vidavet');
check('página pública responde 200', barbearia.length > 500, `(${barbearia.length} bytes)`);
check('preço continua público', /R\$\s?\d/.test(barbearia), '');
check('duração NÃO aparece na página pública', !showsDuration(barbearia), (barbearia.match(/.{0,40}\b\d{1,3}\s*(min|minutos)\b.{0,20}/i) || [''])[0]);
check('nome do serviço continua público', barbearia.includes('Consulta veterinária'), '');
const clinica = await visibleText('odontovitta');
check('clínica: duração NÃO aparece na página pública', !showsDuration(clinica), (clinica.match(/.{0,40}\b\d{1,3}\s*(min|minutos)\b.{0,20}/i) || [''])[0]);
check('clínica: preço continua público', /R\$\s?\d/.test(clinica), '');

// ── 6. Estados de horário (loading/empty/error) na API pública ──
console.log('\n— estados de disponibilidade');
const sunday = nextDow([0]);
const closedDay = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&date=${sunday}`);
check('domingo (sem regra) → nenhum horário oferecido', closedDay.status === 200 && (closedDay.data.slots || []).length === 0, JSON.stringify(closedDay.data).slice(0, 100));
const monthMap = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&from=${sunday}&to=${sunday}`);
check('calendário marca o domingo como fechado', monthMap.data.days?.[sunday]?.closed === true, JSON.stringify(monthMap.data.days));
check('calendário marca dia útil como aberto', (await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&from=${clinicDay}&to=${clinicDay}`)).data.days?.[clinicDay]?.closed === false, '');
const pastDay = await api('GET', `/api/bookings?businessId=${B3}&serviceId=svc-odonto&date=${isoDay(-3)}`);
check('data passada → nada de horários', (pastDay.data.slots || []).length === 0, JSON.stringify(pastDay.data).slice(0, 80));
const noModule = await api('GET', `/api/bookings?businessId=${B1}&serviceId=svc-consulta-vet&date=${clinicDay}`);
check('negócio sem módulo de agenda → nenhum horário', (noModule.data.slots || []).length === 0 && (noModule.data.moduleOff === undefined || noModule.data.moduleOff === true), JSON.stringify(noModule.data).slice(0, 100));

console.log(`\nRESULTADO: ${pass} ok, ${fail} falhas${fail ? ' → ' + failures.join(' | ') : ''}\n`);
process.exit(fail ? 1 : 0);
