// ═══════════════════════════════════════════════════════════════
// F3-F · INBOX + HANDOFF + TAKEOVER
// ═══════════════════════════════════════════════════════════════
// Regras do briefing:
//  • Estados explícitos: ai_active | waiting_patient | waiting_team |
//    human_active | resolved. Humano e IA NUNCA respondem juntos.
//  • Handoff persiste resumo/intenção/entidades/ações em
//    conversation.handoff — NUNCA chain-of-thought.
//  • Devolver para IA: autorizado + audit; SEM mensagem espontânea.
//  • Idempotência: provider + providerMessageId (duplicata ≠ 2 respostas).
//  • Contexto lateral: SÓ administrativo (tutor/pet/telefone/próx.
//    agendamento/serviço/responsável/lead). NUNCA prontuário/anamnese.
//  • Simulador interno com badge SIMULADOR — nunca parece WhatsApp real.
// ═══════════════════════════════════════════════════════════════
import { randomUUID } from 'node:crypto';
import type {
  Conversation, ConversationAgentState, ConversationHandoff,
  ConversationMessage, DB, Message, User,
} from '../types';
import { emitAutomationEvent } from '../automation/events';
import { pushAudit } from '../audit';
import { petsOfTutor } from '../pets';
import { onlyDigits } from '../utils';
import { resolveConversationContact } from '../conversation-identity';

// ── Estado ─────────────────────────────────────────────────────

/** Deriva o estado explícito (dado legado sem agentState). */
export function effectiveAgentState(conv: Pick<Conversation, 'mode' | 'agentState' | 'status'>): ConversationAgentState {
  if (conv.agentState) return conv.agentState;
  if (conv.status === 'closed') return 'resolved';
  return conv.mode === 'human' ? 'human_active' : 'ai_active';
}

/** A IA PODE responder agora? (humano + IA nunca juntos). */
export function aiShouldRespond(conv: Conversation): boolean {
  const st = effectiveAgentState(conv);
  return st === 'ai_active' || st === 'waiting_patient';
}

/** Aplica estado + espelha `mode` legado (Instagram/WhatsApp continuam ok). */
export function setAgentState(
  conv: Conversation,
  next: ConversationAgentState,
): ConversationAgentState {
  conv.agentState = next;
  // mode legado: só human_active/resolved assumem 'human'; o resto é IA.
  if (next === 'human_active') conv.mode = 'human';
  else if (next === 'ai_active' || next === 'waiting_patient') conv.mode = 'automation';
  else if (next === 'waiting_team') conv.mode = 'human'; // equipe é quem vai responder
  return next;
}

/** UX: só 3 rótulos compreensíveis (sem webhook/payload/event ID). */
export function agentStateLabel(state: ConversationAgentState): string {
  switch (state) {
    case 'ai_active':
    case 'waiting_patient':
      return '✨ IA atendendo';
    case 'waiting_team':
      return 'Aguardando equipe';
    case 'human_active':
      return 'Recepção atendendo';
    case 'resolved':
      return 'Encerrada';
    default:
      return '✨ IA atendendo';
  }
}

// ── Conversa ───────────────────────────────────────────────────

export interface EnsureConversationInput {
  businessId: string;
  channel: 'whatsapp' | 'instagram' | 'agent';
  phone: string;
  name?: string;
  contactId?: string;
  customerId?: string;
  channelUserId?: string;
  channelAccountId?: string;
  channelUsername?: string;
  now: string;
}

/** Busca ou cria conversa com estado inicial de IA. Idempotente por telefone. */
export function ensureConversation(db: DB, input: EnsureConversationInput): Conversation {
  const digits = onlyDigits(input.phone || '');
  let conv = db.conversations.find(
    (c) => c.businessId === input.businessId
      && (!digits || c.phone === digits)
      && (c.channel === input.channel || (input.channel === 'whatsapp' && c.channel === 'agent')),
  );
  if (!conv) {
    conv = {
      id: randomUUID(),
      businessId: input.businessId,
      channel: input.channel,
      channelUserId: input.channelUserId || digits,
      channelAccountId: input.channelAccountId || '',
      channelUsername: input.channelUsername || '',
      contactId: input.contactId || '',
      customerId: input.customerId || '',
      name: input.name || digits || 'Cliente',
      phone: digits,
      status: 'open',
      mode: 'automation',
      agentState: 'ai_active',
      unread: 0,
      lastMessageAt: input.now,
      lastMessagePreview: '',
      createdAt: input.now,
      context: {},
    };
    db.conversations.push(conv);
    emitAutomationEvent(db, {
      event: 'conversation.started',
      businessId: input.businessId,
      at: input.now,
      data: { conversationId: conv.id, channel: conv.channel, phone: conv.phone },
    });
  } else if (!conv.agentState) {
    setAgentState(conv, conv.mode === 'human' ? 'human_active' : 'ai_active');
  }
  return conv;
}

// ── Idempotência: provider + providerMessageId ─────────────────

/** Mensagem já gravada para este provider+providerMessageId? */
export function findDuplicateMessage(
  db: DB,
  businessId: string,
  provider: string,
  providerMessageId: string,
): Message | undefined {
  if (!providerMessageId) return undefined;
  return db.messages.find((m) => {
    if (m.businessId !== businessId) return false;
    if ((m.externalId || '') === providerMessageId) {
      const p = String(m.meta?.provider || '') || providerOfChannel(m.channel);
      if (!p || p === provider) return true;
    }
    return false;
  });
}

function providerOfChannel(channel?: string): string {
  if (channel === 'whatsapp') return 'whatsapp';
  if (channel === 'instagram') return 'instagram';
  if (channel === 'agent') return 'agent';
  return '';
}

// ── Mensagens (modelo interno ConversationMessage) ─────────────

export function toConversationMessage(m: Message): ConversationMessage {
  const sender: ConversationMessage['sender'] =
    m.by === 'contact' ? 'patient'
      : m.by === 'automation' ? 'ai'
        : m.by === 'system' ? 'system'
          : 'human';
  return {
    id: m.id,
    businessId: m.businessId,
    conversationId: m.conversationId,
    direction: m.direction,
    sender,
    body: m.body,
    status: m.status,
    provider: String(m.meta?.provider || providerOfChannel(m.channel) || 'internal'),
    providerMessageId: m.externalId || '',
    at: m.at,
    ...(m.meta ? { meta: m.meta } : {}),
  };
}

export interface ReceiveInboundInput {
  businessId: string;
  conversationId: string;
  body: string;
  provider: string;
  providerMessageId: string;
  at: string;
  channelUserId?: string;
  contactName?: string;
}

export type ReceiveInboundResult =
  | { ok: true; messageId: string; duplicate: false; agentWillRespond: boolean }
  | { ok: true; messageId: string; duplicate: true; agentWillRespond: false };

/**
 * Grava inbound com idempotência (provider + providerMessageId).
 * Duplicata NÃO cria segunda mensagem nem dispara segunda resposta de IA.
 */
export function receiveInbound(db: DB, input: ReceiveInboundInput): ReceiveInboundResult {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) throw Object.assign(new Error('Conversa não encontrada.'), { status: 404 });

  const dup = findDuplicateMessage(db, input.businessId, input.provider, input.providerMessageId);
  if (dup) {
    return { ok: true, messageId: dup.id, duplicate: true, agentWillRespond: false };
  }

  const msg: Message = {
    id: randomUUID(),
    businessId: input.businessId,
    conversationId: conv.id,
    direction: 'in',
    body: input.body.slice(0, 4000),
    status: 'delivered',
    externalId: input.providerMessageId,
    by: 'contact',
    byName: input.contactName || conv.name || 'Cliente',
    channel: conv.channel === 'instagram' ? 'instagram' : conv.channel === 'agent' ? 'agent' : 'whatsapp',
    channelUserId: input.channelUserId || conv.channelUserId || '',
    at: input.at,
    meta: { provider: input.provider },
  };
  db.messages.push(msg);

  if (conv.lastInboundAt && conv.lastInboundAt > input.at) {
    // nunca retrocede
  } else {
    conv.lastInboundAt = input.at;
  }
  conv.unread = (conv.unread || 0) + 1;
  conv.lastMessageAt = input.at;
  conv.lastMessagePreview = input.body.slice(0, 120);

  emitAutomationEvent(db, {
    event: 'message.received',
    businessId: input.businessId,
    at: input.at,
    data: {
      conversationId: conv.id,
      channel: conv.channel,
      phone: conv.phone,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
    },
  });

  const will = aiShouldRespond(conv);
  if (will) setAgentState(conv, 'waiting_patient');
  return { ok: true, messageId: msg.id, duplicate: false, agentWillRespond: will };
}

export interface SendOutboundInput {
  businessId: string;
  conversationId: string;
  body: string;
  /** 'ai' | 'human' + userId do humano | 'system'. */
  by: string;
  byName?: string;
  provider?: string;
  providerMessageId?: string;
  at: string;
  status?: Message['status'];
}

/** Grava outbound (IA ou humano) e emite message.sent. */
export function sendOutbound(db: DB, input: SendOutboundInput): Message {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) throw Object.assign(new Error('Conversa não encontrada.'), { status: 404 });

  const provider = input.provider || (conv.channel === 'instagram' ? 'instagram' : conv.channel === 'agent' ? 'agent' : 'whatsapp');
  const msgId = randomUUID();
  const msg: Message = {
    id: msgId,
    businessId: input.businessId,
    conversationId: conv.id,
    direction: 'out',
    body: input.body.slice(0, 4000),
    status: input.status || 'pending',
    externalId: input.providerMessageId || '',
    by: input.by,
    byName: input.byName || '',
    channel: conv.channel,
    at: input.at,
    meta: { provider },
  };
  db.messages.push(msg);
  conv.lastMessageAt = input.at;
  conv.lastMessagePreview = input.body.slice(0, 120);

  emitAutomationEvent(db, {
    event: 'message.sent',
    businessId: input.businessId,
    at: input.at,
    data: {
      conversationId: conv.id,
      channel: conv.channel,
      phone: conv.phone,
      provider,
      by: input.by,
    },
  });

  if (input.by === 'ai') setAgentState(conv, 'waiting_patient');
  return msg;
}

// ── Handoff / Takeover / Devolver-IA / Pausar ──────────────────

export interface HandoffInput {
  businessId: string;
  conversationId: string;
  /** Resumo operacional curto — NUNCA chain-of-thought. */
  summary: string;
  intent?: string;
  entities?: Record<string, string>;
  actions?: string[];
  requestedBy?: string;
  actor?: { id: string; email?: string; role?: string };
  at: string;
  /** false = handoff silencioso (ex.: paciente pediu humano e já há aviso). */
  notifyHandoff?: boolean;
}

export type HandoffResult =
  | { ok: true; conversationId: string; state: ConversationAgentState }
  | { ok: false; error: string };

/**
 * Handoff: IA para; resumo persistido em conversation.handoff; estado
 * waiting_team. Emite conversation.handoff + audit (sem raciocínio).
 */
export function handoffToTeam(db: DB, input: HandoffInput): HandoffResult {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) return { ok: false, error: 'Conversa não encontrada.' };

  const summary = String(input.summary || '').slice(0, 500).trim();
  if (!summary) return { ok: false, error: 'Resumo do handoff é obrigatório.' };

  // NUNCA persistir chain-of-thought: campos são só resumo/intenção/entidades/ações.
  const handoff: ConversationHandoff = {
    at: input.at,
    summary,
    ...(input.intent ? { intent: String(input.intent).slice(0, 80) } : {}),
    ...(input.entities && Object.keys(input.entities).length
      ? { entities: pickEntities(input.entities) } : {}),
    ...(input.actions?.length
      ? { actions: input.actions.slice(0, 8).map((a) => String(a).slice(0, 120)) } : {}),
    ...(input.requestedBy ? { requestedBy: String(input.requestedBy).slice(0, 64) } : {}),
  };
  conv.handoff = handoff;
  setAgentState(conv, 'waiting_team');

  emitAutomationEvent(db, {
    event: 'conversation.handoff',
    businessId: input.businessId,
    at: input.at,
    data: {
      conversationId: conv.id,
      channel: conv.channel,
      phone: conv.phone,
      intent: handoff.intent || '',
      // resumo curto ok; nunca campos de raciocínio
      summary: handoff.summary,
    },
  });

  pushAudit(db, {
    action: 'conversation.handoff',
    actor: input.actor
      ? { id: input.actor.id, email: input.actor.email || '', role: input.actor.role || '' }
      : { id: 'system', email: 'system@instalink.app', role: 'system' },
    businessId: input.businessId,
    // Só dados operacionais — NUNCA campos de raciocínio/chain-of-thought.
    meta: {
      conversationId: conv.id,
      intent: handoff.intent || '',
      summary: handoff.summary,
    },
  }, input.at);

  return { ok: true, conversationId: conv.id, state: 'waiting_team' };
}

function pickEntities(entities: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(entities)) {
    if (n >= 16) break;
    const key = String(k).slice(0, 40);
    const val = String(v ?? '').slice(0, 120);
    if (!key || !val) continue;
    out[key] = val;
    n += 1;
  }
  return out;
}

export interface HumanSendInput {
  businessId: string;
  conversationId: string;
  body: string;
  actor: User | { id: string; name?: string; email?: string; role?: string };
  at: string;
}

/**
 * Humano responde → human_active IMEDIATO (IA nunca responde junto).
 * Se estava waiting_team, consome o handoff. Audit takeover se saiu da IA.
 */
export function humanSend(db: DB, input: HumanSendInput): Message {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) throw Object.assign(new Error('Conversa não encontrada.'), { status: 404 });

  const prev = effectiveAgentState(conv);
  setAgentState(conv, 'human_active');
  conv.unread = 0;

  if (prev === 'ai_active' || prev === 'waiting_patient') {
    pushAudit(db, {
      action: 'conversation.takeover',
      actor: { id: input.actor.id, email: (input.actor as User).email || '', role: (input.actor as User).role || '' },
      businessId: input.businessId,
      meta: { conversationId: conv.id, from: prev, to: 'human_active' },
    }, input.at);
  }

  return sendOutbound(db, {
    businessId: input.businessId,
    conversationId: conv.id,
    body: input.body,
    by: input.actor.id,
    byName: (input.actor as User).name || 'Equipe',
    at: input.at,
    status: 'pending',
  });
}

export interface ResumeAiInput {
  businessId: string;
  conversationId: string;
  actor: User | { id: string; email?: string; role?: string };
  at: string;
}

export type ResumeAiResult =
  | { ok: true; state: ConversationAgentState }
  | { ok: false; error: string };

/**
 * Devolver para IA: só a partir de human_active/waiting_team; auditado;
 * NÃO envia mensagem espontânea (a próxima fala do paciente é que a IA lê).
 */
export function resumeAi(db: DB, input: ResumeAiInput): ResumeAiResult {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) return { ok: false, error: 'Conversa não encontrada.' };
  const prev = effectiveAgentState(conv);
  if (prev === 'ai_active' || prev === 'waiting_patient') {
    return { ok: false, error: 'A IA já está atendendo esta conversa.' };
  }
  if (prev === 'resolved') {
    return { ok: false, error: 'Conversa encerrada.' };
  }

  setAgentState(conv, 'ai_active');
  pushAudit(db, {
    action: 'conversation.ai_resumed',
    actor: { id: input.actor.id, email: (input.actor as User).email || '', role: (input.actor as User).role || '' },
    businessId: input.businessId,
    meta: { conversationId: conv.id, from: prev, to: 'ai_active', spontaneousMessage: false },
  }, input.at);
  // SEM mensagem automática — sem sendOutbound aqui.
  return { ok: true, state: 'ai_active' };
}

export interface PauseAiInput extends ResumeAiInput {}

/** Pausar IA: human_active sem necessarily ter escrito (takeover manual). */
export function pauseAi(db: DB, input: PauseAiInput): ResumeAiResult {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) return { ok: false, error: 'Conversa não encontrada.' };
  const prev = effectiveAgentState(conv);
  if (prev === 'human_active') return { ok: true, state: prev };

  setAgentState(conv, 'human_active');
  pushAudit(db, {
    action: 'conversation.ai_paused',
    actor: { id: input.actor.id, email: (input.actor as User).email || '', role: (input.actor as User).role || '' },
    businessId: input.businessId,
    meta: { conversationId: conv.id, from: prev, to: 'human_active' },
  }, input.at);
  return { ok: true, state: 'human_active' };
}

/** Encerrar conversa (resolved). IA e humano param. */
export function resolveConversation(
  db: DB,
  input: { businessId: string; conversationId: string; at: string },
): ResumeAiResult {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) return { ok: false, error: 'Conversa não encontrada.' };
  conv.status = 'closed';
  setAgentState(conv, 'resolved');
  return { ok: true, state: 'resolved' };
}

// ── Handoff automático (pedido de humano / conteúdo clínico) ────

const HUMAN_REQUEST_RE =
  /\b(humano|atendente|falar com (uma )?pessoa|falar com atendente|suporte humano|atendente humano|quero falar com alguem)\b/i;

/** Paciente pediu pessoa de verdade? */
export function wantsHuman(text: string): boolean {
  return HUMAN_REQUEST_RE.test(String(text || ''));
}

/**
 * Conteúdo clínico/diagnóstico → handoff para profissional.
 * A IA NÃO diagnostica; só escala (guardrail F3).
 */
const CLINICAL_RE =
  /\b(diagn[oó]stico|receita|rem[eé]dio|antibiotico|posologia|dosagem|sintoma grave|dor no peito|estou passando mal|urg[eê]ncia|emergencia)\b/i;

export function looksClinical(text: string): boolean {
  return CLINICAL_RE.test(String(text || ''));
}

/** Resumo de handoff a partir da conversa — só fatos, sem raciocínio. */
export function buildHandoffSummary(
  db: DB,
  conv: Conversation,
  reason: 'pedido_humano' | 'clinico' | 'sistema',
): { summary: string; intent: string; entities: Record<string, string>; actions: string[] } {
  const recent = db.messages
    .filter((m) => m.conversationId === conv.id)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(-6);
  const lastPatient = [...recent].reverse().find((m) => m.direction === 'in');
  const intent = reason === 'pedido_humano' ? 'pedir_humano' : reason === 'clinico' ? 'clínico' : 'sistema';
  const entities: Record<string, string> = {};
  if (conv.name) entities.tutor = conv.name;
  if (conv.phone) entities.telefone = conv.phone;
  const petName = String(conv.context?.activePetName || '');
  if (petName) entities.pet = petName;
  const preview = (lastPatient?.body || conv.lastMessagePreview || '').slice(0, 160);
  const summary = reason === 'clinico'
    ? `Assunto clínico relatado pelo paciente${petName ? ` (pet ${petName})` : ''}: "${preview}" — encaminhado ao profissional.`
    : reason === 'pedido_humano'
      ? `Paciente pediu atendimento humano. Última mensagem: "${preview}".`
      : `Handoff de sistema. Última mensagem: "${preview}".`;
  const actions = reason === 'clinico'
    ? ['Retornar pelo profissional', 'Não orientar diagnóstico pela IA']
    : ['Retornar pela recepção'];
  return { summary, intent, entities, actions };
}

// ── Contexto lateral (SÓ administrativo — nunca prontuário) ────

export interface ConversationSideContext {
  tutor: { name: string; phone: string; registered: boolean };
  pets: Array<{ id: string; name: string; species: string }>;
  /** Paciente corrente quando veterinária com pet ativo. */
  currentPatient?: { id: string; name: string };
  phone: string;
  nextAppointment?: { date: string; time: string; service: string };
  lastService?: string;
  responsible?: string;
  lead?: { id: string; stage?: string };
  /** Modo do canal para o rótulo (nunca expõe payload provider). */
  channel: string;
}

/**
 * Contexto lateral para o humano no inbox — administrativo apenas.
 * Proibido: prontuário, anamnese, evolução clínica, notas médicas.
 */
export function conversationSideContext(db: DB, businessId: string, conv: Conversation): ConversationSideContext {
  // §5 — UMA resolução canônica (lib/conversation-identity.ts): o painel de
  // contexto laterale, a lista e o detalhe respondem "quem é esta pessoa"
  // com a MESMA regra. Nada de paralelo com régua própria.
  const contact = resolveConversationContact(db, businessId, conv);
  const tutorId = contact?.id || '';
  const business = db.businesses.find((b) => b.id === businessId);
  const isVet = String(business?.clinicType || '') === 'veterinaria';

  const pets = isVet && tutorId
    ? petsOfTutor((db.pets || []).filter((p) => p.businessId === businessId), tutorId)
      .map((p) => ({ id: p.id, name: p.name, species: p.species || '' }))
    : [];

  const activePetId = String(conv.context?.activePetId || conv.context?.petId || '');
  const currentPet = pets.find((p) => p.id === activePetId);

  const today = (conv.lastMessageAt || '').slice(0, 10);
  const upcoming = (db.bookings || [])
    .filter((b) => b.businessId === businessId && b.status !== 'cancelled' && b.status !== 'completed' && b.status !== 'no_show')
    .filter((b) => !tutorId ? onlyDigits(b.customerPhone || '') === onlyDigits(conv.phone || '') : (b.customerId && contact?.customerId ? b.customerId === contact.customerId : onlyDigits(b.customerPhone || '') === onlyDigits(conv.phone || '')))
    .filter((b) => !today || b.date >= today)
    .sort((a, b) => (a.date === b.date ? (a.time < b.time ? -1 : 1) : a.date < b.date ? -1 : 1));

  const next = upcoming[0];
  const svc = next ? db.services.find((s) => s.id === next.serviceId) : undefined;
  const lastDone = (db.bookings || [])
    .filter((b) => b.businessId === businessId && (b.status === 'completed' || b.status === 'confirmed'))
    .filter((b) => onlyDigits(b.customerPhone || '') === onlyDigits(conv.phone || ''))
    .sort((a, b) => (a.date > b.date ? -1 : 1))[0];
  const lastSvc = lastDone ? db.services.find((s) => s.id === lastDone.serviceId) : undefined;

  const leadId = String(conv.context?.leadId || '');
  const lead = leadId ? (db.leads || []).find((l) => l.id === leadId && l.businessId === businessId) : undefined;

  const responsible = next
    ? (db.professionals.find((p) => p.id === next.professionalId)?.name || '')
    : '';

  return {
    tutor: {
      name: contact?.name || conv.name || '',
      phone: contact?.phone || conv.phone || '',
      // Mesma régua da lista/detalhe: contato resolvido = cadastrado.
      registered: !!contact,
    },
    pets,
    ...(currentPet ? { currentPatient: { id: currentPet.id, name: currentPet.name } } : {}),
    phone: conv.phone || '',
    ...(next ? {
      nextAppointment: {
        date: next.date,
        time: next.time,
        service: svc?.name || '',
      },
    } : {}),
    ...(lastSvc ? { lastService: lastSvc.name } : {}),
    ...(responsible ? { responsible } : {}),
    ...(lead ? { lead: { id: lead.id, stage: String((lead as { stageId?: string }).stageId || (lead as { status?: string }).status || '') } } : {}),
    channel: conv.channel,
  };
}

// ── Simulador interno (badge SIMULADOR — nunca parece WhatsApp) ─

export const SIMULATOR_PROVIDER = 'simulator';

/**
 * Injeta mensagem do "paciente" no simulador interno de testes/demos.
 * Sempre carrega meta.simulator=true e provider='simulator' para a UI
 * marcar SIMULADOR — nunca imita WhatsApp real.
 */
export function simulatorInbound(
  db: DB,
  input: { businessId: string; conversationId: string; body: string; at: string },
): ReceiveInboundResult {
  const providerMessageId = `sim-${randomUUID()}`;
  const result = receiveInbound(db, {
    businessId: input.businessId,
    conversationId: input.conversationId,
    body: input.body,
    provider: SIMULATOR_PROVIDER,
    providerMessageId,
    at: input.at,
  });
  // Marca meta de exibição na mensagem gravada
  if (!result.duplicate) {
    const msg = db.messages.find((m) => m.id === result.messageId);
    if (msg) {
      msg.meta = { ...(msg.meta || {}), provider: SIMULATOR_PROVIDER, simulator: true };
    }
  }
  return result;
}

/** Resposta da IA no simulador (badge SIMULADOR no histórico). */
export function simulatorAiReply(
  db: DB,
  input: { businessId: string; conversationId: string; body: string; at: string },
): Message {
  const msg = sendOutbound(db, {
    businessId: input.businessId,
    conversationId: input.conversationId,
    body: input.body,
    by: 'automation',
    byName: '✨ IA (simulador)',
    provider: SIMULATOR_PROVIDER,
    providerMessageId: `sim-${randomUUID()}`,
    at: input.at,
    status: 'sent',
  });
  msg.meta = { ...(msg.meta || {}), provider: SIMULATOR_PROVIDER, simulator: true };
  return msg;
}
