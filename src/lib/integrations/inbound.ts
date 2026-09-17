// ═══════════════════════════════════════════════════════════════
// P6 — ENTRADA: sistema externo → evento normalizado → P4
// ═══════════════════════════════════════════════════════════════
// A ordem abaixo NÃO é negociável — é ela que garante isolamento e verdade:
//
//   1. resolver a INTEGRAÇÃO (pelo id do endpoint);
//   2. autenticar a ORIGEM (token; assinatura HMAC quando exigida);
//   3. rejeitar integração/negócio inexistente e integração desativada;
//   4. normalizar o payload (adaptador do provedor) — o `businessId` do corpo
//      é IGNORADO: a unidade vem da integração autenticada;
//   5. idempotência (integração + identificador externo do evento);
//   6. entregar ao MOTOR EXISTENTE (`ingestLead`, `upsertContact` + P4);
//   7. registrar a entrega no log da unidade;
//   8. responder com o que REALMENTE aconteceu.
//
// Nada aqui grava direto em tabela de CRM: quem cria lead é `lib/pipeline.ts`
// (serviço oficial), então deduplicação, esteira, histórico, contato e os
// gatilhos do P4 acontecem exatamente como em qualquer outro caminho.
//
// CONCORRÊNCIA (limite honesto): a checagem de idempotência acontece dentro da
// MESMA escrita do banco (`updateDB`), o que resolve a reentrega sequencial
// (o caso real: o sistema externo reenvia porque não recebeu a resposta). Duas
// chamadas SIMULTÂNEAS de instâncias diferentes podem passar juntas — o mesmo
// comportamento best-effort do P3. Fechar essa janela com reserva atômica
// (CAS) fica para o P6.1.
import type { Business, DB, ExternalEventName, Integration, LeadPriority } from '../types';
import { updateDB } from '../db';
import { verifyWebhookSignature } from '../webhooks';
import { emitAutomationEvent } from '../automation/events';
import { ingestLead, getBusinessPipeline } from '../pipeline';
import { upsertContact, findContact } from '../contacts';
import {
  buildIdempotencyKey, clipText, isSupportedExternalEvent, externalEventDef,
  type NormalizedEvent,
} from './contract';
import { normalizeInboundPayload } from './connectors';
import { providerDef } from './catalog';
import { authenticateIntegrationToken } from './connections';
import { findProcessedByKey, recordIntegrationEvent } from './logs';

export interface InboundRequestInput {
  /** Id da integração (path do endpoint). */
  integrationId: string;
  /** Token do header (`Authorization: Bearer` ou `X-Instalink-Token`). */
  token: string;
  /** `Idempotency-Key` do header (usada quando o payload não traz id). */
  fallbackIdempotencyKey?: string;
  /** `X-Instalink-Signature` (obrigatória quando a integração exige). */
  signature?: string;
  /** Corpo CRU (a assinatura HMAC é conferida sobre ele, não sobre o JSON reescrito). */
  rawBody: string;
  /** Corpo já interpretado (JSON). */
  payload: unknown;
  nowISO?: string;
}

export interface InboundOutcome {
  status: number;
  body: Record<string, unknown>;
}

const LEAD_PRIORITIES: LeadPriority[] = ['low', 'medium', 'high'];

/**
 * Processa uma entrega externa sobre o `db` recebido (puro em relação a I/O).
 * O chamador (`handleInboundRequest`) é quem lê/grava o banco.
 */
export function processInboundRequest(db: DB, input: InboundRequestInput): InboundOutcome {
  const nowISO = input.nowISO || new Date().toISOString();
  const integration = (db.integrations || []).find((i) => i.id === input.integrationId);
  if (!integration) {
    // Integração inexistente: não há unidade a quem atribuir log — resposta
    // genérica (não confirmamos a existência de ids de outras unidades).
    return { status: 404, body: { ok: false, error: 'Integração não encontrada.', code: 'integration_not_found' } };
  }

  const deny = (status: number, error: string, code: string, event: ExternalEventName | '' = ''): InboundOutcome => {
    recordIntegrationEvent(db, {
      businessId: integration.businessId,
      integrationId: integration.id,
      provider: integration.provider,
      direction: 'in',
      event,
      status: 'rejected',
      externalEventId: '',
      httpStatus: status,
      reason: error,
      now: nowISO,
    });
    return { status, body: { ok: false, error, code } };
  };

  // 1-3. Autenticação da origem + existência do negócio + integração ativa.
  const auth = authenticateIntegrationToken(db, integration.id, input.token);
  if (!auth.ok) {
    return deny(auth.status, auth.error || 'Credencial de integração inválida.', auth.status === 404 ? 'integration_not_found' : 'unauthorized');
  }
  const business: Business = auth.business!;
  const def = providerDef(integration.provider);
  if (!def || !def.canConnect || integration.direction === 'out') {
    return deny(403, 'Esta integração não recebe dados externos.', 'provider_not_inbound');
  }

  // Assinatura HMAC (replay/imitação): mesma política do P3 — `t=...,v1=...`,
  // tolerância de 5 minutos e comparação em tempo constante.
  if (integration.requireSignature) {
    const verification = verifyWebhookSignature(
      integration.signingSecret,
      input.rawBody,
      String(input.signature || ''),
      Math.floor(Date.parse(nowISO) / 1000),
    );
    if (!verification.valid) {
      return deny(401, verification.reason || 'Assinatura inválida.', 'invalid_signature');
    }
  }

  // 4. Normalização pelo adaptador do provedor.
  const normalized = normalizeInboundPayload(integration.provider, input.payload, {
    businessId: business.id,
    integrationId: integration.id,
    provider: integration.provider,
    defaultEvent: integration.defaultEvent || '',
    nowISO,
  });
  if (normalized.error || normalized.events.length === 0) {
    return deny(400, normalized.error || 'Payload não reconhecido.', 'invalid_payload');
  }

  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let duplicated = 0;
  let firstFailure: InboundOutcome | null = null;

  for (const event of normalized.events) {
    // 4b. Evento declarado mas ainda sem entrega (canais/agendamento): recusa
    //     explícita, sem inventar efeito.
    if (!isSupportedExternalEvent(event.event)) {
      const reason = externalEventDef(event.event)?.hint || 'Evento ainda não suportado por esta versão.';
      recordIntegrationEvent(db, {
        businessId: business.id,
        integrationId: integration.id,
        provider: integration.provider,
        direction: 'in',
        event: event.event,
        status: 'rejected',
        externalEventId: event.externalId,
        httpStatus: 422,
        reason,
        payloadSummary: event.payload,
        now: nowISO,
      });
      if (!firstFailure) {
        firstFailure = {
          status: 422,
          body: { ok: false, error: reason, code: 'event_not_supported', event: event.event },
        };
      }
      results.push({ event: event.event, status: 'rejected', reason });
      continue;
    }

    // 5. Idempotência: integração + identificador externo do evento.
    const idempotencyKey = buildIdempotencyKey(integration.id, event.externalId, input.fallbackIdempotencyKey || '');
    const alreadyProcessed = findProcessedByKey(db, integration.id, idempotencyKey);
    if (alreadyProcessed) {
      recordIntegrationEvent(db, {
        businessId: business.id,
        integrationId: integration.id,
        provider: integration.provider,
        direction: 'in',
        event: event.event,
        status: 'duplicate',
        externalEventId: event.externalId,
        idempotencyKey,
        httpStatus: 200,
        reason: 'Evento já processado (mesma integração e mesmo identificador externo).',
        leadId: alreadyProcessed.leadId,
        contactId: alreadyProcessed.contactId,
        now: nowISO,
      });
      duplicated += 1;
      results.push({ event: event.event, status: 'duplicate', leadId: alreadyProcessed.leadId });
      continue;
    }

    // 6. Entrega ao motor existente.
    const outcome = forwardToEngine(db, { integration, business, event, nowISO });
    if (!outcome.ok) {
      recordIntegrationEvent(db, {
        businessId: business.id,
        integrationId: integration.id,
        provider: integration.provider,
        direction: 'in',
        event: event.event,
        status: 'rejected',
        externalEventId: event.externalId,
        idempotencyKey,
        httpStatus: outcome.status,
        reason: outcome.error,
        payloadSummary: event.payload,
        now: nowISO,
      });
      if (!firstFailure) {
        firstFailure = { status: outcome.status, body: { ok: false, error: outcome.error, code: 'engine_rejected' } };
      }
      results.push({ event: event.event, status: 'rejected', reason: outcome.error });
      continue;
    }

    // 7. Log da entrega efetiva.
    recordIntegrationEvent(db, {
      businessId: business.id,
      integrationId: integration.id,
      provider: integration.provider,
      direction: 'in',
      event: event.event,
      status: 'processed',
      externalEventId: event.externalId,
      idempotencyKey,
      httpStatus: 202,
      reason: outcome.detail,
      leadId: outcome.leadId,
      contactId: outcome.contactId,
      automationRunIds: outcome.automationRunIds,
      payloadSummary: event.payload,
      now: nowISO,
    });
    processed += 1;
    results.push({
      event: event.event,
      status: 'processed',
      leadId: outcome.leadId,
      contactId: outcome.contactId,
      automationRuns: outcome.automationRunIds.length,
      notes: event.notes,
    });
  }

  integration.lastEventAt = processed > 0 || duplicated > 0 ? nowISO : integration.lastEventAt;
  integration.eventCount = Number(integration.eventCount || 0) + processed;
  integration.updatedAt = nowISO;

  if (processed === 0 && duplicated === 0 && firstFailure) return firstFailure;

  return {
    status: 202,
    body: {
      ok: true,
      received: results.length,
      processed,
      duplicate: duplicated > 0,
      dedupe: buildIdempotencyKey(integration.id, normalized.events[0]?.externalId || '', input.fallbackIdempotencyKey || '')
        ? 'external-event-id'
        : 'none',
      businessId: business.id,
      events: results,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// ENTRADA via HTTP (usada pela rota do webhook de entrada)
// ═══════════════════════════════════════════════════════════════

/** Token da integração: `Authorization: Bearer …` ou `X-Instalink-Token`. */
export function extractIntegrationToken(headers: Headers): string {
  const auth = headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return (headers.get('x-instalink-token') || '').trim();
}

/** Assinatura HMAC do corpo (`t=…,v1=…`), quando a integração exige. */
export function extractIntegrationSignature(headers: Headers): string {
  return (headers.get('x-instalink-signature') || '').trim();
}

/** JSON do corpo cru — erro legível, nunca exceção crua na resposta. */
export function parseInboundBody(rawBody: string): { ok: true; payload: unknown } | { ok: false; error: string } {
  const text = String(rawBody || '').trim();
  if (!text) return { ok: false, error: 'Corpo da requisição vazio.' };
  try {
    return { ok: true, payload: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'Corpo da requisição não é JSON válido.' };
  }
}

/**
 * Porta de entrada completa: lê o banco, processa dentro de UMA escrita
 * (o log, o lead e as execuções do P4 entram juntos) e devolve a resposta.
 */
export async function receiveInboundRequest(req: {
  integrationId: string;
  headers: Headers;
  rawBody: string;
  nowISO?: string;
}): Promise<InboundOutcome> {
  const integrationId = String(req.integrationId || '').trim();
  if (!integrationId) {
    return { status: 404, body: { ok: false, error: 'Integração não encontrada.', code: 'integration_not_found' } };
  }
  const parsed = parseInboundBody(req.rawBody);
  if (!parsed.ok) {
    return { status: 400, body: { ok: false, error: parsed.error, code: 'invalid_body' } };
  }
  return updateDB((db) => processInboundRequest(db, {
    integrationId,
    token: extractIntegrationToken(req.headers),
    signature: extractIntegrationSignature(req.headers),
    fallbackIdempotencyKey: (req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key') || '').trim(),
    rawBody: req.rawBody,
    payload: parsed.payload,
    nowISO: req.nowISO,
  }));
}

// ── Entrega ao motor existente ───────────────────────────────
type ForwardResult =
  | { ok: true; detail: string; leadId: string; contactId: string; automationRunIds: string[] }
  | { ok: false; status: number; error: string };

function runsCreatedSince(db: DB, index: number): string[] {
  return (db.automationRuns || []).slice(index).map((r) => r.id);
}

function forwardToEngine(
  db: DB,
  args: { integration: Integration; business: Business; event: NormalizedEvent; nowISO: string },
): ForwardResult {
  const { integration, business, event, nowISO } = args;
  const runsBefore = (db.automationRuns || []).length;
  try {
    if (event.event === 'lead.created' || event.event === 'lead.updated' || event.event === 'form.submitted') {
      return forwardLead(db, { integration, business, event, nowISO, runsBefore });
    }
    if (event.event === 'contact.created' || event.event === 'contact.updated') {
      return forwardContact(db, { integration, business, event, nowISO, runsBefore });
    }
    return { ok: false, status: 422, error: 'Evento ainda não entregue ao motor.' };
  } catch (err: any) {
    const status = Number(err?.status) || 422;
    return { ok: false, status, error: clipText(err?.message || 'Falha ao entregar o evento ao motor.', 200) };
  }
}

/**
 * Lead/Formulário → `ingestLead` (serviço oficial): deduplicação, contato no
 * CRM, esteira, histórico e gatilhos do P4 saem da MESMA função usada pela
 * página, pelo painel e pela API externa do P3.
 */
function forwardLead(
  db: DB,
  args: { integration: Integration; business: Business; event: NormalizedEvent; nowISO: string; runsBefore: number },
): ForwardResult {
  const { integration, business, event, nowISO, runsBefore } = args;
  const data = event.payload || {};
  const name = clipText(event.contact.name || data.name, 80);
  const phone = event.contact.phone;
  const email = event.contact.email;
  if (!name && !phone && !email) {
    return { ok: false, status: 422, error: 'Payload sem nome, telefone ou e-mail — nada a fazer com o lead.' };
  }

  // Campos com referência interna são validados DENTRO da unidade: um id de
  // outra empresa é descartado (nunca aceito como autoridade).
  const pipeline = getBusinessPipeline(db, business.id);
  const stageIdRaw = clipText(data.stageId, 32);
  const stageId = stageIdRaw && pipeline.stages.some((s) => s.id === stageIdRaw) ? stageIdRaw : '';
  const priorityRaw = clipText(data.priority, 12) as LeadPriority;
  const priority = LEAD_PRIORITIES.includes(priorityRaw) ? priorityRaw : undefined;
  const serviceId = db.services.some((s) => s.id === data.serviceId && s.businessId === business.id) ? clipText(data.serviceId, 64) : '';
  const professionalId = db.professionals.some((p) => p.id === data.professionalId && p.businessId === business.id)
    ? clipText(data.professionalId, 64) : '';

  const result = ingestLead(db, {
    businessId: business.id,
    name,
    phone,
    email,
    instagram: event.contact.instagram,
    customerId: event.contact.customerId,
    message: clipText(data.message, 1000),
    interest: clipText(data.interest, 500),
    source: event.source || integration.provider,
    channel: event.channel,
    sourceUrl: clipText(data.sourceUrl, 300),
    stageId: stageId || undefined,
    priority,
    serviceId: serviceId || undefined,
    professionalId: professionalId || undefined,
    metadata: { ...event.metadata, integrationId: integration.id, externalEventId: event.externalId },
    actor: { id: integration.id, name: `Integração · ${integration.name}`.slice(0, 60), type: 'api' },
    now: nowISO,
  });

  return {
    ok: true,
    detail: result.isNew ? 'lead criado pelo canal externo' : 'lead atualizado pelo canal externo',
    leadId: result.lead.id,
    contactId: result.contact?.id || '',
    automationRunIds: runsCreatedSince(db, runsBefore),
  };
}

/**
 * Contato → `upsertContact` (CRM oficial) + gatilho do P4. Nada é sobrescrito
 * com vazio: o serviço só promove o que veio preenchido.
 */
function forwardContact(
  db: DB,
  args: { integration: Integration; business: Business; event: NormalizedEvent; nowISO: string; runsBefore: number },
): ForwardResult {
  const { integration, business, event, nowISO, runsBefore } = args;
  const name = clipText(event.contact.name, 80);
  const phone = event.contact.phone;
  const email = event.contact.email;
  if (!name && !phone && !email) {
    return { ok: false, status: 422, error: 'Payload sem nome, telefone ou e-mail — nada a fazer com o contato.' };
  }

  const existed = !!findContact(db, business.id, event.contact.customerId, phone, name);
  const contact = upsertContact(db, {
    businessId: business.id,
    customerId: event.contact.customerId,
    name,
    phone,
    email,
    source: event.source || integration.provider,
    now: nowISO,
  });
  if (!contact) return { ok: false, status: 422, error: 'Não foi possível registrar o contato.' };

  emitAutomationEvent(db, {
    event: existed ? 'customer.updated' : 'customer.created',
    businessId: business.id,
    at: nowISO,
    customerId: contact.id,
    eventKey: event.externalId ? `integration:${integration.id}:${event.externalId}` : undefined,
    data: {
      source: event.source || integration.provider,
      channel: event.channel,
      integrationId: integration.id,
    },
  });

  return {
    ok: true,
    detail: existed ? 'contato atualizado pelo canal externo' : 'contato criado pelo canal externo',
    leadId: '',
    contactId: contact.id,
    automationRunIds: runsCreatedSince(db, runsBefore),
  };
}
