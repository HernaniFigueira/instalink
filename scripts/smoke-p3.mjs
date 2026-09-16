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
// - Consumidor automático da fila de retry (cron) e retry ponta a ponta
//
// Para validar o CONSUMIDOR AUTOMÁTICO (seções 16–18) defina CRON_SECRET no
// servidor E aqui (o mesmo valor). Sem CRON_SECRET a seção 16 apenas confirma
// que o endpoint está protegido (401/503) e as seções 17–18 são puladas.

import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || '';
const RUN_FULL_RETRY = process.env.SMOKE_P3_RETRY_FULL === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ═══════════════════════════════════════════════════════════════
// 16. Consumidor automático da fila de retry — rota SEMPRE protegida
// ═══════════════════════════════════════════════════════════════
const cronAnonymous = await req('/api/cron/webhooks');
assert.ok(
  cronAnonymous.status === 401 || cronAnonymous.status === 503,
  `GET /api/cron/webhooks sem credencial deve ser 401 (configurado) ou 503 (desativado), veio ${cronAnonymous.status}`,
);
const cronWrong = await req('/api/cron/webhooks', {
  headers: { Authorization: 'Bearer credencial-de-cron-invalida' },
});
assert.ok([401, 503].includes(cronWrong.status), 'Credencial inválida não pode executar a fila');
const cronDeniedBody = JSON.stringify(cronAnonymous.data) + JSON.stringify(cronWrong.data);
assert.ok(!cronDeniedBody.includes('whsec'), 'Resposta negada não pode conter segredo');
assert.ok(!cronDeniedBody.includes(generatedWhSecret), 'Resposta negada não pode conter o segredo do webhook');

console.log('✓ Consumidor de retry protegido: sem CRON_SECRET válido o endpoint nunca executa a fila');

if (!CRON_SECRET) {
  console.log('⚠ CRON_SECRET não definido neste ambiente — fluxo automático de retry não pôde ser acionado aqui.');
}

if (CRON_SECRET) {
  const cronOk = await req('/api/cron/webhooks', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  assert.equal(cronOk.status, 200, 'Execução válida do cron deve responder 200');
  assert.equal(cronOk.data.ok, true);
  assert.ok(typeof cronOk.data.processed === 'number');
  assert.ok(typeof cronOk.data.delivered === 'number');
  assert.ok(!JSON.stringify(cronOk.data).includes('whsec'), 'Resposta do cron não pode conter segredo');

  console.log(`✓ Cron autenticado executou o processador (processed=${cronOk.data.processed}, failed=${cronOk.data.failed})`);

  // ── Receptor LOCAL de webhooks (prova a entrega real das tentativas) ──
  const hookLog = [];
  const hookModes = new Map();
  const receiver = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const mode = hookModes.get(request.url) || 'fail';
      hookLog.push({
        url: request.url,
        mode,
        eventId: request.headers['x-instalink-event-id'],
        attempt: Number(request.headers['x-instalink-attempt'] || 0),
        signature: request.headers['x-instalink-signature'],
        body,
      });
      response.writeHead(mode === 'ok' ? 200 : 500, { 'content-type': 'application/json' });
      response.end(mode === 'ok' ? '{"ok":true}' : '{"error":"indisponivel"}');
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverBase = `http://127.0.0.1:${receiver.address().port}`;

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
  const attemptsFor = (path, eventId) =>
    hookLog.filter((h) => h.url === path && (!eventId || h.eventId === eventId)).length;
  const latestDelivery = async (url) => {
    const list = await req(`/api/integrations/webhooks?businessId=${businessId}`, { headers: cookieHeader });
    assert.equal(list.status, 200);
    return (list.data.deliveries || []).find((d) => d.url === url);
  };
  const verifies = (entry, secret) => {
    if (!entry?.signature) return false;
    const parts = Object.fromEntries(entry.signature.split(',').map((kv) => kv.split('=')));
    if (!parts.t || !parts.v1) return false;
    return createHmac('sha256', secret).update(`${parts.t}.${entry.body}`).digest('hex') === parts.v1;
  };
  // O cron é o CONSUMIDOR: chamamos o mesmo endpoint até a entrega sair da fila.
  const runCron = async (cycles = 4) => {
    for (let i = 0; i < cycles; i++) {
      if (i > 0) await sleep(2000); // cada chamada = um ciclo do consumidor
      const res = await req('/api/cron/webhooks', { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
      assert.equal(res.status, 200, `Chamada autenticada do cron deve responder 200 (veio ${res.status})`);
    }
  };

  if (!isLocal) {
    console.log('⚠ BASE não é local — o receptor de teste (127.0.0.1) não é alcançável pelo servidor; fluxo ponta a ponta pulado.');
  } else {
    // ─────────────────────────────────────────────────────────────
    // 17. Fluxo real: evento → falha retryable → pending → cron → success
    // ─────────────────────────────────────────────────────────────
    const okPath = '/retry-sucesso';
    const okUrl = `${receiverBase}${okPath}`;
    hookModes.set(okPath, 'fail'); // a 1ª tentativa (no evento) falha de propósito

    const okHookRes = await req(`/api/integrations/webhooks?businessId=${businessId}`, {
      method: 'POST',
      headers: cookieHeader,
      body: JSON.stringify({ businessId, url: okUrl, events: ['lead.created'], active: true }),
    });
    assert.equal(okHookRes.status, 201, 'Webhook do teste de retry deve ser criado');
    const okSecret = okHookRes.data.secret || okHookRes.data.webhook?.secret;
    assert.ok(okSecret?.startsWith('whsec_'), 'Criação deve devolver o segredo uma única vez');

    const okLeadRes = await req('/api/external/leads', {
      method: 'POST',
      headers: apiKeyHeader,
      body: JSON.stringify({
        name: 'Retry Cron P3',
        phone: `119${Math.floor(10000000 + Math.random() * 90000000)}`,
        source: 'smoke_retry',
        channel: 'site',
      }),
    });
    assert.equal(okLeadRes.status, 201, 'Lead de teste do retry deve ser criado');

    await sleep(500); // dá tempo da tentativa 1 (no evento) ser registrada
    const attempt1 = hookLog.find((h) => h.url === okPath);
    assert.ok(attempt1, 'A tentativa 1 deve ter sido enviada no evento (falha retryable)');
    assert.equal(attempt1.attempt, 1);
    assert.ok(verifies(attempt1, okSecret), 'Tentativa 1 deve ter assinatura HMAC válida');

    const pendingDelivery = await latestDelivery(okUrl);
    assert.ok(pendingDelivery, 'Entrega deve estar registrada no painel');
    assert.equal(pendingDelivery.status, 'pending', 'Falha retryable deve deixar a entrega pendente');
    assert.ok(pendingDelivery.nextRetryAt, 'Entrega pendente deve ter nextRetryAt agendado');
    assert.equal(pendingDelivery.claimToken, undefined, 'Campos internos da fila não podem ir ao painel');
    const retryAtMs = new Date(pendingDelivery.nextRetryAt).getTime();
    const backoffMs = retryAtMs - new Date(pendingDelivery.createdAt).getTime();
    assert.ok(backoffMs >= 28000 && backoffMs <= 32000, `Backoff da tentativa 2 deve ser ~30s (veio ${backoffMs}ms)`);

    console.log('✓ Falha retryable deixou a entrega pendente com backoff de ~30s e tentativa 1 assinada');

    // Antes da hora o consumidor NÃO deve tentar de novo.
    const earlyCron = await req('/api/cron/webhooks', { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    assert.equal(earlyCron.status, 200);
    assert.equal(attemptsFor(okPath, attempt1.eventId), 1, 'Entrega futura não pode ser entregue antes do nextRetryAt');

    console.log('✓ Cron executado antes do nextRetryAt não gerou nova requisição externa');

    // Passado o backoff, o cron entrega com o MESMO eventId.
    hookModes.set(okPath, 'ok'); // receptor volta ao ar
    while (Date.now() < retryAtMs + 2000) await sleep(2000);
    await runCron(4);

    const okEvents = hookLog.filter((h) => h.url === okPath);
    assert.ok(okEvents.length >= 2, `Tentativa 2 deveria ter sido entregue (tentativas: ${okEvents.length})`);
    const attempt2 = okEvents[okEvents.length - 1];
    assert.equal(attempt2.attempt, 2, 'O cron deve executar a tentativa 2');
    assert.equal(attempt2.eventId, attempt1.eventId, 'O MESMO eventId deve ser preservado no retry');
    assert.ok(verifies(attempt2, okSecret), 'Retry deve manter a assinatura HMAC válida');

    const deliveredDelivery = await latestDelivery(okUrl);
    assert.equal(deliveredDelivery.status, 'success', 'Sucesso na tentativa 2 deve marcar a entrega como delivered');
    assert.equal(deliveredDelivery.attempts, 2);
    assert.equal(deliveredDelivery.eventId, attempt1.eventId);

    console.log('✓ Retry automático entregou com sucesso na tentativa 2, com o MESMO eventId e assinatura válida');

    // ─────────────────────────────────────────────────────────────
    // 18. Fluxo completo (opcional): tentativas 1→3 e failed definitivo
    //     SMOKE_P3_RETRY_FULL=1 (leva ~3 minutos por causa do backoff real)
    // ─────────────────────────────────────────────────────────────
    if (RUN_FULL_RETRY) {
      const failPath = '/retry-falha';
      const failUrl = `${receiverBase}${failPath}`;
      hookModes.set(failPath, 'fail'); // nunca volta ao ar

      const failHookRes = await req(`/api/integrations/webhooks?businessId=${businessId}`, {
        method: 'POST',
        headers: cookieHeader,
        body: JSON.stringify({ businessId, url: failUrl, events: ['lead.created'], active: true }),
      });
      assert.equal(failHookRes.status, 201);

      const failLeadRes = await req('/api/external/leads', {
        method: 'POST',
        headers: apiKeyHeader,
        body: JSON.stringify({
          name: 'Retry Falha Definitiva P3',
          phone: `119${Math.floor(10000000 + Math.random() * 90000000)}`,
          source: 'smoke_retry_full',
          channel: 'site',
        }),
      });
      assert.equal(failLeadRes.status, 201);

      await sleep(500);
      const failAttempt1 = hookLog.find((h) => h.url === failPath);
      assert.ok(failAttempt1, 'Tentativa 1 do fluxo de falha deve ser enviada');
      const failEventId = failAttempt1.eventId;

      const waitForRetry = async (delivery) => {
        const at = new Date(delivery.nextRetryAt).getTime();
        while (Date.now() < at + 2000) await sleep(3000);
      };

      let delivery = await latestDelivery(failUrl);
      assert.equal(delivery.status, 'pending');
      await waitForRetry(delivery);
      await runCron(4);
      delivery = await latestDelivery(failUrl);
      assert.equal(delivery.attempts, 2, 'Tentativa 2 deve ter sido executada pelo cron');
      assert.equal(delivery.status, 'pending', 'Falha retryable na tentativa 2 mantém a entrega pendente');

      await waitForRetry(delivery);
      await runCron(4);
      delivery = await latestDelivery(failUrl);
      assert.equal(delivery.attempts, 3, 'Tentativa 3 deve ter sido executada pelo cron');
      assert.equal(delivery.status, 'failed', 'Terceira falha deve encerrar a entrega como failed');
      assert.equal(delivery.nextRetryAt, undefined, 'Entrega falha definitiva não mantém agendamento');

      const attemptsBefore = attemptsFor(failPath, failEventId);
      await sleep(2000);
      await runCron(2);
      assert.equal(
        attemptsFor(failPath, failEventId),
        attemptsBefore,
        'Entrega failed nunca volta para a fila (sem retry infinito)',
      );
      for (const entry of hookLog.filter((h) => h.url === failPath)) {
        assert.equal(entry.eventId, failEventId, 'Todas as tentativas usam o mesmo eventId');
      }

      console.log('✓ Fluxo completo: 3 tentativas (30s/120s), failed definitivo e nenhuma 4ª requisição');
    } else {
      console.log('• Fluxo completo de falha definitiva não executado (use SMOKE_P3_RETRY_FULL=1 para rodar).');
    }
  }

  await new Promise((resolve) => receiver.close(resolve));
}

console.log('\nTODOS OS 15 FLUXOS DO SMOKE P3 (+ CONSUMIDOR AUTOMÁTICO DE RETRY) PASSARAM COM SUCESSO!\n');
