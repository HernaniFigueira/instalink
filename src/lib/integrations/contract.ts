// ═══════════════════════════════════════════════════════════════
// P6 — CONTRATO DE EVENTO EXTERNO (o "formato canônico")
// ═══════════════════════════════════════════════════════════════
// Todo dado que entra no InstaLink vindo de fora passa por aqui antes de virar
// efeito: é este contrato que o P4 consome e que qualquer conector futuro
// (WhatsApp, Instagram, n8n, formulário) precisa produzir.
//
//   SISTEMA EXTERNO → CONNECTOR → EVENTO NORMALIZADO → P4
//
// REGRAS DO CONTRATO
//   • `businessId` NUNCA vem do payload — é derivado da integração autenticada;
//   • nomes de evento são os MESMOS do produto (`lead.created`, …): sem
//     vocabulário paralelo e sem tradução no meio do caminho;
//   • o payload é SANITIZADO (limites de tamanho, profundidade e número de
//     chaves) antes de ser gravado — nada de guardar blob hostil no documento;
//   • idempotência = integração + identificador externo do evento.
import type { ExternalEventDef, ExternalEventName, IntegrationProviderId } from '../types';
import { EXTERNAL_EVENT_DEFS } from '../types';
import { onlyDigits } from '../utils';

export { EXTERNAL_EVENT_DEFS };
export type { ExternalEventDef, ExternalEventName };

/** Teto do corpo aceito no endpoint de entrada (bytes). 413 acima disso. */
export const MAX_INBOUND_BYTES = 64 * 1024;
/** Teto de eventos normalizados por requisição (um lote grande é recusado). */
export const MAX_EVENTS_PER_DELIVERY = 25;
/** Tetos de texto/estrutura do payload guardado no log. */
export const MAX_TEXT = 500;
export const MAX_PAYLOAD_KEYS = 40;
export const MAX_METADATA_KEYS = 20;
const MAX_DEPTH = 3;
const MAX_ARRAY_ITEMS = 20;

export const EXTERNAL_EVENT_IDS: ExternalEventName[] = EXTERNAL_EVENT_DEFS.map((d) => d.id);

export function isExternalEvent(id: unknown): id is ExternalEventName {
  return typeof id === 'string' && (EXTERNAL_EVENT_IDS as string[]).includes(id);
}

export function externalEventDef(id: ExternalEventName | ''): ExternalEventDef | undefined {
  return EXTERNAL_EVENT_DEFS.find((d) => d.id === id);
}

/** O P6 entrega este evento ao P4 hoje? (Usado para recusar com motivo claro.) */
export function isSupportedExternalEvent(id: ExternalEventName | ''): boolean {
  return externalEventDef(id)?.supported === true;
}

// ── Evento normalizado ───────────────────────────────────────
/**
 * Contrato de saída de TODO conector de entrada. Tudo que o P4 precisa está
 * aqui — e nada que pertença ao provedor (formato cru fica no adaptador).
 */
export interface NormalizedEvent {
  /** Evento canônico (`lead.created`, `form.submitted`, …). */
  event: ExternalEventName;
  /** SEMPRE a unidade da integração autenticada. */
  businessId: string;
  integrationId: string;
  provider: IntegrationProviderId | '';
  /** Origem declarada pelo payload/adaptador (ex.: 'campanha-setembro'). */
  source: string;
  /** Canal de conversa quando aplicável (ex.: 'instagram'); '' quando não é canal. */
  channel: string;
  /** Identificador do evento NA ORIGEM (idempotência). '' = origem não mandou. */
  externalId: string;
  /** Quando aconteceu na origem (ISO) — default: agora. */
  occurredAt: string;
  /** Dados de contato/lead já mapeados por campo semântico. */
  contact: {
    name: string;
    phone: string;
    email: string;
    instagram: string;
    customerId: string;
  };
  /** Dados adicionais do evento (campos do lead, serviço, mensagem…). */
  payload: Record<string, any>;
  /** Metadados de origem (utm, campanha, formulário de origem…). */
  metadata: Record<string, any>;
  /** Observações do adaptador (ex.: campo ignorado) — nunca segredo. */
  notes: string[];
}

/** Entrada de um adaptador de conector. */
export interface NormalizeContext {
  businessId: string;
  integrationId: string;
  provider: IntegrationProviderId;
  /** Evento padrão configurado na integração ('' = exige envelope canônico). */
  defaultEvent: ExternalEventName | '';
  nowISO: string;
}

export interface NormalizeResult {
  events: NormalizedEvent[];
  /** Preenchido quando o payload não pôde ser interpretado (400 na API). */
  error?: string;
}

// ── Sanitização ──────────────────────────────────────────────
export function clipText(value: unknown, max = MAX_TEXT): string {
  const raw = typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? ''
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
}

/**
 * Deixa o valor JSON-seguro e LIMITADO (profundidade, chaves e tamanho).
 * O que não couber é descartado — nunca truncado no meio de uma estrutura.
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, MAX_TEXT * 4);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      const clean = sanitizeValue(item, depth + 1);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_PAYLOAD_KEYS) break;
      const cleanKey = clipText(key, 60);
      if (!cleanKey) continue;
      const clean = sanitizeValue(item, depth + 1);
      if (clean === undefined) continue;
      out[cleanKey] = clean;
      count += 1;
    }
    return out;
  }
  return undefined; // funções, symbol, undefined…
}

/** Objeto de dados do evento, achatado no primeiro nível e limitado. */
export function sanitizePayload(value: unknown): Record<string, any> {
  const clean = sanitizeValue(value, 0);
  return clean && typeof clean === 'object' && !Array.isArray(clean)
    ? (clean as Record<string, any>)
    : {};
}

/**
 * Chave que PARECE credencial nunca é registrada (log, resumo de evento):
 * um payload externo pode trazer `token`/`accessToken`/`authorization` por
 * acidente ou má intenção, e o log não é lugar de segredo de terceiro.
 */
const SENSITIVE_PAYLOAD_KEY = /(token|secret|senha|password|api[_-]?key|authorization|bearer|credential|private[_-]?key|signature)/i;

/** Remove (recursivamente) chaves que parecem credencial. */
export function stripSensitivePayloadKeys(value: unknown, depth = 0): Record<string, any> {
  const clean = sanitizePayload(value);
  const out: Record<string, any> = {};
  for (const [key, item] of Object.entries(clean)) {
    if (SENSITIVE_PAYLOAD_KEY.test(key)) continue;
    if (item && typeof item === 'object' && !Array.isArray(item) && depth < 2) {
      out[key] = stripSensitivePayloadKeys(item, depth + 1);
    } else if (Array.isArray(item) && depth < 2) {
      out[key] = item.map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? stripSensitivePayloadKeys(entry, depth + 1)
          : entry);
    } else {
      out[key] = item;
    }
  }
  return out;
}

/** Metadados de origem: só primitivos, chaves curtas e poucas entradas. */
export function sanitizeMetadata(value: unknown): Record<string, any> {
  const out: Record<string, any> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  let count = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_METADATA_KEYS) break;
    const cleanKey = clipText(key, 40);
    if (!cleanKey) continue;
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      out[cleanKey] = typeof item === 'string' ? item.slice(0, MAX_TEXT) : item;
      count += 1;
    }
  }
  return out;
}

/** Telefone em dígitos (mesma normalização usada no resto do produto). */
export function normalizePhone(phone: unknown): string {
  return onlyDigits(String(phone ?? '')).slice(0, 20);
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase().slice(0, 120);
}

/**
 * Chave de idempotência do evento externo: integração + identificador da
 * origem. Sem identificador não há dedupe automático (a resposta diz isso de
 * forma explícita — ver `dedupe` na resposta do endpoint).
 */
export function buildIdempotencyKey(integrationId: string, externalEventId: string, fallbackKey = ''): string {
  const id = clipText(externalEventId, 160) || clipText(fallbackKey, 160);
  if (!integrationId || !id) return '';
  return `${integrationId}:${id}`.slice(0, 220);
}

/** Rótulo curto para o log (nunca inclui segredo). */
export function describeEvent(event: NormalizedEvent): string {
  const who = event.contact.name || event.contact.phone || event.contact.email || 'sem identificação';
  return `${event.event} · ${who}`.slice(0, 160);
}

/**
 * Extrai o identificador da entrega de um payload QUALQUER — usado antes da
 * normalização (é o que permite deduplicar até um payload que será recusado).
 */
export function extractExternalEventId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, any>;
  return clipText(
    obj.externalId || obj.eventId || obj.id || obj.messageId || obj.submissionId || '',
    160,
  );
}

/** `Idempotency-Key` do header (mesma semântica do P3). */
export function idempotencyHeaderKey(headers: Headers): string {
  const raw = headers.get('idempotency-key') || headers.get('x-idempotency-key') || '';
  return clipText(raw, 160);
}
