// ═══════════════════════════════════════════════════════════════
// P6 — CONNECTORS: adaptadores de entrada e conectores de canal
// ═══════════════════════════════════════════════════════════════
// Este é o ÚNICO lugar que conhece o formato de cada sistema externo. O P4, o
// P3 e a interface não sabem (e não devem saber) que "telefone" pode vir como
// `phone`, `telefone` ou `whatsapp`: quem sabe é o adaptador.
//
//   ENTRADA:  payload cru → `InboundAdapter.normalize()` → NormalizedEvent
//   SAÍDA:    `ChannelConnector.send()` → API do canal (P6.1/P6.2)
//
// REGRA DE HONESTIDADE: conector de canal sem implementação devolve
// `not_implemented` — nunca "enviado". A interface mostra o estado real.
import { assertOutsideDBTransaction } from '../db-transaction';
import type { DB, Integration, IntegrationProviderId } from '../types';
import {
  MAX_EVENTS_PER_DELIVERY, clipText, isExternalEvent, normalizeEmail, normalizePhone, sanitizeMetadata, sanitizePayload,
  type NormalizeContext, type NormalizeResult, type NormalizedEvent,
} from './contract';
import { PROVIDERS, providerDef } from './catalog';

// ═══════════════════════════════════════════════════════════════
// ENTRADA — adaptadores
// ═══════════════════════════════════════════════════════════════

export interface InboundAdapter {
  provider: IntegrationProviderId;
  label: string;
  /** Payload cru → eventos canônicos. Função PURA (sem I/O, sem banco). */
  normalize(payload: unknown, ctx: NormalizeContext): NormalizeResult;
}

/** Campos de contato reconhecidos (nome/telefone/e-mail/instagram). */
const NAME_KEYS = ['name', 'nome', 'full_name', 'fullname', 'nome_completo', 'contato'];
const PHONE_KEYS = ['phone', 'telefone', 'whatsapp', 'celular', 'fone', 'telefone_celular', 'mobile'];
const EMAIL_KEYS = ['email', 'e-mail', 'mail'];
const INSTAGRAM_KEYS = ['instagram', 'insta', '@'];
const MESSAGE_KEYS = ['message', 'mensagem', 'observacao', 'observação', 'note', 'comentario', 'comentário', 'duvida', 'dúvida'];
const INTEREST_KEYS = ['interest', 'interesse', 'servico', 'serviço', 'service', 'assunto', 'produto'];
const CUSTOMER_KEYS = ['customerId', 'customer_id', 'cliente_id'];

function pickString(source: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

/** Contato a partir de um objeto "solto" (formulário, lead, webhook cru). */
function contactFrom(source: Record<string, any>) {
  const instagramRaw = pickString(source, INSTAGRAM_KEYS);
  return {
    name: clipText(pickString(source, NAME_KEYS), 80),
    phone: normalizePhone(pickString(source, PHONE_KEYS)),
    email: normalizeEmail(pickString(source, EMAIL_KEYS)),
    instagram: clipText(instagramRaw.replace(/^@/, ''), 60),
    customerId: clipText(pickString(source, CUSTOMER_KEYS), 64),
  };
}

/** Campos do lead que o serviço oficial de ingestão entende. */
function leadPayloadFrom(source: Record<string, any>): Record<string, any> {
  const message = clipText(pickString(source, MESSAGE_KEYS), 1000);
  const interest = clipText(pickString(source, INTEREST_KEYS), 500);
  const payload: Record<string, any> = {};
  if (message) { payload.message = message; payload.interest = interest || message; }
  else if (interest) payload.interest = interest;
  for (const key of [
    'stageId', 'serviceId', 'professionalId', 'priority', 'sourceUrl', 'assignedUserId',
  ]) {
    const value = clipText(source[key], 300);
    if (value) payload[key] = value;
  }
  return payload;
}

function baseEvent(ctx: NormalizeContext, payload: Record<string, any>, extra: {
  event: NormalizedEvent['event'];
  externalId?: string;
  occurredAt?: string;
  source?: string;
  channel?: string;
  contact: NormalizedEvent['contact'];
  data?: Record<string, any>;
  metadata?: Record<string, any>;
  notes?: string[];
}): NormalizedEvent {
  return {
    // businessId SEMPRE do contexto autenticado — jamais do payload.
    businessId: ctx.businessId,
    integrationId: ctx.integrationId,
    provider: ctx.provider,
    event: extra.event,
    source: clipText(extra.source || payload.source || payload.origem || ctx.provider, 40),
    channel: clipText(extra.channel || payload.channel || payload.canal || '', 40),
    externalId: clipText(extra.externalId, 160),
    occurredAt: validIso(extra.occurredAt) || ctx.nowISO,
    contact: extra.contact,
    payload: sanitizePayload(extra.data || {}),
    metadata: sanitizeMetadata(extra.metadata || {}),
    notes: (extra.notes || []).slice(0, 5).map((n) => clipText(n, 160)),
  };
}

/** ISO válido (o timestamp da origem não é confiado às cegas). */
function validIso(value: unknown): string {
  const raw = clipText(value, 40);
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '';
  const iso = new Date(parsed).toISOString();
  // Timestamp absurdo (mais de 1 ano no futuro/passado) é ignorado.
  const drift = Math.abs(Date.now() - parsed);
  if (drift > 365 * 86400000) return '';
  return iso;
}

/** Envelope canônico do InstaLink (ver docs/integracoes-p6.md). */
function isEnvelope(payload: unknown): payload is Record<string, any> {
  return !!payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof (payload as Record<string, any>).event === 'string';
}

function metadataFrom(payload: Record<string, any>): Record<string, any> {
  const meta = { ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}) };
  // Chaves de rastreio no nível raiz também são aproveitadas (utm_*, gclid…).
  for (const [key, value] of Object.entries(payload)) {
    if (/^(utm_|fbclid|gclid|ttclid|ref$|campanha|campaign|ad_|adset)/i.test(key)) meta[key] = value;
  }
  return meta;
}

/**
 * Envelope canônico → UM evento. `businessId` do payload é descartado (e
 * anotado) — a autoridade é a integração autenticada.
 */
function eventFromEnvelope(payload: Record<string, any>, ctx: NormalizeContext): NormalizeResult {
  const eventId = clipText(payload.event, 60);
  if (!isExternalEvent(eventId)) return { events: [], error: `Evento desconhecido: ${eventId || '(vazio)'}.` };
  const data = (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data))
    ? payload.data as Record<string, any>
    : {};
  const contactSource = (payload.contact && typeof payload.contact === 'object' && !Array.isArray(payload.contact))
    ? { ...data, ...(payload.contact as Record<string, any>) }
    : data;
  const notes: string[] = [];
  const payloadBusiness = clipText(payload.businessId, 64);
  if (payloadBusiness && payloadBusiness !== ctx.businessId) {
    notes.push('businessId do payload ignorado (a unidade vem da integração autenticada)');
  }
  const event = baseEvent(ctx, payload, {
    event: eventId,
    externalId: payload.externalId || payload.eventId || payload.id || '',
    occurredAt: payload.occurredAt || payload.occurred_at || payload.timestamp || '',
    source: payload.source,
    channel: payload.channel,
    contact: contactFrom(contactSource),
    data: { ...leadPayloadFrom(data), ...data },
    metadata: metadataFrom(payload),
    notes,
  });
  return { events: [event] };
}

/** Payload cru (sem `event`) → evento padrão do provedor. */
function eventFromRaw(payload: Record<string, any>, ctx: NormalizeContext): NormalizeResult {
  const event = ctx.defaultEvent || providerDef(ctx.provider)?.defaultEvent || '';
  if (!isExternalEvent(event)) {
    return { events: [], error: 'Payload sem `event` e a integração não tem evento padrão configurado.' };
  }
  const data = (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data))
    ? payload.data as Record<string, any>
    : payload;
  const notes: string[] = [];
  const payloadBusiness = clipText(payload.businessId, 64);
  if (payloadBusiness && payloadBusiness !== ctx.businessId) {
    notes.push('businessId do payload ignorado (a unidade vem da integração autenticada)');
  }
  return {
    events: [baseEvent(ctx, payload, {
      event,
      externalId: payload.externalId || payload.eventId || payload.id || payload.submissionId || '',
      occurredAt: payload.occurredAt || payload.created_at || payload.timestamp || '',
      contact: contactFrom({ ...data, ...pickObject(payload, 'contact') }),
      data: { ...leadPayloadFrom(data), ...sanitizePayload(data) },
      metadata: metadataFrom(payload),
      notes,
    })],
  };
}

function pickObject(source: Record<string, any>, key: string): Record<string, any> {
  const value = source[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Lista (n8n/planilha manda arrays) → vários eventos, com teto. */
function normalizeList(payload: unknown[], ctx: NormalizeContext): NormalizeResult {
  const events: NormalizedEvent[] = [];
  for (const item of payload.slice(0, MAX_EVENTS_PER_DELIVERY)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const one = normalizePayload(item as Record<string, any>, ctx);
    if (one.error) return one; // um item inválido invalida o lote (recusa explícita)
    events.push(...one.events);
  }
  if (events.length === 0) return { events: [], error: 'Lote sem eventos válidos.' };
  return { events };
}

/**
 * Entrada comum: envelope canônico, payload cru ou lista. `strict` (integrações
 * técnicas/webhook) exige o envelope — nada de adivinhar formato de API.
 */
function normalizePayload(payload: unknown, ctx: NormalizeContext, strict = false): NormalizeResult {
  if (Array.isArray(payload)) return normalizeList(payload, ctx);
  if (!payload || typeof payload !== 'object') return { events: [], error: 'Payload inválido (JSON de objeto esperado).' };
  const object = payload as Record<string, any>;
  if (isEnvelope(object)) return eventFromEnvelope(object, ctx);
  if (strict) return { events: [], error: 'Envelope canônico obrigatório para este provedor (`event` ausente).' };
  const events = eventFromRaw(object, ctx);
  if (!events.error && events.events.length === 0) return { events: [], error: 'Nenhum evento reconhecido no payload.' };
  return events;
}

export const INBOUND_ADAPTERS: InboundAdapter[] = [
  {
    provider: 'inbound_webhook', label: 'Webhook de entrada',
    normalize: (payload, ctx) => normalizePayload(payload, ctx, true),
  },
  {
    provider: 'external_api', label: 'API externa',
    normalize: (payload, ctx) => normalizePayload(payload, ctx, true),
  },
  {
    provider: 'n8n', label: 'n8n',
    normalize: (payload, ctx) => normalizePayload(payload, ctx),
  },
  {
    provider: 'form', label: 'Formulário',
    normalize: (payload, ctx) => normalizePayload(payload, ctx),
  },
  {
    provider: 'landing_page', label: 'Landing page',
    normalize: (payload, ctx) => normalizePayload(payload, ctx),
  },
  {
    provider: 'paid_traffic', label: 'Tráfego pago',
    normalize: (payload, ctx) => normalizePayload(payload, ctx),
  },
];

export function inboundAdapterFor(provider: IntegrationProviderId): InboundAdapter | undefined {
  return INBOUND_ADAPTERS.find((a) => a.provider === provider);
}

/** Normaliza usando o adaptador do provedor (fallback: leitura tolerante). */
export function normalizeInboundPayload(
  provider: IntegrationProviderId,
  payload: unknown,
  ctx: NormalizeContext,
): NormalizeResult {
  const adapter = inboundAdapterFor(provider);
  const result = adapter
    ? adapter.normalize(payload, ctx)
    : normalizePayload(payload, ctx, false);
  if (result.error) return result;
  if (result.events.length === 0) return { events: [], error: 'Nenhum evento reconhecido no payload.' };
  if (result.events.length > MAX_EVENTS_PER_DELIVERY) {
    return { events: [], error: `Lote acima do limite de ${MAX_EVENTS_PER_DELIVERY} eventos.` };
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// SAÍDA — conectores de canal
// ═══════════════════════════════════════════════════════════════
//
// O P4 chama `dispatchOutboundEvent` (lib/integrations/outbound.ts) e NUNCA um
// provedor específico. Quem implementa `send` é o conector — hoje nenhum canal
// oficial está implementado, então o resultado é honesto: `not_implemented`.
// O P6.1 implementa `whatsapp`/`instagram`; o P6.2, `messenger`/`telegram`.

export interface OutboundChannelMessage {
  businessId: string;
  integrationId: string;
  provider: IntegrationProviderId;
  /** Destino no canal (telefone em dígitos, handle, chat id). */
  to: string;
  body: string;
  /** Contexto opcional (ex.: template aprovado, mídia). */
  meta?: Record<string, any>;
}

export interface ChannelSendResult {
  ok: boolean;
  code: 'sent' | 'not_implemented' | 'missing_credentials' | 'invalid_target' | 'provider_error' | 'skipped';
  detail: string;
  /** Id da mensagem no provedor (quando enviada). */
  externalId?: string;
  retryable?: boolean;
}

export interface ConnectorContext {
  businessId: string;
  integration: Integration;
  nowISO: string;
  fetchFn?: typeof fetch;
}

export interface ChannelConnector {
  provider: IntegrationProviderId;
  label: string;
  /** false = interface mostra "Disponível em breve" e a saída é recusada. */
  available: boolean;
  send(ctx: ConnectorContext, message: OutboundChannelMessage): Promise<ChannelSendResult>;
}

function unavailableConnector(provider: IntegrationProviderId, label: string, reason: string): ChannelConnector {
  return {
    provider,
    label,
    available: false,
    async send() {
      return { ok: false, code: 'not_implemented', detail: reason, retryable: false };
    },
  };
}

const channelConnectors = new Map<IntegrationProviderId, ChannelConnector>();

for (const def of PROVIDERS.filter((p) => p.kind === 'channel')) {
  channelConnectors.set(def.provider, unavailableConnector(
    def.provider,
    def.label,
    def.unavailableReason || 'Conector do canal ainda não implementado.',
  ));
}

/**
 * Registra (ou substitui) o conector de um canal. Ponto de extensão do P6.1/P6.2
 * e dos testes — nenhum outro lugar do sistema precisa mudar para um canal
 * existir.
 */
export function registerChannelConnector(connector: ChannelConnector): void {
  channelConnectors.set(connector.provider, connector);
}

export function channelConnectorFor(provider: IntegrationProviderId): ChannelConnector | undefined {
  return channelConnectors.get(provider);
}

export function channelConnectorList(): ChannelConnector[] {
  return [...channelConnectors.values()];
}

/** O conector de canal existe E está implementado? (verdade para a interface) */
export function channelConnectorAvailable(provider: IntegrationProviderId): boolean {
  return channelConnectors.get(provider)?.available === true;
}

/**
 * Envia uma mensagem por UM conector de canal. Sem conector implementado a
 * resposta é `not_implemented` — o chamador registra a tentativa e não finge
 * entrega.
 */
export async function sendChannelMessage(
  db: DB,
  input: {
    businessId: string;
    integrationId: string;
    to: string;
    body: string;
    meta?: Record<string, any>;
    nowISO?: string;
    fetchFn?: typeof fetch;
  },
): Promise<ChannelSendResult & { provider: IntegrationProviderId | '' }> {
  assertOutsideDBTransaction();
  const integration = (db.integrations || []).find(
    (i) => i.id === input.integrationId && i.businessId === input.businessId,
  );
  if (!integration) {
    return { ok: false, provider: '', code: 'invalid_target', detail: 'Integração não encontrada nesta unidade.' };
  }
  const connector = channelConnectorFor(integration.provider);
  if (!connector || !connector.available) {
    return {
      ok: false,
      provider: integration.provider,
      code: 'not_implemented',
      detail: connector
        ? `${connector.label}: conector ainda não implementado.`
        : `Provedor ${integration.provider} não tem conector de envio.`,
    };
  }
  const to = clipText(input.to, 120);
  const body = clipText(input.body, 2000);
  if (!to || !body) {
    return { ok: false, provider: integration.provider, code: 'invalid_target', detail: 'Destino ou mensagem vazios.' };
  }
  const result = await connector.send(
    {
      businessId: input.businessId,
      integration,
      nowISO: input.nowISO || new Date().toISOString(),
      fetchFn: input.fetchFn,
    },
    {
      businessId: input.businessId,
      integrationId: integration.id,
      provider: integration.provider,
      to,
      body,
      meta: sanitizeMetadata(input.meta),
    },
  );
  return { ...result, provider: integration.provider };
}
