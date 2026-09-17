// ═══════════════════════════════════════════════════════════════
// P6 — CONEXÕES (registro genérico de integração por unidade)
// ═══════════════════════════════════════════════════════════════
// CRUD da `Integration` + credenciais. Reaproveita o padrão já provado no P3
// (`api-keys.ts`): segredo forte, hash em repouso, prefixo visível, máscara na
// resposta e isolamento por Business.
//
//   • TOKEN (`ilk_live_...`)      → identifica a integração e a unidade na
//     entrada. Guardado como SHA-256; aparece UMA vez, na criação/rotação.
//   • SEGREDO (`ilsec_...`)       → assinatura HMAC dos webhooks de entrada.
//     Precisa ser reversível para conferir a assinatura (é a única exceção,
//     documentada) e NUNCA sai depois da criação — a API devolve só a máscara.
//
// `businessId` é derivado SEMPRE da integração autenticada: nenhum payload
// externo escolhe a unidade.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  Business, DB, ExternalEventName, Integration, IntegrationKind,
  IntegrationProviderId, SafeIntegration,
} from '../types';
import { isExternalEvent } from './contract';
import { providerDef } from './catalog';

export const INTEGRATION_TOKEN_PREFIX = 'ilk_live_';
export const INTEGRATION_SECRET_PREFIX = 'ilsec_';
/** Teto de conexões por unidade (proteção contra criação descontrolada). */
export const MAX_INTEGRATIONS_PER_BUSINESS = 25;
/** Teto de conexões do MESMO provedor por unidade. */
export const MAX_INTEGRATIONS_PER_PROVIDER = 5;

export function generateIntegrationToken(): string {
  return `${INTEGRATION_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
}

export function generateIntegrationSigningSecret(): string {
  return `${INTEGRATION_SECRET_PREFIX}${randomBytes(24).toString('hex')}`;
}

/** Hash SHA-256 (o mesmo critério do P3 para credenciais em repouso). */
export function hashIntegrationCredential(secret: string): string {
  return createHash('sha256').update(String(secret || '').trim()).digest('hex');
}

/** Máscara para exibição: nunca revela o valor completo. */
export function maskIntegrationCredential(secret: string): string {
  const value = String(secret || '').trim();
  if (!value) return '';
  const last4 = value.slice(-4);
  const head = value.startsWith(INTEGRATION_TOKEN_PREFIX)
    ? INTEGRATION_TOKEN_PREFIX.replace(/_$/, '')
    : value.startsWith(INTEGRATION_SECRET_PREFIX)
      ? INTEGRATION_SECRET_PREFIX.replace(/_$/, '')
      : '';
  return `${head}••••••••${last4}`;
}

/**
 * Chaves de configuração que parecem credencial são DESCARTADAS na gravação:
 * o documento não é lugar de token de terceiro (e o que não é gravado não
 * vaza em log, resposta nem backup).
 */
const SENSITIVE_CONFIG_KEYS = /(token|secret|password|passwd|senha|apikey|api_key|authorization|bearer|private)/i;

export function sanitizeIntegrationConfig(input: unknown): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_CONFIG_KEYS.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key.slice(0, 60)] = typeof value === 'string' ? value.slice(0, 300) : value;
    }
  }
  return out;
}

/** Caminho do endpoint de entrada da integração ('' quando não recebe dados). */
export function endpointPathFor(integration: Pick<Integration, 'id' | 'direction'>): string {
  if (integration.direction === 'out') return '';
  return `/api/integrations/inbound/${integration.id}`;
}

export function sanitizeIntegration(integration: Integration): SafeIntegration {
  return {
    id: integration.id,
    businessId: integration.businessId,
    kind: integration.kind,
    provider: integration.provider,
    name: integration.name,
    direction: integration.direction,
    status: integration.status,
    tokenMasked: maskIntegrationCredential(integration.tokenPrefix || integration.tokenHash),
    signingSecretMasked: maskIntegrationCredential(integration.signingSecretPrefix || integration.signingSecret),
    requireSignature: integration.requireSignature === true,
    defaultEvent: integration.defaultEvent || '',
    config: sanitizeIntegrationConfig(integration.config),
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    rotatedAt: integration.rotatedAt || '',
    lastEventAt: integration.lastEventAt || '',
    eventCount: Number(integration.eventCount || 0),
    endpointPath: endpointPathFor(integration),
  };
}

export function integrationsOfBusiness(db: DB, businessId: string): Integration[] {
  if (!Array.isArray(db.integrations)) db.integrations = [];
  return db.integrations.filter((i) => i && i.businessId === businessId);
}

export function findIntegration(db: DB, businessId: string, id: string): Integration | undefined {
  if (!id) return undefined;
  return integrationsOfBusiness(db, businessId).find((i) => i.id === id);
}

/** Lista segura (sanitizada) das conexões da unidade, mais recentes primeiro. */
export function listBusinessIntegrations(db: DB, businessId: string): SafeIntegration[] {
  return integrationsOfBusiness(db, businessId)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(sanitizeIntegration);
}

/** Integrações ATIVAS de canal que podem enviar mensagem (uso do P6.1+). */
export function activeChannelIntegrations(db: DB, businessId: string): Integration[] {
  return integrationsOfBusiness(db, businessId).filter(
    (i) => i.kind === 'channel' && i.status === 'active' && (i.direction === 'out' || i.direction === 'both'),
  );
}

export interface CreateIntegrationInput {
  provider: IntegrationProviderId;
  name?: string;
  /** Sobrescreve o evento padrão do provedor (precisa estar na lista dele). */
  defaultEvent?: ExternalEventName | '';
  requireSignature?: boolean;
  config?: Record<string, any>;
  createdByUserId?: string;
}

export interface CreateIntegrationResult {
  ok: boolean;
  integration?: SafeIntegration;
  /** Devolvido UMA ÚNICA VEZ (nem o banco guarda o token em claro). */
  token?: string;
  signingSecret?: string;
  endpointPath?: string;
  status?: number;
  error?: string;
}

export function createIntegration(
  db: DB,
  businessId: string,
  input: CreateIntegrationInput,
  now = new Date().toISOString(),
): CreateIntegrationResult {
  const business: Business | undefined = (db.businesses || []).find((b) => b.id === businessId);
  if (!business) return { ok: false, status: 404, error: 'Negócio não encontrado.' };

  const def = providerDef(input.provider);
  if (!def) return { ok: false, status: 400, error: 'Provedor de integração desconhecido.' };
  if (!def.canConnect) {
    // HONESTIDADE: nada de criar conexão que não existe.
    return { ok: false, status: 409, error: def.unavailableReason || 'Conector ainda não disponível.' };
  }

  const current = integrationsOfBusiness(db, businessId);
  if (current.length >= MAX_INTEGRATIONS_PER_BUSINESS) {
    return { ok: false, status: 409, error: `Limite de ${MAX_INTEGRATIONS_PER_BUSINESS} integrações por unidade atingido.` };
  }
  if (current.filter((i) => i.provider === def.provider).length >= MAX_INTEGRATIONS_PER_PROVIDER) {
    return { ok: false, status: 409, error: `Limite de ${MAX_INTEGRATIONS_PER_PROVIDER} conexões deste tipo atingido.` };
  }

  const defaultEvent = normalizeDefaultEvent(def.events, def.defaultEvent, input.defaultEvent);

  const token = generateIntegrationToken();
  const signingSecret = generateIntegrationSigningSecret();
  const integration: Integration = {
    id: randomUUID(),
    businessId,
    kind: def.kind,
    provider: def.provider,
    name: String(input.name || def.label).trim().slice(0, 60) || def.label,
    direction: def.direction,
    status: 'active',
    tokenHash: hashIntegrationCredential(token),
    tokenPrefix: token.slice(0, INTEGRATION_TOKEN_PREFIX.length + 8),
    signingSecret,
    signingSecretPrefix: signingSecret.slice(0, 14),
    requireSignature: input.requireSignature === true,
    defaultEvent,
    config: sanitizeIntegrationConfig(input.config),
    createdAt: now,
    updatedAt: now,
    createdByUserId: String(input.createdByUserId || ''),
    rotatedAt: '',
    lastEventAt: '',
    eventCount: 0,
  };

  if (!Array.isArray(db.integrations)) db.integrations = [];
  db.integrations.push(integration);

  return {
    ok: true,
    integration: sanitizeIntegration(integration),
    token,
    signingSecret,
    endpointPath: endpointPathFor(integration),
  };
}

function normalizeDefaultEvent(
  allowed: ExternalEventName[],
  fallback: ExternalEventName | '',
  requested: ExternalEventName | '' | undefined,
): ExternalEventName | '' {
  if (requested === '') return '';
  if (isExternalEvent(requested) && allowed.includes(requested)) return requested;
  return fallback;
}

export interface UpdateIntegrationInput {
  name?: string;
  status?: 'active' | 'paused';
  defaultEvent?: ExternalEventName | '';
  requireSignature?: boolean;
  config?: Record<string, any>;
}

export function updateIntegration(
  db: DB,
  businessId: string,
  id: string,
  patch: UpdateIntegrationInput,
  now = new Date().toISOString(),
): { ok: boolean; integration?: SafeIntegration; status?: number; error?: string } {
  const integration = findIntegration(db, businessId, id);
  if (!integration) return { ok: false, status: 404, error: 'Integração não encontrada.' };
  const def = providerDef(integration.provider);

  const name = String(patch.name ?? '').trim();
  if (name) integration.name = name.slice(0, 60);
  if (patch.status === 'active' || patch.status === 'paused') integration.status = patch.status;
  if (patch.requireSignature !== undefined) integration.requireSignature = patch.requireSignature === true;
  if (patch.defaultEvent !== undefined) {
    const allowed = def?.events || [];
    if (patch.defaultEvent !== '' && !(isExternalEvent(patch.defaultEvent) && allowed.includes(patch.defaultEvent))) {
      return { ok: false, status: 400, error: 'Evento padrão não é aceito por este provedor.' };
    }
    integration.defaultEvent = patch.defaultEvent;
  }
  if (patch.config !== undefined) {
    integration.config = sanitizeIntegrationConfig(patch.config);
  }
  integration.updatedAt = now;
  return { ok: true, integration: sanitizeIntegration(integration) };
}

/** Liga/desliga a integração (pausar não apaga nada: o log permanece). */
export function setIntegrationStatus(
  db: DB,
  businessId: string,
  id: string,
  status: 'active' | 'paused',
  now = new Date().toISOString(),
): { ok: boolean; integration?: SafeIntegration; status?: number; error?: string } {
  return updateIntegration(db, businessId, id, { status }, now);
}

/**
 * Rotaciona as credenciais: novo token (hash regravado) e novo segredo de
 * assinatura. O valor cru só existe nesta resposta.
 */
export function rotateIntegrationCredentials(
  db: DB,
  businessId: string,
  id: string,
  now = new Date().toISOString(),
): { ok: boolean; token?: string; signingSecret?: string; integration?: SafeIntegration; status?: number; error?: string } {
  const integration = findIntegration(db, businessId, id);
  if (!integration) return { ok: false, status: 404, error: 'Integração não encontrada.' };
  const token = generateIntegrationToken();
  const signingSecret = generateIntegrationSigningSecret();
  integration.tokenHash = hashIntegrationCredential(token);
  integration.tokenPrefix = token.slice(0, INTEGRATION_TOKEN_PREFIX.length + 8);
  integration.signingSecret = signingSecret;
  integration.signingSecretPrefix = signingSecret.slice(0, 14);
  integration.rotatedAt = now;
  integration.updatedAt = now;
  return { ok: true, token, signingSecret, integration: sanitizeIntegration(integration) };
}

/** Remove a integração e o log de entregas DELA (auditoria geral permanece). */
export function deleteIntegration(db: DB, businessId: string, id: string): { ok: boolean; removedEvents: number; error?: string } {
  if (!Array.isArray(db.integrations)) db.integrations = [];
  const idx = db.integrations.findIndex((i) => i.id === id && i.businessId === businessId);
  if (idx === -1) return { ok: false, removedEvents: 0, error: 'Integração não encontrada.' };
  db.integrations.splice(idx, 1);
  const before = Array.isArray(db.integrationEvents) ? db.integrationEvents.length : 0;
  if (Array.isArray(db.integrationEvents)) {
    db.integrationEvents = db.integrationEvents.filter((e) => !(e.integrationId === id && e.businessId === businessId));
  }
  return { ok: true, removedEvents: before - (db.integrationEvents?.length || 0) };
}

export interface TokenAuthResult {
  ok: boolean;
  status: number;
  error?: string;
  integration?: Integration;
  business?: Business;
}

/**
 * Autentica a ORIGEM pelo token da integração. A unidade e a integração vêm
 * daqui — nunca do corpo da requisição. Comparação em tempo constante sobre os
 * hashes (o token em claro não é persistido nem comparado).
 */
export function authenticateIntegrationToken(
  db: DB,
  integrationId: string,
  token: string,
): TokenAuthResult {
  const provided = String(token || '').trim();
  const integration = (db.integrations || []).find((i) => i.id === integrationId);
  if (!integration) return { ok: false, status: 404, error: 'Integração não encontrada.' };
  const business = (db.businesses || []).find((b) => b.id === integration.businessId);
  if (!business) return { ok: false, status: 404, error: 'Negócio da integração não encontrado.' };
  if (!provided) return { ok: false, status: 401, error: 'Credencial de integração ausente.' };

  const expected = Buffer.from(integration.tokenHash || '', 'hex');
  const actual = Buffer.from(hashIntegrationCredential(provided), 'hex');
  const match = expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!match) return { ok: false, status: 401, error: 'Credencial de integração inválida.' };
  if (integration.status !== 'active') {
    return { ok: false, status: 403, error: 'Integração desativada. Reative para voltar a receber eventos.' };
  }
  return { ok: true, status: 200, integration, business };
}

/** Estado exibido na interface (sem inventar conexão). */
export function integrationStatusLabel(integration: Integration): string {
  if (integration.status === 'paused') return 'Pausada';
  const def = providerDef(integration.provider);
  return def?.kind === 'channel' ? 'Conectado' : 'Ativa';
}
