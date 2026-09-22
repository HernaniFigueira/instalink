// ═══════════════════════════════════════════════════════════════
// FATIA RELACIONAL POR UNIDADE (slice) — o caminho de ESCRITA do modo relacional.
// ═══════════════════════════════════════════════════════════════
// Como funciona (e por que NÃO é o "documento inteiro"):
//   1. BEGIN + advisory lock da unidade + SELECT ... FOR UPDATE do negócio;
//   2. carrega SOMENTE as linhas DA UNIDADE que as operações de agenda/CRM/
//      automação mexem (WHERE business_id = $1, índices de 0001);
//   3. executa as FUNÇÕES CANÔNICAS do produto (createBookingTx,
//      createSeriesTx, applyBookingStatusTx, ingestLead, enqueueDueReminders…)
//      sobre essa fatia — as regras continuam tendo UMA só fonte;
//   4. faz diff antes/depois e grava de volta APENAS as linhas mudadas
//      (upsert/delete por id), na MESMA transação;
//   5. COMMIT; após o commit, a fila P4 é drenada pelo mesmo motor.
// Consultas específicas por unidade, transação única, escrita em UM banco só.
import type { Pool, PoolClient } from 'pg';
import { getPool } from './pool';
import { rowToBooking, rowToService, rowToProfessional, rowToAvailability, rowToException } from './mapping';
import { bookingToRow } from './mapping';
import { emptyDB } from '../db';
import type { DB } from '../types';
// Import PREGUIÇOSO: slice.ts é carregado por rotas leves (auth, público);
// o executor puxa os conectores de canal (efeito colateral de registro no
// import) — só quando o dreno de automações roda de fato.
type ExecutorModule = typeof import('../automation/executor');
let executorPromise: Promise<ExecutorModule> | null = null;
async function executor(): Promise<ExecutorModule> {
  if (!executorPromise) executorPromise = import('../automation/executor');
  return executorPromise;
}
type CapabilitiesModule = typeof import('../automation/capabilities');
let capabilitiesPromise: Promise<CapabilitiesModule> | null = null;
async function capabilities(): Promise<CapabilitiesModule> {
  if (!capabilitiesPromise) capabilitiesPromise = import('../automation/capabilities');
  return capabilitiesPromise;
}

const emitLog = (msg: string) => { if (process.env.GODOUTOR_SQL_DEBUG) console.log(`[sql] ${msg}`); };

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const dateStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const timeStr = (v: unknown): string => String(v ?? '').slice(0, 5);
import { rowToBusiness } from './business-row';
export { rowToBusiness };
const s = (v: unknown): string => String(v ?? '');
const n = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const b = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const j = <T>(v: unknown, d: T): T => {
  if (v == null) return d;
  if (typeof v === 'object') return v as T; // pg já devolve jsonb parseado
  try { return JSON.parse(String(v)) as T; } catch { return d; }
};
const jn = <T>(v: unknown, d: T): T => (v == null ? d : (typeof v === 'object' ? v as T : (j(v, d))));

// ── Linha → domínio (espelho exato dos builders do import/transform.ts) ──

function rowToCustomer(r: any) {
  return {
    id: s(r.id), name: s(r.name), phone: s(r.phone), email: s(r.email),
    passwordHash: s(r.password_hash), googleId: s(r.google_id), avatar: s(r.avatar),
    mustChangePassword: b(r.must_change_password),
    ...(r.access_created_at ? { accessCreatedAt: iso(r.access_created_at) } : {}),
    createdAt: iso(r.created_at),
  };
}
function rowToContact(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), customerId: s(r.customer_id),
    name: s(r.name), phone: s(r.phone), email: s(r.email),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    source: s(r.source) || 'interaction', ...(r.last_interaction ? { lastInteraction: iso(r.last_interaction) } : {}),
    marketingOptIn: b(r.marketing_opt_in), note: s(r.note),
    ...(r.notes ? { notes: j(r.notes, []) } : {}), ...(r.profile ? { profile: j(r.profile, {}) } : {}),
    ...(r.channel_identities ? { channelIdentities: j(r.channel_identities, {}) } : {}),
  } as any;
}
function rowToConversation(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), channel: s(r.channel),
    channelUserId: s(r.channel_user_id), channelAccountId: s(r.channel_account_id),
    ...(r.last_inbound_at ? { lastInboundAt: iso(r.last_inbound_at) } : {}),
    channelUsername: s(r.channel_username),
    contactId: s(r.contact_id), customerId: s(r.customer_id),
    name: s(r.name), phone: s(r.phone), status: s(r.status) || 'open',
    mode: (s(r.mode) || 'automation') as any, unread: n(r.unread),
    lastMessageAt: r.last_message_at ? iso(r.last_message_at) : '',
    lastMessagePreview: s(r.last_message_preview), createdAt: iso(r.created_at),
    ...(r.context ? { context: j(r.context, {}) } : {}),
  } as any;
}
function rowToMessage(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), conversationId: s(r.conversation_id),
    direction: s(r.direction) as 'in' | 'out', body: s(r.body), status: s(r.status) || 'pending',
    externalId: s(r.external_id), by: s(r.by), byName: s(r.by_name),
    channel: s(r.channel), channelUserId: s(r.channel_user_id),
    at: iso(r.at), error: s(r.error),
    ...(r.claim_token ? { claimToken: s(r.claim_token) } : {}),
    ...(r.claim_expires_at ? { claimExpiresAt: iso(r.claim_expires_at) } : {}),
    attempts: n(r.attempts), ...(r.next_retry_at ? { nextRetryAt: iso(r.next_retry_at) } : {}),
    ...(r.meta ? { meta: j(r.meta, {}) } : {}),
  } as any;
}
function rowToEvent(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), type: s(r.type), path: s(r.path),
    meta: jn(r.meta, {}), createdAt: iso(r.created_at),
  } as any;
}
export function rowToLead(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), customerId: s(r.customer_id),
    name: s(r.name), phone: s(r.phone), email: s(r.email), instagram: s(r.instagram),
    origin: s(r.origin), channel: s(r.channel), interest: s(r.interest), action: s(r.action),
    status: s(r.status) || 'new', createdAt: iso(r.created_at),
    lastInteraction: r.last_interaction ? iso(r.last_interaction) : '',
    stageId: s(r.stage_id) || 'new', assignedUserId: s(r.assigned_user_id),
    ...(r.priority ? { priority: s(r.priority) } : {}), nextAction: s(r.next_action),
    serviceId: s(r.service_id), professionalId: s(r.professional_id),
    sourceUrl: s(r.source_url), ...(r.metadata ? { metadata: j(r.metadata, {}) } : {}),
    bookingId: s(r.booking_id),
    ...(r.notes ? { notes: j(r.notes, []) } : {}), ...(r.stage_history ? { stageHistory: j(r.stage_history, []) } : {}),
  } as any;
}
function rowToPipeline(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), stages: jn(r.stages, [] as any[]),
    updatedAt: iso(r.updated_at),
  } as any;
}
function rowToAutomation(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), name: s(r.name), description: s(r.description),
    active: b(r.active, true), trigger: jn(r.trigger, null as any), nodes: jn(r.nodes, [] as any[]),
    edges: jn(r.edges, [] as any[]), settings: jn(r.settings, {} as any),
    templateId: s(r.template_id), version: n(r.version, 1), createdByUserId: s(r.created_by_user_id),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  } as any;
}
function rowToAutomationRun(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), automationId: s(r.automation_id),
    automationName: s(r.automation_name), status: s(r.status) || 'queued',
    triggerEvent: s(r.trigger_event), currentNodeId: s(r.current_node_id),
    context: jn(r.context, {} as any), ...(r.waiting_until ? { waitingUntil: iso(r.waiting_until) } : {}),
    startedAt: iso(r.started_at), updatedAt: iso(r.updated_at),
    ...(r.finished_at ? { finishedAt: iso(r.finished_at) } : {}), error: s(r.error),
    history: jn(r.history, [] as any[]), eventKey: s(r.event_key), emittedByRunId: s(r.emitted_by_run_id),
    steps: n(r.steps), resumes: n(r.resumes),
    lastActionType: s(r.last_action_type), lastError: s(r.last_error),
    ...(r.claim_token ? { claimToken: s(r.claim_token) } : {}),
    ...(r.claim_expires_at ? { claimExpiresAt: iso(r.claim_expires_at) } : {}),
  } as any;
}
function rowToTask(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), title: s(r.title), note: s(r.note),
    status: s(r.status) || 'open', ...(r.due_at ? { dueAt: iso(r.due_at) } : {}),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at ?? r.created_at),
    ...(r.done_at ? { doneAt: iso(r.done_at) } : {}), assignedUserId: s(r.assigned_user_id),
    createdBy: s(r.created_by), automationId: s(r.automation_id), automationRunId: s(r.automation_run_id),
    automationNodeId: s(r.automation_node_id), leadId: s(r.lead_id), bookingId: s(r.booking_id),
    customerId: s(r.customer_id), encounterId: s(r.encounter_id), source: s(r.source) || 'automation',
  } as any;
}
function rowToAudit(r: any) {
  return {
    id: s(r.id), at: iso(r.at), action: s(r.action),
    actorUserId: s(r.actor_user_id), actorEmail: s(r.actor_email), actorRole: s(r.actor_role),
    businessId: s(r.business_id), supportSessionId: s(r.support_session_id),
    meta: jn(r.meta, {}),
  } as any;
}
function rowToReview(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), customerId: s(r.customer_id),
    customerName: s(r.customer_name), rating: n(r.rating, 5), text: s(r.text),
    source: s(r.source) || 'site', status: s(r.status) || 'pending',
    orderId: s(r.order_id), bookingId: s(r.booking_id), externalId: s(r.external_id),
    createdAt: iso(r.created_at),
  } as any;
}

export const SLICE_COLLECTIONS = [
  'businesses', 'services', 'professionals', 'availability', 'exceptions', 'bookings',
  'contacts', 'customers', 'conversations', 'messages', 'leads', 'pipelines', 'automations',
  'automationRuns', 'events', 'tasks', 'audit', 'reviews', 'webhooks', 'webhookDeliveries',
  'users', 'pages', 'categories', 'products', 'options', 'optionValues',
  'members', 'sessions', 'queue', 'encounters', 'orders',
] as const;

export type SliceColl = (typeof SLICE_COLLECTIONS)[number];

/** Tabela SQL de cada coleção da fatia (para carregamento direcionado). */
export const SLICE_TABLE: Record<Exclude<SliceColl, 'businesses' | 'customers'>, string> = {
  users: 'app.users',
  pages: 'app.pages',
  categories: 'app.categories',
  products: 'app.products',
  options: 'app.product_options',
  optionValues: 'app.product_option_values',
  members: 'app.members',
  sessions: 'app.sessions',
  queue: 'app.queue_entries',
  encounters: 'app.encounters',
  orders: 'app.orders',
  services: 'app.services',
  professionals: 'app.professionals',
  availability: 'app.availability',
  exceptions: 'app.availability_exceptions',
  bookings: 'app.bookings',
  contacts: 'app.contacts',
  conversations: 'app.conversations',
  messages: 'app.messages',
  leads: 'app.leads',
  pipelines: 'app.pipelines',
  automations: 'app.automations',
  automationRuns: 'app.automation_runs',
  events: 'app.events',
  tasks: 'app.tasks',
  audit: 'app.audit',
  reviews: 'app.reviews',
  webhooks: 'app.webhooks',
  webhookDeliveries: 'app.webhook_deliveries',
};

// ── Carregamento DIRECIONADO (cada operação carrega só o que usa) ──────────
// Bloqueio de desempenho: NENHUMA escrita reconstrói o documento da unidade.
// Cada operação declara as coleções que lê, com WHERE/ORDER/LIMIT próprios;
// coleção fora da spec permanece vazia (append-only: só o que `fn` criar é
// gravado — nada é apagado sem ter sido carregado).
export interface TableLoad { where?: string; args?: unknown[]; order?: string; limit?: number; global?: boolean }
export type SliceLoadFn = (partial: DB) => TableLoad | null | undefined;
export type SliceSpec = Partial<Record<SliceColl, TableLoad | SliceLoadFn>>;

const resolveLoad = (entry: TableLoad | SliceLoadFn | undefined, partial: DB): TableLoad | null =>
  typeof entry === 'function' ? (entry(partial) ?? null) : (entry ?? null);

function rowToWebhook(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), url: s(r.url), secret: s(r.secret),
    events: jn(r.events, [] as string[]), active: b(r.active, true),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  } as any;
}
function rowToWebhookDelivery(r: any) {
  return {
    id: s(r.id), webhookId: s(r.webhook_id), businessId: s(r.business_id), event: s(r.event),
    eventId: s(r.event_id), url: s(r.url), payloadSummary: jn(r.payload_summary, {}),
    status: s(r.status) || 'pending', ...(r.status_code != null ? { statusCode: n(r.status_code) } : {}),
    error: s(r.error), attempts: n(r.attempts, 1), maxAttempts: n(r.max_attempts, 3),
    ...(r.next_retry_at ? { nextRetryAt: iso(r.next_retry_at) } : {}),
    ...(r.delivered_at ? { deliveredAt: iso(r.delivered_at) } : {}),
    attemptsHistory: jn(r.attempts_history, [] as any[]),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    ...(r.claim_token ? { claimToken: s(r.claim_token) } : {}),
    ...(r.claim_expires_at ? { claimExpiresAt: iso(r.claim_expires_at) } : {}),
  } as any;
}

function rowToCategory(r: any) {
  return { id: s(r.id), businessId: s(r.business_id), kind: s(r.kind), name: s(r.name), order: n(r.order), active: b(r.active, true) } as any;
}
function rowToProduct(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), categoryId: s(r.category_id),
    name: s(r.name), description: s(r.description), image: s(r.image),
    price: n(r.price), promoPrice: n(r.promo_price),
    active: b(r.active, true), featured: b(r.featured), order: n(r.order),
  } as any;
}
function rowToOption(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), productId: s(r.product_id),
    name: s(r.name), required: b(r.required), multiple: b(r.multiple),
    min: n(r.min), max: n(r.max), order: n(r.order),
  } as any;
}
function rowToOptionValue(r: any) {
  return { id: s(r.id), optionId: s(r.option_id), name: s(r.name), priceDelta: n(r.price_delta), active: b(r.active, true) } as any;
}
function rowToMember(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), userId: s(r.user_id), role: s(r.role),
    permissions: jn(r.permissions, {} as any), active: b(r.active, true), note: s(r.note),
    invitedBy: s(r.invited_by), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  } as any;
}
function rowToUserFull(r: any) {
  return {
    id: s(r.id), name: s(r.name), email: s(r.email), role: s(r.role) || 'owner',
    passwordHash: s(r.password_hash), googleId: '', avatar: '', mustChangePassword: false,
    active: r.active !== false, lastLoginAt: r.last_login_at ? iso(r.last_login_at) : '',
    createdAt: iso(r.created_at),
  } as any;
}
function rowToSession(r: any) {
  return { id: s(r.id), userId: s(r.user_id), createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) } as any;
}
function rowToOrder(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), customerId: s(r.customer_id),
    code: s(r.code), customerName: s(r.customer_name), customerPhone: s(r.customer_phone),
    customerAddress: s(r.customer_address), type: s(r.type) === 'pickup' ? 'pickup' : 'delivery',
    payment: s(r.payment), items: jn(r.items, [] as any[]),
    subtotal: n(r.subtotal), total: n(r.total), status: s(r.status) || 'new',
    note: s(r.note), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    history: jn(r.history, [] as any[]),
  } as any;
}
function rowToAvailabilityLight(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), professionalId: s(r.professional_id),
    serviceId: s(r.service_id), weekday: n(r.weekday), start: timeStr(r.start),
    end: timeStr(r.end), slotMin: n(r.slot_min, 30),
  } as any;
}
function rowToExceptionLight(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), date: dateStr(r.date),
    closed: b(r.closed), start: timeStr(r.start), end: timeStr(r.end), note: s(r.note),
  } as any;
}
// Fila/atendimento: mappers do ops-store (módulo leve, sem importar slice).
async function opsMappers() {
  return await import('./ops-store');
}

/**
 * Carrega a fatia DA UNIDADE. Sem `spec`: todas as coleções da unidade
 * (comportamento histórico). Com `spec`: SOMENTE as coleções declaradas,
 * cada uma com seu WHERE/ORDER/LIMIT — a operação nunca reconstrói o
 * documento da unidade inteira.
 * `customers` (conta global) vem apenas pelos ids referenciados na fatia.
 */
export async function loadBusinessSlice(client: PoolClient, businessId: string, spec?: SliceSpec): Promise<DB> {
  if (spec) return loadTargetedSlice(client, businessId, spec);
  const one = async (sql: string) => (await client.query(sql, [businessId])).rows;
  const db = emptyDB() as DB;
  db.businesses = (await client.query('SELECT * FROM app.businesses WHERE id = $1', [businessId])).rows.map(() => null as any) as any;
  // businesses: usa o mapper existente (mapping.rowToBusinessCore não basta —
  // aqui vai a linha completa em domínio).
  const bizRows = (await client.query('SELECT * FROM app.businesses WHERE id = $1', [businessId])).rows;
  db.businesses = bizRows.map(rowToBusiness);
  db.services = (await one('SELECT * FROM app.services WHERE business_id = $1')).map(rowToService);
  db.professionals = (await one('SELECT * FROM app.professionals WHERE business_id = $1')).map(rowToProfessional);
  db.availability = (await one('SELECT * FROM app.availability WHERE business_id = $1')).map(rowToAvailability);
  db.exceptions = (await one('SELECT * FROM app.availability_exceptions WHERE business_id = $1')).map(rowToException);
  db.bookings = (await one('SELECT * FROM app.bookings WHERE business_id = $1')).map(rowToBooking);
  db.contacts = (await one('SELECT * FROM app.contacts WHERE business_id = $1')).map(rowToContact);
  db.conversations = (await one('SELECT * FROM app.conversations WHERE business_id = $1')).map(rowToConversation);
  db.messages = (await one('SELECT * FROM app.messages WHERE business_id = $1')).map(rowToMessage);
  db.leads = (await one('SELECT * FROM app.leads WHERE business_id = $1')).map(rowToLead);
  db.pipelines = (await one('SELECT * FROM app.pipelines WHERE business_id = $1')).map(rowToPipeline);
  db.automations = (await one('SELECT * FROM app.automations WHERE business_id = $1')).map(rowToAutomation);
  db.automationRuns = (await one('SELECT * FROM app.automation_runs WHERE business_id = $1')).map(rowToAutomationRun);
  db.events = (await one('SELECT * FROM app.events WHERE business_id = $1')).map(rowToEvent);
  db.tasks = (await one('SELECT * FROM app.tasks WHERE business_id = $1')).map(rowToTask);
  db.audit = (await one('SELECT * FROM app.audit WHERE business_id = $1')).map(rowToAudit);
  db.reviews = (await one('SELECT * FROM app.reviews WHERE business_id = $1')).map(rowToReview);
  // Conta do consumidor é global: só os ids que a fatia referencia.
  const ids = new Set<string>();
  for (const bk of db.bookings) if (bk.customerId) ids.add(bk.customerId);
  for (const c of db.contacts) if (c.customerId) ids.add(c.customerId);
  for (const l of db.leads) if (l.customerId) ids.add(l.customerId);
  db.customers = ids.size
    ? (await client.query('SELECT * FROM app.customers WHERE id = ANY($1)', [[...ids]])).rows.map(rowToCustomer)
    : [];
  return db;
}

/**
 * Carregamento DIRECIONADO: só as coleções da spec, cada uma com seus
 * filtros. `businesses` sempre vem (é o sujeito da fatia); planners são
 * resolvidos DEPOIS das cargas fixas (podem usar linhas já carregadas para
 * montar chaves exatas — ex.: dedupe de mensagens por agendamento).
 */
async function loadTargetedSlice(client: PoolClient, businessId: string, spec: SliceSpec): Promise<DB> {
  const db = emptyDB() as DB;
  db.businesses = (await client.query('SELECT * FROM app.businesses WHERE id = $1', [businessId])).rows.map(rowToBusiness);
  const fixed: Array<[Exclude<SliceColl, 'businesses' | 'customers'>, TableLoad]> = [];
  const planners: Array<[SliceColl | 'customers', SliceLoadFn]> = [];
  for (const [coll, entry] of Object.entries(spec) as Array<[SliceColl, TableLoad | SliceLoadFn]>) {
    if (typeof entry === 'function') planners.push([coll, entry]);
    else if (coll !== 'businesses' && coll !== 'customers' && entry) fixed.push([coll as Exclude<SliceColl, 'businesses' | 'customers'>, entry]);
  }
  const ops = await opsMappers();
  for (const [coll, load] of fixed) {
    const table = SLICE_TABLE[coll];
    // $1 é SEMPRE o businessId (mesmo no global): wheres de coleções globais
    // (usuários, sessões) podem referenciar a unidade em subconsultas. O
    // marcador tipado mantém $1 presente/declarado mesmo quando o where não
    // o usa (senão o Postgres recusa parâmetro fornecido e sem tipo).
    if (load.global && !load.where) throw new Error(`carga global sem filtro: ${coll}`);
    const conds = load.global ? ['($1::text IS NOT NULL)'] : ['business_id = $1'];
    const args: unknown[] = [businessId];
    if (load.where) {
      conds.push(`(${load.where})`);
      for (const a of load.args || []) args.push(a);
    }
    let sql = `SELECT * FROM ${table} WHERE ${conds.join(' AND ')}`;
    if (load.order) sql += ` ORDER BY ${load.order}`;
    if (load.limit) sql += ` LIMIT ${Math.floor(load.limit)}`;
    const mapOf: Record<string, (r: any) => any> = {
      services: rowToService, professionals: rowToProfessional, bookings: rowToBooking, contacts: rowToContact,
      conversations: rowToConversation, messages: rowToMessage, leads: rowToLead,
      pipelines: rowToPipeline, automations: rowToAutomation, automationRuns: rowToAutomationRun,
      events: rowToEvent, tasks: rowToTask, audit: rowToAudit, reviews: rowToReview,
      webhooks: rowToWebhook, webhookDeliveries: rowToWebhookDelivery,
      pages: (r: any) => ({
        id: s(r.id), businessId: s(r.business_id), presetId: s(r.preset_id),
        theme: jn(r.theme, {} as any), blocks: jn(r.blocks, [] as any[]),
        updatedAt: iso(r.updated_at),
      }),
      categories: rowToCategory, products: rowToProduct, options: rowToOption,
      optionValues: rowToOptionValue, members: rowToMember,
      users: rowToUserFull, sessions: rowToSession,
      availability: rowToAvailabilityLight, exceptions: rowToExceptionLight,
      queue: ops.rowToQueueEntry, encounters: ops.rowToEncounter, orders: rowToOrder,
    };
    (db as any)[coll] = (await client.query(sql, args)).rows.map(mapOf[coll]);
  }
  for (const [coll, planner] of planners) {
    const load = resolveLoad(planner as SliceLoadFn, db);
    if (!load) continue;
    if (coll === 'optionValues') {
      const optIds = db.options.map((o: any) => o.id);
      if (!optIds.length) continue;
      db.optionValues = (await client.query(
        'SELECT * FROM app.product_option_values WHERE option_id = ANY($1) AND active = true',
        [optIds],
      )).rows.map(rowToOptionValue);
      continue;
    }
    if (coll === 'customers') {
      const ids = new Set<string>();
      for (const c of db.contacts) if (c.customerId) ids.add(c.customerId);
      for (const l of db.leads) if (l.customerId) ids.add(l.customerId);
      for (const bk of db.bookings) if (bk.customerId) ids.add(bk.customerId);
      if (ids.size === 0) continue;
      db.customers = (await client.query('SELECT * FROM app.customers WHERE id = ANY($1)', [[...ids]])).rows.map(rowToCustomer);
      continue;
    }
    const table = SLICE_TABLE[coll as Exclude<SliceColl, 'businesses' | 'customers'>];
    if (load.global && !load.where) throw new Error(`carga global sem filtro: ${coll}`);
    const conds = load.global ? ['($1::text IS NOT NULL)'] : ['business_id = $1'];
    const args: unknown[] = [businessId];
    if (load.where) {
      conds.push(`(${load.where})`);
      for (const a of load.args || []) args.push(a);
    }
    let sql = `SELECT * FROM ${table} WHERE ${conds.join(' AND ')}`;
    if (load.order) sql += ` ORDER BY ${load.order}`;
    if (load.limit) sql += ` LIMIT ${Math.floor(load.limit)}`;
    const mapOf: Record<string, (r: any) => any> = {
      contacts: rowToContact, conversations: rowToConversation, messages: rowToMessage,
      leads: rowToLead, bookings: rowToBooking, members: rowToMember, users: rowToUserFull,
      sessions: rowToSession,
    };
    const map = mapOf[coll as string];
    if (!map) continue;
    (db as any)[coll] = (await client.query(sql, args)).rows.map(map);
  }
  return db;
}

/** Linha businesses → domínio completo (o que os motores canônicos leem). */

// ── Domínio → linha (upsert do write-back; espelho do import/transform) ──

type Row = Record<string, unknown>;

// (write-back usa ctx para herdar business_id em tabelas sem a coluna)

function customerRow(c: any): Row {
  return {
    id: c.id, name: c.name ?? '', phone: c.phone ?? '', email: (c.email ?? '').trim().toLowerCase(),
    password_hash: c.passwordHash ?? '', google_id: c.googleId ?? '', avatar: c.avatar ?? '',
    must_change_password: c.mustChangePassword === true,
    access_created_at: c.accessCreatedAt ? new Date(c.accessCreatedAt) : null,
    created_at: c.createdAt ? new Date(c.createdAt) : new Date(),
  };
}
function contactRow(c: any): Row {
  return {
    id: c.id, business_id: c.businessId, customer_id: c.customerId || null,
    name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '',
    created_at: c.createdAt ? new Date(c.createdAt) : new Date(),
    updated_at: c.updatedAt ? new Date(c.updatedAt) : new Date(),
    source: c.source || 'interaction', last_interaction: c.lastInteraction ? new Date(c.lastInteraction) : null,
    marketing_opt_in: c.marketingOptIn === true, note: c.note ?? '',
    notes: c.notes === undefined ? null : JSON.stringify(c.notes ?? null),
    profile: c.profile === undefined ? null : JSON.stringify(c.profile ?? null),
    channel_identities: c.channelIdentities === undefined ? null : JSON.stringify(c.channelIdentities ?? null),
  };
}
function conversationRow(c: any): Row {
  return {
    id: c.id, business_id: c.businessId, channel: c.channel,
    channel_user_id: c.channelUserId ?? '', channel_account_id: c.channelAccountId ?? '',
    last_inbound_at: c.lastInboundAt ? new Date(c.lastInboundAt) : null,
    channel_username: c.channelUsername ?? '',
    contact_id: c.contactId ?? '', customer_id: c.customerId || null,
    name: c.name ?? '', phone: c.phone ?? '', status: c.status || 'open',
    mode: c.mode || 'automation', unread: c.unread ?? 0,
    last_message_at: c.lastMessageAt ? new Date(c.lastMessageAt) : null,
    last_message_preview: c.lastMessagePreview ?? '',
    created_at: c.createdAt ? new Date(c.createdAt) : new Date(),
    context: c.context === undefined ? null : JSON.stringify(c.context ?? null),
  };
}
function messageRow(m: any): Row {
  return {
    id: m.id, business_id: m.businessId, conversation_id: m.conversationId,
    direction: m.direction, body: m.body ?? '', status: m.status || 'pending',
    external_id: m.externalId ?? '', by: m.by ?? '', by_name: m.byName ?? '',
    channel: m.channel ?? '', channel_user_id: m.channelUserId ?? '',
    at: m.at ? new Date(m.at) : new Date(), error: m.error ?? '',
    claim_token: m.claimToken || null,
    claim_expires_at: m.claimExpiresAt ? new Date(m.claimExpiresAt) : null,
    attempts: m.attempts ?? 0,
    next_retry_at: m.nextRetryAt ? new Date(m.nextRetryAt) : null,
    meta: m.meta === undefined ? null : JSON.stringify(m.meta ?? null),
  };
}
function eventRow(e: any): Row {
  return {
    id: e.id, business_id: e.businessId, type: e.type, path: e.path ?? '',
    meta: JSON.stringify(e.meta ?? {}), created_at: e.createdAt ? new Date(e.createdAt) : new Date(),
  };
}
function leadRow(l: any): Row {
  return {
    id: l.id, business_id: l.businessId, customer_id: l.customerId || null,
    name: l.name ?? '', phone: l.phone ?? '', email: l.email ?? '', instagram: l.instagram ?? '',
    origin: l.origin ?? '', channel: l.channel ?? '', interest: l.interest ?? '', action: l.action ?? '',
    status: l.status || 'new',
    created_at: l.createdAt ? new Date(l.createdAt) : new Date(),
    last_interaction: l.lastInteraction ? new Date(l.lastInteraction) : null,
    stage_id: l.stageId || 'new', assigned_user_id: l.assignedUserId || null,
    priority: l.priority || null, next_action: l.nextAction ?? '',
    service_id: l.serviceId ?? '', professional_id: l.professionalId ?? '',
    source_url: l.sourceUrl ?? '', metadata: l.metadata === undefined ? null : JSON.stringify(l.metadata ?? null),
    booking_id: l.bookingId || null,
    notes: l.notes === undefined ? null : JSON.stringify(l.notes ?? null),
    stage_history: l.stageHistory === undefined ? null : JSON.stringify(l.stageHistory ?? null),
  };
}
function pipelineRow(p: any): Row {
  return {
    id: p.id, business_id: p.businessId, stages: JSON.stringify(p.stages ?? []),
    updated_at: p.updatedAt ? new Date(p.updatedAt) : new Date(),
  };
}
function automationRow(a: any): Row {
  return {
    id: a.id, business_id: a.businessId, name: a.name ?? '', description: a.description ?? '',
    active: a.active !== false, trigger: JSON.stringify(a.trigger ?? null),
    nodes: JSON.stringify(a.nodes ?? []), edges: JSON.stringify(a.edges ?? []),
    settings: JSON.stringify(a.settings ?? {}), template_id: a.templateId ?? '',
    version: a.version ?? 1, created_by_user_id: a.createdByUserId ?? '',
    created_at: a.createdAt ? new Date(a.createdAt) : new Date(),
    updated_at: a.updatedAt ? new Date(a.updatedAt) : new Date(),
  };
}
function automationRunRow(r: any): Row {
  return {
    id: r.id, business_id: r.businessId, automation_id: r.automationId ?? '',
    automation_name: r.automationName ?? '', status: r.status || 'queued',
    trigger_event: r.triggerEvent ?? '', current_node_id: r.currentNodeId ?? '',
    context: JSON.stringify(r.context ?? {}),
    waiting_until: r.waitingUntil ? new Date(r.waitingUntil) : null,
    started_at: r.startedAt ? new Date(r.startedAt) : new Date(),
    updated_at: r.updatedAt ? new Date(r.updatedAt) : new Date(),
    finished_at: r.finishedAt ? new Date(r.finishedAt) : null,
    error: r.error ?? '', history: JSON.stringify(r.history ?? []),
    event_key: r.eventKey ?? '', emitted_by_run_id: r.emittedByRunId ?? '',
    steps: r.steps ?? 0, resumes: r.resumes ?? 0,
    last_action_type: r.lastActionType ?? '', last_error: r.lastError ?? '',
    claim_token: r.claimToken || null,
    claim_expires_at: r.claimExpiresAt ? new Date(r.claimExpiresAt) : null,
  };
}
function taskRow(t: any): Row {
  return {
    id: t.id, business_id: t.businessId, title: t.title ?? '', note: t.note ?? '',
    status: t.status || 'open', due_at: t.dueAt ? new Date(t.dueAt) : null,
    created_at: t.createdAt ? new Date(t.createdAt) : new Date(),
    updated_at: new Date(t.updatedAt || t.createdAt || Date.now()),
    done_at: t.doneAt ? new Date(t.doneAt) : null,
    assigned_user_id: t.assignedUserId ?? '', created_by: t.createdBy ?? '',
    automation_id: t.automationId ?? '', automation_run_id: t.automationRunId ?? '',
    automation_node_id: t.automationNodeId ?? '', lead_id: t.leadId ?? '',
    booking_id: t.bookingId ?? '', customer_id: t.customerId ?? '', encounter_id: t.encounterId ?? '',
    source: t.source || 'automation',
  };
}
function auditRow(a: any): Row {
  return {
    id: a.id, at: a.at ? new Date(a.at) : new Date(), action: a.action,
    actor_user_id: a.actorUserId ?? '', actor_email: a.actorEmail ?? '', actor_role: a.actorRole ?? '',
    business_id: a.businessId ?? '', support_session_id: a.supportSessionId ?? '',
    meta: JSON.stringify(a.meta ?? {}),
  };
}
function reviewRow(r: any): Row {
  return {
    id: r.id, business_id: r.businessId, customer_id: r.customerId || null,
    customer_name: r.customerName ?? '', rating: r.rating ?? 5, text: r.text ?? '',
    source: r.source || 'site', status: r.status || 'pending',
    order_id: r.orderId ?? '', booking_id: r.bookingId ?? '', external_id: r.externalId ?? '',
    created_at: r.createdAt ? new Date(r.createdAt) : new Date(),
  };
}

/** Coleção → { tabela, domínio→linha } (somente o que os fluxos da agenda/CRM/automação mexem). */
const WRITEBACK: Record<string, { table: string; row: (x: any, ctx: { durationOf: Map<string, number>; optionBiz: Map<string, string> }) => Row; idOf: (x: any) => string }> = {
  bookings: { table: 'app.bookings', row: (x, ctx) => bookingToRow(x, ctx.durationOf.get(x.serviceId) ?? 30), idOf: (x) => x.id },
  contacts: { table: 'app.contacts', row: contactRow, idOf: (x) => x.id },
  customers: { table: 'app.customers', row: customerRow, idOf: (x) => x.id },
  conversations: { table: 'app.conversations', row: conversationRow, idOf: (x) => x.id },
  messages: { table: 'app.messages', row: messageRow, idOf: (x) => x.id },
  events: { table: 'app.events', row: eventRow, idOf: (x) => x.id },
  leads: { table: 'app.leads', row: (x) => leadRow(x), idOf: (x) => x.id },
  pipelines: { table: 'app.pipelines', row: pipelineRow, idOf: (x) => x.id },
  automations: { table: 'app.automations', row: automationRow, idOf: (x) => x.id },
  automationRuns: { table: 'app.automation_runs', row: automationRunRow, idOf: (x) => x.id },
  tasks: { table: 'app.tasks', row: taskRow, idOf: (x) => x.id },
  audit: { table: 'app.audit', row: auditRow, idOf: (x) => x.id },
  reviews: { table: 'app.reviews', row: reviewRow, idOf: (x) => x.id },
  webhooks: { table: 'app.webhooks', row: webhookConfigRow, idOf: (x) => x.id },
  webhookDeliveries: { table: 'app.webhook_deliveries', row: webhookDeliveryRow, idOf: (x) => x.id },
  businesses: { table: 'app.businesses', row: businessProfileRow, idOf: (x) => x.id },
  pages: { table: 'app.pages', row: pageRow, idOf: (x) => x.id },
  categories: { table: 'app.categories', row: (c: any): Row => ({
    id: c.id, business_id: c.businessId, kind: c.kind, name: c.name ?? '',
    order: c.order ?? 0, active: c.active !== false,
  }), idOf: (x) => x.id },
  products: { table: 'app.products', row: (pr: any): Row => ({
    id: pr.id, business_id: pr.businessId, category_id: pr.categoryId || null,
    name: pr.name ?? '', description: pr.description ?? '', image: pr.image ?? '',
    price: pr.price ?? 0, promo_price: pr.promoPrice ?? 0,
    active: pr.active !== false, featured: pr.featured === true, order: pr.order ?? 0,
  }), idOf: (x) => x.id },
  options: { table: 'app.product_options', row: (o: any): Row => ({
    id: o.id, business_id: o.businessId, product_id: o.productId, name: o.name ?? '',
    required: o.required === true, multiple: o.multiple === true,
    min: o.min ?? 0, max: o.max ?? 0, order: o.order ?? 0,
  }), idOf: (x) => x.id },
  optionValues: { table: 'app.product_option_values', row: (v: any, ctx): Row => ({
    id: v.id, business_id: ctx.optionBiz.get(v.optionId) || '', option_id: v.optionId,
    name: v.name ?? '', price_delta: v.priceDelta ?? 0, active: v.active !== false,
  }), idOf: (x) => x.id },
  // Catálogo da agenda: SEM estes dois, professional.save/service.save
  // respondiam 200 mas NUNCA persistiam (achado da validação do preview —
  // o diff do write-back ignorava as coleções inteiras).
  services: { table: 'app.services', row: (s: any): Row => ({
    id: s.id, business_id: s.businessId, category_id: s.categoryId || null,
    name: s.name ?? '', description: s.description ?? '', image: s.image ?? '',
    price: s.price ?? 0, show_price: s.showPrice !== false,
    duration_min: s.durationMin ?? 30,
    professional_ids: JSON.stringify(s.professionalIds || []),
    active: s.active !== false, featured: s.featured === true,
    bookable: s.bookable !== false, questions: JSON.stringify(s.questions || []),
  }), idOf: (x) => x.id },
  professionals: { table: 'app.professionals', row: (p: any): Row => ({
    id: p.id, business_id: p.businessId, name: p.name ?? '', role: p.role ?? '',
    photo: p.photo ?? '', active: p.active !== false, user_id: p.userId || null,
    follow_business_hours: p.followBusinessHours !== false,
  }), idOf: (x) => x.id },
  availability: { table: 'app.availability', row: (a: any): Row => ({
    id: a.id, business_id: a.businessId, professional_id: a.professionalId || null,
    service_id: a.serviceId || null, weekday: a.weekday,
    start: a.start || '00:00', end: a.end || '23:59', slot_min: a.slotMin ?? 30,
  }), idOf: (x) => x.id },
  exceptions: { table: 'app.availability_exceptions', row: (e: any): Row => ({
    id: e.id, business_id: e.businessId, date: e.date, closed: e.closed === true,
    start: e.start ?? '', end: e.end ?? '', note: e.note ?? '',
  }), idOf: (x) => x.id },
  users: { table: 'app.users', row: (u: any): Row => ({
    id: u.id, name: u.name ?? '', email: String(u.email ?? '').trim().toLowerCase(),
    password_hash: u.passwordHash ?? '', role: u.role || 'owner',
    active: u.active !== false,
    last_login_at: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
    created_at: u.createdAt ? new Date(u.createdAt) : new Date(),
  }), idOf: (x) => x.id },
  members: { table: 'app.members', row: (m: any): Row => ({
    id: m.id, business_id: m.businessId, user_id: m.userId, role: m.role,
    permissions: JSON.stringify(m.permissions ?? {}), active: m.active !== false,
    note: m.note ?? '', invited_by: m.invitedBy ?? '',
    created_at: m.createdAt ? new Date(m.createdAt) : new Date(),
    updated_at: m.updatedAt ? new Date(m.updatedAt) : new Date(),
  }), idOf: (x) => x.id },
  sessions: { table: 'app.sessions', row: (sess: any): Row => ({
    id: sess.id, user_id: sess.userId,
    created_at: sess.createdAt ? new Date(sess.createdAt) : new Date(),
    expires_at: sess.expiresAt ? new Date(sess.expiresAt) : new Date(),
  }), idOf: (x) => x.id },
  orders: { table: 'app.orders', row: (o: any): Row => ({
    id: o.id, business_id: o.businessId, customer_id: o.customerId || null,
    code: o.code ?? '', customer_name: o.customerName ?? '', customer_phone: o.customerPhone ?? '',
    customer_address: o.customerAddress ?? '', type: o.type === 'pickup' ? 'pickup' : 'delivery',
    payment: o.payment ?? '', items: JSON.stringify(o.items ?? []),
    subtotal: o.subtotal ?? 0, total: o.total ?? 0, status: o.status || 'new',
    note: o.note ?? '', created_at: o.createdAt ? new Date(o.createdAt) : new Date(),
    updated_at: o.updatedAt ? new Date(o.updatedAt) : new Date(),
    history: JSON.stringify(o.history ?? []),
  }), idOf: (x) => x.id },
};

// Perfil da unidade e página — espelho do import/transform.ts (o diff grava
// de volta APENAS quando a operação mexeu; config/página usam fatia mínima).
function businessProfileRow(biz: any): Row {
  return {
    id: biz.id, organization_id: biz.organizationId || null, owner_id: biz.ownerId,
    name: biz.name ?? '', slug: biz.slug ?? '', description: biz.description ?? '',
    logo: biz.logo ?? '', cover: biz.cover ?? '', niche: biz.niche || 'outro',
    modes: JSON.stringify(biz.modes ?? []), features: JSON.stringify(biz.features ?? null),
    products_off: typeof biz.productsOff === 'boolean' ? biz.productsOff : null,
    whatsapp_integration: JSON.stringify(biz.whatsappIntegration ?? null),
    instagram_integration: JSON.stringify(biz.instagramIntegration ?? null),
    phone: biz.phone ?? '', whatsapp: biz.whatsapp ?? '', email: biz.email ?? '',
    instagram: biz.instagram ?? '', tiktok: biz.tiktok ?? '',
    socials: JSON.stringify(biz.socials ?? {}), address: biz.address ?? '', maps_url: biz.mapsUrl ?? '',
    hours: JSON.stringify(biz.hours ?? {}), business_timezone: biz.businessTimezone || null,
    payment_methods: JSON.stringify(biz.paymentMethods ?? []), pix_key: biz.pixKey ?? '',
    delivery_fee: biz.deliveryFee ?? 0, min_order: biz.minOrder ?? 0,
    google_url: biz.googleUrl ?? '', google_place_id: biz.googlePlaceId ?? '', google_api_key: biz.googleApiKey ?? '',
    booking: JSON.stringify(biz.booking ?? null), nav: JSON.stringify(biz.nav ?? []),
    nav_custom: biz.navCustom === true,
    nav_items: JSON.stringify(biz.navItems ?? null), automations: JSON.stringify(biz.automations ?? null),
    capability_flags: JSON.stringify(biz.capabilityFlags ?? null), about: JSON.stringify(biz.about ?? null),
    appearance: JSON.stringify(biz.appearance ?? null), published: biz.published === true,
    subscription: JSON.stringify(biz.subscription ?? null),
    created_at: biz.createdAt ? new Date(biz.createdAt) : new Date(),
    updated_at: biz.updatedAt ? new Date(biz.updatedAt) : new Date(),
  };
}
function pageRow(pg: any): Row {
  return {
    id: pg.id, business_id: pg.businessId, preset_id: pg.presetId ?? '',
    theme: JSON.stringify(pg.theme ?? {}), blocks: JSON.stringify(pg.blocks ?? []),
    updated_at: pg.updatedAt ? new Date(pg.updatedAt) : new Date(),
  };
}

function webhookConfigRow(w: any): Row {
  return {
    id: w.id, business_id: w.businessId, url: w.url ?? '', secret: w.secret ?? '',
    events: JSON.stringify(w.events ?? []), active: w.active !== false,
    created_at: w.createdAt ? new Date(w.createdAt) : new Date(),
    updated_at: w.updatedAt ? new Date(w.updatedAt) : new Date(),
  };
}
function webhookDeliveryRow(d: any): Row {
  return {
    id: d.id, webhook_id: d.webhookId ?? '', business_id: d.businessId, event: d.event,
    event_id: d.eventId ?? '', url: d.url ?? '', payload_summary: JSON.stringify(d.payloadSummary ?? {}),
    status: d.status || 'pending', status_code: d.statusCode == null ? null : d.statusCode,
    error: d.error ?? '', attempts: d.attempts ?? 1, max_attempts: d.maxAttempts ?? 3,
    next_retry_at: d.nextRetryAt ? new Date(d.nextRetryAt) : null,
    delivered_at: d.deliveredAt ? new Date(d.deliveredAt) : null,
    attempts_history: JSON.stringify(d.attemptsHistory ?? []),
    created_at: d.createdAt ? new Date(d.createdAt) : new Date(),
    updated_at: d.updatedAt ? new Date(d.updatedAt) : (d.createdAt ? new Date(d.createdAt) : new Date()),
    claim_token: d.claimToken ?? null,
    claim_expires_at: d.claimExpiresAt ? new Date(d.claimExpiresAt) : null,
  };
}

async function upsertRow(client: PoolClient, table: string, row: Row): Promise<void> {
  // Identificadores ENTRE ASPAS: colunas como start/"end" (horários) são
  // palavras reservadas do Postgres — sem aspas, INSERT estoura
  // "syntax error at or near end". Os nomes vêm sempre das nossas Row specs
  // (nunca de input do usuário), então as aspas são seguras.
  const cols = Object.keys(row).map((c) => `"${c}"`);
  const values = Object.values(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const rawCols = Object.keys(row);
  const updates = rawCols.slice(1).map((c, i) => `"${c}" = $${i + 2}`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values,
  );
}

/**
 * Diff antes/depois da fatia: grava SOMENTE o que mudou (upsert por id) e
 * remove o que desapareceu (podas de fila). Tudo na MESMA transação.
 */
export async function writeBackSlice(
  client: PoolClient,
  before: DB,
  after: DB,
): Promise<{ upserts: number; deletes: number }> {
  const durationOf = new Map(after.services.map((sv: any) => [sv.id, sv.durationMin ?? 30]));
  const optionBiz = new Map<string, string>((after.options || []).map((o: any) => [o.id, o.businessId]));
  const ctx = { durationOf, optionBiz };
  let upserts = 0;
  let deletes = 0;
  for (const [coll, def] of Object.entries(WRITEBACK)) {
    const beforeRows = (before as any)[coll] || [];
    const afterRows = (after as any)[coll] || [];
    const beforeById = new Map(beforeRows.map((x: any) => [def.idOf(x), x]));
    const afterById = new Map(afterRows.map((x: any) => [def.idOf(x), x]));
    // Novos ou mudados (comparação profunda ordem-insensível de jsonb).
    for (const [id, obj] of afterById) {
      const prev = beforeById.get(id);
      if (prev && JSON.stringify(stable(prev)) === JSON.stringify(stable(obj))) continue;
      await upsertRow(client, def.table, def.row(obj, ctx));
      upserts += 1;
    }
    // Removidos (podas explícitas das filas).
    for (const id of beforeById.keys()) {
      if (!afterById.has(id)) {
        await client.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
        deletes += 1;
      }
    }
  }
  return { upserts, deletes };
}

/** Normaliza para comparação estável (chaves ordenadas, sem campos voláteis de Date). */
function stable(v: any): any {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = stable((v as any)[k]);
    return out;
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════
// SPECS POR OPERAÇÃO — o que cada escrita carrega (e nada mais).
// ═══════════════════════════════════════════════════════════════
// Regra de ouro: coleção que a operação só ACRESCENTA (audit, events, tasks,
// entregas de webhook) NÃO é carregada — o diff grava o que `fn` criar.
// Dedupes de identidade (contato/lead/conversa/mensagem) carregam as linhas
// CANDIDATAS exatas (por telefone/e-mail/id/chave de automação) — nunca o
// histórico da unidade.

/** Regex-safe: ids usados em padrões de dedupe são UUIDs/compostos sem metacaracteres. */
const idPattern = (id: string) => `(^|[^a-z0-9])${id}([^a-z0-9]|$)`;

/**
 * Spec de operações da AGENDA (criar, série, preview, remarcar, status,
 * check-in, cancelar série). `bookingIds` = alvos diretos; `dateFrom/dateTo`
 * = janela de conflito/lembretes; série completa via `seriesOfBookingId`.
 * NUMERAÇÃO: cada tabela monta seus placeholders a partir de $2 (o $1 é
 * sempre o business_id da consulta base).
 */
export function bookingOpSpec(o: {
  bookingIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  seriesOfBookingId?: string;
  phones?: string[];
  emails?: string[];
  contactId?: string;
  leadId?: string;
  customerId?: string;
}): SliceSpec {
  const bids = (o.bookingIds || []).filter(Boolean);
  const phones = [...new Set((o.phones || []).filter(Boolean))];
  const emails = [...new Set((o.emails || []).filter((e) => !!e))];
  const bid0 = bids[0] || '';

  // bookings: janela de conflito + alvos + série inteira (se for o caso).
  const bConds: string[] = [];
  const bArgs: unknown[] = [];
  let p = 2;
  if (o.dateFrom && o.dateTo) {
    bConds.push(`(date >= $${p} AND date <= $${p + 1})`);
    bArgs.push(o.dateFrom, o.dateTo);
    p += 2;
  }
  if (bids.length) {
    bConds.push(`(id = ANY($${p}))`);
    bArgs.push(bids);
    p += 1;
  }
  if (o.seriesOfBookingId) {
    bConds.push(`(series_request_id = (SELECT series_request_id FROM app.bookings WHERE id = $${p} AND business_id = $1))`);
    bArgs.push(o.seriesOfBookingId);
    p += 1;
  }

  // contacts: identidades candidatas (telefone/e-mail/contato/conta + alvo).
  const cConds: string[] = [];
  const cArgs: unknown[] = [];
  p = 2;
  if (phones.length) {
    cConds.push(`(phone = ANY($${p}))`);
    cArgs.push(phones);
    p += 1;
  }
  if (emails.length) {
    cConds.push(`(email = ANY($${p}))`);
    cArgs.push(emails);
    p += 1;
  }
  if (o.contactId) {
    cConds.push(`(id = $${p})`);
    cArgs.push(o.contactId);
    p += 1;
  }
  if (o.customerId) {
    cConds.push(`(customer_id = $${p})`);
    cArgs.push(o.customerId);
    p += 1;
  }
  if (bid0) {
    cConds.push(`(phone = (SELECT customer_phone FROM app.bookings WHERE id = $${p} AND business_id = $1 AND customer_phone <> ''))`);
    cArgs.push(bid0);
    p += 1;
    cConds.push(`(customer_id = (SELECT customer_id FROM app.bookings WHERE id = $${p} AND business_id = $1 AND customer_id IS NOT NULL))`);
    cArgs.push(bid0);
    p += 1;
  }

  // leads: dedupe do ingestLead + vínculo do agendamento (remarcação).
  const lConds: string[] = [];
  const lArgs: unknown[] = [];
  p = 2;
  if (phones.length) {
    lConds.push(`(phone = ANY($${p}))`);
    lArgs.push(phones);
    p += 1;
  }
  if (emails.length) {
    lConds.push(`(email = ANY($${p}))`);
    lArgs.push(emails);
    p += 1;
  }
  if (o.leadId) {
    lConds.push(`(id = $${p})`);
    lArgs.push(o.leadId);
    p += 1;
  }
  if (o.customerId) {
    lConds.push(`(customer_id = $${p})`);
    lArgs.push(o.customerId);
    p += 1;
  }
  if (bid0) {
    lConds.push(`(id = (SELECT lead_id FROM app.bookings WHERE id = $${p} AND business_id = $1 AND lead_id IS NOT NULL))`);
    lArgs.push(bid0);
    p += 1;
  }
  if (bids.length > 1) {
    lConds.push(`(booking_id = ANY($${p}))`);
    lArgs.push(bids);
    p += 1;
  }

  const spec: SliceSpec = {
    services: {}, professionals: {}, availability: {}, exceptions: {},
    bookings: bConds.length ? { where: bConds.join(' OR '), args: bArgs } : {},
    pipelines: {},
  };
  if (cConds.length) spec.contacts = { where: cConds.join(' OR '), args: cArgs };
  if (lConds.length) spec.leads = { where: lConds.join(' OR '), args: lArgs };
  // Conversas por telefone (criação/enqueue de mensagem de automação).
  spec.conversations = (partial) => {
    const all = new Set<string>(phones);
    for (const c of partial.contacts) if (c.phone) all.add(c.phone);
    for (const bk of partial.bookings) if (bk.customerPhone) all.add(bk.customerPhone);
    if (all.size === 0) return null;
    return { where: `channel = 'whatsapp' AND phone = ANY($2)`, args: [[...all]] };
  };
  // Mensagens: chaves de automação dos agendamentos envolvidos (dedupe exato).
  spec.messages = (partial) => {
    const ids = new Set<string>(bids);
    for (const bk of partial.bookings) ids.add(bk.id);
    if (ids.size === 0) return null;
    return { where: `external_id <> '' AND external_id ~ ANY($2)`, args: [[...ids].map(idPattern)] };
  };
  spec.customers = () => ({});
  return spec;
}

/**
 * Spec da ESTEIRA (ingestLead / moveLeadStage / assign / nota / campos).
 * Webhooks (config) entram: o outbox é escolhido pela config da unidade.
 */
export function leadWriteSpec(o: {
  leadId?: string;
  phones?: string[];
  emails?: string[];
  customerId?: string;
  name?: string;
  assignedUserId?: string;
}): SliceSpec {
  const phones = [...new Set((o.phones || []).filter(Boolean))];
  const emails = [...new Set((o.emails || []).filter(Boolean))];
  const lConds: string[] = [];
  const lArgs: unknown[] = [];
  let p = 2;
  if (o.leadId) {
    lConds.push(`(id = $${p})`);
    lArgs.push(o.leadId);
    p += 1;
  }
  if (phones.length) {
    lConds.push(`(phone = ANY($${p}))`);
    lArgs.push(phones);
    p += 1;
  }
  if (emails.length) {
    lConds.push(`(email = ANY($${p}))`);
    lArgs.push(emails);
    p += 1;
  }
  if (o.customerId) {
    lConds.push(`(customer_id = $${p})`);
    lArgs.push(o.customerId);
    p += 1;
  }
  const spec: SliceSpec = {
    businesses: {},
    pipelines: {},
    webhooks: {},
    leads: lConds.length ? { where: lConds.join(' OR '), args: lArgs } : { limit: 0 },
  };
  const cConds: string[] = [];
  const cArgs: unknown[] = [];
  p = 2;
  if (phones.length) {
    cConds.push(`(phone = ANY($${p}))`);
    cArgs.push(phones);
    p += 1;
  }
  if (emails.length) {
    cConds.push(`(email = ANY($${p}))`);
    cArgs.push(emails);
    p += 1;
  }
  if (o.customerId) {
    cConds.push(`(customer_id = $${p})`);
    cArgs.push(o.customerId);
    p += 1;
  }
  // Fusão "só-nome" do findContact: só quando AMBOS os lados não têm telefone/conta/e-mail.
  if (o.name && o.name.trim()) {
    cConds.push(`(name = $${p} AND COALESCE(phone, '') = '' AND COALESCE(email, '') = '' AND (customer_id IS NULL OR customer_id = ''))`);
    cArgs.push(o.name.trim());
    p += 1;
  }
  if (cConds.length) spec.contacts = { where: cConds.join(' OR '), args: cArgs };
  if (o.assignedUserId) spec.users = { where: `id = $2`, args: [o.assignedUserId] };
  spec.customers = () => ({});
  return spec;
}

/**
 * Spec de UM PASSO de execução de automação (dreno P4): o run reclamado, sua
 * automação, o assunto do contexto (lead/contato/agendamento) e o que as
 * ações tocam — nada do histórico da unidade.
 */
export function runStepSpec(runId: string, contextJson: unknown): SliceSpec {
  const ctx = (contextJson && typeof contextJson === 'object' ? contextJson : {}) as Record<string, any>;
  const leadId = String(ctx?.lead?.id || '');
  const bookingId = String(ctx?.booking?.id || '');
  const customerId = String(ctx?.customer?.id || '');
  const spec: SliceSpec = {
    businesses: {},
    automations: {},
    pipelines: {},
    services: {},
    professionals: {},
    automationRuns: { where: `id = $2`, args: [runId] },
    tasks: { where: `automation_run_id = $2`, args: [runId] },
    webhooks: {},
  };
  const lConds: string[] = [];
  const lArgs: unknown[] = [];
  let p = 2;
  if (leadId) {
    lConds.push(`(id = $${p})`);
    lArgs.push(leadId);
    p += 1;
  }
  if (bookingId) {
    lConds.push(`(booking_id = $${p})`);
    lArgs.push(bookingId);
    p += 1;
  }
  if (lConds.length) spec.leads = { where: lConds.join(' OR '), args: lArgs };
  if (bookingId) spec.bookings = { where: `id = $2`, args: [bookingId] };
  if (customerId) spec.contacts = { where: `id = $2`, args: [customerId] };
  // Conversa/mensagens do assunto (telefone do lead/agendamento/carregado).
  spec.conversations = (partial) => {
    const phones = new Set<string>();
    for (const l of partial.leads) if (l.phone) phones.add(l.phone);
    for (const bk of partial.bookings) if (bk.customerPhone) phones.add(bk.customerPhone);
    for (const c of partial.contacts) if (c.phone) phones.add(c.phone);
    const conds: string[] = [];
    const args: unknown[] = [];
    let q = 2;
    if (phones.size) {
      conds.push(`phone = ANY($${q})`);
      args.push([...phones]);
      q += 1;
    }
    if (customerId) {
      conds.push(`contact_id = $${q}`);
      args.push(customerId);
      q += 1;
    }
    if (!conds.length) return null;
    return { where: `channel = 'whatsapp' AND (${conds.join(' OR ')})`, args };
  };
  spec.messages = (partial) => {
    const convIds = partial.conversations.map((c: any) => c.id);
    if (!convIds.length) return null;
    return { where: `conversation_id = ANY($2)`, args: [convIds], order: `created_at DESC`, limit: 50 };
  };
  spec.customers = () => ({});
  return spec;
}

/**
 * Executa `fn` (MUTAÇÃO SÍNCRONA — mesma disciplina do updateDB) sobre a
 * fatia da unidade, dentro de UMA transação com advisory lock da unidade.
 * Devolve o retorno de `fn`. Nenhum outro banco é tocado.
 */
/**
 * Leitura DIRECIONADA (sem transação, sem writeback): mesma fatia da
 * escrita, só para consultar. Uso: montar views de tela (equipe, catálogo)
 * sem reconstruir o documento da unidade.
 */
export async function runRelationalRead(businessId: string, spec: SliceSpec): Promise<DB> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await loadBusinessSlice(client, businessId, spec);
  } finally {
    client.release();
  }
}

export async function runRelationalWrite<T>(
  businessId: string,
  fn: (slice: DB) => T,
  opts: { nowISO?: string; load?: SliceSpec } = {},
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialização por unidade: a mesma chave do createBookingSql.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`godoutor:unit:${businessId}`]);
    const biz = await client.query('SELECT id FROM app.businesses WHERE id = $1 FOR UPDATE', [businessId]);
    if (biz.rows.length === 0) {
      const e: any = new Error('Negócio não encontrado.');
      e.status = 404;
      throw e;
    }
    const before = await loadBusinessSlice(client, businessId, opts.load);
    const after = structuredClone(before);
    const result = fn(after);
    const wb = await writeBackSlice(client, before, after);
    await client.query('COMMIT');
    if (wb.upserts + wb.deletes > 0) {
      emitLog(`writeback ${businessId}: ${wb.upserts} upserts, ${wb.deletes} deletes`);
    }
    // Mesmo desenho do updateDB: a fila P4 é drenada DEPOIS do commit
    // (melhor-esforço; o cron retoma o que ficar pendente).
    void drainRelationalAutomations({ businessId, limit: 2 }).catch(() => {});
    return result;
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* conexão já quebrou */ }
    // 23P01 = constraint de sobreposição recusou no banco (defesa final).
    if (e?.code === '23P01') {
      const err: any = new Error('Este horário acabou de ser ocupado por outra pessoa. Escolha outro horário.');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Doc mínimo da ESTEIRA (GET /api/leads): SOMENTE o que a resposta consome —
 * leads da unidade (janela paginável), pipeline, membros e nomes de usuários.
 * Nada de agendamentos/mensagens/auditoria: leitura de esteira não reconstrói
 * o documento da unidade.
 */
export async function relationalLeadsDoc(businessId: string): Promise<DB> {
  const { getPool } = await import('./pool');
  const pool = getPool();
  const client = await pool.connect();
  try {
    const db = emptyDB() as DB;
    db.businesses = (await client.query('SELECT * FROM app.businesses WHERE id = $1', [businessId])).rows.map(rowToBusiness);
    db.leads = (await client.query(
      'SELECT * FROM app.leads WHERE business_id = $1 ORDER BY created_at ASC LIMIT 500',
      [businessId],
    )).rows.map(rowToLead);
    db.pipelines = (await client.query('SELECT * FROM app.pipelines WHERE business_id = $1', [businessId])).rows.map(rowToPipeline);
    const members = await client.query(
      'SELECT * FROM app.members WHERE business_id = $1 AND active = true',
      [businessId],
    );
    (db as any).members = members.rows.map((m: any) => ({
      id: s(m.id), businessId: s(m.business_id), userId: s(m.user_id), role: s(m.role),
      permissions: typeof m.permissions === 'object' ? m.permissions : JSON.parse(m.permissions || '{}'),
      active: m.active !== false, note: s(m.note), invitedBy: s(m.invited_by),
      createdAt: iso(m.created_at), updatedAt: iso(m.updated_at),
    }));
    const userIds = (db as any).members.map((m: any) => m.userId);
    if (userIds.length) {
      const users = await client.query('SELECT * FROM app.users WHERE id = ANY($1)', [userIds]);
      (db as any).users = users.rows.map((u: any) => ({
        id: s(u.id), name: s(u.name), email: s(u.email), role: s(u.role) || 'owner',
        passwordHash: '', createdAt: iso(u.created_at),
      }));
    }
    return db;
  } finally {
    client.release();
  }
}

/** Leitura simples da fatia (GETs que precisam do doc da unidade no modo relacional). */
export async function readBusinessSlice(businessId: string): Promise<DB | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const biz = await client.query('SELECT id FROM app.businesses WHERE id = $1', [businessId]);
    if (biz.rows.length === 0) return null;
    return await loadBusinessSlice(client, businessId);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════
// DRENAGEM P4 no modo relacional — MESMO motor, outra persistência.
// ═══════════════════════════════════════════════════════════════
// Executado após o commit (como o gancho inline do updateDB) e pelo
// /api/cron/automations. O claim é CAS no SQL (UPDATE ... WHERE status='queued'
// RETURNING) — seguro com múltiplas instâncias. Entregas HTTP de webhook/
// WhatsApp ficam para o ciclo legado/documento: neste modo elas ficam
// 'pending' e são portadas em rodada própria (documentado na PR).

export async function drainRelationalAutomations(
  options: { businessId?: string; limit?: number; nowISO?: string; holder?: string } = {},
): Promise<{ claimed: number; completed: number; waiting: number; failed: number }> {
  const pool = getPool();
  const nowISO = options.nowISO || new Date().toISOString();
  const holder = options.holder || `rel_${Math.random().toString(36).slice(2, 12)}`;
  const limit = options.limit ?? 20;
  const summary = { claimed: 0, completed: 0, waiting: 0, failed: 0 };

  // 1. CLAIM (CAS): só execuções vencidas; sem posses vivas de terceiros.
  const claimSql = `
    UPDATE app.automation_runs SET status = 'running', claim_token = $1,
           claim_expires_at = now() + interval '60 seconds', updated_at = now()
     WHERE id IN (
       SELECT id FROM app.automation_runs
        WHERE business_id = $2
          AND status = 'queued'
          AND (claim_token IS NULL OR claim_token = '' OR claim_expires_at IS NULL OR claim_expires_at < now())
        ORDER BY started_at
        LIMIT $3 )
     RETURNING *`;
  const client = await pool.connect();
  let claimedRows: any[] = [];
  try {
    await client.query('BEGIN');
    const r = await client.query(claimSql, [holder, options.businessId || '', limit]);
    claimedRows = r.rows;
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  summary.claimed = claimedRows.length;
  if (claimedRows.length === 0) return summary;

  // 2. Executa cada run na fatia da própria unidade (motores canônicos).
  for (const row of claimedRows) {
    const runId = s(row.id);
    const businessId = s(row.business_id);
    try {
      // Executor canônico, passo a passo (mesmo motor do documento) — import
      // preguiçoso ANTES da transação (fn é síncrona).
      const { limitsFor } = await capabilities();
      const { stepAutomationRun, releaseAutomationRunClaim: release } = await executor();
      await runRelationalWrite(businessId, (db) => {
        const run = db.automationRuns.find((x) => x.id === runId);
        if (!run || run.claimToken !== holder) return;
        const limits = limitsFor(db.businesses.find((x) => x.id === businessId) || null);
        for (let i = 0; i < 8; i++) {
          const outcome = stepAutomationRun(db, { runId, holder, nowISO, limits });
          if (outcome.status !== 'advanced') break;
        }
        const still = db.automationRuns.find((x) => x.id === runId);
        if (still && still.status === 'running' && still.claimToken === holder) {
          release(still, true); // volta para a fila
        }
      }, { load: runStepSpec(runId, row.context) });
      // Contadores lidos no próximo ciclo (o summary fiel vive no doc-engine).
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
