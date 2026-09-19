// ═══════════════════════════════════════════════════════════════
// P6 — SAÍDA: evento interno → connector → sistema externo
// ═══════════════════════════════════════════════════════════════
//   P4 (ação) → dispatchOutboundEvent() → connector específico → API externa
//
// O motor de automação NÃO conhece WhatsApp, Instagram, Telegram nem n8n: ele
// pede o destino ("webhook" hoje; "channel" quando o canal existir) e este
// módulo resolve QUEM entrega.
//
// NÃO EXISTE SEGUNDO MOTOR DE RETRY. Para webhooks, a entrega é feita pelo
// mecanismo do P3 (outbox + claim: HMAC, timeout, histórico de tentativas,
// fila persistida com posse/lease e o cron `/api/cron/webhooks`). Para canais,
// o conector é chamado e o resultado é registrado no log do P6 — sem fila
// paralela.
import { assertOutsideDBTransaction } from '../db-transaction';
import type { DB, Integration, IntegrationProviderId, WebhookDelivery, WebhookEvent } from '../types';
import { dispatchWebhook, enqueueWebhookTx } from '../webhooks';
import { activeChannelIntegrations } from './connections';
import { channelConnectorFor, sendChannelMessage, type ChannelSendResult } from './connectors';
import { recordIntegrationEvent } from './logs';

export type OutboundTarget = 'webhook' | 'channel';

export interface OutboundDispatchInput {
  businessId: string;
  /** Evento canônico de saída (mesma lista do P3: `VALID_WEBHOOK_EVENTS`). */
  event: WebhookEvent;
  data: Record<string, any>;
  /**
   * Alvos desta chamada. Padrão `['webhook']`: a ação `dispatch_webhook` do P4
   * continua significando "webhook de saída". Canais entram quando o conector
   * existir (`send_channel_message`, P6.1) — nada muda de comportamento por
   * conta própria.
   */
  targets?: OutboundTarget[];
  fetchFn?: typeof fetch;
  nowISO?: string;
}

export interface OutboundChannelAttempt {
  integrationId: string;
  provider: IntegrationProviderId;
  ok: boolean;
  code: ChannelSendResult['code'] | 'no_connector';
  detail: string;
}

export interface OutboundDispatchResult {
  /** Destinos de webhook ativos na unidade + entregas criadas (P3). */
  webhooks: { destinations: number; deliveries: WebhookDelivery[] };
  /** Tentativas por canal (hoje: conector indisponível ⇒ `not_implemented`). */
  channels: OutboundChannelAttempt[];
}

/** Parte transacional do destino webhook: só outbox, sem I/O de conector. */
export function enqueueOutboundWebhooksTx(db: DB, input: Pick<OutboundDispatchInput, 'businessId' | 'event' | 'data'>, eventId?: string): OutboundDispatchResult {
  const deliveries = enqueueWebhookTx(db, input.event, input.businessId, input.data, eventId);
  return { webhooks: { destinations: deliveries.length, deliveries }, channels: [] };
}

/**
 * Despacha um evento para os sistemas externos da unidade.
 * Helper em memória, fora de transações. No motor use enqueueOutboundWebhooksTx
 * seguido de entrega pós-commit; não chamar conectores sob lock.
 */
export async function dispatchOutboundEvent(
  db: DB,
  input: OutboundDispatchInput,
): Promise<OutboundDispatchResult> {
  assertOutsideDBTransaction();
  const targets = input.targets && input.targets.length > 0 ? input.targets : ['webhook' as OutboundTarget];
  const nowISO = input.nowISO || new Date().toISOString();
  const result: OutboundDispatchResult = { webhooks: { destinations: 0, deliveries: [] }, channels: [] };

  if (targets.includes('webhook')) {
    const hooks = (db.webhooks || []).filter(
      (w) => w.businessId === input.businessId && w.active && w.events.includes(input.event),
    );
    result.webhooks.destinations = hooks.length;
    if (hooks.length > 0) {
      // Delegação pura para o canal assinado do P3 (HMAC + timeout + retry).
      result.webhooks.deliveries = await dispatchWebhook(
        db, input.event, input.businessId, input.data, input.fetchFn,
      );
    }
  }

  if (targets.includes('channel')) {
    for (const integration of activeChannelIntegrations(db, input.businessId)) {
      const connector = channelConnectorFor(integration.provider);
      const attempt: OutboundChannelAttempt = connector && connector.available
        ? await attemptChannelSend(db, integration, input, nowISO)
        : {
          integrationId: integration.id,
          provider: integration.provider,
          ok: false,
          code: 'not_implemented',
          detail: connector
            ? `${connector.label}: conector ainda não implementado (P6.1).`
            : `Provedor ${integration.provider} sem conector de envio.`,
        };
      result.channels.push(attempt);
      if (!attempt.ok) {
        // Tentativa registrada e NÃO fingida: o canal não foi usado.
        recordIntegrationEvent(db, {
          businessId: input.businessId,
          integrationId: integration.id,
          provider: integration.provider,
          direction: 'out',
          event: '',
          status: 'failed',
          httpStatus: 0,
          reason: attempt.detail,
          payloadSummary: { event: input.event },
          now: nowISO,
        });
      }
    }
  }

  return result;
}

async function attemptChannelSend(
  db: DB,
  integration: Integration,
  input: OutboundDispatchInput,
  nowISO: string,
): Promise<OutboundChannelAttempt> {
  const integrationId = integration.id;
  const to = String(input.data?.to || input.data?.phone || input.data?.whatsapp || '').trim();
  const body = String(input.data?.message || input.data?.body || input.data?.text || '').trim();
  const sent = await sendChannelMessage(db, {
    businessId: input.businessId,
    integrationId,
    to,
    body,
    meta: { event: input.event },
    nowISO,
    fetchFn: input.fetchFn,
  });
  if (sent.ok) {
    recordIntegrationEvent(db, {
      businessId: input.businessId,
      integrationId,
      provider: sent.provider,
      direction: 'out',
      event: '',
      status: 'processed',
      httpStatus: 200,
      reason: sent.detail,
      payloadSummary: { event: input.event },
      now: nowISO,
    });
  }
  return {
    integrationId,
    provider: integration.provider,
    ok: sent.ok,
    code: sent.code,
    detail: sent.detail,
  };
}
