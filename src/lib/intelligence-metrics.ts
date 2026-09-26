// ═══════════════════════════════════════════════════════════════
// F3-I · MÉTRICAS DA INTELIGÊNCIA — derivadas, nunca decorativas
// ═══════════════════════════════════════════════════════════════
// Fonte única: eventos/runs/messages/conversations/outreach/audit já
// existentes. Nada de contador persistido "para sempre encher card".
// SEMPRE filtra por businessId — nunca mistura tenants.
//
// HONESTIDADE: se o dado não existe (ex.: Meta real nunca conectou),
// o valor fica `null` e a UI mostra "—". Nunca inventar %.
import type { DB } from './types';
import { messagingHealth } from './messaging/service';
import { followUpChannelState } from './follow-up';
import { BLOCKED_AI_PROVIDER_CREDENTIAL } from './ai/provider';
export const BLOCKED_META_CREDENTIAL = 'BLOCKED_META_CREDENTIAL' as const;

// ── Pontos de corte (janelas) ──────────────────────────────────
export interface MetricsWindow {
  /** YYYY-MM-DD civil (inclusive) ou '' = desde o início. */
  from?: string;
  /** YYYY-MM-DD civil (inclusive) ou '' = até agora. */
  to?: string;
}

function inWindow(iso: string, win: MetricsWindow): boolean {
  if (!iso) return false;
  const day = String(iso).slice(0, 10);
  if (win.from && day < win.from) return false;
  if (win.to && day > win.to) return false;
  return true;
}

function todayISOLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Automação ──────────────────────────────────────────────────
export interface AutomationMetrics {
  runsStarted: number;
  completed: number;
  failed: number;
  /** waiting + queued (fila/aguardando janela) — nome honesto na UI. */
  awaiting: number;
  /** Runs cujo step pulou por condição (history outcome 'skipped'). */
  skipped: number;
  runsToday: number;
}

// ── Mensagens ──────────────────────────────────────────────────
export interface MessagingMetrics {
  processed: number;
  outboundAccepted: number;
  /** delivered/read só quando o webhook Meta realmente reportou. */
  delivered: number | null;
  read: number | null;
  failed: number;
  /** true se algum status advanced além de pending/sent (prova de webhook). */
  hasProviderStatus: boolean;
}

// ── IA / Conversas ─────────────────────────────────────────────
export interface ConversationMetrics {
  attendedByAi: number;
  handoffs: number;
  takeovers: number;
  resolved: number;
  waitingTeam: number;
  humanActive: number;
  duplicatesBlocked: number;
}

// ── Agenda (origem) ────────────────────────────────────────────
export interface AgendaOriginMetrics {
  /** Bookings criados pelo assistente de agendamento (actor/source agent). */
  fromAssistant: number;
  /** Bookings ligados a outreach de retorno concluído. */
  fromFollowUp: number;
  /** Bookings ligados a outreach de reativação concluído. */
  fromReactivation: number;
}

// ── Follow-up ──────────────────────────────────────────────────
export interface FollowUpMetrics {
  returnsDue: number;
  returnMessages: number;
  replies: number;
  rescheduled: number;
  skips: number;
}

// ── Reativação ─────────────────────────────────────────────────
export interface ReactivationMetrics {
  eligible: number;
  messages: number;
  replies: number;
  reactivated: number;
  skippedNoConsent: number;
}

// ── Aggregate ──────────────────────────────────────────────────
export interface IntelligenceMetrics {
  businessId: string;
  window: { from: string; to: string };
  automation: AutomationMetrics;
  messaging: MessagingMetrics;
  conversations: ConversationMetrics;
  agenda: AgendaOriginMetrics;
  followUp: FollowUpMetrics;
  reactivation: ReactivationMetrics;
}

/**
 * Deriva as métricas da Fase 3 a partir do documento real.
 * Puro (não grava). Chamador decide persistência — aqui não há.
 */
export function computeIntelligenceMetrics(
  db: DB,
  businessId: string,
  win: MetricsWindow = {},
): IntelligenceMetrics {
  const from = win.from || '';
  const to = win.to || '';
  const window: MetricsWindow = { from, to };
  const today = todayISOLocal();

  const runs = (db.automationRuns || []).filter(
    (r) => r.businessId === businessId && inWindow(r.startedAt || r.updatedAt, window),
  );
  const automation: AutomationMetrics = {
    runsStarted: runs.length,
    completed: runs.filter((r) => r.status === 'completed').length,
    failed: runs.filter((r) => r.status === 'failed').length,
    awaiting: runs.filter((r) => r.status === 'waiting' || r.status === 'queued' || r.status === 'running').length,
    skipped: runs.reduce(
      (n, r) => n + (r.history || []).filter((h) => h.outcome === 'skipped').length,
      0,
    ),
    runsToday: (db.automationRuns || []).filter(
      (r) => r.businessId === businessId && String(r.startedAt || '').slice(0, 10) === today,
    ).length,
  };

  const messages = (db.messages || []).filter(
    (m) => m.businessId === businessId && inWindow(m.at, window),
  );
  const outbound = messages.filter((m) => m.direction === 'out');
  const deliveredCount = outbound.filter((m) => m.status === 'delivered' || m.status === 'read').length;
  const readCount = outbound.filter((m) => m.status === 'read').length;
  const hasProviderStatus = deliveredCount > 0 || readCount > 0
    || outbound.some((m) => m.externalId && m.status !== 'pending' && m.status !== 'sent');
  const messaging: MessagingMetrics = {
    processed: messages.length,
    outboundAccepted: outbound.filter((m) => m.status !== 'failed').length,
    delivered: hasProviderStatus ? deliveredCount : null,
    read: hasProviderStatus ? readCount : null,
    failed: outbound.filter((m) => m.status === 'failed').length,
    hasProviderStatus,
  };

  const conversations = (db.conversations || []).filter((c) => c.businessId === businessId);
  const handoffAudits = (db.audit || []).filter(
    (a) => a.businessId === businessId && a.action === 'conversation.handoff' && inWindow(a.at, window),
  );
  const convMetrics: ConversationMetrics = {
    attendedByAi: conversations.filter(
      (c) => c.agentState === 'ai_active' || c.agentState === 'waiting_patient' || (!c.agentState && c.mode !== 'human'),
    ).length,
    // Prefer audit (janelável); fallback: handoff atual na conversa sem janela.
    handoffs: from || to
      ? handoffAudits.length
      : conversations.filter((c) => !!c.handoff).length,
    takeovers: (db.audit || []).filter(
      (a) => a.businessId === businessId
        && (a.action === 'conversation.takeover' || a.action === 'conversation.ai_paused')
        && inWindow(a.at, window),
    ).length,
    resolved: conversations.filter((c) => c.agentState === 'resolved' || c.status === 'closed').length,
    waitingTeam: conversations.filter((c) => c.agentState === 'waiting_team').length,
    humanActive: conversations.filter((c) => c.agentState === 'human_active').length,
    duplicatesBlocked: (db.audit || []).filter(
      (a) => a.businessId === businessId && a.action === 'whatsapp.webhook_received'
        && a.meta?.duplicate === true && inWindow(a.at, window),
    ).length
      + messages.filter((m) => m.meta?.duplicate === true).length,
  };

  const outreach = (db.followUpOutreach || []).filter(
    (o) => o.businessId === businessId && inWindow(o.createdAt || o.updatedAt, window),
  );
  const bookedOutreach = (db.followUpOutreach || []).filter(
    (o) => o.businessId === businessId
      && o.status === 'agendamento_realizado'
      && inWindow(o.updatedAt || o.createdAt, window),
  );
  const assistantBookings = (db.bookings || []).filter(
    (b) => b.businessId === businessId
      && inWindow(b.createdAt, window)
      && (
        // origem explícita do assistente/agent (CreateBookingParams.source)
        (b as any).source === 'agent'
        || (b as any).via === 'agent'
        || String((b as any).source || '').toLowerCase().includes('agent')
      ),
  );
  const agenda: AgendaOriginMetrics = {
    fromAssistant: assistantBookings.length,
    fromFollowUp: bookedOutreach.filter((o) => o.kind === 'return').length,
    fromReactivation: bookedOutreach.filter((o) => o.kind === 'reactivation').length,
  };

  const returns = outreach.filter((o) => o.kind === 'return');
  const returnMessages = returns.filter(
    (o) => o.status === 'mensagem_enviada' || o.status === 'paciente_respondeu'
      || o.status === 'agendamento_realizado' || o.attempt >= 1,
  );
  const followUp: FollowUpMetrics = {
    returnsDue: returns.filter(
      (o) => o.status !== 'cancelado' && o.status !== 'superado' && o.status !== 'recusado'
        && o.status !== 'sem_telefone',
    ).length,
    returnMessages: returnMessages.length,
    replies: returns.filter(
      (o) => o.status === 'paciente_respondeu' || o.status === 'agendamento_realizado' || o.status === 'recusado',
    ).length,
    rescheduled: returns.filter((o) => o.status === 'agendamento_realizado').length,
    skips: returns.filter(
      (o) => o.lastResult && o.lastResult.startsWith('skipped_')
        || o.status === 'ja_agendado' || o.status === 'superado'
        || o.status === 'cancelado' || o.status === 'sem_telefone',
    ).length,
  };

  const reOutreach = outreach.filter((o) => o.kind === 'reactivation');
  const reactivation: ReactivationMetrics = {
    eligible: reOutreach.filter((o) => o.status !== 'sem_consentimento').length,
    messages: reOutreach.filter(
      (o) => o.status === 'mensagem_enviada' || o.status === 'paciente_respondeu'
        || o.status === 'agendamento_realizado' || o.attempt >= 1,
    ).length,
    replies: reOutreach.filter(
      (o) => o.status === 'paciente_respondeu' || o.status === 'agendamento_realizado' || o.status === 'recusado',
    ).length,
    reactivated: reOutreach.filter((o) => o.status === 'agendamento_realizado').length,
    skippedNoConsent: reOutreach.filter(
      (o) => o.status === 'sem_consentimento' || o.lastResult === 'skipped_no_marketing_consent',
    ).length,
  };

  return {
    businessId,
    window: { from, to },
    automation,
    messaging,
    conversations: convMetrics,
    agenda,
    followUp,
    reactivation,
  };
}

// ── Cards resumidos (Dashboard) ────────────────────────────────
export interface IntelligenceCard {
  id: string;
  label: string;
  /** null = sem dado provável (UI mostra "—"). */
  value: number | null;
}

/**
 * Bloco "GoDoutor Intelligence" da Dashboard — só números prováveis.
 * Nada de % de entrega sem webhook Meta real.
 */
export function intelligenceCards(m: IntelligenceMetrics): IntelligenceCard[] {
  return [
    {
      id: 'conversations',
      label: 'conversas na base',
      value: m.conversations.attendedByAi + m.conversations.humanActive + m.conversations.waitingTeam > 0
        || m.messaging.processed > 0
        ? m.conversations.attendedByAi
        : 0,
    },
    {
      id: 'automations',
      label: 'automações concluídas',
      value: m.automation.completed,
    },
    {
      id: 'returns',
      label: 'retornos recuperados',
      value: m.followUp.rescheduled,
    },
    {
      id: 'waiting',
      label: 'aguardando equipe',
      value: m.conversations.waitingTeam,
    },
  ];
}

// ── Resumo Automações (home) ───────────────────────────────────
export interface AutomationHealthSummary {
  active: number;
  awaitingChannel: number;
  withError: number;
  executedToday: number;
}

export function automationHealthSummary(db: DB, businessId: string): AutomationHealthSummary {
  const autos = (db.automations || []).filter((a) => a.businessId === businessId);
  const runs = (db.automationRuns || []).filter((r) => r.businessId === businessId);
  const today = todayISOLocal();
  const business = db.businesses.find((b) => b.id === businessId);
  const channelReady = business ? followUpChannelState(business).ready : false;
  const waitingChannelRuns = runs.filter((r) => String(r.lastError || r.error || '').toLowerCase().includes('awaiting_channel')
    || (r.history || []).some((h) => String(h.detail || h.label || '').toLowerCase().includes('awaiting_channel'))).length;
  return {
    active: autos.filter((a) => a.active).length,
    awaitingChannel: channelReady ? 0 : waitingChannelRuns,
    withError: runs.filter((r) => r.status === 'failed').length,
    executedToday: runs.filter((r) => String(r.startedAt || '').slice(0, 10) === today).length,
  };
}

// ── Health model (interno) ─────────────────────────────────────
export type HealthLevel = 'ok' | 'degraded' | 'blocked' | 'error';

export interface HealthBlock {
  state: HealthLevel;
  /** Motivo curto em PT-BR (UI comum pode traduzir). */
  reason: string;
  /** Código estável p/ testes/docs (não aparece na UI comum). */
  code?: string;
}

export interface IntelligenceHealth {
  automation: HealthBlock;
  runner: HealthBlock;
  messaging: HealthBlock;
  whatsapp: HealthBlock;
  aiProvider: HealthBlock;
  inbox: HealthBlock;
  events: HealthBlock;
}

/**
 * Visão interna de saúde da Fase 3 — honesta:
 * • WhatsApp sem credencial Meta → blocked (não error de app).
 * • AIProvider sem chave → blocked (fallback determinístico ≠ IA completa).
 * • Runner com waitingUntil+CAS+cron → degraded (Workflow SDK pendente).
 */
export function intelligenceHealth(db: DB, businessId: string): IntelligenceHealth {
  const business = db.businesses.find((b) => b.id === businessId);
  const runs = (db.automationRuns || []).filter((r) => r.businessId === businessId);
  const failed = runs.filter((r) => r.status === 'failed').length;
  const autos = (db.automations || []).filter((a) => a.businessId === businessId && a.active);
  const channel = business ? followUpChannelState(business) : { ready: false, label: 'unidade ausente' };
  const msgHealth = messagingHealth(db, businessId);
  const conversations = (db.conversations || []).filter((c) => c.businessId === businessId);
  const waiting = conversations.filter((c) => c.agentState === 'waiting_team').length;

  const automation: HealthBlock = autos.length === 0
    ? { state: 'degraded', reason: 'Nenhuma automação ativa.', code: 'no_active_automation' }
    : failed > 0
      ? { state: 'degraded', reason: `${failed} execução(ões) com erro.`, code: 'runs_failed' }
      : { state: 'ok', reason: 'Funcionando.' };

  const runner: HealthBlock = {
    // Fallback (waitingUntil + claim CAS + cron) funciona; SDK durável alvo não.
    state: 'degraded',
    reason: 'Fila por cron operando; infraestrutura durável alvo pendente.',
    code: 'PARTIAL_INFRA',
  };

  const whatsappCode = msgHealth.state === 'error' ? BLOCKED_META_CREDENTIAL : undefined;
  const whatsapp: HealthBlock =
    msgHealth.state === 'connected'
      ? { state: 'ok', reason: 'Conectado.' }
      : msgHealth.state === 'simulator'
        ? { state: 'ok', reason: 'Simulador ativo — sem saída real.', code: 'SIMULATOR' }
        : msgHealth.state === 'configuring'
          ? { state: 'degraded', reason: 'Configuração incompleta.', code: 'configuring' }
          : {
            state: 'blocked',
            reason: 'Credencial Meta não configurada.',
            code: whatsappCode || BLOCKED_META_CREDENTIAL,
          };

  const hasFailedOut = (db.messages || []).some(
    (m) => m.businessId === businessId && m.direction === 'out' && m.status === 'failed',
  );
  const messagingBlock: HealthBlock = !channel.ready
    ? {
      state: 'blocked',
      reason: 'Aguardando canal — nenhuma saída real será fingida.',
      code: BLOCKED_META_CREDENTIAL,
    }
    : hasFailedOut
      ? { state: 'degraded', reason: 'Há mensagens com falha de envio.', code: 'send_failed' }
      : { state: 'ok', reason: 'Mensagens operando.' };

  const aiProvider: HealthBlock = {
    state: 'blocked',
    reason: 'Modo básico — assistente sem LLM externo autorizado.',
    code: BLOCKED_AI_PROVIDER_CREDENTIAL,
  };

  const inbox: HealthBlock = waiting > 0
    ? { state: 'degraded', reason: `${waiting} conversa(s) aguardando equipe.` }
    : { state: 'ok', reason: 'Funcionando.' };

  const events: HealthBlock = (db.automations || []).length === 0
    ? { state: 'degraded', reason: 'Sem automações registradas.' }
    : { state: 'ok', reason: 'Eventos e execuções gravados.' };

  return { automation, runner, messaging: messagingBlock, whatsapp, aiProvider, inbox, events };
}
