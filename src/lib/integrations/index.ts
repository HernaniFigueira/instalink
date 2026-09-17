// ═══════════════════════════════════════════════════════════════
// P6 — FACHADA DA CAMADA DE CANAIS E INTEGRAÇÕES EXTERNAS
// ═══════════════════════════════════════════════════════════════
//   EXTERNO → CONNECTOR → EVENTO NORMALIZADO → P4 → CRM/AGENDA/TAREFA
//   P4 (ação) → connector → API EXTERNA
//
// Quem precisa de integração importa daqui. O núcleo do P4 nunca importa um
// provedor específico.
export { PROVIDERS, providerDef, providersOfKind, isIntegrationProvider, OUTBOUND_WEBHOOKS_OWNER } from './catalog';
export type { ProviderDef } from './catalog';

export {
  EXTERNAL_EVENT_DEFS, EXTERNAL_EVENT_IDS, isExternalEvent, isSupportedExternalEvent, externalEventDef,
  buildIdempotencyKey, describeEvent, extractExternalEventId, idempotencyHeaderKey,
  clipText, normalizeEmail, normalizePhone, sanitizePayload, sanitizeMetadata, stripSensitivePayloadKeys,
  MAX_INBOUND_BYTES, MAX_EVENTS_PER_DELIVERY,
} from './contract';
export type { ExternalEventDef, ExternalEventName, NormalizedEvent, NormalizeContext, NormalizeResult } from './contract';

export {
  INTEGRATION_TOKEN_PREFIX, INTEGRATION_SECRET_PREFIX, MAX_INTEGRATIONS_PER_BUSINESS,
  createIntegration, updateIntegration, setIntegrationStatus, rotateIntegrationCredentials,
  deleteIntegration, listBusinessIntegrations, findIntegration, integrationsOfBusiness,
  activeChannelIntegrations, sanitizeIntegration, sanitizeIntegrationConfig, endpointPathFor,
  authenticateIntegrationToken, integrationStatusLabel, maskIntegrationCredential,
  hashIntegrationCredential, generateIntegrationToken, generateIntegrationSigningSecret,
} from './connections';
export type {
  CreateIntegrationInput, CreateIntegrationResult, UpdateIntegrationInput, TokenAuthResult,
} from './connections';

export {
  INBOUND_ADAPTERS, inboundAdapterFor, normalizeInboundPayload,
  registerChannelConnector, channelConnectorFor, channelConnectorList, channelConnectorAvailable,
  sendChannelMessage,
} from './connectors';
export type {
  InboundAdapter, ChannelConnector, ChannelSendResult, ConnectorContext, OutboundChannelMessage,
} from './connectors';

export {
  processInboundRequest, receiveInboundRequest, parseInboundBody,
  extractIntegrationToken, extractIntegrationSignature,
} from './inbound';
export type { InboundOutcome, InboundRequestInput } from './inbound';

export { dispatchOutboundEvent } from './outbound';
export type { OutboundDispatchInput, OutboundDispatchResult, OutboundTarget, OutboundChannelAttempt } from './outbound';

export {
  recordIntegrationEvent, integrationEventsOf, summarizeIntegrationEvents, findProcessedByKey,
  MAX_INTEGRATION_EVENTS_PER_BUSINESS, INTEGRATION_EVENT_RETENTION_MS, INTEGRATION_DUPLICATE_RETENTION_MS,
} from './logs';
export type { RecordIntegrationEventInput } from './logs';

export { inspectOutboundUrl, assertOutboundUrlAllowed, isPrivateOrReservedHost, privateUrlsAllowed } from '../outbound-url';
export type { OutboundUrlInspection } from '../outbound-url';
