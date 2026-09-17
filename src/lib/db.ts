// Camada de persistência.
//
// Arquitetura: todo acesso a dados passa por readDB/updateDB.
// Backend duplo, escolhido por ambiente:
//   - COM DATABASE_URL  → Postgres (documento JSONB em linha única).
//                         É o modo produção (Vercel/Neon/Supabase).
//   - SEM DATABASE_URL  → arquivo JSON local (dev).
// Nenhuma rota ou tela importa detalhes de armazenamento.
//
// FAIL-CLOSED (P0-1): erro de leitura NUNCA retorna banco vazio.
// pgRead/fileRead lançam exceção em falha real; emptyDB só existe quando
// o documento genuinamente não existe (primeira execução). updateDB nunca
// escreve sobre uma leitura que falhou.
//
// Concorrência: updateDB serializa escritas por instância (mutex em
// memória). Entre instâncias serverless distintas ainda vale last-wins —
// por isso checagens críticas (slot, código de pedido) acontecem DENTRO
// do callback, sobre a leitura mais fresca possível.
//
// Retenção: updateDB executa prune oportunístico (sessões expiradas e
// eventos antigos) para o documento não crescer sem teto.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { DB } from './types';
import { defaultBookingConfig } from './types';
import { backfillContacts } from './contacts';
import { normalizeFeatures } from './features';
import { sanitizeAppearance } from './appearance';
import { defaultWhatsappIntegration } from './whatsapp';
// P4 — normalizadores puros da automação (sem I/O): importá-los aqui mantém a
// migração num só lugar. `automation/model.ts` não importa este arquivo.
import { normalizeAutomationRecord, normalizeAutomationRunRecord } from './automation/model';
// P6 — tetos do log de integrações (uma fonte só: o prune não inventa número).
import {
  MAX_INTEGRATION_EVENTS_PER_BUSINESS,
  INTEGRATION_EVENT_RETENTION_MS,
  INTEGRATION_DUPLICATE_RETENTION_MS,
} from './integrations/logs';

// Caminho do banco local (modo arquivo). A variável INSTALINK_DB_FILE permite
// apontar para um arquivo isolado (testes/dev paralelo) sem mudar o padrão.
const FILE = process.env.INSTALINK_DB_FILE || path.join(process.cwd(), 'data', 'instalink.db.json');

export function emptyDB(): DB {
  return {
    users: [], sessions: [], customers: [], customerSessions: [],
    passwordResets: [],
    organizations: [], organizationMembers: [],
    businesses: [], pages: [], categories: [],
    products: [], options: [], optionValues: [], services: [],
    professionals: [], availability: [], exceptions: [], orders: [],
    bookings: [], leads: [], contacts: [], reviews: [], events: [],
    // Estruturas novas (aditivas — documentos antigos ganham arrays vazios).
    members: [], agents: [], conversations: [], messages: [],
    campaigns: [], campaignRecipients: [], audit: [], supportSessions: [],
    // P3 — esteira e integrações externas
    pipelines: [], apiKeys: [], webhooks: [], webhookDeliveries: [],
    idempotencyKeys: [], integrationLogs: [],
    // P4 — motor de automações (definições, execuções e tarefas internas)
    automations: [], automationRuns: [], tasks: [],
    // P5 — propostas de IA (rascunho/aprovação; nunca executam sozinhas)
    aiProposals: [],
    // P6 — canais e integrações externas (conexões + log de entregas)
    integrations: [], integrationEvents: [],
  };
}

// Migração defensiva: preenche campos novos em documentos antigos.
// Reversível (só adiciona defaults) e idempotente.
export function normalizeDB(raw: unknown): DB {
  const base = { ...emptyDB(), ...((raw && typeof raw === 'object' ? raw : {}) as Partial<DB>) };
  // Arrays novos (members/agents/campaigns/audit/...): documento antigo pode
  // ter chaves ausentes ou inválidas — garantimos array em todos os casos.
  for (const key of [
    'organizations', 'organizationMembers', 'members', 'agents', 'conversations',
    'messages', 'campaigns', 'campaignRecipients', 'audit', 'supportSessions',
    'pipelines', 'apiKeys', 'webhooks', 'webhookDeliveries', 'idempotencyKeys', 'integrationLogs',
    'automations', 'automationRuns', 'tasks', 'aiProposals',
    'integrations', 'integrationEvents',
  ] as const) {
    if (!Array.isArray((base as any)[key])) (base as any)[key] = [];
  }
  // P3: Normalização defensiva de entregas de webhooks
  for (const d of base.webhookDeliveries as any[]) {
    if (!d.status) d.status = d.deliveredAt ? 'success' : 'failed';
    if (!d.attempts) d.attempts = 1;
    if (!d.maxAttempts) d.maxAttempts = 3;
    if (!Array.isArray(d.attemptsHistory)) d.attemptsHistory = [];
    if (!d.eventId) d.eventId = (d.payloadSummary?.id as string) || d.id;
    if (!d.updatedAt) d.updatedAt = d.deliveredAt || d.createdAt || new Date().toISOString();
  }
  // P4: Automações e execuções — normalização ADITIVA e defensiva. Campos
  // novos ganham defaults; nada que o produto tenha escrito é reescrito nem
  // apagado: `normalizeAutomationRecord` conserta o que dá (nó com tipo
  // desconhecido, aresta sem branch, settings ausentes) e só devolve `null`
  // para entrada SEM DONO (não é objeto, ou sem id/businessId) — uma linha
  // assim não pertence a nenhuma unidade e é invisível para todo o resto do
  // sistema, que sempre filtra por `businessId`.
  // HONESTIDADE SOBRE O ARMAZENAMENTO: o documento é único, então a próxima
  // gravação de `updateDB` regrava o documento inteiro — uma entrada descartada
  // aqui NÃO sobrevive ao próximo write. É por isso que o critério de descarte
  // é “sem dono identificável”, nunca “definição estranha”, e por isso que
  // FALHA DE LEITURA (JSON/Postgres) lança em vez de virar banco vazio.
  const seenRunIds = new Set<string>();
  const cleanAutomations: unknown[] = [];
  for (const raw of base.automations as any[]) {
    const a = normalizeAutomationRecord(raw);
    if (a) cleanAutomations.push(a);
  }
  base.automations = cleanAutomations as DB['automations'];
  const cleanRuns: unknown[] = [];
  for (const raw of base.automationRuns as any[]) {
    const run = normalizeAutomationRunRecord(raw);
    if (!run || seenRunIds.has(run.id)) continue;
    seenRunIds.add(run.id);
    cleanRuns.push(run);
  }
  base.automationRuns = cleanRuns as DB['automationRuns'];
  const tasksNow = new Date().toISOString();
  for (const t of base.tasks as any[]) {
    if (typeof t.businessId !== 'string') t.businessId = '';
    if (!t.status) t.status = 'open';
    if (typeof t.dueAt !== 'string') t.dueAt = '';
    if (typeof t.doneAt !== 'string') t.doneAt = '';
    if (typeof t.assignedUserId !== 'string') t.assignedUserId = '';
    if (typeof t.createdAt !== 'string' || !t.createdAt) t.createdAt = tasksNow;
    if (typeof t.updatedAt !== 'string' || !t.updatedAt) t.updatedAt = t.createdAt;
    if (t.source !== 'manual') t.source = 'automation';
  }
  // P5 — propostas de IA: defaults defensivos. Sem dono (id/businessId) a
  // linha é invisível para o resto do sistema (sempre filtra por tenant).
  const cleanProposals: unknown[] = [];
  for (const raw of base.aiProposals as any[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = String(raw.id || '').trim();
    const businessId = String(raw.businessId || '').trim();
    if (!id || !businessId) continue;
    const statuses = ['draft', 'approved', 'published', 'cancelled'];
    const status = statuses.includes(raw.status) ? raw.status : 'draft';
    const plan = (raw.plan && typeof raw.plan === 'object' && !Array.isArray(raw.plan))
      ? raw.plan
      : { name: '', description: '', prompt: '', event: 'lead.created', steps: [], confidence: 0, assumptions: [], unresolved: [] };
    cleanProposals.push({
      id,
      businessId,
      status,
      prompt: String(raw.prompt || plan.prompt || '').slice(0, 2000),
      plan,
      nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
      edges: Array.isArray(raw.edges) ? raw.edges : [],
      validation: (raw.validation && typeof raw.validation === 'object')
        ? {
          ok: raw.validation.ok === true,
          errors: Array.isArray(raw.validation.errors) ? raw.validation.errors.map(String).slice(0, 40) : [],
          warnings: Array.isArray(raw.validation.warnings) ? raw.validation.warnings.map(String).slice(0, 40) : [],
        }
        : { ok: false, errors: [], warnings: [] },
      ...(raw.automationId ? { automationId: String(raw.automationId).slice(0, 64) } : {}),
      createdByUserId: String(raw.createdByUserId || ''),
      createdAt: String(raw.createdAt || tasksNow),
      updatedAt: String(raw.updatedAt || raw.createdAt || tasksNow),
      ...(raw.publishedAt ? { publishedAt: String(raw.publishedAt) } : {}),
    });
  }
  base.aiProposals = cleanProposals as DB['aiProposals'];
  // P6 — integrações externas: normalização ADITIVA e defensiva. Campos novos
  // ganham default; linha SEM DONO (sem id ou sem businessId) é descartada —
  // não pertence a nenhuma unidade e seria invisível para o resto do sistema,
  // que sempre filtra por `businessId`. Nenhum segredo é inventado aqui: o que
  // existe é preservado (o token já vive só como hash).
  const cleanIntegrations: unknown[] = [];
  const seenIntegrationIds = new Set<string>();
  for (const raw of base.integrations as any[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = String(raw.id || '').trim();
    const businessId = String(raw.businessId || '').trim();
    if (!id || !businessId || seenIntegrationIds.has(id)) continue;
    seenIntegrationIds.add(id);
    const statuses = ['active', 'paused'];
    const directions = ['in', 'out', 'both'];
    const integrationsNow = new Date().toISOString();
    cleanIntegrations.push({
      ...raw,
      id,
      businessId,
      kind: ['channel', 'source', 'technical'].includes(raw.kind) ? raw.kind : 'technical',
      name: String(raw.name || '').slice(0, 60) || 'Integração',
      direction: directions.includes(raw.direction) ? raw.direction : 'in',
      status: statuses.includes(raw.status) ? raw.status : 'active',
      tokenHash: String(raw.tokenHash || ''),
      tokenPrefix: String(raw.tokenPrefix || ''),
      signingSecret: String(raw.signingSecret || ''),
      signingSecretPrefix: String(raw.signingSecretPrefix || ''),
      requireSignature: raw.requireSignature === true,
      defaultEvent: typeof raw.defaultEvent === 'string' ? raw.defaultEvent : '',
      config: raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config) ? raw.config : {},
      createdAt: String(raw.createdAt || integrationsNow),
      updatedAt: String(raw.updatedAt || raw.createdAt || integrationsNow),
      createdByUserId: String(raw.createdByUserId || ''),
      rotatedAt: String(raw.rotatedAt || ''),
      lastEventAt: String(raw.lastEventAt || ''),
      eventCount: Number.isFinite(raw.eventCount) ? Number(raw.eventCount) : 0,
    });
  }
  base.integrations = cleanIntegrations as DB['integrations'];
  const cleanIntegrationEvents: unknown[] = [];
  const seenIntegrationEventIds = new Set<string>();
  for (const raw of base.integrationEvents as any[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = String(raw.id || '').trim();
    const businessId = String(raw.businessId || '').trim();
    const integrationId = String(raw.integrationId || '').trim();
    if (!id || !businessId || !integrationId || seenIntegrationEventIds.has(id)) continue;
    seenIntegrationEventIds.add(id);
    const statuses = ['processed', 'duplicate', 'rejected', 'failed'];
    const eventsNow = new Date().toISOString();
    cleanIntegrationEvents.push({
      ...raw,
      id,
      businessId,
      integrationId,
      provider: String(raw.provider || ''),
      direction: raw.direction === 'out' ? 'out' : 'in',
      event: String(raw.event || ''),
      status: statuses.includes(raw.status) ? raw.status : 'failed',
      externalEventId: String(raw.externalEventId || '').slice(0, 160),
      idempotencyKey: String(raw.idempotencyKey || '').slice(0, 220),
      httpStatus: Number.isFinite(raw.httpStatus) ? Number(raw.httpStatus) : 0,
      reason: String(raw.reason || '').slice(0, 200),
      leadId: String(raw.leadId || ''),
      contactId: String(raw.contactId || ''),
      automationRunIds: Array.isArray(raw.automationRunIds) ? raw.automationRunIds.map(String).slice(0, 25) : [],
      payloadSummary: raw.payloadSummary && typeof raw.payloadSummary === 'object' && !Array.isArray(raw.payloadSummary)
        ? raw.payloadSummary : {},
      at: String(raw.at || eventsNow),
    });
  }
  base.integrationEvents = cleanIntegrationEvents as DB['integrationEvents'];
  // Contatos: migração defensiva UMA única vez (quando o doc antigo não
  // tinha o campo). Idempotente; nada existente é apagado ou duplicado.
  const hadContacts = Array.isArray((raw as any)?.contacts);
  if (!Array.isArray(base.contacts)) base.contacts = [];
  if (!hadContacts) backfillContacts(base);
  // Organization é uma camada aditiva. Dados legados são agrupados por
  // proprietário, mantendo cada Business como unidade operacional isolada.
  const now = new Date().toISOString();
  for (const b of base.businesses) {
    if (!(b as any).organizationId) {
      // Um Business legado é uma empresa independente até que o usuário
      // explicitamente crie outra unidade dentro da mesma Organization.
      // Agrupar por ownerId transformaria empresas sem relação em filiais.
      const organizationId = `org-${b.id}`;
      let org = base.organizations.find((o) => o.id === organizationId);
      if (!org) {
        org = { id: organizationId, name: b.name, ownerId: b.ownerId, metadata: {}, createdAt: b.createdAt || now, updatedAt: b.updatedAt || now };
        base.organizations.push(org);
      }
      (b as any).organizationId = org.id;
    }
  }
  for (const o of base.organizations) {
    if (!o.metadata || typeof o.metadata !== 'object') o.metadata = {};
  }
  for (const b of base.businesses) {
    // Módulos opcionais: derivados dos blocos apenas quando ausentes
    // (idempotente; valor explícito do lojista nunca é sobrescrito).
    const page = base.pages.find((p) => p.businessId === b.id);
    b.features = normalizeFeatures(b, page?.blocks || []);
    if (!b.whatsappIntegration || typeof b.whatsappIntegration !== 'object') {
      b.whatsappIntegration = defaultWhatsappIntegration();
    } else {
      b.whatsappIntegration = { ...defaultWhatsappIntegration(), ...b.whatsappIntegration };
    }
    if (!b.booking) b.booking = defaultBookingConfig();
    else b.booking = { ...defaultBookingConfig(), ...b.booking };
    if (typeof b.deliveryFee !== 'number') b.deliveryFee = 0;
    if (typeof b.minOrder !== 'number') b.minOrder = 0;
    if (!Array.isArray(b.modes)) b.modes = [];
    if (!Array.isArray(b.nav)) b.nav = [];
    if (typeof b.navCustom !== 'boolean') b.navCustom = false;
    if (!b.about || typeof b.about !== 'object') {
      b.about = { title: '', text: '', image: '', enabled: false };
    } else {
      b.about = {
        title: typeof b.about.title === 'string' ? b.about.title : '',
        text: typeof b.about.text === 'string' ? b.about.text : '',
        image: typeof b.about.image === 'string' ? b.about.image : '',
        enabled: !!b.about.enabled,
      };
    }
  }
  for (const s of base.services) {
    if (!Array.isArray((s as any).professionalIds)) (s as any).professionalIds = [];
    // Preço público (showPrice): dado legado não tinha o campo e o preço ERA
    // exibido — preservamos o comportamento (true). Quem desmarcar no painel
    // grava false explicitamente.
    if (typeof (s as any).showPrice !== 'boolean') (s as any).showPrice = true;
  }
  for (const b of base.businesses) {
    if (!b.socials || typeof b.socials !== 'object') b.socials = {};
    else {
      // Sanitiza: só redes conhecidas com valor em string.
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(b.socials)) {
        if (typeof v === 'string' && v.trim()) clean[k] = v.trim().slice(0, 300);
      }
      b.socials = clean;
    }
    if (!Array.isArray((b as any).navItems)) (b as any).navItems = [];
    if (!b.automations || typeof b.automations !== 'object') (b as any).automations = {};
    // P4 — capacidades (planos/flags) são aditivas: ausente = padrão do produto.
    if (!b.capabilityFlags || typeof b.capabilityFlags !== 'object') (b as any).capabilityFlags = {};
  }
  for (const c of base.conversations) {
    if (!c.context || typeof c.context !== 'object') (c as any).context = {};
  }
  // Identidade visual do painel (P2): campo ADITIVO por Business. Quando
  // ausente, o negócio continua exatamente com o visual atual (sem cor
  // customizada) — nenhum dado existente é tocado.
  for (const b of base.businesses) {
    b.appearance = sanitizeAppearance(b.appearance);
  }
  // Profissionais: vínculo com o horário geral da clínica (lib/schedule.ts).
  // Migração DEFENSIVA e idempotente: quando o campo não existe (dado legado),
  // derivamos do que já estava gravado — quem tinha horário próprio continua
  // personalizado, quem não tinha passa a herdar. NENHUM registro é apagado e
  // nenhum horário existente muda de dono.
  for (const p of base.professionals) {
    // Vínculo User → Professional (P2): '' quando o profissional não tem login.
    if (typeof (p as any).userId !== 'string') (p as any).userId = '';
    if (typeof (p as any).followBusinessHours !== 'boolean') {
      (p as any).followBusinessHours = !base.availability.some(
        (a) => a.professionalId === (p as any).id,
      );
    }
  }
  for (const a of base.availability) {
    if (typeof (a as any).serviceId !== 'string') (a as any).serviceId = '';
    if (typeof (a as any).professionalId !== 'string') (a as any).professionalId = '';
  }
  for (const e of base.exceptions) {
    if (typeof (e as any).start !== 'string') (e as any).start = '';
    if (typeof (e as any).end !== 'string') (e as any).end = '';
    if (typeof (e as any).note !== 'string') (e as any).note = '';
  }
  for (const l of base.leads) {
    if (typeof (l as any).customerId !== 'string') (l as any).customerId = '';
  }
  for (const o of base.orders) {
    if (typeof (o as any).updatedAt !== 'string' || !(o as any).updatedAt) (o as any).updatedAt = o.createdAt || '';
    if (!Array.isArray((o as any).history)) (o as any).history = [];
  }
  for (const bk of base.bookings) {
    if (typeof (bk as any).updatedAt !== 'string' || !(bk as any).updatedAt) (bk as any).updatedAt = bk.createdAt || '';
    if (!Array.isArray((bk as any).history)) (bk as any).history = [];
    if (typeof (bk as any).previousId !== 'string') (bk as any).previousId = '';
    if (typeof (bk as any).rescheduleCount !== 'number') (bk as any).rescheduleCount = 0;
  }
  for (const c of base.contacts) {
    // OBSERVAÇÕES: o campo legado `note` é preservado SEM alteração; o array
    // `notes` (P2) só é criado quando ausente — append-only, nada é apagado.
    if (typeof (c as any).note !== 'string') (c as any).note = '';
    if (!Array.isArray((c as any).notes)) (c as any).notes = [];
    if (typeof (c as any).marketingOptIn !== 'boolean') (c as any).marketingOptIn = false;
  }
  for (const m of base.members) {
    if (!m.permissions || typeof m.permissions !== 'object') (m as any).permissions = {};
    if (typeof (m as any).active !== 'boolean') (m as any).active = true;
    if (typeof (m as any).note !== 'string') (m as any).note = '';
    if (typeof (m as any).createdAt !== 'string') (m as any).createdAt = new Date().toISOString();
    if (typeof (m as any).updatedAt !== 'string') (m as any).updatedAt = (m as any).createdAt;
  }
  for (const u of base.users) {
    if (u.role !== 'owner' && u.role !== 'admin' && u.role !== 'master') (u as any).role = 'owner';
    if (typeof (u as any).lastLoginAt !== 'string') (u as any).lastLoginAt = '';
  }
  return base;
}

// ── Postgres ────────────────────────────────────────────────
let pool: Pool | null = null;

function usePg(): boolean {
  return !!process.env.DATABASE_URL;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon/Vercel Postgres/Supabase exigem SSL. PGSSLMODE=disable só
      // para Postgres local sem SSL.
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

async function pgInit(): Promise<void> {
  await getPool().query(
    'CREATE TABLE IF NOT EXISTS instalink_doc (id SMALLINT PRIMARY KEY, data JSONB NOT NULL)',
  );
}

async function pgRead(): Promise<DB> {
  // FAIL-CLOSED: qualquer erro (timeout, TLS, conexão, resposta inválida)
  // propaga como exceção. emptyDB SOMENTE quando a linha não existe.
  await pgInit();
  const res = await getPool().query('SELECT data FROM instalink_doc WHERE id = 1');
  if (res.rows.length === 0) return emptyDB();
  return normalizeDB(res.rows[0].data);
}

async function pgWrite(db: DB): Promise<void> {
  await pgInit();
  await getPool().query(
    `INSERT INTO instalink_doc (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(db)],
  );
}

// ── Escrita condicional (CAS) — concorrência ENTRE instâncias ──
// `updateDB` serializa por instância (mutex em memória) e, entre instâncias
// serverless distintas, vale last-wins. Para tarefas que NÃO podem ser
// duplicadas (ex.: consumidor de retry de webhooks), lemos o documento junto
// com o hash do que está gravado e só escrevemos se ninguém tiver escrito no
// meio (compare-and-swap atômico no próprio banco):
//
//   SELECT data, md5(data::text)          → snapshot + hash
//   UPDATE ... WHERE md5(data::text) = $1 → só grava se ainda for o snapshot
//
// Se o CAS falhar, a operação é reaplicada sobre a leitura mais fresca
// (poucas tentativas). Nada de Redis/lock externo: o próprio Postgres é o
// árbitro e o modo arquivo usa o mesmo mutex de `updateDB`.
async function pgReadCas(): Promise<{ db: DB; hash: string | null }> {
  await pgInit();
  const res = await getPool().query('SELECT data, md5(data::text) AS hash FROM instalink_doc WHERE id = 1');
  if (res.rows.length === 0) return { db: emptyDB(), hash: null };
  return { db: normalizeDB(res.rows[0].data), hash: res.rows[0].hash as string };
}

async function pgCasWrite(hash: string | null, db: DB): Promise<boolean> {
  await pgInit();
  if (hash === null) {
    // Primeira gravação: cria a linha apenas se ela ainda não existir.
    const ins = await getPool().query(
      'INSERT INTO instalink_doc (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
      [JSON.stringify(db)],
    );
    return ins.rowCount === 1;
  }
  const upd = await getPool().query(
    'UPDATE instalink_doc SET data = $2 WHERE id = 1 AND md5(data::text) = $1',
    [hash, JSON.stringify(db)],
  );
  return upd.rowCount === 1;
}

// ── Arquivo JSON (dev local) ───────────────────────────────
function fileRead(): DB {
  if (!fs.existsSync(FILE)) return emptyDB();
  const raw = fs.readFileSync(FILE, 'utf8');
  if (!raw.trim()) return emptyDB();
  // FAIL-CLOSED também em dev: JSON corrompido lança, não vira vazio.
  return normalizeDB(JSON.parse(raw));
}

function fileWrite(db: DB): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  try {
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
  } catch {
    /* backup é melhor-esforço: nunca pode quebrar a escrita */
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

// ── Retenção (teto contra crescimento infinito) ─────────────
const MAX_EVENTS_PER_BUSINESS = 3000;
const VOLATILE_EVENT_MAX_AGE_MS = 90 * 86400000; // page_view/ai_started
const VOLATILE_TYPES = new Set(['page_view', 'ai_started', 'ai_recommendation']);

const MAX_AUDIT_ENTRIES = 5000;

// P4 — teto das execuções TERMINAIS de automação por unidade (o histórico vivo
// — queued/running/waiting — nunca é podado: perder estado de espera é perder a
// automação). Tarefas concluídas/canceladas saem depois de 180 dias.
const MAX_FINISHED_RUNS_PER_BUSINESS = 200;
const RUN_RETENTION_MS = 30 * 86400000;
const TASK_RETENTION_MS = 180 * 86400000;
const MAX_AI_PROPOSALS_PER_BUSINESS = 80;
const AI_PROPOSAL_RETENTION_MS = 180 * 86400000;


function prune(db: DB): void {
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  // Sessões de suporte: encerradas/vencidas saem (auditoria permanece).
  db.supportSessions = db.supportSessions.filter(
    (s) => !s.endedAt && new Date(s.expiresAt).getTime() > now,
  );
  // Auditoria administrativa: teto simples (mais recentes primeiro).
  if (db.audit.length > MAX_AUDIT_ENTRIES) {
    db.audit = db.audit.slice(db.audit.length - MAX_AUDIT_ENTRIES);
  }
  // Execuções de automação: mantém as vivas sempre; das terminais, as mais
  // recentes de cada unidade dentro da janela de retenção.
  if (db.automationRuns.length > 0) {
    const perBiz = new Map<string, number>();
    const cutoff = now - RUN_RETENTION_MS;
    const keptRuns: typeof db.automationRuns = [];
    for (let i = db.automationRuns.length - 1; i >= 0; i--) {
      const r = db.automationRuns[i];
      const live = r.status === 'queued' || r.status === 'running' || r.status === 'waiting';
      if (!live) {
        const finished = Date.parse(r.finishedAt || r.updatedAt || '');
        if (Number.isFinite(finished) && finished < cutoff) continue;
        const n = perBiz.get(r.businessId) || 0;
        if (n >= MAX_FINISHED_RUNS_PER_BUSINESS) continue;
        perBiz.set(r.businessId, n + 1);
      }
      keptRuns.push(r);
    }
    db.automationRuns = keptRuns.reverse();
  }
  // Tarefas: as abertas ficam para sempre (é pendência real); as encerradas
  // saem só depois de meio ano.
  if (db.tasks.length > 0) {
    db.tasks = db.tasks.filter((t) => {
      if (t.status === 'open') return true;
      const at = Date.parse(t.doneAt || t.updatedAt || t.createdAt || '');
      return !Number.isFinite(at) || at > now - TASK_RETENTION_MS;
    });
  }
  // P6 — log de integrações: teto por unidade (as mais recentes ficam) e
  // janela de retenção. Linhas terminais antigas saem; duplicatas (ruído de
  // reentrega) saem antes. Nenhuma conexão é removida por prune — apagar
  // conexão é decisão do lojista (e o log dela vai junto, por escolha dele).
  if (Array.isArray(db.integrationEvents) && db.integrationEvents.length > 0) {
    const perBiz = new Map<string, number>();
    const kept: typeof db.integrationEvents = [];
    for (let i = db.integrationEvents.length - 1; i >= 0; i--) {
      const e = db.integrationEvents[i];
      const at = Date.parse(e.at || '');
      const retention = e.status === 'duplicate'
        ? INTEGRATION_DUPLICATE_RETENTION_MS
        : INTEGRATION_EVENT_RETENTION_MS;
      if (Number.isFinite(at) && at < now - retention) continue;
      const n = perBiz.get(e.businessId) || 0;
      if (n >= MAX_INTEGRATION_EVENTS_PER_BUSINESS) continue;
      perBiz.set(e.businessId, n + 1);
      kept.push(e);
    }
    db.integrationEvents = kept.reverse();
  }
  // P5 — propostas: rascunhos/aprovadas ficam (é trabalho do lojista);
  // publicadas/canceladas saem depois da janela, com teto por unidade.
  if (Array.isArray(db.aiProposals) && db.aiProposals.length > 0) {
    const perBiz = new Map<string, number>();
    const kept: typeof db.aiProposals = [];
    for (let i = db.aiProposals.length - 1; i >= 0; i--) {
      const p = db.aiProposals[i];
      const live = p.status === 'draft' || p.status === 'approved';
      if (!live) {
        const at = Date.parse(p.updatedAt || p.createdAt || '');
        if (Number.isFinite(at) && at < now - AI_PROPOSAL_RETENTION_MS) continue;
      }
      const n = perBiz.get(p.businessId) || 0;
      if (!live && n >= MAX_AI_PROPOSALS_PER_BUSINESS) continue;
      perBiz.set(p.businessId, n + 1);
      kept.push(p);
    }
    db.aiProposals = kept.reverse();
  }
  db.customerSessions = db.customerSessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  db.passwordResets = db.passwordResets.filter(
    (r) => !r.usedAt && new Date(r.expiresAt).getTime() > now,
  );
  if (db.events.length === 0) return;
  const cutoff = new Date(now - VOLATILE_EVENT_MAX_AGE_MS).toISOString();
  const kept: typeof db.events = [];
  const perBiz = new Map<string, number>();
  // percorre do mais novo ao mais antigo
  for (let i = db.events.length - 1; i >= 0; i--) {
    const e = db.events[i];
    if (VOLATILE_TYPES.has(e.type) && e.createdAt < cutoff) continue;
    const n = perBiz.get(e.businessId) || 0;
    if (n >= MAX_EVENTS_PER_BUSINESS) continue;
    perBiz.set(e.businessId, n + 1);
    kept.push(e);
  }
  db.events = kept.reverse();
}

// ── API pública (sempre async) ──────────────────────────────
export async function readDB(): Promise<DB> {
  if (usePg()) return pgRead();
  return fileRead();
}

export async function writeDB(db: DB): Promise<void> {
  if (usePg()) return pgWrite(db);
  return fileWrite(db);
}

// Mutex por instância: serializa read-modify-write concorrentes.
let writeChain: Promise<unknown> = Promise.resolve();

/** Enfileira uma operação na mesma fila de escrita (uma por vez, por instância). */
function withWriteLock<T>(run: () => Promise<T>): Promise<T> {
  const p = writeChain.then(run, run);
  writeChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

export async function updateDB<T>(fn: (db: DB) => T): Promise<Awaited<T>> {
  const run = async (): Promise<Awaited<T>> => {
    const db = await readDB(); // falhou? lança — NADA é escrito
    // O callback pode ser assíncrono (ex.: disparo de webhook, que enfileira a
    // entrega depois da 1ª tentativa HTTP): aguardamos a conclusão para que
    // TODAS as mutações entrem na MESMA gravação. Sem isso, mutações feitas
    // depois de um `await` dentro do callback eram perdidas na escrita.
    const result: Awaited<T> = await fn(db); // callback lançou? nada é escrito
    prune(db);
    await writeDB(db);
    // P4 — só há trabalho quando existe execução pronta AGORA (fila, espera
    // vencida ou posse morta): checamos o documento que acabamos de gravar
    // (sem leitura extra) e agendamos o motor.
    if (hasDueAutomationWork(db)) maybeRunAutomations();
    return result;
  };
  return withWriteLock(run);
}

// ── P4: gancho de execução imediata (melhor esforço, nunca bloqueante) ──
// Se uma mutação deixou execução na fila, o motor processa na hora — o usuário
// não espera o cron, e a rota não precisa conhecer automação nenhuma (um ponto
// de acionamento só). Custos evitados de propósito:
//   • nenhuma leitura extra quando não há fila (checagem no objeto já gravado);
//   • nenhum `await` no caminho do pedido (agendado, com erro engolido);
//   • nenhuma recursão (flag de execução ativa) e nenhum efeito no caminho de
//     escrita do PRÓPRIO motor (`updateDBWithCas` não agendou nada);
//   • desligável por AUTOMATION_INLINE=0 (testes determinísticos).
// O gatilho é “existe algo PRONTO AGORA”, a mesma pergunta que
// `isAutomationRunDue` faz no motor: fila `queued`, espera vencida ou execução
// com posse morta. Isso importa porque o agendador é EXTERNO ao app (no Vercel
// Hobby não há cron por minuto): checagem só por `queued` deixaria uma espera
// vencida paradinha até que outro evento criasse fila ou alguém clicasse no
// painel. Quem decide o que processar continua sendo o banco (CAS + lease).
let automationDrainActive = false;

/** Existe execução pronta para processar neste documento (agora)? */
function hasDueAutomationWork(db: DB): boolean {
  if (!Array.isArray(db.automationRuns) || db.automationRuns.length === 0) return false;
  const now = Date.now();
  for (let i = db.automationRuns.length - 1; i >= 0; i--) {
    const r = db.automationRuns[i];
    if (r.status === 'queued') return true;
    if (r.status === 'waiting') {
      const at = Date.parse(r.waitingUntil || '');
      // Espera ilegível conta como vencida (o motor decide igual: não trava a fila).
      if (!Number.isFinite(at) || at <= now) return true;
    }
    if (r.status === 'running') {
      // Instância interrompida: posse expirada ⇒ este ciclo pode reassumir.
      const lease = Date.parse(r.claimExpiresAt || '');
      if (!Number.isFinite(lease) || lease <= now) return true;
    }
  }
  return false;
}

function maybeRunAutomations(): void {
  if (automationDrainActive) return;
  if (process.env.AUTOMATION_INLINE === '0') return;
  automationDrainActive = true;
  setTimeout(() => {
    import('./automation/executor')
      .then((m) => m.drainAutomations({ limit: AUTOMATION_INLINE_BATCH }))
      .catch(() => { /* automação não derruba a operação nem o write */ })
      .finally(() => { automationDrainActive = false; });
  }, 0);
}

const AUTOMATION_INLINE_BATCH = 8;

/** Resultado de uma escrita condicional: `applied: false` = nada foi gravado. */
export interface CasWriteResult<T> {
  applied: boolean;
  result: T | null;
}

export interface CasWriteOptions {
  /**
   * Avaliado sobre a leitura mais fresca ANTES de mutar. Se retornar `false`,
   * nada é gravado (útil para evitar escrita inútil quando não há trabalho).
   */
  guard?: (db: DB) => boolean;
  /** Tentativas em caso de conflito (Postgres). Padrão: 4. */
  attempts?: number;
}

/**
 * Escrita condicional (CAS): `fn` roda sobre a leitura mais fresca possível e
 * a gravação só acontece se o documento não tiver mudado nesse meio-tempo.
 *
 * Uso pensado para tarefas concorrentes que NÃO podem duplicar efeito
 * (ex.: consumidor de retry de webhooks): a decisão ("reivindicar a entrega X")
 * e a gravação acontecem de forma indivisível — a segunda execução encontra
 * a decisão da primeira já gravada e desiste.
 *
 * - Postgres: `UPDATE ... WHERE md5(data::text) = <hash lido>`; em conflito,
 *   relê e reaplica (até `attempts` vezes).
 * - Arquivo local: mesma fila de escrita de `updateDB` (uma operação por vez).
 *
 * `fn` deve ser idempotente em relação ao `db` recebido (pode rodar mais de
 * uma vez quando houver conflito) e NÃO deve conter I/O longo (HTTP etc.).
 */
export async function updateDBWithCas<T>(
  fn: (db: DB) => T,
  options: CasWriteOptions = {},
): Promise<CasWriteResult<Awaited<T>>> {
  const attempts = Math.max(1, options.attempts ?? 4);

  if (!usePg()) {
    // Modo arquivo: o mutex já torna leitura+escrita indivisíveis aqui.
    return withWriteLock(async () => {
      const db = fileRead(); // falhou? lança — NADA é escrito
      if (options.guard && !options.guard(db)) return { applied: false, result: null };
      // Callback assíncrono (quando houver) entra na MESMA gravação.
      const result: Awaited<T> = await fn(db);
      prune(db);
      fileWrite(db);
      return { applied: true, result };
    });
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { db, hash } = await pgReadCas();
    if (options.guard && !options.guard(db)) return { applied: false, result: null };
    const result: Awaited<T> = await fn(db);
    prune(db);
    if (await pgCasWrite(hash, db)) return { applied: true, result };
  }
  // Conflito persistente: melhor não gravar (fail-safe) do que sobrescrever
  // uma decisão alheia — a próxima execução da tarefa tenta de novo.
  return { applied: false, result: null };
}
