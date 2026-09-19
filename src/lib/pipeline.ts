// ═══════════════════════════════════════════════════════════════
// ESTEIRA OPERACIONAL & ENTRADA UNIVERSAL DE LEADS (P3)
// ═══════════════════════════════════════════════════════════════
// Núcleo operacional agnóstico ao nicho:
//  - Pipeline configurável por Business com estágios internos estáveis;
//  - Entrada universal normalizada com deduplicação e preservação de origem;
//  - Atribuição de responsável e histórico append-only de movimentações;
//  - Ponte direta para agendamento (saída da esteira sem duplicar booking);
//  - Interfaces claras para consumo direto da interface, APIs externas e
//    futura inteligência conversacional (P4).

import { randomUUID } from 'node:crypto';
import type {
  Booking, Business, BusinessCustomer, BusinessPipeline, DB,
  Lead, LeadNote, LeadPriority, LeadStageHistory, LeadStatus,
  PipelineStage, Service, User,
} from './types';
import { onlyDigits } from './utils';
import { upsertContact, addContactNote, findContact } from './contacts';
import { createBookingTx } from './booking-create';
// P4 — ônibus de gatilhos. Chamado AQUI (e não em cada rota) para que todo
// caminho que produz o evento dispare a automação: painel, API externa,
// assistente e widget usam exatamente estas funções. `emitAutomationEvent` é
// puro sobre o db recebido e NUNCA lança (a operação do usuário vem primeiro).
import { emitAutomationEvent } from './automation/events';

export const DEFAULT_PIPELINE_STAGES: PipelineStage[] = [
  { id: 'new', name: 'Novo', order: 0, color: 'blue', mappedStatus: 'new', isSystem: true },
  { id: 'in_progress', name: 'Em atendimento', order: 1, color: 'amber', mappedStatus: 'contacted', isSystem: true },
  { id: 'qualifying', name: 'Qualificando', order: 2, color: 'purple', mappedStatus: 'contacted', isSystem: true },
  { id: 'qualified', name: 'Qualificado', order: 3, color: 'emerald', mappedStatus: 'qualified', isSystem: true },
  { id: 'waiting_secretary', name: 'Aguardando secretaria', order: 4, color: 'orange', mappedStatus: 'contacted', isSystem: true },
  { id: 'scheduled', name: 'Agendado', order: 5, color: 'emerald', mappedStatus: 'converted', isSystem: true },
  { id: 'converted', name: 'Concluído', order: 6, color: 'emerald', isTerminal: true, mappedStatus: 'converted', isSystem: true },
  { id: 'lost', name: 'Perdido', order: 7, color: 'red', isTerminal: true, mappedStatus: 'lost', isSystem: true },
];

export const SIMPLE_STAGE_IDS = ['new', 'in_progress', 'scheduled', 'converted'];

/** Obtém a esteira configurada do negócio (ou cria padrão defensivo). */
export function getBusinessPipeline(db: DB, businessId: string): BusinessPipeline {
  if (!Array.isArray(db.pipelines)) db.pipelines = [];
  let p = db.pipelines.find((x) => x.businessId === businessId);
  if (!p) {
    p = {
      id: randomUUID(),
      businessId,
      stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s })),
      updatedAt: new Date().toISOString(),
    };
    db.pipelines.push(p);
  }
  return p;
}

/** Etapas estruturais: devem existir em QUALQUER pipeline customizado. */
export const STRUCTURAL_STAGE_IDS = ['new', 'scheduled', 'converted'] as const;

/** Atualiza os estágios da esteira do negócio preservando IDs válidos. */
export function updateBusinessPipeline(
  db: DB,
  businessId: string,
  newStages: Partial<PipelineStage>[],
): BusinessPipeline {
  const current = getBusinessPipeline(db, businessId);
  const now = new Date().toISOString();

  const validated: PipelineStage[] = [];
  let order = 0;
  for (const st of newStages) {
    const id = String(st.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32);
    const name = String(st.name || '').trim().slice(0, 60);
    if (!id || !name) continue;
    const def = DEFAULT_PIPELINE_STAGES.find((d) => d.id === id);
    validated.push({
      id,
      name,
      order: typeof st.order === 'number' ? st.order : order++,
      color: st.color || def?.color || 'zinc',
      isTerminal: st.isTerminal ?? def?.isTerminal ?? false,
      isSystem: def?.isSystem ?? false,
      mappedStatus: st.mappedStatus || def?.mappedStatus || 'contacted',
    });
  }

  // Garante etapas estruturais: new (sempre primeira), scheduled (antes de converted), converted
  // — sem duplicação, ordem garantida independente da entrada.
  if (!validated.some((s) => s.id === 'new')) {
    validated.unshift({ ...DEFAULT_PIPELINE_STAGES[0] });
  } else {
    // força new para primeira posição preservando o objeto original
    const idx = validated.findIndex((s) => s.id === 'new');
    if (idx > 0) {
      const [newStage] = validated.splice(idx, 1);
      validated.unshift(newStage);
    }
  }
  if (!validated.some((s) => s.id === 'scheduled')) {
    const defScheduled = DEFAULT_PIPELINE_STAGES.find((s) => s.id === 'scheduled')!;
    // Insere antes de converted se já existe converted, senão no fim
    const convertedIdx = validated.findIndex((s) => s.id === 'converted');
    if (convertedIdx >= 0) validated.splice(convertedIdx, 0, { ...defScheduled });
    else validated.push({ ...defScheduled });
  }
  if (!validated.some((s) => s.id === 'converted')) {
    validated.push({ ...DEFAULT_PIPELINE_STAGES[6] });
  }

  // Corrige duplicatas de ID mantendo primeiro
  const seen = new Set<string>();
  const deduped: PipelineStage[] = [];
  for (const s of validated) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    deduped.push(s);
  }
  // Re-garante ordem estrutural após dedupe (new primeiro, scheduled antes de converted)
  const newIdx = deduped.findIndex((s)=> s.id==='new');
  if (newIdx>0) { const [ns]=deduped.splice(newIdx,1); deduped.unshift(ns); }
  const schedIdx = deduped.findIndex((s)=> s.id==='scheduled');
  const convIdx = deduped.findIndex((s)=> s.id==='converted');
  if (schedIdx>=0 && convIdx>=0 && schedIdx>convIdx) {
    const [ns]=deduped.splice(schedIdx,1); deduped.splice(convIdx,0,ns);
  }
  // A3 fechamento — semântica estrutural sempre preservada (nome/cor podem mudar)
  for (const s of deduped) {
    if (s.id === 'new') {
      s.isSystem = true;
      s.isTerminal = false;
      s.mappedStatus = 'new';
    } else if (s.id === 'scheduled') {
      s.isSystem = true;
      s.isTerminal = false;
      s.mappedStatus = 'converted';
    } else if (s.id === 'converted') {
      s.isSystem = true;
      s.isTerminal = true;
      s.mappedStatus = 'converted';
    }
  }
  // Normaliza order sequencial preservando posição atual
  deduped.forEach((s, idx) => { s.order = idx; });

  current.stages = deduped;
  current.updatedAt = now;
  return current;
}

export function mapStageToStatus(pipeline: BusinessPipeline, stageId: string): LeadStatus {
  const stage = pipeline.stages.find((s) => s.id === stageId);
  if (stage?.mappedStatus) return stage.mappedStatus;
  if (stageId === 'new') return 'new';
  if (stageId === 'scheduled' || stageId === 'converted') return 'converted';
  if (stageId === 'lost') return 'lost';
  if (stageId === 'qualified') return 'qualified';
  return 'contacted';
}

// ═══════════════════════════════════════════════════════════════
// A1.2 · BLOCO 2 — UMA ÚNICA MÁQUINA DE ESTADOS (F1 · F2 · F3)
// ═══════════════════════════════════════════════════════════════
// `PipelineStage` é a ÚNICA máquina de estados oficial do lead. O antigo
// `LeadStatus` (new/contacted/qualified/converted/lost) permanece somente
// como PROJEÇÃO derivada e read-only (`mapStageToStatus`) — exigida por
// compatibilidade (selos, condições do P4, APIs antigas).
//
// ESCRITA (F1): nenhuma entrada escreve `stageId` diretamente. Entrada
// legada em `LeadStatus` é convertida EXPLICITAMENTE para uma etapa válida
// (`stageForLegacyStatus`) e passa pelo mecanismo oficial (`moveLeadStage`).
//
// LEITURA (F3): estágio ausente/inválido/inexistente NUNCA quebra nem vira
// comportamento silenciosamente incoerente — é normalizado por
// `normalizeLeadStageId` com fallback EXPLÍCITO (primeira etapa da esteira
// do negócio). Nenhuma etapa é inventada: só existem as do negócio.
//
// F2 — inventário dos usos legados de LeadStatus restantes (classificação):
//   • leitura/projeção: mapStageToStatus, selos em LEAD_STATUS (lib/status),
//     clientes/page.tsx (badge do histórico 360);
//   • compatibilidade: PATCH /api/leads aceita `status` e CONVERTE (não
//     escreve mais estado por ele);
//   • filtros: GET /api/leads e /api/external/leads comparam pela etapa
//     NORMALIZADA (nunca pelo status cru);
//   • histórico: LeadStageHistory registra apenas etapas reais;
//   • P4: condições `lead.status` continuam válidas porque o status é sempre
//     recalculado a partir da etapa (projeção consistente).
//
// A resolução/normalização em si vive em `lib/pipeline-stages.ts` (módulo
// PURO, sem node:crypto) para poder ser usada também pela UI do funil.
export {
  STAGE_ALIASES, LEGACY_LEAD_STATUSES, isLegacyLeadStatus, stagesInOrder,
  stageForLegacyStatus, resolveStageId, normalizeLeadStageId, type ResolvedStage,
} from './pipeline-stages';
import { normalizeLeadStageId, resolveStageId, STAGE_ALIASES } from './pipeline-stages';

// ═══════════════════════════════════════════════════════════════
// ENTRADA NORMALIZADA DE LEADS (UNIVERSAL)
// ═══════════════════════════════════════════════════════════════

/** Origem de um evento: a execução de automação que o produziu (anti-loop). */
export interface AutomationOrigin {
  runId?: string;
  automationId?: string;
}

export interface LeadActor {
  id?: string;
  name?: string;
  role?: string;
  type?: 'system' | 'user' | 'api' | 'agent' | 'customer';
}

export interface IngestLeadInput {
  businessId: string;
  name?: string;
  phone?: string;
  email?: string;
  instagram?: string;
  message?: string;
  interest?: string;
  source?: string; // origin e.g. 'external_site', 'landing_page', 'public_page', 'whatsapp', 'api', 'manual'
  channel?: string;
  sourceUrl?: string;
  serviceId?: string;
  professionalId?: string;
  priority?: LeadPriority;
  assignedUserId?: string;
  stageId?: string;
  customerId?: string;
  metadata?: Record<string, any>;
  actor?: LeadActor;
  now?: string;
  /** P4 — quando o evento vem de uma automação (proteção contra reentrada). */
  origin?: AutomationOrigin;
}

/**
 * Validação centralizada de integridade para atribuição de responsável ao lead.
 * O usuário deve:
 * 1. Existir no sistema;
 * 2. Estar ativo (user.active !== false);
 * 3. Estar associado a esta unidade específica (dono da unidade ou membro com acesso ativo).
 * Usuário de outra unidade/negócio, outra organização, inexistente ou inativo é rejeitado.
 * Retorna { valid: true } quando userId for vazio/nulo (desatribuição permitida).
 */
export function validateAssignedUser(
  db: DB,
  businessId: string,
  userId?: string | null,
): { valid: boolean; user?: User; error?: string } {
  if (!userId || !userId.trim()) {
    return { valid: true };
  }
  const cleanId = userId.trim();
  const user = (db.users || []).find((u) => u.id === cleanId);
  if (!user) {
    return { valid: false, error: 'Usuário informado não existe no sistema.' };
  }
  if (user.active === false) {
    return { valid: false, error: 'Usuário informado está inativo.' };
  }

  const business = (db.businesses || []).find((b) => b.id === businessId);
  if (!business) {
    return { valid: false, error: 'Negócio não encontrado.' };
  }

  // É o proprietário do negócio?
  if (business.ownerId === cleanId) {
    return { valid: true, user };
  }

  // Ou é membro ativo associado a este negócio específico?
  const isMember = (db.members || []).some(
    (m) => m.businessId === businessId && m.userId === cleanId && m.active !== false,
  );

  if (!isMember) {
    return { valid: false, error: 'Usuário não pertence à equipe desta unidade.' };
  }

  return { valid: true, user };
}

/** Localiza lead existente no negócio por customerId, telefone ou email. */
export function findLead(
  db: DB,
  businessId: string,
  query: { id?: string; phone?: string; email?: string; customerId?: string },
): Lead | undefined {
  if (query.id) {
    const direct = db.leads.find((l) => l.id === query.id && l.businessId === businessId);
    if (direct) return direct;
  }
  const digits = onlyDigits(query.phone || '');
  const email = (query.email || '').trim().toLowerCase();
  const customerId = (query.customerId || '').trim();

  return db.leads.find((l) => {
    if (l.businessId !== businessId) return false;
    if (customerId && l.customerId && l.customerId === customerId) return true;
    if (digits && onlyDigits(l.phone) === digits) return true;
    if (email && l.email && l.email.toLowerCase() === email) return true;
    return false;
  });
}

/**
 * Entrada universal de leads (reutilizada por página pública, API externa,
 * integrações e futura IA).
 * - Deduplicação automática com contatos/leads existentes;
 * - Preservação estrita da origem e metadados;
 * - Inicialização da esteira e histórico append-only.
 */
export function ingestLead(db: DB, input: IngestLeadInput): {
  lead: Lead;
  isNew: boolean;
  contact: BusinessCustomer | null;
} {
  const business = db.businesses.find((b) => b.id === input.businessId);
  if (!business) {
    throw Object.assign(new Error('Negócio não encontrado.'), { status: 404 });
  }

  const now = input.now || new Date().toISOString();
  const digits = onlyDigits(input.phone || '');
  const name = (input.name || '').trim().slice(0, 80);
  const email = (input.email || '').trim().toLowerCase().slice(0, 120);
  const instagram = (input.instagram || '').trim().slice(0, 60);
  const source = (input.source || 'external_site').trim().slice(0, 40);
  const interest = (input.interest || input.message || '').trim().slice(0, 500);

  if (!name && !digits && !email) {
    throw Object.assign(new Error('Informe ao menos nome, telefone ou e-mail.'), { status: 400 });
  }

  // Validação estrita de integridade para atribuição de responsável
  if (input.assignedUserId && input.assignedUserId.trim()) {
    const check = validateAssignedUser(db, business.id, input.assignedUserId);
    if (!check.valid) {
      throw Object.assign(new Error(check.error || 'Usuário responsável inválido.'), { status: 422 });
    }
  }

  const pipeline = getBusinessPipeline(db, business.id);

  // 1. Garante Contato no CRM (upsert idempotente, nunca duplica pessoa)
  const contactExistedBefore = !!findContact(db, business.id, input.customerId || '', digits, name, email);
  const contact = upsertContact(db, {
    businessId: business.id,
    customerId: input.customerId,
    name,
    phone: digits,
    email,
    source,
    now,
  });

  // 2. Busca lead existente
  const existing = findLead(db, business.id, {
    customerId: input.customerId || contact?.customerId || '',
    phone: digits,
    email,
  });

  const actorName = input.actor?.name || (input.actor?.type === 'api' ? 'API Externa' : 'Sistema');
  const actorId = input.actor?.id || 'system';

  if (existing) {
    // Atualização cumulativa: preserva a origem original e agrega novos dados
    if (name && !existing.name) existing.name = name;
    if (digits && !existing.phone) existing.phone = digits;
    if (email && !existing.email) existing.email = email;
    if (instagram && !existing.instagram) existing.instagram = instagram;
    if (interest) existing.interest = interest;
    if (input.customerId && !existing.customerId) existing.customerId = input.customerId;
    if (input.sourceUrl) existing.sourceUrl = input.sourceUrl;
    if (input.serviceId) existing.serviceId = input.serviceId;
    if (input.professionalId) existing.professionalId = input.professionalId;
    if (input.assignedUserId && !existing.assignedUserId) existing.assignedUserId = input.assignedUserId;
    if (input.priority) existing.priority = input.priority;
    if (input.channel && !(existing as any).channel) (existing as any).channel = input.channel;

    if (input.metadata && typeof input.metadata === 'object') {
      existing.metadata = { ...(existing.metadata || {}), ...input.metadata };
    }

    existing.lastInteraction = now;

    // Se veio mensagem ou nota, adiciona ao histórico de observações
    if (input.message) {
      if (!Array.isArray(existing.notes)) existing.notes = [];
      existing.notes.push({
        id: randomUUID(),
        at: now,
        by: actorId,
        byName: actorName,
        text: input.message.slice(0, 1000),
      });
    }

    // P4 — gatilho de atualização, DEPOIS de aplicar as mudanças (a fotografia
    // do contexto é o estado real; a criação é tratada no ramo de novo lead).
    emitLeadIngestEvents(db, business.id, existing, {
      isNew: false, contact, contactExistedBefore, origin: input.origin, now,
    });

    return { lead: existing, isNew: false, contact };
  }

  // 3. Novo Lead
  // A1.2 · Bloco 2 (F1): a etapa inicial é resolvida contra a esteira REAL do
  // negócio — aliases e LeadStatus legado são convertidos, e entrada
  // desconhecida/inválida nunca é persistida (fallback explícito na 1ª etapa).
  const { stageId: initialStageId } = resolveStageId(pipeline, input.stageId || 'new');
  // A3 fechamento — scheduled nunca nasce sem agendamento real
  if (initialStageId === SCHEDULED_STAGE_ID) {
    throw Object.assign(new Error('Agendado requer um agendamento real. Use o fluxo de agendamento.'), { status: 422 });
  }
  const initialStatus = mapStageToStatus(pipeline, initialStageId);
  const leadId = randomUUID();

  const stageHistory: LeadStageHistory[] = [{
    id: randomUUID(),
    fromStage: '',
    toStage: initialStageId,
    movedBy: actorId,
    movedByName: actorName,
    at: now,
    note: input.message ? 'Entrada com mensagem' : 'Entrada de lead',
  }];

  const notes: LeadNote[] = [];
  if (input.message) {
    notes.push({
      id: randomUUID(),
      at: now,
      by: actorId,
      byName: actorName,
      text: input.message.slice(0, 1000),
    });
  }

  const newLead: Lead = {
    id: leadId,
    businessId: business.id,
    customerId: input.customerId || contact?.customerId || '',
    name,
    phone: digits,
    email,
    instagram,
    origin: source,
    channel: input.channel || '',
    interest,
    action: 'contato',
    status: initialStatus,
    stageId: initialStageId,
    assignedUserId: input.assignedUserId || '',
    priority: input.priority || 'medium',
    nextAction: '',
    serviceId: input.serviceId || '',
    professionalId: input.professionalId || '',
    sourceUrl: input.sourceUrl || '',
    metadata: input.metadata || {},
    notes,
    stageHistory,
    createdAt: now,
    lastInteraction: now,
  };

  db.leads.push(newLead);
  db.events.push({
    id: randomUUID(),
    businessId: business.id,
    type: 'lead_created',
    path: '',
    meta: { origin: source, stageId: initialStageId },
    createdAt: now,
  });
  db.events.push({
    id: randomUUID(),
    businessId: business.id,
    type: 'conversion',
    path: '',
    meta: { kind: 'lead' },
    createdAt: now,
  });

  // P4 — gatilhos do ciclo de vida (lead + entrada na base de clientes).
  emitLeadIngestEvents(db, business.id, newLead, {
    isNew: true, contact, contactExistedBefore, origin: input.origin, now,
  });

  return { lead: newLead, isNew: true, contact };
}

// ═══════════════════════════════════════════════════════════════
// P4 — GATILHOS (o evento nasce no serviço oficial, não na rota)
// ═══════════════════════════════════════════════════════════════
// Emissão SEMPRE no fim de uma mutação real, dentro da MESMA transação: ou o
// lead muda e o gatilho existe, ou nada acontece — não há janela em que o
// evento se perde. `emitAutomationEvent` nunca lança: automação quebrada não
// pode estragar a operação de quem está usando o sistema.

function emitLeadIngestEvents(
  db: DB,
  businessId: string,
  lead: Lead,
  info: {
    isNew: boolean;
    contact: BusinessCustomer | null;
    contactExistedBefore: boolean;
    origin?: AutomationOrigin;
    now: string;
  },
): void {
  emitAutomationEvent(db, {
    event: info.isNew ? 'lead.created' : 'lead.updated',
    businessId,
    at: info.now,
    leadId: lead.id,
    data: { isNew: info.isNew, stageId: lead.stageId || lead.status || 'new' },
    fromRunId: info.origin?.runId,
  });
  if (!info.contact) return;
  emitAutomationEvent(db, {
    event: info.contactExistedBefore ? 'customer.updated' : 'customer.created',
    businessId,
    at: info.now,
    customerId: info.contact.id,
    leadId: lead.id,
    data: { source: info.contact.source || '' },
    fromRunId: info.origin?.runId,
  });
}

/**
 * Atualiza campos de lead (a MESMA função usada pelo painel — a automação não
 * tem caminho paralelo de escrita). `Lead.lastInteraction` é sempre tocado.
 */
export function updateLeadFields(
  db: DB,
  input: {
    businessId: string;
    leadId: string;
    patch: Partial<Pick<Lead, 'priority' | 'interest' | 'nextAction' | 'name' | 'email' | 'phone' | 'instagram' | 'serviceId' | 'professionalId' | 'sourceUrl'>> & { metadata?: Record<string, any> };
    actor?: LeadActor;
    now?: string;
    origin?: AutomationOrigin;
  },
): Lead {
  const lead = db.leads.find((l) => l.id === input.leadId && l.businessId === input.businessId);
  if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });

  const now = input.now || new Date().toISOString();
  const patch = input.patch || {};
  const changed: string[] = [];

  if (typeof patch.priority === 'string' && ['low', 'medium', 'high', 'urgent'].includes(patch.priority)) {
    if (lead.priority !== patch.priority) changed.push('prioridade');
    lead.priority = patch.priority as LeadPriority;
  }
  for (const key of ['name', 'email', 'instagram', 'nextAction', 'serviceId', 'professionalId', 'sourceUrl'] as const) {
    const raw = patch[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if ((lead as any)[key] !== value) changed.push(key);
    (lead as any)[key] = key === 'name' ? value.slice(0, 80)
      : key === 'email' ? value.toLowerCase().slice(0, 120)
      : key === 'instagram' ? value.slice(0, 60)
      : value.slice(0, 300);
  }
  if (typeof patch.interest === 'string' && patch.interest.trim()) {
    const value = patch.interest.trim().slice(0, 500);
    if (lead.interest !== value) changed.push('interesse');
    lead.interest = value;
  }
  if (typeof patch.phone === 'string') {
    const digits = onlyDigits(patch.phone);
    if (digits && lead.phone !== digits) { lead.phone = digits; changed.push('telefone'); }
  }
  if (patch.metadata && typeof patch.metadata === 'object') {
    lead.metadata = { ...(lead.metadata || {}), ...patch.metadata };
    changed.push('metadata');
  }

  lead.lastInteraction = now;
  emitAutomationEvent(db, {
    event: 'lead.updated',
    businessId: input.businessId,
    at: now,
    leadId: lead.id,
    data: { changed: changed.join(','), by: input.actor?.id || 'automation' },
    fromRunId: input.origin?.runId,
  });
  return lead;
}

// ═══════════════════════════════════════════════════════════════
// OPERAÇÕES NA ESTEIRA (MOVIMENTAÇÃO, ATRIBUIÇÃO, OBSERVAÇÕES)
// ═══════════════════════════════════════════════════════════════

export interface MoveLeadStageParams {
  businessId: string;
  leadId: string;
  toStageId: string;
  note?: string;
  actor: { id: string; name: string; role?: string };
  now?: string;
  /** P4 — execução que originou o movimento (anti-loop). */
  origin?: AutomationOrigin;
  /** A3 — scheduled só via helper oficial (default false). */
  allowScheduledTransition?: boolean;
}

export function moveLeadStage(db: DB, p: MoveLeadStageParams): Lead {
  const lead = db.leads.find((l) => l.id === p.leadId && l.businessId === p.businessId);
  if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });

  const pipeline = getBusinessPipeline(db, p.businessId);
  const targetId = STAGE_ALIASES[p.toStageId] || p.toStageId;
  const targetStage = pipeline.stages.find((s) => s.id === p.toStageId || s.id === targetId);
  if (!targetStage) {
    throw Object.assign(new Error(`Etapa "${p.toStageId}" não existe na esteira deste negócio.`), { status: 422 });
  }
  // A3 fechamento — scheduled é estrutural de agenda: só via markLeadScheduled
  const now = p.now || new Date().toISOString();
  // A1.2 · Bloco 2 (F3): o "de onde saiu" registrado no histórico é a etapa
  // NORMALIZADA — registro legado (ex.: stageId cru "contacted") não entra.
  const fromStage = normalizeLeadStageId(pipeline, lead);
  // A3 fechamento — scheduled só via markLeadScheduled (autorizado)
  // No-op (mesma etapa) é reparo silencioso e não é transição — permitido
  if (targetStage.id === SCHEDULED_STAGE_ID && !p.allowScheduledTransition && fromStage !== targetStage.id) {
    throw Object.assign(new Error('Agendado requer um agendamento real. Use o fluxo de agendamento.'), { status: 422 });
  }
  // A3 — idempotência: mesma etapa não gera histórico/evento duplicado,
  // mas repara projeção silenciosamente se stageId/status divergiram (legado).
  if (fromStage === targetStage.id) {
    const expectedStatus = mapStageToStatus(pipeline, targetStage.id);
    let repaired = false;
    if (lead.stageId !== targetStage.id) { lead.stageId = targetStage.id; repaired = true; }
    if (lead.status !== expectedStatus) { lead.status = expectedStatus; repaired = true; }
    // não cria histórico, não emite evento, não toca lastInteraction
    return lead;
  }

  lead.stageId = targetStage.id;
  lead.status = mapStageToStatus(pipeline, targetStage.id);
  lead.lastInteraction = now;

  if (!Array.isArray(lead.stageHistory)) lead.stageHistory = [];
  lead.stageHistory.push({
    id: randomUUID(),
    fromStage,
    toStage: targetStage.id,
    movedBy: p.actor.id,
    movedByName: p.actor.name,
    at: now,
    note: p.note ? String(p.note).trim().slice(0, 300) : undefined,
  });

  // P4 — gatilho de movimentação (o painel, a API externa e a automação
  // produzem o mesmo evento, porque todos passam por esta função).
  emitAutomationEvent(db, {
    event: 'lead.stage_changed',
    businessId: p.businessId,
    at: now,
    leadId: lead.id,
    data: { fromStage, stageId: targetStage.id, note: p.note || '' },
    fromRunId: p.origin?.runId,
  });

  return lead;
}

// ═══════════════════════════════════════════════════════════════
// A2-B1 (F2) — AGENDAMENTO → ESTEIRA (helper OFICIAL de domínio)
// ═══════════════════════════════════════════════════════════════
// O caminho de booking NUNCA escreve `stageId` diretamente: todo
// "cliente agendou" passa por `markLeadScheduled`, que reutiliza a
// máquina oficial (`moveLeadStage`) — histórico coerente, status
// projetado recalculado e evento `lead.stage_changed` emitido.
//
// DECISÃO 2 — `scheduled` é ESTRUTURAL (Agenda ↔ CRM ↔ Automação):
// esteiras customizadas podem remover a etapa, então `ensureScheduledStage`
// reinsere a etapa de sistema padrão (sem tocar nas etapas do lojista).
// Um agendamento nunca pode desaparecer semanticamente no CRM nem cair
// em fallback silencioso para "Novo".
//
// DECISÃO 1 — lead TERMINAL não ganha gêmeo: o lead existente é REABERTO
// (movido para `scheduled`); o status projetado é recalculado por
// `mapStageToStatus` dentro de `moveLeadStage` — nunca fica
// `stageId=scheduled` com `status=lost`.
export const SCHEDULED_STAGE_ID = 'scheduled';

/** Garante a etapa estrutural `scheduled` na esteira do negócio (idempotente). */
export function ensureScheduledStage(db: DB, businessId: string): BusinessPipeline {
  const pipeline = getBusinessPipeline(db, businessId);
  if (pipeline.stages.some((s) => s.id === SCHEDULED_STAGE_ID)) return pipeline;
  const maxOrder = pipeline.stages.reduce((m, s) => Math.max(m, s.order || 0), 0);
  const def = DEFAULT_PIPELINE_STAGES.find((s) => s.id === SCHEDULED_STAGE_ID);
  const stage: PipelineStage = def
    ? { ...def, order: maxOrder + 1 }
    : { id: SCHEDULED_STAGE_ID, name: 'Agendado', order: maxOrder + 1, color: 'emerald', mappedStatus: 'converted', isSystem: true };
  pipeline.stages.push(stage);
  pipeline.updatedAt = new Date().toISOString();
  return pipeline;
}

export interface MarkLeadScheduledParams {
  businessId: string;
  /** Lead explícito (painel/esteira/API) — tem prioridade sobre a busca. */
  leadId?: string;
  /** Identidade para localizar o lead do cliente (fluxo público/assistente). */
  customerId?: string;
  phone?: string;
  /** Nome informado no agendamento (complementa o lead sem apagar o existente). */
  name?: string;
  /** Contexto do agendamento (vínculo + nota de histórico). */
  bookingId?: string;
  bookingDate?: string;
  bookingTime?: string;
  actor: { id: string; name: string };
  now?: string;
  /** P4 — execução que originou o agendamento (anti-loop). */
  origin?: AutomationOrigin;
}

export interface MarkLeadScheduledResult {
  lead: Lead;
  /** Etapa NORMALIZADA de onde o lead saiu. */
  fromStage: string;
  /** false = lead já estava em `scheduled` (nenhum movimento/histórico). */
  moved: boolean;
  /** true = o lead estava numa etapa terminal (perdido/concluído) e foi reaberto. */
  reopened: boolean;
}

/**
 * Move (ou cria o vínculo de) um lead para a etapa estrutural `scheduled`
 * pela MÁQUINA OFICIAL. Localiza o lead dentro do tenant, garante o destino
 * estrutural, reabre lead terminal quando aplicável, recalcula o status
 * projetado, registra histórico coerente e emite `lead.stage_changed`.
 * Retorna `null` quando não há lead correspondente (o chamador decide criar).
 */
export function markLeadScheduled(db: DB, p: MarkLeadScheduledParams): MarkLeadScheduledResult | null {
  const pipeline = ensureScheduledStage(db, p.businessId);

  let lead = p.leadId
    ? db.leads.find((l) => l.id === p.leadId && l.businessId === p.businessId)
    : undefined;
  if (!lead && (p.customerId || p.phone)) {
    const digits = onlyDigits(p.phone || '');
    const customerId = (p.customerId || '').trim();
    lead = db.leads.find((l) =>
      l.businessId === p.businessId &&
      ((customerId && l.customerId && l.customerId === customerId) ||
        (digits && onlyDigits(l.phone) === digits)),
    );
  }
  if (!lead) return null;

  const now = p.now || new Date().toISOString();
  const fromStage = normalizeLeadStageId(pipeline, lead);
  const reopened = pipeline.stages.find((s) => s.id === fromStage)?.isTerminal === true;

  // Vínculo com o agendamento e contexto do cliente (sempre — mesmo quando
  // o lead já está em `scheduled`, o agendamento novo vira o atual).
  if (p.bookingId) lead.bookingId = p.bookingId;
  if (p.name && !lead.name) lead.name = p.name;
  if (p.customerId && !lead.customerId) lead.customerId = p.customerId;
  lead.lastInteraction = now;
  lead.action = 'agendamento';

  // Já agendado: sem movimento real ⇒ sem histórico redundante (mesma
  // semântica do F7.1 na máquina de status do agendamento).
  if (fromStage === SCHEDULED_STAGE_ID) {
    // repara projeção se necessário (ex.: scheduled + status=lost legado)
    const expected = mapStageToStatus(pipeline, SCHEDULED_STAGE_ID);
    if (lead.stageId !== SCHEDULED_STAGE_ID) lead.stageId = SCHEDULED_STAGE_ID;
    if (lead.status !== expected) lead.status = expected;
    return { lead, fromStage, moved: false, reopened: false };
  }

  const note = p.bookingDate && p.bookingTime
    ? `Agendado para ${p.bookingDate} às ${p.bookingTime}`
    : 'Agendamento criado';
  moveLeadStage(db, {
    businessId: p.businessId,
    leadId: lead.id,
    toStageId: SCHEDULED_STAGE_ID,
    note,
    actor: { id: p.actor.id, name: p.actor.name },
    now,
    origin: p.origin,
    allowScheduledTransition: true,
  });
  return { lead, fromStage, moved: true, reopened };
}

/**
 * Nota de acompanhamento no histórico do lead quando o agendamento vinculado
 * é REMARCADO (A2-B3 · F7.2): a nota "Agendado para …" da etapa `scheduled`
 * não pode ficar apontando para o dia/horário antigo. Segue o padrão do
 * `assignLead`: entrada de histórico sem mudança de etapa, append-only.
 */
export const CONVERTED_STAGE_ID = 'converted';

/** Garante a etapa estrutural `converted` (idempotente). */
export function ensureConvertedStage(db: import('./types').DB, businessId: string): import('./types').BusinessPipeline {
  const pipeline = getBusinessPipeline(db, businessId);
  if (pipeline.stages.some((s) => s.id === CONVERTED_STAGE_ID)) return pipeline;
  const maxOrder = pipeline.stages.reduce((m, s) => Math.max(m, s.order || 0), 0);
  const def = DEFAULT_PIPELINE_STAGES.find((s) => s.id === CONVERTED_STAGE_ID);
  const stage: import('./types').PipelineStage = def ? { ...def, order: maxOrder + 1 } : { id: CONVERTED_STAGE_ID, name: 'Concluído', order: maxOrder + 1, color: 'emerald', isTerminal: true, mappedStatus: 'converted', isSystem: true };
  pipeline.stages.push(stage);
  pipeline.updatedAt = new Date().toISOString();
  return pipeline;
}

export interface MarkLeadConvertedParams {
  businessId: string;
  leadId?: string;
  bookingId?: string;
  actor: { id: string; name: string };
  now?: string;
  origin?: AutomationOrigin;
}

/**
 * A3.16 — CONCLUÍDO: booking completed ⇒ lead convertido.
 * Helper OFICIAL: usa a máquina moveLeadStage (nunca escreve stageId direto).
 * Idempotente: se já está em converted, não gera histórico/evento.
 */
export function markLeadConverted(db: import('./types').DB, p: MarkLeadConvertedParams): { lead: import('./types').Lead; moved: boolean } | null {
  ensureConvertedStage(db, p.businessId);
  let lead: import('./types').Lead | undefined;
  if (p.leadId) lead = db.leads.find((l) => l.id === p.leadId && l.businessId === p.businessId);
  if (!lead && p.bookingId) {
    const booking = db.bookings.find((b) => b.id === p.bookingId && b.businessId === p.businessId);
    if (booking?.leadId) lead = db.leads.find((l) => l.id === booking.leadId && l.businessId === p.businessId);
    if (!lead && booking) {
      const digits = onlyDigits(booking.customerPhone || '');
      const cid = (booking.customerId || '').trim();
      lead = db.leads.find((l) => l.businessId === p.businessId && ((cid && l.customerId === cid) || (digits && onlyDigits(l.phone) === digits)));
    }
  }
  if (!lead) return null;
  const pipeline = getBusinessPipeline(db, p.businessId);
  const fromStage = normalizeLeadStageId(pipeline, lead);
  if (fromStage === CONVERTED_STAGE_ID) return { lead, moved: false };
  moveLeadStage(db, {
    businessId: p.businessId,
    leadId: lead.id,
    toStageId: CONVERTED_STAGE_ID,
    note: 'Atendimento concluído',
    actor: { id: p.actor.id, name: p.actor.name },
    now: p.now,
    origin: p.origin,
  });
  return { lead, moved: true };
}

export function noteLeadReschedule(
  db: DB,
  p: {
    businessId: string;
    leadId?: string;
    from: { date: string; time: string };
    to: { date: string; time: string };
    by: 'owner' | 'customer' | 'agent' | 'system';
    now?: string;
  },
): void {
  if (!p.leadId) return;
  const lead = db.leads.find((l) => l.id === p.leadId && l.businessId === p.businessId);
  if (!lead) return;
  const now = p.now || new Date().toISOString();
  const pipeline = getBusinessPipeline(db, p.businessId);
  const stage = normalizeLeadStageId(pipeline, lead);
  if (!Array.isArray(lead.stageHistory)) lead.stageHistory = [];
  lead.stageHistory.push({
    id: randomUUID(),
    fromStage: stage,
    toStage: stage,
    movedBy: p.by,
    movedByName: 'Reagendamento',
    at: now,
    note: `Reagendado de ${p.from.date.slice(8, 10)}/${p.from.date.slice(5, 7)} ${p.from.time} para ${p.to.date.slice(8, 10)}/${p.to.date.slice(5, 7)} ${p.to.time}`,
  });
  lead.lastInteraction = now;
}

export interface AssignLeadParams {
  businessId: string;
  leadId: string;
  assignedUserId: string;
  actor: { id: string; name: string; role?: string };
  now?: string;
  /** Observação adicional no histórico do movimento (opcional). */
  note?: string;
  /** P4 — execução que originou a atribuição (anti-loop). */
  origin?: AutomationOrigin;
}

export function assignLead(db: DB, p: AssignLeadParams): Lead {
  const lead = db.leads.find((l) => l.id === p.leadId && l.businessId === p.businessId);
  if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });

  const cleanAssignee = String(p.assignedUserId || '').trim();
  const validation = validateAssignedUser(db, p.businessId, cleanAssignee);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error || 'Usuário responsável inválido.'), { status: 422 });
  }

  const now = p.now || new Date().toISOString();
  lead.assignedUserId = cleanAssignee;
  lead.lastInteraction = now;

  const assignedMember = db.members.find((m) => m.userId === lead.assignedUserId && m.businessId === p.businessId);
  const assignedUser = validation.user || db.users.find((u) => u.id === lead.assignedUserId);
  const targetName = assignedUser?.name || assignedMember?.note || (lead.assignedUserId ? 'Usuário' : 'Nenhum');

  if (!Array.isArray(lead.stageHistory)) lead.stageHistory = [];
  lead.stageHistory.push({
    id: randomUUID(),
    fromStage: lead.stageId || 'new',
    toStage: lead.stageId || 'new',
    movedBy: p.actor.id,
    movedByName: p.actor.name,
    at: now,
    note: [
      `Responsável definido: ${targetName}`,
      p.note ? String(p.note).trim().slice(0, 200) : '',
    ].filter(Boolean).join(' — '),
  });

  // P4 — gatilho de atribuição (o responsável novo pode ser o próximo passo).
  emitAutomationEvent(db, {
    event: 'lead.assigned',
    businessId: p.businessId,
    at: now,
    leadId: lead.id,
    data: { assignedUserId: lead.assignedUserId || '', assignedTo: targetName },
    fromRunId: p.origin?.runId,
  });

  return lead;
}

export interface AddLeadNoteParams {
  businessId: string;
  leadId: string;
  text: string;
  actor: { id: string; name: string };
  now?: string;
}

export function addLeadNote(db: DB, p: AddLeadNoteParams): LeadNote {
  const lead = db.leads.find((l) => l.id === p.leadId && l.businessId === p.businessId);
  if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });

  const text = String(p.text || '').trim().slice(0, 1000);
  if (!text) throw Object.assign(new Error('Texto da observação não pode ser vazio.'), { status: 400 });

  const now = p.now || new Date().toISOString();
  const note: LeadNote = {
    id: randomUUID(),
    at: now,
    by: p.actor.id,
    byName: p.actor.name,
    text,
  };

  if (!Array.isArray(lead.notes)) lead.notes = [];
  lead.notes.push(note);
  lead.lastInteraction = now;

  // Se o lead tem contato vinculado no CRM, replica a nota lá também (visão unificada)
  const contact = db.contacts.find((c) =>
    c.businessId === p.businessId &&
    ((lead.customerId && c.customerId === lead.customerId) || (lead.phone && onlyDigits(c.phone) === onlyDigits(lead.phone))),
  );
  if (contact) {
    addContactNote(contact, { text, by: p.actor.id, byName: p.actor.name, at: now });
  }

  return note;
}

// ═══════════════════════════════════════════════════════════════
// SAÍDA DA ESTEIRA PARA AGENDAMENTO
// ═══════════════════════════════════════════════════════════════

export interface BookLeadParams {
  business: Business;
  service: Service;
  leadId: string;
  date: string;
  time: string;
  professionalId?: string;
  note?: string;
  actor: { id: string; name: string; role?: string };
  now?: string;
  /** P4 — execução que pediu o agendamento (anti-loop do gatilho). */
  originRunId?: string;
}

export function bookLead(db: DB, p: BookLeadParams): {
  booking: Booking;
  lead: Lead;
} {
  const lead = db.leads.find((l) => l.id === p.leadId && l.businessId === p.business.id);
  if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });

  const contact = db.contacts.find((c) =>
    c.businessId === p.business.id &&
    ((lead.customerId && c.customerId === lead.customerId) || (lead.phone && onlyDigits(c.phone) === onlyDigits(lead.phone))),
  );

  // Executa pelo motor único de reservas (revalida slot, concorrência, profissional)
  const res = createBookingTx(db, {
    business: p.business,
    service: p.service,
    date: p.date,
    time: p.time,
    actor: 'owner',
    customer: {
      id: lead.customerId || contact?.customerId || '',
      name: lead.name || contact?.name || 'Cliente',
      phone: lead.phone || contact?.phone || '',
      email: lead.email || contact?.email || '',
    },
    linkedContact: contact ? {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      customerId: contact.customerId,
    } : null,
    professionalId: p.professionalId,
    note: p.note || `Agendamento via esteira (Lead #${lead.id.slice(0, 8)})`,
    source: lead.origin || 'esteira',
    leadId: lead.id,
    now: p.now,
    originRunId: p.originRunId,
  });

  const booking = db.bookings.find((b) => b.id === res.bookingId)!;
  return { booking, lead };
}
