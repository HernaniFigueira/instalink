// ═══════════════════════════════════════════════════════════════
// IMPORTADOR — documento monolítico → linhas relacionais (Supabase).
// ═══════════════════════════════════════════════════════════════
// FUNÇÃO PURA: um DB do domínio vira o plano de inserção por tabela, na ordem
// das chaves estrangeiras. O MESMO código atende ao CLI (Neon → Supabase) e
// aos testes (documento sintético → Postgres de teste). Repetível: modo
// upsert reconcilia (ON CONFLICT (id) DO UPDATE) sem duplicar nem apagar.
//
// Regras do handoff (§6): preservar IDs, hashes de senha e relacionamentos;
// validar contagens/vínculos; nunca preencher produção com seed; nunca tratar
// falha de leitura como banco vazio.
import type { DB } from '../../types';
import { bookingToRow } from '../mapping';

const nowIso = () => new Date().toISOString();

/** timestamptz: ISO válido → string; '' /inválido → null. */
function ts(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** timestamptz obrigatório com fallback (nunca grava lixo). */
function tsReq(v: unknown, fallback = nowIso()): string {
  return ts(v) ?? fallback;
}
/** Referência opcional do domínio: '' → NULL (FK honesta). */
const ref = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};
const txt = (v: unknown): string => String(v ?? '');
const num = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v ?? null));
const jsonReq = (v: unknown, d: unknown): string => JSON.stringify(v ?? d);
const date = (v: unknown): string => {
  const s = txt(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : txt(v);
};

export interface TablePlan {
  table: string;           // sem schema (sempre app.)
  rows: Record<string, unknown>[];
  /** Segunda fase para quebrar dependência circular (leads.booking_id). */
  post?: (client: { query: (sql: string, args?: unknown[]) => Promise<unknown> }) => Promise<void>;
}

export interface ImportPlan {
  tables: TablePlan[];
  counts: Record<string, number>;
}

/**
 * Converte o documento INTEIRO em planos de inserção — TODAS as coleções
 * (nada de módulo legado é descartado). Ordem = pais antes de filhos.
 *
 * `finalPhase: true` produz as linhas COMO FICAM NO DESTINO após as fases
 * posteriores (leads.booking_id restabelecido) — é o que a validação compara.
 */
export function documentToRows(source: DB, opts: { finalPhase?: boolean } = {}): ImportPlan {
  const db = source;
  const now = nowIso();
  const tables: TablePlan[] = [];

  const push = (table: string, rows: Record<string, unknown>[], post?: TablePlan['post']) => {
    tables.push({ table, rows, post });
  };

  // ── Identidade ──
  push('users', db.users.map((u) => ({
    id: u.id, name: txt(u.name), email: txt(u.email).trim().toLowerCase(),
    password_hash: txt(u.passwordHash), role: u.role || 'owner',
    active: bool(u.active, true), last_login_at: ts(u.lastLoginAt),
    created_at: tsReq(u.createdAt, now),
  })));

  push('customers', db.customers.map((c) => ({
    id: c.id, name: txt(c.name), phone: txt(c.phone), email: txt(c.email).trim().toLowerCase(),
    password_hash: txt(c.passwordHash), google_id: txt(c.googleId), avatar: txt(c.avatar),
    must_change_password: bool(c.mustChangePassword),
    access_created_at: ts(c.accessCreatedAt), created_at: tsReq(c.createdAt, now),
  })));

  push('sessions', db.sessions.map((s) => ({
    id: s.id, user_id: s.userId, created_at: tsReq(s.createdAt, now),
    expires_at: tsReq(s.expiresAt, now),
  })));

  push('customer_sessions', db.customerSessions.map((s) => ({
    id: s.id, customer_id: s.customerId, created_at: tsReq(s.createdAt, now),
    expires_at: tsReq(s.expiresAt, now),
  })));

  push('password_resets', db.passwordResets.map((r) => ({
    id: r.id, kind: r.kind, account_id: r.accountId, token_hash: r.tokenHash,
    expires_at: tsReq(r.expiresAt, now), used_at: ts(r.usedAt), created_at: tsReq(r.createdAt, now),
  })));

  push('deletion_authorizations', (db.deletionAuthorizations || []).map((d) => ({
    token_hash: d.tokenHash, user_id: d.userId, session_hash: txt(d.sessionHash),
    kind: d.kind, target_id: d.targetId, organization_id: txt(d.organizationId),
    target_name: txt(d.targetName),
    expires_at: Math.round(num(d.expiresAt)), used_at: Math.round(num(d.usedAt)),
  })));

  // ── Organizações e unidades ──
  push('organizations', db.organizations.map((o) => ({
    id: o.id, name: txt(o.name), owner_id: o.ownerId,
    metadata: jsonReq(o.metadata, {}), public_business_id: ref(o.publicBusinessId),
    created_at: tsReq(o.createdAt, now), updated_at: tsReq(o.updatedAt, now),
  })));

  push('businesses', db.businesses.map((b) => ({
    id: b.id, organization_id: b.organizationId, owner_id: b.ownerId,
    name: txt(b.name), slug: txt(b.slug), description: txt(b.description),
    logo: txt(b.logo), cover: txt(b.cover), niche: b.niche || 'outro',
    modes: jsonReq(b.modes, []), features: json(b.features),
    products_off: typeof b.productsOff === 'boolean' ? b.productsOff : null,
    whatsapp_integration: json(b.whatsappIntegration),
    instagram_integration: json(b.instagramIntegration),
    phone: txt(b.phone), whatsapp: txt(b.whatsapp), email: txt(b.email),
    instagram: txt(b.instagram), tiktok: txt(b.tiktok),
    socials: jsonReq(b.socials, {}), address: txt(b.address), maps_url: txt(b.mapsUrl),
    hours: jsonReq(b.hours, {}), business_timezone: b.businessTimezone ? txt(b.businessTimezone) : null,
    payment_methods: jsonReq(b.paymentMethods, []), pix_key: txt(b.pixKey),
    delivery_fee: num(b.deliveryFee), min_order: num(b.minOrder),
    google_url: txt(b.googleUrl), google_place_id: txt(b.googlePlaceId), google_api_key: txt(b.googleApiKey),
    booking: jsonReq(b.booking, null), nav: jsonReq(b.nav, []), nav_custom: bool(b.navCustom),
    nav_items: json(b.navItems), automations: json(b.automations),
    capability_flags: json(b.capabilityFlags), about: jsonReq(b.about, null),
    appearance: json(b.appearance), published: bool(b.published),
    subscription: json(b.subscription),
    created_at: tsReq(b.createdAt, now), updated_at: tsReq(b.updatedAt, now),
  })));

  push('organization_members', db.organizationMembers.map((m) => ({
    id: m.id, organization_id: m.organizationId, user_id: m.userId, role: m.role,
    active: bool(m.active, true), created_at: tsReq(m.createdAt, now), updated_at: tsReq(m.updatedAt, now),
  })));

  push('members', db.members.map((m) => ({
    id: m.id, business_id: m.businessId, user_id: m.userId, role: m.role,
    permissions: jsonReq(m.permissions, {}), active: bool(m.active, true), note: txt(m.note),
    invited_by: txt(m.invitedBy), created_at: tsReq(m.createdAt, now), updated_at: tsReq(m.updatedAt, now),
  })));

  // ── Página e catálogo ──
  push('pages', db.pages.map((p) => ({
    id: p.id, business_id: p.businessId, preset_id: txt(p.presetId),
    theme: jsonReq(p.theme, {}), blocks: jsonReq(p.blocks, []), updated_at: tsReq(p.updatedAt, now),
  })));

  push('categories', db.categories.map((c) => ({
    id: c.id, business_id: c.businessId, kind: c.kind, name: txt(c.name),
    order: num(c.order), active: bool(c.active, true),
  })));

  push('products', db.products.map((p) => ({
    id: p.id, business_id: p.businessId, category_id: ref(p.categoryId),
    name: txt(p.name), description: txt(p.description), image: txt(p.image),
    price: num(p.price), promo_price: num(p.promoPrice),
    active: bool(p.active, true), featured: bool(p.featured), order: num(p.order),
  })));

  push('product_options', db.options.map((o) => ({
    id: o.id, business_id: o.businessId, product_id: o.productId, name: txt(o.name),
    required: bool(o.required), multiple: bool(o.multiple),
    min: num(o.min), max: num(o.max), order: num(o.order),
  })));

  // product_option_values não tem businessId no domínio: herda da opção-pai.
  const optionBusiness = new Map(db.options.map((o) => [o.id, o.businessId]));
  push('product_option_values', db.optionValues.map((v) => ({
    id: v.id, business_id: optionBusiness.get(v.optionId) || '', option_id: v.optionId, name: txt(v.name),
    price_delta: num(v.priceDelta), active: bool(v.active, true),
  })));

  // ── Agenda: serviços, profissionais, disponibilidade ──
  push('services', db.services.map((s) => ({
    id: s.id, business_id: s.businessId, category_id: ref(s.categoryId),
    name: txt(s.name), description: txt(s.description), image: txt(s.image),
    price: num(s.price), show_price: s.showPrice !== false,
    duration_min: num(s.durationMin, 30), professional_ids: jsonReq(s.professionalIds, []),
    active: bool(s.active, true), featured: bool(s.featured), bookable: bool(s.bookable, true),
    questions: jsonReq(s.questions, []),
  })));

  push('professionals', db.professionals.map((p) => ({
    id: p.id, business_id: p.businessId, name: txt(p.name), role: txt(p.role),
    photo: txt(p.photo), active: bool(p.active, true), user_id: ref(p.userId),
    follow_business_hours: bool(p.followBusinessHours, true),
  })));

  push('availability', db.availability.map((a) => ({
    id: a.id, business_id: a.businessId, professional_id: ref(a.professionalId),
    service_id: ref(a.serviceId), weekday: num(a.weekday),
    start: txt(a.start) || '00:00', end: txt(a.end) || '23:59', slot_min: num(a.slotMin, 30),
  })));

  push('availability_exceptions', db.exceptions.map((e) => ({
    id: e.id, business_id: e.businessId, date: date(e.date), closed: bool(e.closed),
    start: txt(e.start), end: txt(e.end), note: txt(e.note),
  })));

  // ── Leads (booking_id entra na 2ª fase — dependência mútua com bookings) ──
  push('leads', db.leads.map((l) => ({
    id: l.id, business_id: l.businessId, customer_id: ref(l.customerId),
    name: txt(l.name), phone: txt(l.phone), email: txt(l.email), instagram: txt(l.instagram),
    origin: txt(l.origin), channel: txt(l.channel), interest: txt(l.interest),
    action: txt(l.action), status: l.status || 'new',
    created_at: tsReq(l.createdAt, now), last_interaction: ts(l.lastInteraction),
    stage_id: txt(l.stageId) || 'new', assigned_user_id: ref(l.assignedUserId),
    priority: l.priority ? txt(l.priority) : null, next_action: txt(l.nextAction),
    service_id: txt(l.serviceId), professional_id: txt(l.professionalId),
    source_url: txt(l.sourceUrl), metadata: json(l.metadata),
    booking_id: (opts.finalPhase ? ref(l.bookingId) : null) as string | null, // fase 2
    notes: json(l.notes), stage_history: json(l.stageHistory),
  })), async (client) => {
    // Fase 2: restabelece o vínculo lead↔agendamento após gravar bookings.
    for (const l of db.leads) {
      if (!l.bookingId) continue;
      await client.query(
        'UPDATE app.leads SET booking_id = $2 WHERE id = $1',
        [l.id, l.bookingId],
      );
    }
  });

  // ── Bookings (precisa da duração dos serviços p/ start_min/end_min) ──
  const durationOf = new Map(db.services.map((s) => [s.id, num(s.durationMin, 30)]));
  push('bookings', db.bookings.map((b) => bookingToRow(b, durationOf.get(b.serviceId) ?? 30)));

  // ── CRM, avaliações, eventos, pedidos ──
  push('contacts', db.contacts.map((c) => ({
    id: c.id, business_id: c.businessId, customer_id: ref(c.customerId),
    name: txt(c.name), phone: txt(c.phone), email: txt(c.email),
    created_at: tsReq(c.createdAt, now), updated_at: tsReq(c.updatedAt, now),
    source: txt(c.source) || 'interaction', last_interaction: ts(c.lastInteraction),
    marketing_opt_in: bool(c.marketingOptIn), note: txt(c.note),
    notes: json(c.notes), profile: json(c.profile), channel_identities: json(c.channelIdentities),
  })));

  push('reviews', db.reviews.map((r) => ({
    id: r.id, business_id: r.businessId, customer_id: ref(r.customerId),
    customer_name: txt(r.customerName), rating: num(r.rating, 5), text: txt(r.text),
    source: r.source || 'site', status: r.status || 'pending',
    order_id: txt(r.orderId), booking_id: txt(r.bookingId), external_id: txt(r.externalId),
    created_at: tsReq(r.createdAt, now),
  })));

  push('events', db.events.map((e) => ({
    id: e.id, business_id: e.businessId, type: e.type, path: txt(e.path),
    meta: jsonReq(e.meta, {}), created_at: tsReq(e.createdAt, now),
  })));

  push('orders', db.orders.map((o) => ({
    id: o.id, business_id: o.businessId, customer_id: ref(o.customerId),
    code: txt(o.code), customer_name: txt(o.customerName), customer_phone: txt(o.customerPhone),
    customer_address: txt(o.customerAddress), type: o.type || 'delivery', payment: txt(o.payment),
    items: jsonReq(o.items, []), subtotal: num(o.subtotal), total: num(o.total),
    status: o.status || 'new', note: txt(o.note),
    created_at: tsReq(o.createdAt, now), updated_at: tsReq(o.updatedAt, o.createdAt || now),
    history: jsonReq(o.history, []),
  })));

  // ── Agente, conversas, mensagens ──
  push('agents', db.agents.map((a) => ({
    id: a.id, business_id: a.businessId, name: txt(a.name), enabled: bool(a.enabled, true),
    greeting: txt(a.greeting), tone: a.tone || 'profissional',
    objectives: jsonReq(a.objectives, []), instructions: txt(a.instructions),
    restrictions: txt(a.restrictions), handoff_message: txt(a.handoffMessage),
    knowledge_override: txt(a.knowledgeOverride), channels: jsonReq(a.channels, { site: true, whatsapp: false }),
    created_at: tsReq(a.createdAt, now), updated_at: tsReq(a.updatedAt, now),
  })));

  push('conversations', db.conversations.map((c) => ({
    id: c.id, business_id: c.businessId, channel: c.channel,
    channel_user_id: txt(c.channelUserId), channel_account_id: txt(c.channelAccountId),
    last_inbound_at: ts(c.lastInboundAt), channel_username: txt(c.channelUsername),
    contact_id: txt(c.contactId), customer_id: ref(c.customerId),
    name: txt(c.name), phone: txt(c.phone), status: c.status || 'open',
    mode: c.mode || 'automation', unread: num(c.unread),
    last_message_at: ts(c.lastMessageAt), last_message_preview: txt(c.lastMessagePreview),
    created_at: tsReq(c.createdAt, now), context: json(c.context),
  })));

  push('messages', db.messages.map((m) => ({
    id: m.id, business_id: m.businessId, conversation_id: m.conversationId,
    direction: m.direction, body: txt(m.body), status: m.status || 'pending',
    external_id: txt(m.externalId), by: txt(m.by), by_name: txt(m.byName),
    channel: txt(m.channel), channel_user_id: txt(m.channelUserId),
    at: tsReq(m.at, now), error: txt(m.error),
    claim_token: m.claimToken ? txt(m.claimToken) : null,
    claim_expires_at: ts(m.claimExpiresAt), attempts: num(m.attempts),
    next_retry_at: ts(m.nextRetryAt), meta: json(m.meta),
  })));

  // ── Campanhas ──
  push('campaigns', db.campaigns.map((c) => ({
    id: c.id, business_id: c.businessId, name: txt(c.name), message: txt(c.message),
    template_name: txt(c.templateName), template_language: txt(c.templateLanguage),
    template_params: json(c.templateParams), segment: c.segment || 'all_optin',
    segment_ref: txt(c.segmentRef), status: c.status || 'draft',
    counts: jsonReq(c.counts, { eligible: 0, sent: 0, delivered: 0, failed: 0 }),
    channel: c.channel || 'whatsapp', created_by: txt(c.createdBy),
    created_at: tsReq(c.createdAt, now), updated_at: tsReq(c.updatedAt, now),
    sent_at: ts(c.sentAt),
  })));

  push('campaign_recipients', db.campaignRecipients.map((r) => ({
    id: r.id, business_id: r.businessId, campaign_id: r.campaignId,
    contact_id: txt(r.contactId), name: txt(r.name), phone: txt(r.phone),
    status: r.status || 'pending', external_id: txt(r.externalId), error: txt(r.error),
    at: ts(r.at), next_retry_at: ts(r.nextRetryAt), attempts: num(r.attempts),
    claim_token: r.claimToken ? txt(r.claimToken) : null, claim_expires_at: ts(r.claimExpiresAt),
  })));

  // ── Auditoria, suporte ──
  push('audit', db.audit.map((a) => ({
    id: a.id, at: tsReq(a.at, now), action: a.action,
    actor_user_id: txt(a.actorUserId), actor_email: txt(a.actorEmail), actor_role: txt(a.actorRole),
    business_id: txt(a.businessId), support_session_id: txt(a.supportSessionId),
    meta: jsonReq(a.meta, {}),
  })));

  push('support_sessions', db.supportSessions.map((s) => ({
    id: s.id, master_user_id: s.masterUserId, master_email: txt(s.masterEmail),
    business_id: txt(s.businessId), mode: s.mode, reason: txt(s.reason),
    created_at: tsReq(s.createdAt, now), expires_at: tsReq(s.expiresAt, now),
    ended_at: ts(s.endedAt),
  })));

  // ── P3: esteira e integrações externas ──
  push('pipelines', db.pipelines.map((p) => ({
    id: p.id, business_id: p.businessId, stages: jsonReq(p.stages, []),
    updated_at: tsReq(p.updatedAt, now),
  })));

  push('api_keys', db.apiKeys.map((k) => ({
    id: k.id, business_id: k.businessId, name: txt(k.name), key_prefix: txt(k.keyPrefix),
    key_hash: k.keyHash, created_at: tsReq(k.createdAt, now),
    last_used_at: ts(k.lastUsedAt), revoked_at: ts(k.revokedAt),
    created_by_user_id: txt(k.createdByUserId),
  })));

  push('webhooks', db.webhooks.map((w) => ({
    id: w.id, business_id: w.businessId, url: txt(w.url), secret: txt(w.secret),
    events: jsonReq(w.events, []), active: bool(w.active, true),
    created_at: tsReq(w.createdAt, now), updated_at: tsReq(w.updatedAt, now),
  })));

  push('webhook_deliveries', db.webhookDeliveries.map((d) => ({
    id: d.id, webhook_id: txt(d.webhookId), business_id: d.businessId, event: d.event,
    event_id: txt(d.eventId), url: txt(d.url), payload_summary: jsonReq(d.payloadSummary, {}),
    status: d.status || 'pending', status_code: d.statusCode == null ? null : num(d.statusCode),
    error: txt(d.error), attempts: num(d.attempts, 1), max_attempts: num(d.maxAttempts, 3),
    next_retry_at: ts(d.nextRetryAt), delivered_at: ts(d.deliveredAt),
    attempts_history: jsonReq(d.attemptsHistory, []),
    created_at: tsReq(d.createdAt, now), updated_at: tsReq(d.updatedAt, d.createdAt || now),
    claim_token: d.claimToken ? txt(d.claimToken) : null, claim_expires_at: ts(d.claimExpiresAt),
  })));

  push('idempotency_keys', db.idempotencyKeys.map((k) => ({
    id: k.id, business_id: k.businessId, key: k.key, endpoint: txt(k.endpoint),
    status_code: num(k.statusCode), response_body: json(k.responseBody),
    created_at: tsReq(k.createdAt, now),
  })));

  push('integration_logs', db.integrationLogs.map((l) => ({
    id: l.id, business_id: l.businessId, endpoint: txt(l.endpoint), method: txt(l.method),
    source: txt(l.source), status: num(l.status), operation_id: txt(l.operationId),
    error_message: txt(l.errorMessage), at: tsReq(l.at, now),
  })));

  // ── P4/P5: automações ──
  push('automations', db.automations.map((a) => ({
    id: a.id, business_id: a.businessId, name: txt(a.name), description: txt(a.description),
    active: bool(a.active, true), trigger: jsonReq(a.trigger, null), nodes: jsonReq(a.nodes, []),
    edges: jsonReq(a.edges, []), settings: jsonReq(a.settings, {}),
    template_id: txt(a.templateId), version: num(a.version, 1),
    created_by_user_id: txt(a.createdByUserId),
    created_at: tsReq(a.createdAt, now), updated_at: tsReq(a.updatedAt, now),
  })));

  push('automation_runs', db.automationRuns.map((r) => ({
    id: r.id, business_id: r.businessId, automation_id: txt(r.automationId),
    automation_name: txt(r.automationName), status: r.status || 'queued',
    trigger_event: txt(r.triggerEvent), current_node_id: txt(r.currentNodeId),
    context: jsonReq(r.context, {}), waiting_until: ts(r.waitingUntil),
    started_at: tsReq(r.startedAt, now), updated_at: tsReq(r.updatedAt, now),
    finished_at: ts(r.finishedAt), error: txt(r.error), history: jsonReq(r.history, []),
    event_key: txt(r.eventKey), emitted_by_run_id: txt(r.emittedByRunId),
    steps: num(r.steps), resumes: num(r.resumes),
    last_action_type: txt(r.lastActionType), last_error: txt(r.lastError),
    claim_token: r.claimToken ? txt(r.claimToken) : null, claim_expires_at: ts(r.claimExpiresAt),
  })));

  push('tasks', db.tasks.map((t) => ({
    id: t.id, business_id: t.businessId, title: txt(t.title), note: txt(t.note),
    status: t.status || 'open', due_at: ts(t.dueAt),
    created_at: tsReq(t.createdAt, now), updated_at: tsReq(t.updatedAt, t.createdAt || now),
    done_at: ts(t.doneAt), assigned_user_id: txt(t.assignedUserId), created_by: txt(t.createdBy),
    automation_id: txt(t.automationId), automation_run_id: txt(t.automationRunId),
    automation_node_id: txt(t.automationNodeId), lead_id: txt(t.leadId),
    booking_id: txt(t.bookingId), customer_id: txt(t.customerId), encounter_id: txt(t.encounterId),
    source: t.source || 'automation',
  })));

  push('ai_proposals', db.aiProposals.map((p) => ({
    id: p.id, business_id: p.businessId, status: p.status || 'draft', prompt: txt(p.prompt),
    plan: jsonReq(p.plan, {}), nodes: jsonReq(p.nodes, []), edges: jsonReq(p.edges, []),
    validation: jsonReq(p.validation, { ok: false, errors: [], warnings: [] }),
    automation_id: txt(p.automationId), created_by_user_id: txt(p.createdByUserId),
    created_at: tsReq(p.createdAt, now), updated_at: tsReq(p.updatedAt, p.createdAt || now),
    published_at: ts(p.publishedAt),
  })));

  // ── P6: canais e integrações ──
  push('integrations', db.integrations.map((i) => ({
    id: i.id, business_id: i.businessId, kind: i.kind, provider: txt(i.provider),
    name: txt(i.name) || 'Integração', direction: i.direction || 'in',
    status: i.status || 'active', token_hash: txt(i.tokenHash), token_prefix: txt(i.tokenPrefix),
    signing_secret: txt(i.signingSecret), signing_secret_prefix: txt(i.signingSecretPrefix),
    require_signature: bool(i.requireSignature), default_event: txt(i.defaultEvent),
    config: jsonReq(i.config, {}), created_at: tsReq(i.createdAt, now),
    updated_at: tsReq(i.updatedAt, i.createdAt || now), created_by_user_id: txt(i.createdByUserId),
    rotated_at: ts(i.rotatedAt), last_event_at: ts(i.lastEventAt), event_count: num(i.eventCount),
  })));

  push('integration_events', db.integrationEvents.map((e) => ({
    id: e.id, business_id: e.businessId, integration_id: e.integrationId,
    provider: txt(e.provider), direction: e.direction === 'out' ? 'out' : 'in',
    event: txt(e.event), status: e.status || 'failed', external_event_id: txt(e.externalEventId),
    idempotency_key: txt(e.idempotencyKey), http_status: num(e.httpStatus), reason: txt(e.reason),
    lead_id: txt(e.leadId), contact_id: txt(e.contactId),
    automation_run_ids: jsonReq(e.automationRunIds, []), payload_summary: jsonReq(e.payloadSummary, {}),
    at: tsReq(e.at, now),
  })));

  // ── A3.4: fila e atendimentos ──
  push('queue_entries', db.queue.map((q) => ({
    id: q.id, business_id: q.businessId, customer_name: txt(q.customerName),
    customer_phone: txt(q.customerPhone), contact_id: txt(q.contactId),
    service_id: txt(q.serviceId), professional_id: txt(q.professionalId),
    booking_id: txt(q.bookingId), note: txt(q.note), status: q.status || 'waiting',
    date: date(q.date), created_at: tsReq(q.createdAt, now), called_at: ts(q.calledAt),
    started_at: ts(q.startedAt), ended_at: ts(q.endedAt), updated_by: txt(q.updatedBy),
    updated_at: tsReq(q.updatedAt, q.createdAt || now),
  })));

  push('encounters', db.encounters.map((e) => ({
    id: e.id, business_id: e.businessId, booking_id: txt(e.bookingId), queue_id: txt(e.queueId),
    service_id: txt(e.serviceId), professional_id: txt(e.professionalId),
    customer_id: ref(e.customerId), contact_id: txt(e.contactId), customer_name: txt(e.customerName),
    date: date(e.date), time: txt(e.time), complaint: txt(e.complaint), evolution: txt(e.evolution),
    guidance: txt(e.guidance), follow_up: txt(e.followUp), internal_note: txt(e.internalNote),
    tags: jsonReq(e.tags, []), status: e.status || 'draft', version: num(e.version, 1),
    created_at: tsReq(e.createdAt, now), updated_at: tsReq(e.updatedAt, e.createdAt || now),
    created_by: txt(e.createdBy), updated_by: txt(e.updatedBy), finalized_at: ts(e.finalizedAt),
    finalized_by: txt(e.finalizedBy), signed_by: txt(e.signedBy),
  })));

  const counts: Record<string, number> = {};
  for (const t of tables) counts[t.table] = t.rows.length;
  return { tables, counts };
}

/**
 * PRÉ-FLIGHT (handoff §6): conflitos de horário que o documento legado já
 * contém e a constraint `bookings_no_overlap` recusaria. Import não adivinha:
 * a lista volta para reconciliação HUMANA antes do corte.
 */
export function findBookingOverlapConflicts(db: DB): Array<Record<string, unknown>> {
  const byKey = new Map<string, DB['bookings']>();
  for (const b of db.bookings) {
    if (b.bookingKind === 'fit_in') continue;
    if (!(b.status === 'pending' || b.status === 'confirmed')) continue;
    const key = `${b.businessId}|${b.date}|${b.professionalId || ''}`;
    const list = byKey.get(key) || [];
    list.push(b);
    byKey.set(key, list);
  }
  const conflicts: Array<Record<string, unknown>> = [];
  const dur = new Map(db.services.map((s) => [s.id, num(s.durationMin, 30)]));
  const toMin = (t: string) => {
    const [h, m] = String(t).split(':');
    return (Number(h || 0) * 60) + Number(m || 0);
  };
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => toMin(a.time) - toMin(b.time));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const aEnd = toMin(a.time) + (dur.get(a.serviceId) ?? 30);
        const bStart = toMin(b.time);
        if (bStart < aEnd) {
          conflicts.push({
            businessId: a.businessId, date: a.date, professionalId: a.professionalId || '',
            a: { id: a.id, time: a.time, endMin: aEnd, serviceId: a.serviceId },
            b: { id: b.id, time: b.time, endMin: toMin(b.time) + (dur.get(b.serviceId) ?? 30), serviceId: b.serviceId },
          });
        } else break;
      }
    }
  }
  return conflicts;
}
