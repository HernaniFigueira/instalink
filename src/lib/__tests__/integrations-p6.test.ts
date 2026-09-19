// ═══════════════════════════════════════════════════════════════
// P6 — CANAIS E INTEGRAÇÕES EXTERNAS (testes da fundação)
// ═══════════════════════════════════════════════════════════════
// O que aqui é provado (os 18 casos críticos do P6):
//   1. criar integração;                10. normalização de evento;
//   2. listar as do PRÓPRIO business;   11. encaminhamento para o P4;
//   3. impedir acesso cross-tenant;     12. webhook de saída;
//   4. webhook válido;                  13. falha de webhook de saída;
//   5. webhook inválido;                14. retry (motor do P3);
//   6. webhook sem autenticação;        15. segredo não aparece na resposta;
//   7. integração inexistente;          16. businessId não pode ser falsificado;
//   8. evento duplicado;                17. integração desativada;
//   9. evento novo;                     18. logs isolados por tenant.
//
// Os testes usam as ROTAS REAIS (NextRequest + sessão) sobre o banco em arquivo
// temporário e as funções puras sobre `emptyDB()` — nada de mock de motor.
//
// O primeiro import é obrigatório: isola o banco em arquivo temporário.
import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { TEMP_DB_FILE } from './helpers/temp-db';
import { createSession } from '../auth';
import { buildAutomation, FIXED_NOW } from './helpers/automation-fixtures';
import { upsertWebhook } from '../webhooks';
import { inspectOutboundUrl, isPrivateOrReservedHost, privateUrlsAllowed } from '../outbound-url';
import {
  createIntegration, deleteIntegration, listBusinessIntegrations, sanitizeIntegration,
  rotateIntegrationCredentials, setIntegrationStatus, updateIntegration,
  integrationsOfBusiness, authenticateIntegrationToken,
} from '../integrations/connections';
import { providerDef, providerViewsByKind } from '../integrations/catalog';
import { normalizeInboundPayload } from '../integrations/connectors';
import { processInboundRequest } from '../integrations/inbound';
import { dispatchOutboundEvent } from '../integrations/outbound';
import { integrationEventsOf, summarizeIntegrationEvents, findProcessedByKey } from '../integrations/logs';
import { registerChannelConnector, channelConnectorAvailable, sendChannelMessage } from '../integrations/connectors';
import { buildIdempotencyKey, sanitizePayload, MAX_INBOUND_BYTES } from '../integrations/contract';
import type { Business, DB, Integration } from '../types';
import { GET as integrationsGET, POST as integrationsPOST, PATCH as integrationsPATCH, DELETE as integrationsDELETE } from '@/app/api/integrations/route';
import { GET as eventsGET } from '@/app/api/integrations/events/route';
import { POST as inboundPOST } from '@/app/api/integrations/inbound/[id]/route';

const OWNER = 'owner-b1';
const OTHER_OWNER = 'owner-b2';

function biz(id: string, ownerId: string): Business {
  return {
    id, ownerId, organizationId: `org-${id}`, name: `Empresa ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'servicos', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: true, about: false, agent: false },
    phone: '', whatsapp: '11999990000', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: FIXED_NOW, updatedAt: FIXED_NOW, automations: {}, capabilityFlags: {},
  };
}

function seedDb(): DB {
  const db = emptyDB();
  // Usuários reais: as rotas autenticam a sessão e resolvem o dono da empresa.
  db.users.push(
    { id: OWNER, name: 'Dono A', email: 'a@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: OTHER_OWNER, name: 'Dono B', email: 'b@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
  );
  db.businesses.push(biz('b1', OWNER), biz('b2', OTHER_OWNER));
  return db;
}

/** Cria a integração e devolve o token (que só existe na criação). */
function withIntegration(db: DB, businessId: string, provider: any, extra: Record<string, any> = {}) {
  const res = createIntegration(db, businessId, { provider, name: `Conexão ${provider}`, ...extra });
  if (!res.ok || !res.integration || !res.token) throw new Error(res.error || 'falha ao criar integração de teste');
  return { integration: res.integration, token: res.token, signingSecret: res.signingSecret! };
}

function inbound(db: DB, integrationId: string, token: string, payload: unknown, extra: Record<string, any> = {}) {
  return processInboundRequest(db, {
    integrationId,
    token,
    rawBody: JSON.stringify(payload),
    payload,
    nowISO: FIXED_NOW,
    ...extra,
  });
}

const LEAD_ENVELOPE = {
  event: 'lead.created',
  externalId: 'evt-1',
  source: 'campanha-setembro',
  data: { name: 'Maria Souza', phone: '(11) 98888-7777', email: 'MARIA@EXEMPLO.com', interest: 'Corte', message: 'Quero agendar' },
  metadata: { utm_source: 'facebook' },
};

function jsonReq(path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers || {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function jsonBody(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  // O gancho inline do P4 é desligado: a fila é drenada quando o teste quiser.
  process.env.AUTOMATION_INLINE = '0';
  await writeDB(seedDb());
});

afterEach(() => {
  delete process.env.AUTOMATION_INLINE;
  delete process.env.ALLOW_PRIVATE_OUTBOUND_URLS;
});

// ═══════════════════════════════════════════════════════════════
describe('P6.1 — Conexões: criar, listar, rotacionar e remover', () => {
  it('1) cria integração com token forte, guarda só o hash e devolve o valor uma única vez', () => {
    const db = seedDb();
    const res = createIntegration(db, 'b1', { provider: 'form', name: 'Formulário do site', createdByUserId: OWNER });
    expect(res.ok).toBe(true);
    expect(res.token!.startsWith('ilk_live_')).toBe(true);
    expect(res.signingSecret!.startsWith('ilsec_')).toBe(true);
    expect(res.endpointPath).toBe(`/api/integrations/inbound/${res.integration!.id}`);

    const stored: Integration = db.integrations[0];
    expect(stored.tokenHash).not.toContain(res.token!);
    expect(stored.tokenHash.length).toBe(64); // SHA-256
    expect(JSON.stringify(stored)).not.toContain(res.token!); // o cru NÃO fica no banco
    expect(res.integration!.tokenMasked).not.toContain(res.token!.slice(10, 30)); // nem na resposta

    // O provedor define o tipo e a direção (nada disso vem do cliente).
    expect(stored.kind).toBe('source');
    expect(stored.direction).toBe('in');
    expect(stored.defaultEvent).toBe('form.submitted');
  });

  it('recusa provedor que ainda NÃO existe (nada de conexão de fachada)', () => {
    // BLOCO 9: o Instagram passou a ter caminho de conexão real (Business
    // Login); quem continua sem caminho é o Messenger.
    const db = seedDb();
    const messenger = createIntegration(db, 'b1', { provider: 'messenger' });
    expect(messenger.ok).toBe(false);
    expect(messenger.status).toBe(409);
    expect(messenger.error).toBeDefined();
    expect(db.integrations).toHaveLength(0);
  });

  it('2) lista apenas as integrações do próprio business, sem segredo', () => {
    const db = seedDb();
    withIntegration(db, 'b1', 'form');
    withIntegration(db, 'b2', 'n8n');

    const list = listBusinessIntegrations(db, 'b1');
    expect(list).toHaveLength(1);
    expect(list[0].businessId).toBe('b1');
    expect((list[0] as any).tokenHash).toBeUndefined();
    expect((list[0] as any).signingSecret).toBeUndefined();
    expect(list[0].tokenMasked).toMatch(/^ilk_live••••••••/);
  });

  it('rotaciona credenciais e desativa/reativa sem apagar o histórico', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'n8n');
    expect(authenticateIntegrationToken(db, integration.id, token).ok).toBe(true);

    const rotated = rotateIntegrationCredentials(db, 'b1', integration.id);
    expect(rotated.ok).toBe(true);
    expect(authenticateIntegrationToken(db, integration.id, token).ok).toBe(false);
    expect(authenticateIntegrationToken(db, integration.id, rotated.token!).ok).toBe(true);

    const paused = setIntegrationStatus(db, 'b1', integration.id, 'paused');
    expect(paused.ok).toBe(true);
    expect(authenticateIntegrationToken(db, integration.id, rotated.token!).status).toBe(403);

    const renamed = updateIntegration(db, 'b1', integration.id, { name: 'Meu n8n' });
    expect(renamed.integration!.name).toBe('Meu n8n');
    expect(deleteIntegration(db, 'b1', integration.id).ok).toBe(true);
    expect(integrationsOfBusiness(db, 'b1')).toHaveLength(0);
  });

  it('recusa evento padrão que o provedor não aceita', () => {
    const db = seedDb();
    const { integration } = withIntegration(db, 'b1', 'form');
    const bad = updateIntegration(db, 'b1', integration.id, { defaultEvent: 'message.received' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Evento padrão/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('P6.2 — Entrada: autenticação, normalização e idempotência', () => {
  it('6) sem token não entra — e a tentativa fica registrada na unidade', () => {
    const db = seedDb();
    const { integration } = withIntegration(db, 'b1', 'inbound_webhook', { defaultEvent: 'lead.created' });
    const out = inbound(db, integration.id, '', { name: 'Zé', phone: '11912345678' });
    expect(out.status).toBe(401);
    expect(db.leads).toHaveLength(0);
    const logs = integrationEventsOf(db, 'b1');
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('rejected');
    expect(logs[0].reason).toMatch(/Credencial/);
  });

  it('5) token errado é recusado (mesma mensagem genérica) e não cria nada', () => {
    const db = seedDb();
    const { integration } = withIntegration(db, 'b1', 'form');
    const out = inbound(db, integration.id, 'ilk_live_deadbeef', LEAD_ENVELOPE);
    expect(out.status).toBe(401);
    expect(db.leads).toHaveLength(0);
    expect(db.contacts).toHaveLength(0);
  });

  it('7) integração inexistente → 404 sem revelar nada de outra unidade', () => {
    const db = seedDb();
    const out = inbound(db, 'nao-existe', 'ilk_live_x', LEAD_ENVELOPE);
    expect(out.status).toBe(404);
    expect(out.body.code).toBe('integration_not_found');
    expect(db.integrationEvents).toHaveLength(0); // sem dono não há log
  });

  it('17) integração desativada não recebe evento', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'form');
    setIntegrationStatus(db, 'b1', integration.id, 'paused');
    const out = inbound(db, integration.id, token, LEAD_ENVELOPE);
    expect(out.status).toBe(403);
    expect(db.leads).toHaveLength(0);
  });

  it('exige assinatura HMAC quando configurada (replay e imitação ficam de fora)', () => {
    const crypto = require('node:crypto');
    const db = seedDb();
    const { integration, token, signingSecret } = withIntegration(db, 'b1', 'external_api', { requireSignature: true });
    const raw = JSON.stringify(LEAD_ENVELOPE);

    const noSig = processInboundRequest(db, {
      integrationId: integration.id, token, rawBody: raw, payload: LEAD_ENVELOPE, nowISO: FIXED_NOW,
    });
    expect(noSig.status).toBe(401);

    const ts = Math.floor(Date.parse(FIXED_NOW) / 1000);
    const signature = crypto.createHmac('sha256', signingSecret).update(`${ts}.${raw}`).digest('hex');
    const ok = processInboundRequest(db, {
      integrationId: integration.id, token, rawBody: raw, payload: LEAD_ENVELOPE, nowISO: FIXED_NOW,
      signature: `t=${ts},v1=${signature}`,
    });
    expect(ok.status).toBe(202);

    // Mesma assinatura fora da tolerância (5 min) é replay: recusada.
    const oldTs = ts - 3600;
    const oldSig = crypto.createHmac('sha256', signingSecret).update(`${oldTs}.${raw}`).digest('hex');
    const replay = processInboundRequest(db, {
      integrationId: integration.id, token, rawBody: raw, payload: LEAD_ENVELOPE, nowISO: FIXED_NOW,
      signature: `t=${oldTs},v1=${oldSig}`,
    });
    expect(replay.status).toBe(401);
  });

  it('10) normaliza campos em português do formulário (quem conhece o formato é o adaptador)', () => {
    const ctx = {
      businessId: 'b1', integrationId: 'i1', provider: 'form' as const,
      defaultEvent: 'form.submitted' as const, nowISO: FIXED_NOW,
    };
    const result = normalizeInboundPayload('form', {
      nome: 'Joana Lima', telefone: '(11) 97777-6666', 'e-mail': 'JOANA@EX.com',
      mensagem: 'Gostaria de um horário', utm_source: 'instagram',
    }, ctx);
    expect(result.error).toBeUndefined();
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.event).toBe('form.submitted');
    expect(event.contact).toMatchObject({ name: 'Joana Lima', phone: '11977776666', email: 'joana@ex.com' });
    expect(event.payload.interest).toBe('Gostaria de um horário');
    expect(event.metadata.utm_source).toBe('instagram');
  });

  it('5) payload sem nada reconhecível é recusado com 400 (não grava lixo)', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'inbound_webhook', { defaultEvent: 'lead.created' });
    const out = inbound(db, integration.id, token, { foo: 'bar' });
    expect(out.status).toBe(400);
    expect(db.leads).toHaveLength(0);
    expect(integrationEventsOf(db, 'b1')[0].status).toBe('rejected');
  });

  it('evento declarado mas ainda não entregue (message.received) é recusado com motivo', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'inbound_webhook');
    const out = inbound(db, integration.id, token, { event: 'message.received', data: { text: 'oi' } });
    expect(out.status).toBe(422);
    expect(out.body.code).toBe('event_not_supported');
  });

  it('16) businessId do payload é IGNORADO: a unidade vem da integração autenticada', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'n8n');
    const out = inbound(db, integration.id, token, {
      event: 'lead.created',
      businessId: 'b2', // tentativa de trocar de tenant pelo corpo
      data: { name: 'Tentativa', phone: '11955554444' },
    });
    expect(out.status).toBe(202);
    expect(db.leads).toHaveLength(1);
    expect(db.leads[0].businessId).toBe('b1');
    expect(db.leads.filter((l) => l.businessId === 'b2')).toHaveLength(0);
    const log = integrationEventsOf(db, 'b1')[0];
    expect(log.status).toBe('processed');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('P6.3 — Encaminhamento ao motor (P4) e idempotência', () => {
  it('11) lead do canal externo vira lead + execução de automação (mesmo caminho do resto do produto)', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'form');
    db.automations.push(buildAutomation({
      id: 'auto-p6', businessId: 'b1',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'Veio de {{lead.origin}}' } } }],
    }));

    const out = inbound(db, integration.id, token, LEAD_ENVELOPE);
    expect(out.status).toBe(202);

    const lead = db.leads.find((l) => l.businessId === 'b1')!;
    expect(lead.name).toBe('Maria Souza');
    expect(lead.phone).toBe('11988887777');
    expect(lead.origin).toBe('campanha-setembro');
    expect(lead.metadata?.integrationId).toBe(integration.id);

    // O P4 foi acionado pelo serviço oficial (ingestLead) — não por caminho paralelo.
    expect(db.automationRuns).toHaveLength(1);
    expect(db.automationRuns[0].businessId).toBe('b1');
    expect(db.automationRuns[0].status).toBe('queued');
    const log = integrationEventsOf(db, 'b1').find((e) => e.status === 'processed')!;
    expect(log.leadId).toBe(lead.id);
    expect(log.automationRunIds).toHaveLength(1);
    expect(log.automationRunIds[0]).toBe(db.automationRuns[0].id);
  });

  it('contato externo entra no CRM e dispara o gatilho de cliente do P4', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'external_api');
    db.automations.push(buildAutomation({
      id: 'auto-customer', businessId: 'b1',
      event: 'customer.created' as any,
      steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Boas-vindas para {{customer.name}}' } } }],
    }));
    const out = inbound(db, integration.id, token, {
      event: 'contact.created', externalId: 'ct-9',
      contact: { name: 'Ana Paula', phone: '11912340000', email: 'ana@ex.com' },
    });
    expect(out.status).toBe(202);
    expect(db.contacts).toHaveLength(1);
    expect(db.automationRuns).toHaveLength(1);
    expect(db.automationRuns[0].triggerEvent).toBe('customer.created');
  });

  it('8) o MESMO evento duas vezes gera UMA entrada efetiva', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'form');
    db.automations.push(buildAutomation({ id: 'auto-dedupe', businessId: 'b1' }));
    const first = inbound(db, integration.id, token, LEAD_ENVELOPE);
    const second = inbound(db, integration.id, token, LEAD_ENVELOPE);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.duplicate).toBe(true);
    expect(db.leads).toHaveLength(1);
    expect(db.automationRuns).toHaveLength(1); // uma execução, não duas

    const statuses = integrationEventsOf(db, 'b1').map((e) => e.status);
    expect(statuses).toContain('processed');
    expect(statuses).toContain('duplicate');
  });

  it('9) evento novo (externalId diferente) entra normalmente', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'form');
    inbound(db, integration.id, token, LEAD_ENVELOPE);
    const second = inbound(db, integration.id, token, {
      ...LEAD_ENVELOPE, externalId: 'evt-2',
      data: { ...LEAD_ENVELOPE.data, phone: '11955550000', name: 'Outra Pessoa', email: 'outra@exemplo.com' },
    });
    expect(second.body.duplicate).toBe(false);
    expect(db.leads).toHaveLength(2);
  });

  it('mesmo eventId em unidades diferentes fica completamente isolado', () => {
    const db = seedDb();
    const a = withIntegration(db, 'b1', 'form');
    const b = withIntegration(db, 'b2', 'form');
    expect(inbound(db, a.integration.id, a.token, LEAD_ENVELOPE).status).toBe(202);
    // Mesmo externalId, outra integração/unidade ⇒ NÃO é duplicado.
    const second = inbound(db, b.integration.id, b.token, LEAD_ENVELOPE);
    expect(second.body.duplicate).toBe(false);
    expect(db.leads.filter((l) => l.businessId === 'b1')).toHaveLength(1);
    expect(db.leads.filter((l) => l.businessId === 'b2')).toHaveLength(1);
    expect(buildIdempotencyKey(a.integration.id, 'evt-1')).not.toBe(buildIdempotencyKey(b.integration.id, 'evt-1'));
  });

  it('18) o log de eventos é isolado por tenant', () => {
    const db = seedDb();
    const a = withIntegration(db, 'b1', 'form');
    const b = withIntegration(db, 'b2', 'form');
    inbound(db, a.integration.id, a.token, LEAD_ENVELOPE);
    inbound(db, b.integration.id, b.token, { ...LEAD_ENVELOPE, externalId: 'evt-b' });

    expect(integrationEventsOf(db, 'b1')).toHaveLength(1);
    expect(integrationEventsOf(db, 'b2')).toHaveLength(1);
    expect(integrationEventsOf(db, 'b1')[0].businessId).toBe('b1');
    expect(summarizeIntegrationEvents(db, 'b1').processed).toBe(1);
    expect(summarizeIntegrationEvents(db, 'b2').processed).toBe(1);
    // A chave de dedupe é escopada pela integração — não vaza entre unidades.
    expect(findProcessedByKey(db, a.integration.id, buildIdempotencyKey(b.integration.id, 'evt-b'))).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
describe('P6.4 — Saída: evento interno → connector → sistema externo', () => {
  it('12) webhook de saída usa o canal assinado do P3 (sem segundo motor de retry)', async () => {
    const db = seedDb();
    upsertWebhook(db, 'b1', { url: 'https://exemplo.com/hook', events: ['lead.created'], active: true });
    const sent: Array<{ url: string; body: string; signature: string | null }> = [];
    const fetchFn = (async (url: any, init: any) => {
      sent.push({ url: String(url), body: String(init.body), signature: init.headers['X-Instalink-Signature'] });
      return { ok: true, status: 200, statusText: 'OK' } as any;
    }) as unknown as typeof fetch;

    const result = await dispatchOutboundEvent(db, {
      businessId: 'b1', event: 'lead.created', data: { leadId: 'lead-1' }, targets: ['webhook'], fetchFn,
    });
    expect(result.webhooks.destinations).toBe(1);
    expect(result.webhooks.deliveries).toHaveLength(1);
    expect(result.webhooks.deliveries[0].status).toBe('success');
    expect(sent[0].body).toContain('lead-1');
    expect(sent[0].signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('13/14) falha de saída entra na fila do P3 e o retry entrega depois', async () => {
    const db = seedDb();
    upsertWebhook(db, 'b1', { url: 'https://exemplo.com/hook', events: ['lead.created'], active: true });
    const failing = (async () => ({ ok: false, status: 503, statusText: 'indisponível' })) as unknown as typeof fetch;

    const first = await dispatchOutboundEvent(db, {
      businessId: 'b1', event: 'lead.created', data: { leadId: 'lead-1' }, targets: ['webhook'], fetchFn: failing,
    });
    const delivery = first.webhooks.deliveries[0];
    expect(delivery.status).toBe('pending');
    expect(delivery.nextRetryAt).toBeTruthy();
    expect(delivery.attemptsHistory).toHaveLength(1);

    // Retomada pelo motor de retry JÁ EXISTENTE (modo determinístico do P3).
    const { processPendingWebhookDeliveries } = await import('../webhooks');
    const retryOk = (async () => ({ ok: true, status: 200, statusText: 'OK' })) as unknown as typeof fetch;
    const later = new Date(Date.parse(delivery.nextRetryAt!) + 1000).toISOString();
    const processed = await processPendingWebhookDeliveries(db, later, retryOk);
    expect(processed).toHaveLength(1);
    expect(db.webhookDeliveries[0].status).toBe('success');
    expect(db.webhookDeliveries[0].eventId).toBe(delivery.eventId); // idempotência do receptor
  });

  it('canal sem conector implementado NÃO finge envio: resultado honesto', async () => {
    const db = seedDb();
    // Conexão de canal só existe quando o conector existir — para testar a
    // camada de saída, registramos a linha como o P6.1 faria.
    const integration: Integration = {
      id: 'ch-1', businessId: 'b1', kind: 'channel', provider: 'instagram', name: 'Instagram',
      direction: 'both', status: 'active', tokenHash: 'h', tokenPrefix: 'ilk_live_12345678',
      signingSecret: 's', signingSecretPrefix: 'ilsec_12345', requireSignature: false,
      defaultEvent: '', config: {}, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
      createdByUserId: '', rotatedAt: '', lastEventAt: '', eventCount: 0,
    };
    db.integrations.push(integration);
    expect(channelConnectorAvailable('instagram')).toBe(false);

    const result = await dispatchOutboundEvent(db, {
      businessId: 'b1', event: 'lead.created', data: { to: '11999998888', message: 'Oi' }, targets: ['channel'],
    });
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].ok).toBe(false);
    expect(result.channels[0].code).toBe('not_implemented');

    // A tentativa fica registrada como falha — não como entregue.
    const log = integrationEventsOf(db, 'b1')[0];
    expect(log.direction).toBe('out');
    expect(log.status).toBe('failed');
  });

  it('conector de canal registrado (P6.1) recebe a mensagem pelo MESMO caminho do P4', async () => {
    const db = seedDb();
    const integration: Integration = {
      id: 'ch-2', businessId: 'b1', kind: 'channel', provider: 'telegram', name: 'Telegram',
      direction: 'both', status: 'active', tokenHash: 'h', tokenPrefix: 'ilk_live_12345679',
      signingSecret: 's', signingSecretPrefix: 'ilsec_12345', requireSignature: false,
      defaultEvent: '', config: {}, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
      createdByUserId: '', rotatedAt: '', lastEventAt: '', eventCount: 0,
    };
    db.integrations.push(integration);
    const inbox: string[] = [];
    registerChannelConnector({
      provider: 'telegram', label: 'Telegram (teste)', available: true,
      async send(_ctx, message) {
        inbox.push(`${message.to}:${message.body}`);
        return { ok: true, code: 'sent', detail: 'enviado', externalId: 'tg-1' };
      },
    });
    expect(channelConnectorAvailable('telegram')).toBe(true);

    const directed = await sendChannelMessage(db, {
      businessId: 'b1', integrationId: 'ch-2', to: '11999998888', body: 'Seu horário está confirmado',
    });
    expect(directed.ok).toBe(true);
    expect(inbox).toEqual(['11999998888:Seu horário está confirmado']);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('P6.5 — API (rotas reais, sessão e isolamento)', () => {
  it('3) cross-tenant: ninguém administra a integração de outra unidade', async () => {
    const db = seedDb();
    const b2 = withIntegration(db, 'b2', 'n8n');
    await writeDB(db);
    const tokenA = await createSession(OWNER);

    // Listar a unidade B como dono de A → 403 (guard central).
    const listRes = await integrationsGET(jsonReq('/api/integrations?businessId=b2', { token: tokenA }));
    expect(listRes.status).toBe(403);

    // Criar na unidade B como dono de A → 403.
    const createRes = await integrationsPOST(jsonReq('/api/integrations', {
      method: 'POST', token: tokenA, body: { businessId: 'b2', provider: 'form' },
    }));
    expect(createRes.status).toBe(403);

    // Pausar / rotacionar / remover a integração de B → 403 (nada muda).
    for (const method of ['PATCH', 'DELETE'] as const) {
      const res = method === 'PATCH'
        ? await integrationsPATCH(jsonReq('/api/integrations', { method, token: tokenA, body: { businessId: 'b2', id: b2.integration.id, action: 'rotate' } }))
        : await integrationsDELETE(jsonReq('/api/integrations', { method, token: tokenA, body: { businessId: 'b2', id: b2.integration.id } }));
      expect(res.status).toBe(403);
    }

    // Log de B também não é acessível.
    const eventsRes = await eventsGET(jsonReq('/api/integrations/events?businessId=b2', { token: tokenA }));
    expect(eventsRes.status).toBe(403);

    const after = await readDB();
    expect(after.integrations.find((i) => i.id === b2.integration.id)!.status).toBe('active');
  });

  it('3b) a unidade A não consulta nem o ID da integração de B (404 dentro do próprio tenant)', async () => {
    const db = seedDb();
    const b2 = withIntegration(db, 'b2', 'n8n');
    await writeDB(db);
    const tokenA = await createSession(OWNER);
    const res = await integrationsPATCH(jsonReq('/api/integrations', {
      method: 'PATCH', token: tokenA,
      body: { businessId: 'b1', id: b2.integration.id, action: 'pause' },
    }));
    expect(res.status).toBe(404);
    const after = await readDB();
    expect(after.integrations.find((i) => i.id === b2.integration.id)!.status).toBe('active');
  });

  it('1/2/15) cria e lista pela API sem devolver o token depois da criação', async () => {
    const tokenA = await createSession(OWNER);
    const created = await integrationsPOST(jsonReq('/api/integrations', {
      method: 'POST', token: tokenA,
      body: { businessId: 'b1', provider: 'form', name: 'Formulário da campanha' },
    }));
    expect(created.status).toBe(201);
    const createdBody = await jsonBody(created);
    expect(createdBody.token.startsWith('ilk_live_')).toBe(true);
    expect(createdBody.signingSecret.startsWith('ilsec_')).toBe(true);

    const listRes = await integrationsGET(jsonReq('/api/integrations?businessId=b1', { token: tokenA }));
    expect(listRes.status).toBe(200);
    const rawText = JSON.stringify(await jsonBody(listRes));
    expect(rawText).not.toContain(createdBody.token);
    expect(rawText).not.toContain(createdBody.signingSecret);
    expect(rawText).not.toContain('tokenHash');
    const listed = JSON.parse(rawText);
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections[0].tokenMasked).toMatch(/^ilk_live••••••••/);

    // Rotação devolve um token novo e o antigo deixa de autenticar.
    const rotated = await integrationsPATCH(jsonReq('/api/integrations', {
      method: 'PATCH', token: tokenA, body: { businessId: 'b1', id: listed.connections[0].id, action: 'rotate' },
    }));
    const rotatedBody = await jsonBody(rotated);
    expect(rotatedBody.token).not.toBe(createdBody.token);
    const after = await readDB();
    expect(authenticateIntegrationToken(after, listed.connections[0].id, createdBody.token).ok).toBe(false);
  });

  it('4) webhook de entrada válido pela ROTA: 202, lead gravado e execução criada', async () => {
    const tokenA = await createSession(OWNER);
    const created = await jsonBody(await integrationsPOST(jsonReq('/api/integrations', {
      method: 'POST', token: tokenA, body: { businessId: 'b1', provider: 'form' },
    })));
    await updateDB((d) => {
      d.automations.push(buildAutomation({ id: 'auto-rota', businessId: 'b1' }));
    });

    const res = await inboundPOST(
      new NextRequest(`http://localhost:3000/api/integrations/inbound/${created.integration.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${created.token}` },
        body: JSON.stringify(LEAD_ENVELOPE),
      }),
      { params: { id: created.integration.id } },
    );
    expect(res.status).toBe(202);
    const body = await jsonBody(res);
    expect(body.processed).toBe(1);
    expect(body.dedupe).toBe('external-event-id');

    const db = await readDB();
    expect(db.leads).toHaveLength(1);
    expect(db.leads[0].businessId).toBe('b1');
    expect(db.automationRuns).toHaveLength(1);
    expect(db.integrationEvents.filter((e) => e.status === 'processed')).toHaveLength(1);
  });

  it('6) webhook sem autenticação pela ROTA → 401; payload grande → 413', async () => {
    const tokenA = await createSession(OWNER);
    const created = await jsonBody(await integrationsPOST(jsonReq('/api/integrations', {
      method: 'POST', token: tokenA, body: { businessId: 'b1', provider: 'inbound_webhook', defaultEvent: 'lead.created' },
    })));

    const noAuth = await inboundPOST(
      new NextRequest(`http://localhost:3000/api/integrations/inbound/${created.integration.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }),
      }),
      { params: { id: created.integration.id } },
    );
    expect(noAuth.status).toBe(401);

    const huge = 'x'.repeat(MAX_INBOUND_BYTES + 100);
    const tooBig = await inboundPOST(
      new NextRequest(`http://localhost:3000/api/integrations/inbound/${created.integration.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${created.token}` },
        body: JSON.stringify({ event: 'lead.created', data: { name: huge } }),
      }),
      { params: { id: created.integration.id } },
    );
    expect(tooBig.status).toBe(413);

    const db = await readDB();
    expect(db.leads).toHaveLength(0); // nada foi gravado
  });

  it('18b) a API de log não mistura unidades', async () => {
    const db = seedDb();
    const a = withIntegration(db, 'b1', 'form');
    const b = withIntegration(db, 'b2', 'form');
    processInboundRequest(db, { integrationId: a.integration.id, token: a.token, rawBody: JSON.stringify(LEAD_ENVELOPE), payload: LEAD_ENVELOPE, nowISO: FIXED_NOW });
    processInboundRequest(db, { integrationId: b.integration.id, token: b.token, rawBody: JSON.stringify({ ...LEAD_ENVELOPE, externalId: 'b' }), payload: { ...LEAD_ENVELOPE, externalId: 'b' }, nowISO: FIXED_NOW });
    await writeDB(db);

    const tokenB = await createSession(OTHER_OWNER);
    const resB = await jsonBody(await eventsGET(jsonReq('/api/integrations/events?businessId=b2', { token: tokenB })));
    expect(resB.events).toHaveLength(1);
    expect(resB.events[0].businessId).toBe('b2');
    expect(JSON.stringify(resB)).not.toContain(a.integration.id);
  });

  it('catálogo da API mostra a verdade: canais conectáveis e fontes conectáveis', async () => {
    const tokenA = await createSession(OWNER);
    const listed = await jsonBody(await integrationsGET(jsonReq('/api/integrations?businessId=b1', { token: tokenA })));
    // BLOCO 9: o Instagram passou a ser conectável de verdade (conexão oficial),
    // então o catálogo conta a verdade nova: sem "em breve" e sem P6.1.
    const instagram = listed.channels.find((p: any) => p.provider === 'instagram');
    expect(instagram.canConnect).toBe(true);
    expect(instagram.nativePending).toBe(false);
    expect(JSON.stringify(instagram)).not.toContain('P6.1');
    expect(JSON.stringify(instagram)).not.toContain('em breve');
    const whatsapp = listed.channels.find((p: any) => p.provider === 'whatsapp');
    expect(whatsapp.canConnect).toBe(true);
    const form = listed.sources.find((p: any) => p.provider === 'form');
    expect(form.canConnect).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('P6.6 — Higiene: catálogo, sanitização, SSRF e limites', () => {
  it('catálogo separa canal, fonte e integração técnica (nada achatado)', () => {
    const db = seedDb();
    const { integration } = withIntegration(db, 'b1', 'form');
    const views = providerViewsByKind(listBusinessIntegrations(db, 'b1'));
    expect(providerDef('whatsapp')!.kind).toBe('channel');
    expect(providerDef('form')!.kind).toBe('source');
    expect(providerDef('n8n')!.kind).toBe('technical');
    expect(views.channel.every((v) => v.kind === 'channel')).toBe(true);
    expect(views.source.find((v) => v.provider === 'form')!.connections.map((c) => c.id)).toContain(integration.id);
  });

  it('payload guardado é sanitizado (sem estrutura hostil, sem chave sensível exposta)', () => {
    const clean = sanitizePayload({
      name: 'Ana', deep: { a: { b: { c: { d: 'muito fundo' } } } },
      list: Array.from({ length: 50 }, (_, i) => i),
      big: 'x'.repeat(5000),
      fn: () => 'não entra',
    });
    expect(clean.name).toBe('Ana');
    expect(clean.fn).toBeUndefined();
    expect((clean.list as number[]).length).toBeLessThanOrEqual(20);
    expect(String(clean.big).length).toBeLessThanOrEqual(2000);
    expect(JSON.stringify(clean.deep)).not.toContain('muito fundo');
  });

  it('configuração da integração descarta chave que parece credencial', () => {
    const db = seedDb();
    const res = createIntegration(db, 'b1', {
      provider: 'inbound_webhook', defaultEvent: 'lead.created',
      config: { phoneNumberId: '123', accessToken: 'segredo', api_key: 'x', displayPhone: '+55 11 9…' },
    });
    expect(res.ok).toBe(true);
    const stored = db.integrations[0];
    expect(stored.config.phoneNumberId).toBe('123');
    expect(stored.config.displayPhone).toBeTruthy();
    expect(stored.config.accessToken).toBeUndefined();
    expect(stored.config.api_key).toBeUndefined();
    expect(JSON.stringify(sanitizeIntegration(stored))).not.toContain('segredo');
  });

  it('log não guarda campo com cara de credencial (nem aninhado)', () => {
    const db = seedDb();
    const { integration, token } = withIntegration(db, 'b1', 'inbound_webhook');
    const out = inbound(db, integration.id, token, {
      event: 'lead.created',
      data: {
        name: 'Fulano', phone: '11912345678',
        accessToken: 'nao-pode-ficar', nested: { authorization: 'Bearer x', ok: 'fica' },
      },
    });
    expect(out.status).toBe(202);
    const logged = JSON.stringify(db.integrationEvents);
    expect(logged).not.toContain('nao-pode-ficar');
    expect(logged).not.toContain('Bearer x');
    expect(logged).toContain('fica'); // o resto do payload continua útil para diagnóstico
  });

  it('URL de saída: destino interno é bloqueado em produção', () => {
    const production = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(privateUrlsAllowed(production)).toBe(false);
    expect(privateUrlsAllowed({ NODE_ENV: 'production', ALLOW_PRIVATE_OUTBOUND_URLS: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(privateUrlsAllowed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);

    expect(isPrivateOrReservedHost('localhost')).toBe(true);
    expect(isPrivateOrReservedHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('10.0.0.7')).toBe(true);
    expect(isPrivateOrReservedHost('172.20.3.4')).toBe(true);
    expect(isPrivateOrReservedHost('192.168.0.10')).toBe(true);
    expect(isPrivateOrReservedHost('169.254.169.254')).toBe(true); // metadados de nuvem
    expect(isPrivateOrReservedHost('exemplo.com')).toBe(false);

    const blocked = inspectOutboundUrl('http://169.254.169.254/latest/meta-data', { allowPrivate: false });
    expect(blocked.ok).toBe(false);
    expect(blocked.private).toBe(true);
    expect(inspectOutboundUrl('ftp://exemplo.com/hook', { allowPrivate: false }).ok).toBe(false);
    expect(inspectOutboundUrl('https://user:senha@exemplo.com/hook', { allowPrivate: false }).ok).toBe(false);
    expect(inspectOutboundUrl('https://exemplo.com/hook', { allowPrivate: false }).ok).toBe(true);

    // A configuração do webhook do P3 respeita a mesma regra (produção).
    const previous = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    try {
      const db = seedDb();
      expect(() => upsertWebhook(db, 'b1', { url: 'http://127.0.0.1:9999/hook', events: ['lead.created'] }))
        .toThrow(/SSRF|interno/);
      process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
      expect(upsertWebhook(db, 'b1', { url: 'http://127.0.0.1:9999/hook', events: ['lead.created'] }).url)
        .toBe('http://127.0.0.1:9999/hook');
    } finally {
      (process.env as any).NODE_ENV = previous;
    }
  });

  it('lote de eventos (n8n) é aceito com teto e cada item vira um evento', () => {
    const ctx = {
      businessId: 'b1', integrationId: 'i1', provider: 'n8n' as const,
      defaultEvent: 'lead.created' as const, nowISO: FIXED_NOW,
    };
    const batch = normalizeInboundPayload('n8n', [
      { name: 'Pessoa 1', phone: '11911110001' },
      { name: 'Pessoa 2', phone: '11911110002' },
    ], ctx);
    expect(batch.error).toBeUndefined();
    expect(batch.events).toHaveLength(2);
    expect(batch.events.every((e) => e.event === 'lead.created')).toBe(true);
  });
});
