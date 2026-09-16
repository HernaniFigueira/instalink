// ═══════════════════════════════════════════════════════════════
// P4.1/P4.2/P4.4/P4.5 — CATÁLOGO, VALIDAÇÃO E GRAFO DA AUTOMAÇÃO
// ═══════════════════════════════════════════════════════════════
// Tudo aqui é PURO e compartilhado entre servidor (validação/execução) e
// interface (rótulos do editor). A definição de automação é DADOS: é o
// contrato que a IA do P5 vai gerar e o editor visual do futuro vai desenhar.
//
// Modelo canônico = GRAFO (nodes + edges). A interface linear
// ("Quando / Se / Então / Depois / E / Senão") é uma PROJEÇÃO desse grafo
// (linearToGraph / graphToLinear) — nada de segundo formato persistido.
import type {
  Automation, AutomationActionType, AutomationCondition, AutomationEdge,
  AutomationEventId, AutomationNode, AutomationNodeConfig, AutomationNodeType,
  AutomationRun, AutomationRunStatus, AutomationRunStep, AutomationSettings,
  AutomationWaitConfig, ConditionOperator, DB,
} from '../types';
import { AUTOMATION_EVENTS } from '../types';
import { VALID_WEBHOOK_EVENTS } from '../types';
import { conditionFields } from './conditions';
import { isConditionGroup } from '../types';
import { ADVANCED_LIMITS, type CapabilityId, type CapabilityLimits } from './capabilities';
import { uid } from '../utils';

// ═══════════════════════════════════════════════════════════════
// GATILHOS (P4.2) — só eventos que o sistema JÁ produz
// ═══════════════════════════════════════════════════════════════
export type AutomationEntity = 'lead' | 'customer' | 'booking';

export interface AutomationEventDef {
  id: AutomationEventId;
  label: string;
  hint: string;
  entity: AutomationEntity;
  /** Onde o evento nasce (documentação viva do ponto de integração). */
  source: string;
}

export const AUTOMATION_EVENT_DEFS: AutomationEventDef[] = [
  { id: 'lead.created', label: 'Lead criado', hint: 'Alguém pediu contato (página, API ou assistente).', entity: 'lead', source: 'lib/pipeline.ts · ingestLead' },
  { id: 'lead.updated', label: 'Lead atualizado', hint: 'Dados do lead mudaram.', entity: 'lead', source: 'lib/pipeline.ts · ingestLead' },
  { id: 'lead.stage_changed', label: 'Lead mudou de etapa', hint: 'Movimentação na esteira.', entity: 'lead', source: 'lib/pipeline.ts · moveLeadStage' },
  { id: 'lead.assigned', label: 'Lead atribuído', hint: 'Responsável definido (ou removido).', entity: 'lead', source: 'lib/pipeline.ts · assignLead' },
  { id: 'customer.created', label: 'Cliente entrou na base', hint: 'Contato novo no CRM da unidade.', entity: 'customer', source: 'lib/pipeline.ts · ingestLead' },
  { id: 'customer.updated', label: 'Cliente atualizado', hint: 'Dados do contato mudaram.', entity: 'customer', source: 'lib/pipeline.ts · ingestLead' },
  { id: 'booking.created', label: 'Agendamento criado', hint: 'Reserva registrada (qualquer caminho).', entity: 'booking', source: 'lib/booking-create.ts · createBookingTx' },
  { id: 'booking.confirmed', label: 'Agendamento confirmado', hint: 'pending → confirmed.', entity: 'booking', source: 'lib/booking-ops.ts · applyBookingStatusTx' },
  { id: 'booking.cancelled', label: 'Agendamento cancelado', hint: 'Cancelado pelo negócio ou pelo cliente.', entity: 'booking', source: 'lib/booking-ops.ts · applyBookingStatusTx' },
  { id: 'booking.completed', label: 'Atendimento concluído', hint: 'Serviço finalizado.', entity: 'booking', source: 'lib/booking-ops.ts · applyBookingStatusTx' },
];

export function automationEventDef(id: unknown): AutomationEventDef | undefined {
  return AUTOMATION_EVENT_DEFS.find((e) => e.id === id);
}

export function isAutomationEvent(id: unknown): id is AutomationEventId {
  return typeof id === 'string' && AUTOMATION_EVENTS.includes(id as AutomationEventId);
}

/** Rótulo humano de um evento (usado no painel e no histórico). */
export function automationEventLabel(id: unknown): string {
  return automationEventDef(id)?.label || String(id || 'evento');
}

// ═══════════════════════════════════════════════════════════════
// CAMPOS VISÍVEIS PARA CONDIÇÃO (P4.3)
// ═══════════════════════════════════════════════════════════════
// A lista abaixo é o ÚNICO que a automação pode ler do contexto. Isso mantém
// o motor sem acesso ao banco e dá ao P5 um vocabulário fechado.
export interface AutomationFieldDef {
  path: string;
  label: string;
  type: 'text' | 'enum' | 'number' | 'date' | 'boolean';
  options?: Array<{ value: string; label: string }>;
  events?: AutomationEventId[]; // ausente = todos os eventos
}

const LEAD_STATUS_OPTIONS = [
  { value: 'new', label: 'Novo' },
  { value: 'contacted', label: 'Contatado' },
  { value: 'qualified', label: 'Qualificado' },
  { value: 'converted', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
];

const LEAD_ORIGIN_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'formulario', label: 'Formulário' },
  { value: 'orcamento', label: 'Orçamento' },
  { value: 'agendamento', label: 'Agendamento' },
  { value: 'agente', label: 'Assistente' },
  { value: 'api', label: 'API' },
  { value: 'external_site', label: 'Site externo' },
  { value: 'landing_page', label: 'Landing page' },
  { value: 'automacao', label: 'Automação' },
  { value: 'manual', label: 'Manual' },
];

const BOOKING_STATUS_OPTIONS = [
  { value: 'pending', label: 'Aguardando' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'completed', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'no_show', label: 'Não compareceu' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

export const AUTOMATION_FIELDS: AutomationFieldDef[] = [
  { path: 'event.name', label: 'Evento', type: 'text' },
  { path: 'event.isNew', label: 'É cadastro novo', type: 'boolean' },
  { path: 'event.at', label: 'Data do evento', type: 'date' },
  { path: 'event.previousStageId', label: 'Etapa anterior', type: 'text', events: ['lead.stage_changed'] },
  { path: 'event.stageId', label: 'Nova etapa', type: 'text', events: ['lead.stage_changed'] },
  { path: 'event.note', label: 'Observação do evento', type: 'text' },
  { path: 'lead.id', label: 'Lead · id', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.name', label: 'Lead · nome', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.phone', label: 'Lead · telefone', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.email', label: 'Lead · e-mail', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.origin', label: 'Lead · origem', type: 'enum', options: LEAD_ORIGIN_OPTIONS, events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.channel', label: 'Lead · canal', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.status', label: 'Lead · status', type: 'enum', options: LEAD_STATUS_OPTIONS, events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.stageId', label: 'Lead · etapa da esteira', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.priority', label: 'Lead · prioridade', type: 'enum', options: PRIORITY_OPTIONS, events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.assignedUserId', label: 'Lead · responsável', type: 'text', events: ['lead.created', 'lead.updated', 'lead.assigned'] },
  { path: 'lead.interest', label: 'Lead · interesse', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.serviceId', label: 'Lead · serviço de interesse', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.bookingId', label: 'Lead · agendamento', type: 'text', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'lead.createdAt', label: 'Lead · criado em', type: 'date', events: ['lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned'] },
  { path: 'customer.name', label: 'Cliente · nome', type: 'text', events: ['customer.created', 'customer.updated', 'lead.created', 'lead.updated'] },
  { path: 'customer.phone', label: 'Cliente · telefone', type: 'text', events: ['customer.created', 'customer.updated', 'lead.created', 'lead.updated'] },
  { path: 'customer.email', label: 'Cliente · e-mail', type: 'text', events: ['customer.created', 'customer.updated'] },
  { path: 'customer.source', label: 'Cliente · origem na base', type: 'text', events: ['customer.created', 'customer.updated'] },
  { path: 'customer.marketingOptIn', label: 'Cliente · aceita campanhas', type: 'boolean', events: ['customer.created', 'customer.updated'] },
  { path: 'booking.id', label: 'Agendamento · id', type: 'text', events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'booking.status', label: 'Agendamento · status', type: 'enum', options: BOOKING_STATUS_OPTIONS, events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'booking.date', label: 'Agendamento · data', type: 'date', events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'booking.time', label: 'Agendamento · hora', type: 'text', events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'booking.serviceId', label: 'Agendamento · serviço', type: 'text', events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'booking.professionalId', label: 'Agendamento · profissional', type: 'text', events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'booking.leadId', label: 'Agendamento · lead de origem', type: 'text', events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'booking.customerName', label: 'Agendamento · cliente', type: 'text', events: ['booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed'] },
  { path: 'service.id', label: 'Serviço · id', type: 'text' },
  { path: 'service.name', label: 'Serviço · nome', type: 'text' },
  { path: 'service.durationMin', label: 'Serviço · duração (min)', type: 'number' },
  { path: 'business.name', label: 'Empresa · nome', type: 'text' },
];

export function automationFieldDef(path: string): AutomationFieldDef | undefined {
  return AUTOMATION_FIELDS.find((f) => f.path === path);
}

/** Rótulo legível de um caminho (usado no histórico e no editor). */
export function automationFieldLabel(path: string): string {
  const def = automationFieldDef(path);
  if (def) return def.label.replace(/^([^·]+) · /, (m) => m).replace(' · ', ' ');
  return path;
}

/** Campos oferecidos para um evento (a UI nunca mostra campo inaplicável). */
export function fieldsForEvent(event: AutomationEventId | ''): AutomationFieldDef[] {
  return AUTOMATION_FIELDS.filter((f) => !f.events || !event || f.events.includes(event));
}

/** O caminho é lido pelo motor? (whitelist — nada de campo inventado). */
export function isFieldAllowed(path: string, event?: AutomationEventId | ''): boolean {
  const def = automationFieldDef(path);
  if (!def) return false;
  if (!event) return true;
  if (!def.events) return true;
  return def.events.includes(event);
}

// ═══════════════════════════════════════════════════════════════
// AÇÕES (P4.5) — catálogo; a execução está em actions.ts
// ═══════════════════════════════════════════════════════════════
export interface AutomationActionFieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'service' | 'stage' | 'member' | 'user';
  required?: boolean;
  /** `{{lead.name}}` é permitido (substituição literal, sem expressão). */
  template?: boolean;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  max?: number;
}

export interface AutomationActionDef {
  type: AutomationActionType;
  label: string;
  /** Frase para "Então: [Alterar etapa]". */
  short: string;
  hint: string;
  /** Qual serviço oficial do sistema é chamado (reutilização, não cópia). */
  delegate: string;
  fields: AutomationActionFieldDef[];
  requires?: CapabilityId;
  /** true quando a ação só faz sentido com o assunto do evento sendo do tipo. */
  needs?: Partial<Record<AutomationEntity, boolean>>;
}

const STAGE_FIELD: AutomationActionFieldDef = {
  key: 'stageId', label: 'Etapa', type: 'stage', required: true,
  hint: 'Vale pelo motor oficial da esteira (movimento + histórico).',
};

export const AUTOMATION_ACTION_DEFS: AutomationActionDef[] = [
  {
    type: 'change_lead_stage', label: 'Alterar etapa do lead', short: 'Alterar etapa',
    hint: 'Move o lead na esteira pelo motor do P3 (histórico e status inclusos).',
    delegate: 'lib/pipeline.ts · moveLeadStage',
    fields: [STAGE_FIELD, { key: 'note', label: 'Motivo (opcional)', type: 'text', template: true, max: 300 }],
    needs: { lead: true },
  },
  {
    type: 'assign_lead', label: 'Atribuir responsável', short: 'Atribuir responsável',
    hint: 'Define quem cuida do lead. Também distribui em rodízio (menos ocupado).',
    delegate: 'lib/pipeline.ts · assignLead (validação de equipe incluída)',
    fields: [
      {
        key: 'target', label: 'Para', type: 'select', required: true,
        options: [
          { value: 'member', label: 'Uma pessoa da equipe' },
          { value: 'auto', label: 'Rodízio (menos ocupado agora)' },
        ],
      },
      { key: 'userId', label: 'Pessoa', type: 'member', hint: 'Só quem pertence a esta unidade.' },
      { key: 'note', label: 'Recado no histórico', type: 'text', template: true, max: 300 },
    ],
    needs: { lead: true },
  },
  {
    type: 'add_lead_note', label: 'Adicionar observação', short: 'Adicionar observação',
    hint: 'Recado para a equipe no lead (e no cliente, se houver vínculo).',
    delegate: 'lib/pipeline.ts · addLeadNote',
    fields: [{ key: 'text', label: 'Texto', type: 'textarea', required: true, template: true, max: 1000 }],
    needs: { lead: true },
  },
  {
    type: 'update_lead', label: 'Atualizar o lead', short: 'Atualizar o lead',
    hint: 'Ajusta prioridade, interesse ou próxima ação prevista.',
    delegate: 'lib/pipeline.ts · updateLeadFields',
    fields: [
      { key: 'priority', label: 'Prioridade', type: 'select', options: PRIORITY_OPTIONS },
      { key: 'interest', label: 'Interesse', type: 'text', template: true, max: 500 },
      { key: 'nextAction', label: 'Próxima ação', type: 'text', template: true, max: 300 },
    ],
    needs: { lead: true },
  },
  {
    type: 'update_customer', label: 'Atualizar o cliente', short: 'Atualizar o cliente',
    hint: 'Altera o contato no CRM (nome/e-mail/consentimento) e registra observação.',
    delegate: 'lib/contacts.ts · upsertContact / addContactNote',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', template: true, max: 80 },
      { key: 'email', label: 'E-mail', type: 'text', template: true, max: 120 },
      { key: 'note', label: 'Observação (append-only)', type: 'textarea', template: true, max: 1000 },
      { key: 'marketingOptIn', label: 'Aceita campanhas', type: 'boolean', hint: 'Nunca presumido: a automação só marca o que o gatilho já autorizou.' },
    ],
  },
  {
    type: 'create_task', label: 'Criar tarefa', short: 'Criar tarefa',
    hint: 'Coloca uma pendência para a equipe (na lista de tarefas da unidade).',
    delegate: 'lib/automation/tasks.ts · createTaskTx',
    fields: [
      { key: 'title', label: 'Tarefa', type: 'text', required: true, template: true, max: 140 },
      { key: 'note', label: 'Detalhes', type: 'textarea', template: true, max: 1000 },
      { key: 'dueInMinutes', label: 'Prazo (minutos a partir de agora)', type: 'number', hint: 'Vazio = sem prazo.' },
      { key: 'assignee', label: 'Responsável', type: 'select', options: [
        { value: 'none', label: 'Qualquer um' },
        { value: 'leadOwner', label: 'Responsável do lead' },
        { value: 'member', label: 'Uma pessoa da equipe' },
      ] },
      { key: 'assignedUserId', label: 'Pessoa', type: 'member' },
    ],
  },
  {
    type: 'create_booking', label: 'Criar agendamento', short: 'Criar agendamento',
    hint: 'Reserva pelo motor oficial da agenda (slot, profissional e conflitos).',
    delegate: 'lib/pipeline.ts · bookLead → lib/booking-create.ts',
    requires: 'automation.advanced',
    fields: [
      { key: 'serviceId', label: 'Serviço', type: 'service', required: true },
      { key: 'date', label: 'Data', type: 'text', template: true, hint: 'YYYY-MM-DD. Vazio usa "em N dias".' },
      { key: 'time', label: 'Hora', type: 'text', template: true, hint: 'HH:MM.' },
      { key: 'daysFromTrigger', label: 'Em quantos dias', type: 'number', hint: 'Alternativa à data fixa.' },
      { key: 'note', label: 'Observação', type: 'textarea', template: true, max: 300 },
    ],
    needs: { lead: true },
  },
  {
    type: 'cancel_booking', label: 'Cancelar agendamento', short: 'Cancelar agendamento',
    hint: 'Cancela pelo fluxo oficial (histórico + automações de mensagem do P3).',
    delegate: 'lib/booking-ops.ts · applyBookingStatusTx',
    requires: 'automation.advanced',
    fields: [{ key: 'reason', label: 'Motivo', type: 'text', template: true, max: 300 }],
    needs: { booking: true },
  },
  {
    type: 'dispatch_webhook', label: 'Enviar webhook de saída', short: 'Enviar webhook',
    hint: 'Avisa um sistema externo pelo canal oficial do P3 (HMAC + retry).',
    delegate: 'lib/webhooks.ts · dispatchWebhook',
    requires: 'automation.advanced',
    fields: [
      {
        key: 'event', label: 'Evento', type: 'select', required: true,
        options: VALID_WEBHOOK_EVENTS.map((e) => ({ value: e, label: e })),
      },
      { key: 'note', label: 'Recado no payload', type: 'text', template: true, max: 300 },
    ],
  },
];

export function automationActionDef(type: unknown): AutomationActionDef | undefined {
  return AUTOMATION_ACTION_DEFS.find((a) => a.type === type);
}

export const AUTOMATION_ACTION_TYPES: AutomationActionType[] = AUTOMATION_ACTION_DEFS.map((a) => a.type);

// ═══════════════════════════════════════════════════════════════
// TIPOS DE NÓ (P4.4/P4.6)
// ═══════════════════════════════════════════════════════════════
export const NODE_TYPE_DEFS: Record<AutomationNodeType, { label: string; hint: string }> = {
  trigger: { label: 'Quando', hint: 'O evento que liga a automação.' },
  condition: { label: 'Se', hint: 'Caminho "sim" ou "não".' },
  branch: { label: 'Ramificação', hint: 'Vários caminhos, avaliados em ordem.' },
  action: { label: 'Então', hint: 'Uma ação sobre os dados reais.' },
  wait: { label: 'Depois', hint: 'Espera e continua sozinha.' },
  end: { label: 'Fim', hint: 'Encerra a execução.' },
};

export const WAIT_MINUTE_PRESETS = [
  { label: '10 minutos', minutes: 10 },
  { label: '30 minutos', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: '1 dia', minutes: 1440 },
  { label: '2 dias', minutes: 2880 },
  { label: '7 dias', minutes: 10080 },
];

export interface WaitResolution {
  ok: boolean;
  /** Momento ISO em que a execução retoma. */
  resumeAt: string;
  /** Rótulo humano ("2 horas", "amanhã às 09:00"). */
  label: string;
  error?: string;
}

/**
 * P4.6 — calcula o ponto de retomada de uma espera.
 * `duration`: minutos a partir de `now`; `until`: data/hora do produto
 * (aceita `YYYY-MM-DDTHH:mm` e "amanhã 09:00" normalizado pela UI).
 * A espera é SEMRE persistida — nada segura requisição HTTP aberta.
 */
export function resolveWait(
  wait: AutomationWaitConfig | undefined,
  now = new Date(),
  limits: CapabilityLimits = ADVANCED_LIMITS,
): WaitResolution {
  const mode = String(wait?.mode || 'duration');
  if (mode === 'event') {
    return {
      ok: false, resumeAt: '', label: '',
      error: 'espera por evento ainda não está disponível nesta versão',
    };
  }
  if (mode === 'until') {
    const raw = String(wait?.at || '').trim();
    const iso = normalizeDateTimeInput(raw);
    if (!iso) return { ok: false, resumeAt: '', label: raw, error: 'data/hora de retomada inválida' };
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return { ok: false, resumeAt: '', label: raw, error: 'data/hora ilegível' };
    if (at <= now.getTime()) {
      // Passado: retoma imediatamente (falha segura — nunca espera para sempre).
      return { ok: true, resumeAt: now.toISOString(), label: 'imediatamente (data já passou)' };
    }
    const minutes = Math.round((at - now.getTime()) / 60000);
    if (minutes > limits.maxWaitMinutes) {
      return { ok: false, resumeAt: '', label: raw, error: `espera maior que o limite (${limits.maxWaitMinutes} min)` };
    }
    return { ok: true, resumeAt: iso, label: `até ${iso.slice(0, 16).replace('T', ' ')}` };
  }

  const minutes = Math.floor(Number(wait?.minutes ?? 0));
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { ok: false, resumeAt: '', label: '', error: 'duração da espera inválida' };
  }
  if (minutes > limits.maxWaitMinutes) {
    return { ok: false, resumeAt: '', label: '', error: `espera maior que o limite (${limits.maxWaitMinutes} min)` };
  }
  return {
    ok: true,
    resumeAt: new Date(now.getTime() + minutes * 60000).toISOString(),
    label: humanDuration(minutes),
  };
}

/** `2026-09-17T09:00` (aceita varredura de UI: espaço, segundos opcionais). */
export function normalizeDateTimeInput(raw: string): string {
  const value = String(raw || '').trim().replace(' ', 'T');
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return '';
  const [, y, mo, d, h, mi, s] = m;
  const yNum = Number(y);
  if (yNum < 2000 || yNum > 2100) return '';
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return '';
  if (Number(h) > 23 || Number(mi) > 59 || Number(s || 0) > 59) return '';
  const base = `${y}-${mo}-${d}T${h}:${mi}`;
  return base;
}

export function humanDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  if (m < 60) return `${m} minuto${m === 1 ? '' : 's'}`;
  if (m < 1440) {
    const h = m / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} hora${h === 1 ? '' : 's'}`;
  }
  const d = m / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1).replace('.', ',')} dia${Math.round(d) === 1 ? '' : 's'}`;
}

// ═══════════════════════════════════════════════════════════════
// ANÁLISE E VALIDAÇÃO DO GRAFO (P4.4)
// ═══════════════════════════════════════════════════════════════
export interface GraphReport {
  errors: string[];
  warnings: string[];
  triggerId: string;
  reachable: string[];
  maxDepth: number;
}

export function nodeMap(nodes: AutomationNode[]): Map<string, AutomationNode> {
  const map = new Map<string, AutomationNode>();
  for (const n of nodes) if (n && n.id) map.set(n.id, n);
  return map;
}

export function outgoingEdges(nodeId: string, edges: AutomationEdge[]): AutomationEdge[] {
  return edges.filter((e) => e && e.from === nodeId);
}

/**
 * Próximo nó seguindo as arestas. Em condição/ramificação o `branch` escolhe o
 * caminho; sem aresta correspondente, a execução termina (falha segura).
 */
export function nextNodeId(
  fromId: string,
  edges: AutomationEdge[],
  branch = '',
): string {
  const list = outgoingEdges(fromId, edges);
  if (list.length === 0) return '';
  if (branch) {
    const exact = list.find((e) => (e.branch || '') === branch);
    if (exact) return exact.to;
  }
  const fallback = list.find((e) => !e.branch || e.branch === 'next');
  return fallback?.to || (list.length === 1 ? list[0].to : '');
}

/** Nós alcançáveis a partir do gatilho (BFS). */
function reachableIds(nodes: AutomationNode[], edges: AutomationEdge[], startId: string): Set<string> {
  const out = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const e of edges) if (e.from === id && !out.has(e.to)) queue.push(e.to);
  }
  return out;
}

/**
 * Ciclo existe? Retorna o caminho (para a mensagem). Ciclo SEM espera é erro;
 * com `wait` no caminho é permitido e limitado por passos pelo executor.
 */
function findCycle(nodes: AutomationNode[], edges: AutomationEdge[], startId: string): string[] {
  const byId = nodeMap(nodes);
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seen = new Set<string>();
  let cycle: string[] = [];

  const dfs = (id: string): boolean => {
    if (cycle.length) return true;
    if (onStack.has(id)) {
      const at = stack.indexOf(id);
      cycle = at === -1 ? [id] : [...stack.slice(at), id];
      return true;
    }
    if (seen.has(id)) return false;
    seen.add(id);
    onStack.add(id);
    stack.push(id);
    for (const e of edges) {
      const next = byId.get(e.to);
      if (!next || e.from !== id) continue;
      if (dfs(e.to)) return true;
    }
    stack.pop();
    onStack.delete(id);
    return false;
  };
  dfs(startId);
  return cycle;
}

/** Rótulo curto de um nó (para mensagens de validação). */
export function nodeLabel(node: AutomationNode): string {
  if (node.label && node.label.trim()) return node.label.trim();
  if (node.type === 'trigger') return automationEventLabel(node.config.event);
  if (node.type === 'action') return automationActionDef(node.config.action?.type)?.label || 'ação';
  if (node.type === 'wait') return 'espera';
  if (node.type === 'condition') return 'condição';
  if (node.type === 'branch') return 'ramificação';
  return NODE_TYPE_DEFS[node.type]?.label || node.type;
}

/** Estrutura do grafo: referências, alcançabilidade, ciclos e terminais. */
export function analyzeGraph(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
  opts: { maxNodes: number } = { maxNodes: ADVANCED_LIMITS.maxNodes },
): GraphReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (!n.id) { errors.push('existe nó sem identificador'); continue; }
    if (ids.has(n.id)) errors.push(`nó duplicado: ${n.id}`);
    ids.add(n.id);
  }
  if (nodes.length > opts.maxNodes) errors.push(`automação grande demais (${nodes.length} nós, máximo ${opts.maxNodes})`);

  for (const e of edges) {
    if (!ids.has(e.from)) errors.push(`aresta parte de um nó inexistente (${e.from})`);
    if (!ids.has(e.to)) errors.push(`aresta aponta para um nó inexistente (${e.to})`);
  }

  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) errors.push('a automação precisa de um gatilho');
  if (triggers.length > 1) warnings.push('mais de um gatilho: só o primeiro é usado');
  const triggerId = triggers[0]?.id || nodes[0]?.id || '';

  const reachable = triggerId ? reachableIds(nodes, edges, triggerId) : new Set<string>();
  const orphans = nodes.filter((n) => !reachable.has(n.id));
  if (orphans.length > 0 && triggerId) {
    warnings.push(`${orphans.length} nó(s) fora do caminho do gatilho: ${orphans.map((o) => nodeLabel(o)).join(', ')}`);
  }

  const cycle = triggerId ? findCycle(nodes, edges, triggerId) : [];
  if (cycle.length) {
    const byId = nodeMap(nodes);
    const hasWait = cycle.some((id) => byId.get(id)?.type === 'wait');
    const path = cycle.map((id) => nodeLabel(byId.get(id) || ({ id, type: 'end', config: {} } as AutomationNode))).join(' → ');
    if (hasWait) warnings.push(`ciclo com espera é permitido e limitado por passos (${path})`);
    else errors.push(`ciclo sem espera (execução nunca terminaria): ${path}`);
  }

  let maxDepth = 0;
  const byId = nodeMap(nodes);
  const walk = (id: string, depth: number, guard: Set<string>): void => {
    if (guard.has(id) || depth > 500) return;
    maxDepth = Math.max(maxDepth, depth);
    guard.add(id);
    for (const e of edges) if (e.from === id && byId.has(e.to)) walk(e.to, depth + 1, new Set(guard));
    guard.delete(id);
  };
  if (triggerId) walk(triggerId, 1, new Set());

  for (const n of nodes) {
    if (n.type === 'condition' || n.type === 'branch') {
      const list = outgoingEdges(n.id, edges);
      if (list.length === 0) warnings.push(`"${nodeLabel(n)}" não tem nenhum caminho depois`);
    }
    if (n.type === 'action' && outgoingEdges(n.id, edges).length === 0) {
      // ok: ação final encerra a execução — apenas informativo para a UI.
    }
  }

  return { errors, warnings, triggerId, reachable: [...reachable], maxDepth };
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZAÇÃO/VALIDAÇÃO DA DEFINIÇÃO (P4.1) — usada pela API e pelo motor
// ═══════════════════════════════════════════════════════════════
export interface ValidateContext {
  limits?: CapabilityLimits;
  /** Etapas válidas da esteira da unidade (para validar `change_lead_stage`). */
  stageIds?: string[];
  /** Serviços ativos da unidade (para validar `create_booking`). */
  serviceIds?: string[];
  /** Usuários que podem ser responsáveis nesta unidade. */
  userIds?: string[];
  /** Capacidades efetivas da unidade (capacidades.ts) — ações restritas. */
  businessCaps?: Record<string, boolean>;
  now?: string;
  idFactory?: () => string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  automation: Omit<Automation, 'createdAt' | 'updatedAt' | 'version'>;
}

const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;
const MAX_LABEL = 80;

function cleanString(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f<>]/g, (c) => (c === '\n' || c === '\t' ? c : ' ')).trim().slice(0, max);
}

/** Remove chaves de objeto que não podem vir de entrada externa. */
function sanitizeParams(params: unknown): Record<string, any> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) continue;
    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
    if (typeof v === 'object' && v !== null) {
      // Só valores escalares dentro de params (nada de objeto profundo do cliente).
      const flat: Record<string, any> = {};
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 === null || ['string', 'number', 'boolean'].includes(typeof v2)) flat[k2] = v2;
      }
      out[k] = flat;
      continue;
    }
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}

function validateConditionValue(value: unknown): value is string | number | boolean | null {
  return value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** Condição → estrutura limpa e segura (recursiva). `null` quando vazia. */
export function sanitizeCondition(input: unknown, event: AutomationEventId | ''): {
  condition: AutomationCondition | null;
  errors: string[];
} {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { condition: null, errors };
  const raw = input as Record<string, unknown>;

  if (Array.isArray(raw.conditions)) {
    const logic = String(raw.logic || 'and').toLowerCase();
    if (!['and', 'or', 'not'].includes(logic)) {
      errors.push(`operador lógico inválido: ${logic}`);
      return { condition: null, errors };
    }
    const list = (raw.conditions as unknown[]).slice(0, 20);
    if (list.length === 0) return { condition: null, errors };
    if (logic === 'not' && list.length > 1) errors.push('NOT aceita apenas uma condição (use E/OU dentro dela)');
    const conditions: AutomationCondition[] = [];
    for (const item of list) {
      const sub = sanitizeCondition(item, event);
      errors.push(...sub.errors);
      if (sub.condition) conditions.push(sub.condition);
    }
    if (conditions.length === 0) return { condition: null, errors };
    if (logic === 'not') return { condition: { logic: 'not', conditions: [conditions[0]] }, errors };
    return { condition: { logic: logic as 'and' | 'or', conditions }, errors };
  }

  const field = cleanString(raw.field, 80);
  const operator = cleanString(raw.operator, 20);
  if (!field) {
    errors.push('condição sem campo');
    return { condition: null, errors };
  }
  if (!isFieldAllowed(field, event || undefined)) {
    errors.push(`campo não disponível para este gatilho: ${field}`);
    return { condition: null, errors };
  }
  const allowedOps = ['equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists', 'greater_than', 'less_than'];
  if (!allowedOps.includes(String(operator))) {
    errors.push(`operador inválido: ${operator}`);
    return { condition: null, errors };
  }
  const def = automationFieldDef(field);
  const value = raw.value;
  if (!validateConditionValue(value)) {
    errors.push(`valor de condição precisa ser texto, número, booleano ou nulo (${field})`);
    return { condition: null, errors };
  }
  const needsValue = operator !== 'exists' && operator !== 'not_exists';
  if (needsValue && (value === undefined || value === null || String(value).trim() === '')) {
    errors.push(`informe o valor da condição "${def?.label || field}"`);
  }
  const condition: AutomationCondition = {
    field,
    operator: operator as ConditionOperator,
    ...(needsValue ? { value: cleanString(value, 120) as string } : {}),
  };
  return { condition, errors };
}

function sanitizeWait(input: unknown, limits: CapabilityLimits): { wait: AutomationWaitConfig | null; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { wait: null, errors: ['nó de espera sem configuração'] };
  const raw = input as Record<string, unknown>;
  const mode = String(raw.mode || 'duration');
  if (mode === 'event') {
    return { wait: { mode: 'event', waitForEvent: cleanString(raw.waitForEvent, 60) }, errors };
  }
  if (mode === 'until') {
    const at = normalizeDateTimeInput(String(raw.at || ''));
    if (!at) errors.push('espera "até" precisa de data e hora no formato AAAA-MM-DD HH:MM');
    return { wait: { mode: 'until', ...(at ? { at } : {}) }, errors };
  }
  const minutes = Math.floor(Number(raw.minutes));
  if (!Number.isFinite(minutes) || minutes <= 0) {
    errors.push('espera precisa de uma duração em minutos');
    return { wait: { mode: 'duration', minutes: 0 }, errors };
  }
  if (minutes > limits.maxWaitMinutes) {
    errors.push(`espera de ${minutes} min acima do limite (${limits.maxWaitMinutes} min)`);
    return { wait: { mode: 'duration', minutes: limits.maxWaitMinutes }, errors };
  }
  return { wait: { mode: 'duration', minutes }, errors };
}

/** Sanitiza e valida um único nó (usado na validação e na leitura defensiva). */
export function sanitizeNode(input: unknown, event: AutomationEventId | '', ctx: ValidateContext = {}): {
  node: AutomationNode | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input || typeof input !== 'object') return { node: null, errors: ['nó inválido'] , warnings };
  const raw = input as Record<string, unknown>;
  const type = String(raw.type || '') as AutomationNodeType;
  if (!['trigger', 'condition', 'branch', 'action', 'wait', 'end'].includes(type)) {
    return { node: null, errors: [`tipo de nó desconhecido: ${type}`], warnings };
  }
  const id = cleanString(raw.id, 64).replace(/\s+/g, '-') || `n_${uid()}`;
  const configIn = (raw.config && typeof raw.config === 'object' ? raw.config : {}) as Record<string, unknown>;
  const config: AutomationNodeConfig = {};
  const label = cleanString(raw.label, MAX_LABEL);

  if (type === 'trigger') {
    const eventId = String(configIn.event || raw.event || event || '') as AutomationEventId;
    if (!isAutomationEvent(eventId)) {
      return { node: null, errors: [`gatilho desconhecido: ${eventId}`], warnings };
    }
    config.event = eventId;
  } else if (type === 'condition' || type === 'branch') {
    if (type === 'condition') {
      const { condition, errors: condErrors } = sanitizeCondition(configIn.condition, event);
      errors.push(...condErrors);
      if (condition) config.condition = condition;
      else errors.push('a condição está incompleta');
    } else {
      const list = Array.isArray(configIn.branches) ? configIn.branches.slice(0, 8) : [];
      if (list.length === 0) errors.push('ramificação precisa de ao menos um caminho');
      const branches: NonNullable<AutomationNodeConfig['branches']> = [];
      for (const b of list) {
        const idb = cleanString((b as any)?.id, 32) || `b_${branches.length + 1}`;
        const { condition, errors: ce } = sanitizeCondition((b as any)?.condition, event);
        errors.push(...ce);
        if (!condition) { errors.push(`ramo "${idb}" sem condição`); continue; }
        branches.push({ id: idb, label: cleanString((b as any)?.label, MAX_LABEL) || idb, condition });
      }
      if (branches.length) config.branches = branches;
    }
  } else if (type === 'action') {
    const actionIn = (configIn.action && typeof configIn.action === 'object' ? configIn.action : {}) as Record<string, unknown>;
    const actionType = String(actionIn.type || '') as AutomationActionType;
    const def = automationActionDef(actionType);
    if (!def) {
      errors.push(`ação desconhecida: ${actionType || '(vazia)'}`);
      return { node: null, errors, warnings };
    }
    const params = sanitizeParams(actionIn.params);
    for (const field of def.fields) {
      if (field.required && (params[field.key] === undefined || String(params[field.key]).trim() === '')) {
        errors.push(`falta o campo "${field.label}" na ação ${def.label}`);
      }
      if (typeof params[field.key] === 'string') params[field.key] = cleanString(params[field.key], field.max || 1000);
      if (field.type === 'number' && params[field.key] !== undefined) {
        const n = Number(params[field.key]);
        if (!Number.isFinite(n)) { delete params[field.key]; errors.push(`"${field.label}" precisa ser um número`); }
        else params[field.key] = n;
      }
      if (field.type === 'stage' && params[field.key] !== undefined && ctx.stageIds) {
        const want = String(params[field.key]);
        const alias = resolveStageAlias(want, ctx.stageIds);
        if (!alias) errors.push(`a etapa "${want}" não existe na esteira desta empresa`);
        else params[field.key] = alias;
      }
      if (field.type === 'service' && params[field.key] !== undefined && ctx.serviceIds) {
        if (!ctx.serviceIds.includes(String(params[field.key]))) errors.push(`o serviço informado não existe nesta empresa`);
      }
    }
    // Campos fora do catálogo são descartados (nunca passados adiante).
    const known = new Set(def.fields.map((f) => f.key));
    for (const key of Object.keys(params)) if (!known.has(key)) delete params[key];
    config.action = { type: actionType, params };
  } else if (type === 'wait') {
    const { wait, errors: we } = sanitizeWait(configIn.wait, ctx.limits || ADVANCED_LIMITS);
    errors.push(...we);
    if (wait) config.wait = wait;
  }

  return { node: { id, type, ...(label ? { label } : {}), config }, errors, warnings };
}

/** Alias de etapa: aceita rótulo/idioma (o motor já tem STAGE_ALIASES no P3). */
export function resolveStageAlias(input: string, stageIds: string[]): string {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  const direct = stageIds.find((s) => s === raw);
  if (direct) return direct;
  const byName = stageIds.find((s) => s.replace(/[^a-z0-9]/g, '') === raw.replace(/[^a-z0-9]/g, ''));
  return byName || '';
}

export interface AutomationDraft {
  id?: string;
  name?: string;
  description?: string;
  active?: boolean;
  event?: AutomationEventId;
  condition?: unknown;
  nodes?: unknown[];
  edges?: unknown[];
  settings?: Record<string, unknown>;
  templateId?: string;
}

/** Valida um rascunho (forma do editor linear OU grafo explícito). */
export function validateAutomationDraft(
  draft: AutomationDraft,
  ctx: ValidateContext = {},
): ValidationResult {
  const limits = ctx.limits || ADVANCED_LIMITS;
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = cleanString(draft.name, MAX_NAME);
  if (!name) errors.push('dê um nome para a automação');
  const description = cleanString(draft.description, MAX_DESCRIPTION);
  const active = draft.active !== false;

  // Forma do editor: quando o grafo não vem pronto, deriva dele.
  let nodes = Array.isArray(draft.nodes) ? draft.nodes : [];
  let edges = Array.isArray(draft.edges) ? draft.edges : [];
  const event = (draft.event || '') as AutomationEventId;
  if (nodes.length === 0) {
    if (!isAutomationEvent(event)) {
      errors.push('escolha um gatilho (o "quando")');
    } else {
      const built = linearToGraph({
        event,
        condition: sanitizeCondition(draft.condition, event).condition,
        steps: [],
      });
      nodes = built.nodes;
      edges = built.edges;
    }
  }

  const triggerEvent = isAutomationEvent(event)
    ? event
    : (((nodes as any[]).find((n: any) => n?.type === 'trigger')?.config?.event) as AutomationEventId | undefined) || '';
  if (!isAutomationEvent(triggerEvent)) errors.push('a automação precisa de um gatilho válido');

  const cleanNodes: AutomationNode[] = [];
  for (const rawNode of nodes) {
    const { node, errors: ne, warnings: nw } = sanitizeNode(rawNode, triggerEvent, { ...ctx, limits });
    errors.push(...ne);
    warnings.push(...nw);
    if (node) cleanNodes.push(node);
  }
  if (cleanNodes.length === 0) errors.push('a automação precisa de ao menos um nó');

  const ids = new Set(cleanNodes.map((n) => n.id));
  if (ids.size !== cleanNodes.length) errors.push('existem nós com o mesmo identificador');
  const cleanEdges: AutomationEdge[] = [];
  for (const rawEdge of edges) {
    const e = rawEdge as Record<string, unknown>;
    const from = cleanString(e?.from, 64);
    const to = cleanString(e?.to, 64);
    if (!from || !to) continue;
    if (!ids.has(from) || !ids.has(to)) {
      errors.push(`conexão aponta para nó inexistente (${from} → ${to})`);
      continue;
    }
    cleanEdges.push({ from, to, ...(e.branch ? { branch: cleanString(e.branch, 16) } : {}) });
  }

  const report = analyzeGraph(cleanNodes, cleanEdges, { maxNodes: limits.maxNodes });
  errors.push(...report.errors);
  warnings.push(...report.warnings);

  // Condições: campos precisam existir no catálogo do evento.
  for (const n of cleanNodes) {
    const conds: (AutomationCondition | undefined)[] = [
      n.config.condition,
      ...(n.config.branches || []).map((b) => b.condition),
    ];
    for (const c of conds) {
      for (const field of conditionFields(c)) {
        if (!isFieldAllowed(field, triggerEvent)) {
          errors.push(`campo indisponível para o gatilho "${triggerEvent}": ${field}`);
        }
      }
      if (isConditionGroup(c) && c.conditions.length > 20) errors.push('muitas condições em um grupo');
    }
  }

  // Ações exigidas por capacidade (checagem POR UNIDADE, não no executor).
  const caps = ctx.businessCaps;
  for (const n of cleanNodes) {
    if (n.type !== 'action') continue;
    const def = automationActionDef(n.config.action?.type);
    if (!def?.requires) continue;
    if (caps && caps[def.requires] === false) {
      errors.push(`a ação "${def.label}" exige o recurso "${def.requires}" (não liberado para esta empresa)`);
    }
  }

  const triggerCondition = sanitizeCondition(draft.condition, triggerEvent).condition;

  const settingsIn = (draft.settings && typeof draft.settings === 'object' ? draft.settings : {}) as Record<string, unknown>;
  const settings: AutomationSettings = {};
  const maxSteps = Math.floor(Number(settingsIn.maxSteps));
  if (Number.isFinite(maxSteps) && maxSteps > 0) settings.maxSteps = Math.min(maxSteps, limits.maxStepsPerRun);
  const maxWait = Math.floor(Number(settingsIn.maxWaitMinutes));
  if (Number.isFinite(maxWait) && maxWait > 0) settings.maxWaitMinutes = Math.min(maxWait, limits.maxWaitMinutes);
  if (typeof settingsIn.allowReentry === 'boolean') settings.allowReentry = settingsIn.allowReentry;
  if (typeof settingsIn.stopOnActionError === 'boolean') settings.stopOnActionError = settingsIn.stopOnActionError;
  const dedupeField = cleanString(settingsIn.dedupeField, 80);
  if (dedupeField && isFieldAllowed(dedupeField, triggerEvent)) settings.dedupeField = dedupeField;
  else if (dedupeField) warnings.push(`campo de deduplicação inválido ignorado: ${dedupeField}`);

  const automation: Omit<Automation, 'createdAt' | 'updatedAt' | 'version'> = {
    id: cleanString(draft.id, 64),
    businessId: '', // preenchido pela camada de API (nunca pelo cliente)
    name: name || 'Automação sem nome',
    description,
    active,
    trigger: {
      event: (triggerEvent || 'lead.created') as AutomationEventId,
      ...(triggerCondition ? { condition: triggerCondition } : {}),
    },
    nodes: cleanNodes,
    edges: cleanEdges,
    settings,
    ...(draft.templateId ? { templateId: cleanString(draft.templateId, 40) } : {}),
    createdByUserId: cleanString((draft as any).createdByUserId, 64) || undefined,
  };

  return { ok: errors.length === 0, errors, warnings, automation };
}

// ═══════════════════════════════════════════════════════════════
// PROJEÇÃO LINEAR ⇄ GRAFO (a interface simples sobre o modelo poderoso)
// ═══════════════════════════════════════════════════════════════
export type LinearStepKind = 'action' | 'wait' | 'condition';

export interface LinearStep {
  kind: LinearStepKind;
  label?: string;
  action?: { type: AutomationActionType; params: Record<string, any> };
  wait?: AutomationWaitConfig;
  condition?: AutomationCondition;
}

export interface LinearAutomation {
  event: AutomationEventId;
  /** "Se" de entrada: caminho sim = steps, caminho não = elseSteps. */
  condition?: AutomationCondition | null;
  steps: LinearStep[];
  elseSteps?: LinearStep[];
}

function linearNode(step: LinearStep, id: string): AutomationNode {
  const config: AutomationNodeConfig = {};
  if (step.kind === 'action' && step.action) config.action = step.action;
  if (step.kind === 'wait') config.wait = step.wait || { mode: 'duration', minutes: 0 };
  if (step.kind === 'condition' && step.condition) config.condition = step.condition;
  const type: AutomationNodeType = step.kind === 'action' ? 'action' : step.kind === 'wait' ? 'wait' : 'condition';
  return { id, type, ...(step.label ? { label: step.label } : {}), config };
}

/** Constrói gatilho + cadeia linear + ramo "não" + fim. Puro. */
export function linearToGraph(draft: LinearAutomation): { nodes: AutomationNode[]; edges: AutomationEdge[] } {
  const nodes: AutomationNode[] = [{ id: 'trigger', type: 'trigger', label: automationEventLabel(draft.event), config: { event: draft.event } }];
  const edges: AutomationEdge[] = [];
  const end: AutomationNode = { id: 'end', type: 'end', label: 'Fim', config: {} };

  const chain = (steps: LinearStep[], prefix: string, startId: string): string => {
    let prev = startId;
    steps.forEach((step, i) => {
      const id = `${prefix}_${i + 1}`;
      nodes.push(linearNode(step, id));
      edges.push({ from: prev, to: id });
      prev = id;
    });
    return prev;
  };

  if (draft.condition) {
    nodes.push({ id: 'if', type: 'condition', label: 'Se', config: { condition: draft.condition } });
    edges.push({ from: 'trigger', to: 'if' });
    const yesEnd = chain(draft.steps || [], 'do', 'if');
    edges.push({ from: 'if', to: draft.steps?.length ? 'do_1' : 'end', branch: 'yes' });
    const noEnd = chain(draft.elseSteps || [], 'else', 'if');
    if (draft.elseSteps?.length) edges.push({ from: 'if', to: 'else_1', branch: 'no' });
    else edges.push({ from: 'if', to: 'end', branch: 'no' });
    if (draft.steps?.length) edges.push({ from: yesEnd, to: 'end' });
    if (draft.elseSteps?.length) edges.push({ from: noEnd, to: 'end' });
  } else {
    const last = chain(draft.steps || [], 'do', 'trigger');
    edges.push({ from: last, to: 'end' });
  }
  nodes.push(end);
  return { nodes, edges };
}

/**
 * Projeção inversa para a edição: devolve o linear quando o grafo TEM a forma
 * "gatilho → (se) → cadeia → fim"; `null` quando é um grafo livre (aí a UI
 * mostra o modo avançado, sem tentar "achar" uma linha que não existe).
 */
export function graphToLinear(automation: Pick<Automation, 'trigger' | 'nodes' | 'edges'>): LinearAutomation | null {
  const nodes = automation.nodes || [];
  const edges = automation.edges || [];
  const trigger = nodes.find((n) => n.type === 'trigger');
  if (!trigger) return null;
  if (nodes.some((n) => n.type === 'branch')) return null;
  const event = (trigger.config.event || automation.trigger?.event || 'lead.created') as AutomationEventId;
  const byId = nodeMap(nodes);

  const edgeTo = (fromId: string, branch = ''): AutomationNode | null => {
    const list = outgoingEdges(fromId, edges);
    if (!list.length) return null;
    const chosen = (branch ? list.find((e) => (e.branch || '') === branch) : null)
      || list.find((e) => !e.branch || e.branch === 'next');
    if (!chosen) return null;
    return byId.get(chosen.to) || null;
  };

  const chainOf = (start: AutomationNode | null): LinearStep[] | null => {
    const steps: LinearStep[] = [];
    let cur = start;
    for (let guard = 0; cur && cur.type !== 'end' && guard < 60; guard++) {
      if (cur.type === 'action' && cur.config.action) steps.push({ kind: 'action', label: cur.label, action: cur.config.action });
      else if (cur.type === 'wait') steps.push({ kind: 'wait', label: cur.label, wait: cur.config.wait });
      else return null; // forma livre ⇒ sem projeção linear honesta
      cur = edgeTo(cur.id);
    }
    return steps;
  };

  const first = edgeTo(trigger.id);
  if (!first) return { event, condition: null, steps: [] };

  if (first.type === 'condition') {
    const yes = outgoingEdges(first.id, edges).find((e) => e.branch === 'yes');
    const no = outgoingEdges(first.id, edges).find((e) => e.branch === 'no');
    if (!yes || !no) return null;
    const steps = chainOf(byId.get(yes.to) || null);
    const elseSteps = chainOf(byId.get(no.to) || null);
    if (!steps || !elseSteps) return null;
    return { event, condition: first.config.condition || null, steps, elseSteps };
  }

  const steps = chainOf(first);
  if (!steps) return null;
  return { event, condition: null, steps };
}

// ═══════════════════════════════════════════════════════════════
// LEITURA DEFENSIVA DE DADOS ANTIGOS (migração aditiva)
// ═══════════════════════════════════════════════════════════════
/** Garante a forma mínima de uma automação lida do banco (nunca sobrescreve). */
export function normalizeAutomationRecord(raw: any, now = new Date().toISOString()): Automation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id || '').trim();
  const businessId = String(raw.businessId || '').trim();
  if (!id || !businessId) return null;
  const nodes: AutomationNode[] = Array.isArray(raw.nodes)
    ? raw.nodes.filter((n: any) => n && typeof n === 'object' && n.id && n.type).map((n: any) => ({
      id: String(n.id),
      type: (['trigger', 'condition', 'branch', 'action', 'wait', 'end'].includes(n.type) ? n.type : 'end') as AutomationNodeType,
      ...(n.label ? { label: String(n.label).slice(0, MAX_LABEL) } : {}),
      config: (n.config && typeof n.config === 'object' ? n.config : {}) as AutomationNodeConfig,
    }))
    : [];
  const edges: AutomationEdge[] = Array.isArray(raw.edges)
    ? raw.edges.filter((e: any) => e && e.from && e.to).map((e: any) => ({
      from: String(e.from), to: String(e.to), ...(e.branch ? { branch: String(e.branch).slice(0, 16) } : {}),
    }))
    : [];
  const triggerEvent = isAutomationEvent(raw?.trigger?.event)
    ? raw.trigger.event
    : (nodes.find((n) => n.type === 'trigger')?.config.event as AutomationEventId) || 'lead.created';
  return {
    id,
    businessId,
    name: String(raw.name || 'Automação').slice(0, MAX_NAME),
    description: String(raw.description || '').slice(0, MAX_DESCRIPTION),
    active: raw.active !== false,
    trigger: {
      event: triggerEvent,
      ...(raw?.trigger?.condition ? { condition: raw.trigger.condition as AutomationCondition } : {}),
    },
    nodes,
    edges,
    settings: (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as AutomationSettings,
    ...(raw.templateId ? { templateId: String(raw.templateId).slice(0, 40) } : {}),
    version: Number.isFinite(raw.version) ? Number(raw.version) : 1,
    ...(raw.createdByUserId ? { createdByUserId: String(raw.createdByUserId).slice(0, 64) } : {}),
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || raw.createdAt || now),
  };
}

/**
 * Execução: defaults defensivos (o documento pode ter sido escrito por uma
 * versão anterior do motor). `context` nunca é recriado do zero — campos
 * ausentes viram vazios, o que já existe é preservado.
 */
export function normalizeAutomationRunRecord(raw: any, now = new Date().toISOString()): AutomationRun | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id || '').trim();
  const businessId = String(raw.businessId || '').trim();
  const automationId = String(raw.automationId || '').trim();
  if (!id || !businessId || !automationId) return null;
  const statuses: AutomationRunStatus[] = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'];
  const status: AutomationRunStatus = statuses.includes(raw.status) ? raw.status : 'queued';
  const history: AutomationRunStep[] = Array.isArray(raw.history)
    ? raw.history
      .filter((h: any) => h && typeof h === 'object' && typeof h.at === 'string')
      .map((h: any) => ({
        at: String(h.at),
        nodeId: String(h.nodeId || ''),
        nodeType: (h.nodeType || 'run') as AutomationRunStep['nodeType'],
        outcome: (h.outcome || 'executed') as AutomationRunStep['outcome'],
        label: String(h.label || '').slice(0, 200),
        ...(h.detail ? { detail: String(h.detail).slice(0, 400) } : {}),
      }))
      .slice(-200)
    : [];
  const finished = status === 'completed' || status === 'failed' || status === 'cancelled';
  return {
    id,
    businessId,
    automationId,
    automationName: String(raw.automationName || 'Automação').slice(0, MAX_NAME),
    status,
    triggerEvent: isAutomationEvent(raw.triggerEvent) ? raw.triggerEvent : 'lead.created',
    currentNodeId: String(raw.currentNodeId || ''),
    context: (raw.context && typeof raw.context === 'object' && !Array.isArray(raw.context) ? raw.context : {}) as Record<string, any>,
    waitingUntil: typeof raw.waitingUntil === 'string' ? raw.waitingUntil : '',
    startedAt: String(raw.startedAt || now),
    updatedAt: String(raw.updatedAt || raw.startedAt || now),
    finishedAt: finished ? String(raw.finishedAt || raw.updatedAt || now) : '',
    error: String(raw.error || '').slice(0, 400),
    history,
    eventKey: String(raw.eventKey || ''),
    emittedByRunId: String(raw.emittedByRunId || ''),
    steps: Number.isFinite(raw.steps) ? Math.max(0, Math.floor(raw.steps)) : history.length,
    resumes: Number.isFinite(raw.resumes) ? Math.max(0, Math.floor(raw.resumes)) : 0,
    ...(raw.lastActionType ? { lastActionType: raw.lastActionType } : {}),
    ...(raw.lastError ? { lastError: String(raw.lastError).slice(0, 300) } : {}),
    // Posse: uma execução legada SEM dono não pode ficar presa em 'running'.
    ...(raw.claimToken && raw.claimExpiresAt && Date.parse(raw.claimExpiresAt) > Date.parse(now)
      ? { claimToken: String(raw.claimToken), claimExpiresAt: String(raw.claimExpiresAt) }
      : {}),
  };
}

/** Automações de uma unidade (nunca de outra — isolamento por construção). */
export function automationsOf(db: DB, businessId: string): Automation[] {
  if (!Array.isArray(db.automations)) return [];
  return db.automations.filter((a) => a && a.businessId === businessId);
}

/**
 * As automações que o gatilho pode acionar (ativas + evento + gatilho válido).
 * A condição de entrada é avaliada no EXECUTOR (não aqui) para que a espera
 * e o histórico sejam sempre registráveis.
 */
export function automationsForEvent(db: DB, businessId: string, event: AutomationEventId): Automation[] {
  return automationsOf(db, businessId).filter((a) => {
    if (!a.active) return false;
    if (a.trigger?.event !== event) return false;
    return Array.isArray(a.nodes) && a.nodes.length > 0;
  });
}
