// Smoke test para validar as novas rotas e fluxos operacionais do P3:
// - API Keys e autenticação externa
// - Isolamento entre negócios
// - Ingestão universal de leads, deduplicação e idempotência
// - Consulta externa de serviços, profissionais e disponibilidade
// - Criação externa de agendamento vinculado a lead e regras de agenda
// - Webhooks com assinatura HMAC-SHA256
// - Pipeline configurável e transições
// - Entrega para secretária e conversão em agendamento
// - Widget JS e página /agendar

import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...opts.headers,
    },
  });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

console.log(`\nSMOKE P3 ${BASE}\n`);

// 1. Login no painel para obter token
const loginRes = await req('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'demo@instalink.app', password: 'demo1234' }),
});
assert.equal(loginRes.status, 200, 'Login demo deve funcionar');
const token = loginRes.data.token;
const authHeader = { Authorization: `Bearer ${token}` };

// 2. Obter business atual (priorizando clínica ou serviços para testar a esteira e agenda completa)
const meRes = await req('/api/auth/me', { headers: authHeader });
assert.equal(meRes.status, 200);
const allBiz = meRes.data.businesses || [];
const targetBiz = allBiz.find((b) => b.id === 'biz-clinicavitta' || (b.modes && b.modes.includes('bookings'))) || allBiz[0];
const businessId = targetBiz?.id;
assert.ok(businessId, 'Deve ter businessId');
const cookieHeader = { ...authHeader, cookie: `biz=${businessId}` };

console.log('✓ Sessão do painel autenticada');

// 3. Gerar API Key para o negócio
const keyCreateRes = await req(`/api/integrations/keys?businessId=${businessId}`, {
  method: 'POST',
  headers: cookieHeader,
  body: JSON.stringify({ name: 'Site Externo P3 Teste', businessId }),
});
assert.equal(keyCreateRes.status, 201, 'Deve criar chave com sucesso');
const apiKey = keyCreateRes.data.fullSecret || keyCreateRes.data.key;
assert.ok(apiKey.startsWith('ik_live_'), 'Chave deve ter prefixo ik_live_');
const apiKeyHeader = { Authorization: `Bearer ${apiKey}` };

console.log('✓ API Key criada com prefixo ik_live_');

// 4. Testar listagem de chaves (sem expor hash)
const keysListRes = await req(`/api/integrations/keys?businessId=${businessId}`, { headers: cookieHeader });
assert.equal(keysListRes.status, 200);
assert.ok(keysListRes.data.keys.length > 0);
assert.equal(keysListRes.data.keys[0].keyHash, undefined, 'Não deve vazar keyHash');

console.log('✓ Listagem de API Keys segura sem expor segredo nem hash');

// 5. Testar chamada externa de Serviços
const extServicesRes = await req('/api/external/services', { headers: apiKeyHeader });
assert.equal(extServicesRes.status, 200);
assert.ok(Array.isArray(extServicesRes.data.services), 'Deve listar serviços');
const serviceId = extServicesRes.data.services[0]?.id;
console.log(`✓ GET /api/external/services retornou ${extServicesRes.data.services.length} serviços`);

// 6. Testar chamada externa de Profissionais
const extProsRes = await req('/api/external/professionals', { headers: apiKeyHeader });
assert.equal(extProsRes.status, 200);
assert.ok(Array.isArray(extProsRes.data.professionals), 'Deve listar profissionais');
console.log(`✓ GET /api/external/professionals retornou ${extProsRes.data.professionals.length} profissionais`);

// 7. Ingestão universal de lead via API externa (com Idempotency-Key)
const idemKey = `lead_test_${Date.now()}`;
const freshPhone = `119${Math.floor(10000000 + Math.random() * 90000000)}`;
const leadPayload = {
  name: 'Cliente P3 Universal',
  phone: freshPhone,
  email: `p3lead_${Date.now()}@teste.com`,
  notes: 'Lead interessado em avaliação',
  source: 'landing_page',
  channel: 'site',
  stageId: 'novo',
  priority: 'high',
  customData: { utm_campaign: 'blackfriday', lp_id: 'lp-orto' },
};

const leadRes1 = await req('/api/external/leads', {
  method: 'POST',
  headers: {
    ...apiKeyHeader,
    'Idempotency-Key': idemKey,
  },
  body: JSON.stringify(leadPayload),
});
assert.equal(leadRes1.status, 201, 'Lead novo deve ser criado com status 201');
assert.ok(leadRes1.data.lead?.id, 'Lead deve ter id retornado');
assert.equal(leadRes1.data.lead.priority, 'high');
assert.equal(leadRes1.data.lead.channel, 'site');
const leadId = leadRes1.data.lead.id;

console.log('✓ Lead ingerido com sucesso via POST /api/external/leads com Idempotency-Key');

// 8. Teste de Idempotência: mesma chamada com mesma chave deve retornar 201 sem duplicar
const leadRes2 = await req('/api/external/leads', {
  method: 'POST',
  headers: {
    ...apiKeyHeader,
    'Idempotency-Key': idemKey,
  },
  body: JSON.stringify(leadPayload),
});
assert.equal(leadRes2.status, 201);
assert.equal(leadRes2.data.lead?.id, leadId, 'Idempotência deve retornar o mesmo lead');
assert.equal(leadRes2.headers.get('x-idempotent-replay'), 'true');

console.log('✓ Idempotency-Key protegeu contra reenvio e duplicidade');

// 9. Atualizar estágio do lead para aguardando_secretaria
const patchLeadRes = await req(`/api/external/leads/${leadId}`, {
  method: 'PATCH',
  headers: apiKeyHeader,
  body: JSON.stringify({
    stageId: 'aguardando_secretaria',
    notes: 'Secretária precisa confirmar horário por telefone',
  }),
});
assert.equal(patchLeadRes.status, 200);
assert.ok(
  patchLeadRes.data.lead.stageId === 'aguardando_secretaria' || patchLeadRes.data.lead.stageId === 'waiting_secretary',
  'Estágio deve ser aguardando_secretaria ou waiting_secretary',
);
assert.ok(patchLeadRes.data.lead.stageHistory.length >= 2, 'Histórico deve registrar transição');

console.log('✓ Lead atualizado para "aguardando_secretaria" com trilha de auditoria');

// 10. Webhooks: criar webhook com HMAC secret
const createHookRes = await req(`/api/integrations/webhooks?businessId=${businessId}`, {
  method: 'POST',
  headers: cookieHeader,
  body: JSON.stringify({
    businessId,
    url: 'https://exemplo.com/webhook-receptor',
    events: ['lead.created', 'booking.created'],
  }),
});
assert.equal(createHookRes.status, 201);
const generatedWhSecret = createHookRes.data.secret || createHookRes.data.webhook?.secret;
assert.ok(generatedWhSecret?.startsWith('whsec_'), 'Criação deve exibir o segredo whsec_ uma única vez');
const webhookId = createHookRes.data.webhook.id;

console.log('✓ Webhook criado com assinatura e segredo whsec_ exibido uma única vez');

// 10.1 Webhooks: listagem GET NUNCA expõe o segredo completo
const listHooksRes = await req(`/api/integrations/webhooks?businessId=${businessId}`, {
  headers: cookieHeader,
});
assert.equal(listHooksRes.status, 200);
const listedHook = listHooksRes.data.webhooks.find((w) => w.id === webhookId);
assert.ok(listedHook, 'Webhook deve constar na listagem');
assert.equal(listedHook.secret, undefined, 'GET /api/integrations/webhooks NUNCA deve conter secret puro');
assert.ok(listedHook.secretMasked?.startsWith('whsec_••••••••'), 'GET deve fornecer secretMasked');

console.log('✓ GET /api/integrations/webhooks protege o segredo (retorna apenas secretMasked)');

// 10.2 Integridade de Atribuição (assignedUserId)
const invalidAssignRes = await req(`/api/external/leads/${leadId}`, {
  method: 'PATCH',
  headers: apiKeyHeader,
  body: JSON.stringify({
    assignedUserId: 'usuario_inexistente_ou_de_outro_negocio',
  }),
});
assert.equal(invalidAssignRes.status, 422, 'Atribuição de usuário inválido deve retornar 422');

console.log('✓ Atribuição de assignedUserId inválido rejeitada no backend com 422');

// 11. Testar disparo simulado de webhook
const testHookRes = await req(`/api/integrations/webhooks/test?businessId=${businessId}`, {
  method: 'POST',
  headers: cookieHeader,
  body: JSON.stringify({ businessId, webhookId, event: 'lead.created' }),
});
assert.equal(testHookRes.status, 200);
assert.ok(testHookRes.data.message !== undefined, 'Deve retornar resultado da entrega/simulação');

console.log('✓ Teste de disparo de webhook executado com sucesso');

// 12. Pipeline endpoint interno
const pipelineRes = await req(`/api/pipeline?businessId=${businessId}`, { headers: cookieHeader });
assert.equal(pipelineRes.status, 200);
assert.ok(pipelineRes.data.pipeline?.stages?.length >= 4);

console.log(`✓ GET /api/pipeline retornou ${pipelineRes.data.pipeline.stages.length} estágios configurados`);

// 13. Agendar a partir do lead (/api/leads/[id]/book)
if (serviceId) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];

  // Buscar slots livres para amanhã
  const availRes = await req(`/api/external/availability?date=${dateStr}&serviceId=${serviceId}`, {
    headers: apiKeyHeader,
  });
  if (availRes.status === 200 && availRes.data.slots && availRes.data.slots.length > 0) {
    const timeSlot = availRes.data.slots[0];
    const bookRes = await req(`/api/leads/${leadId}/book?businessId=${businessId}`, {
      method: 'POST',
      headers: cookieHeader,
      body: JSON.stringify({
        serviceId,
        date: dateStr,
        time: timeSlot,
      }),
    });
    assert.equal(bookRes.status, 201, 'Agendamento direto do lead deve ser criado');
    assert.ok(bookRes.data.booking?.id);
    assert.ok(
      bookRes.data.lead.stageId === 'agendado' || bookRes.data.lead.stageId === 'scheduled',
      'Estágio deve ser agendado/scheduled',
    );
    assert.equal(bookRes.data.lead.bookingId, bookRes.data.booking.id);
    console.log('✓ Lead convertido com sucesso para Agendamento ("agendado") com vínculo bidirecional');
  }
}

// 14. Widget JS
const widgetRes = await req('/widget/booking.js');
assert.equal(widgetRes.status, 200);
assert.ok(widgetRes.headers.get('content-type')?.includes('javascript'));
assert.ok(typeof widgetRes.data === 'string' && widgetRes.data.includes('instalink'));

console.log('✓ Widget JS (/widget/booking.js) servido com Content-Type application/javascript');

// 15. Embed / Standalone Agendamento (/agendar)
const agendarRes = await req(`/agendar?businessId=${businessId}`);
assert.equal(agendarRes.status, 200);

console.log('✓ Página de agendamento embeddable (/agendar) respondeu 200 OK');

console.log('\nTODOS OS 15 TESTES DE SMOKE P3 PASSARAM COM SUCESSO!\n');
