// ═══════════════════════════════════════════════════════════════
// WORKFLOW CANÔNICO DO ATENDIMENTO — Agendado → Chegou → Em atendimento → Finalizado
// ═══════════════════════════════════════════════════════════════
// NÃO é uma 4ª máquina de estados persistida. É uma CAMADA DERIVADA sobre os
// três registros que já existem:
//   • Booking.status  (pending|confirmed|completed|cancelled|no_show)
//   • Booking.checkedInAt (+ entrada de fila waiting/called/in_service)
//   • Encounter       (draft = em atendimento · finalized)
// e responde, num só lugar: em que ETAPA está este atendimento, quais
// TRANSIÇÕES são legais e quais AÇÕES cada papel pode executar nesta etapa.
//
// PURO (sem I/O, sem node:*): o servidor usa para AUTORIZAR; a interface usa o
// que o servidor devolve (`workflowView`) para MOSTRAR — nunca decide sozinha.
import type { Booking, Encounter, QueueEntry } from './types';

export type WorkflowState =
  | 'scheduled' | 'arrived' | 'in_care' | 'finalized' | 'cancelled' | 'no_show';

export const WORKFLOW_STATES: WorkflowState[] = [
  'scheduled', 'arrived', 'in_care', 'finalized', 'cancelled', 'no_show',
];

export const WORKFLOW_LABEL: Record<WorkflowState, string> = {
  scheduled: 'Agendado',
  arrived: 'Chegou',
  in_care: 'Em atendimento',
  finalized: 'Finalizado',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
};

/** Ações operacionais da agenda/atendimento (identificadores estáveis p/ UI e testes). */
export type WorkflowActionId =
  | 'check_in' | 'check_in_undo' | 'no_show' | 'cancel' | 'reschedule'
  | 'confirm' | 'reopen' | 'close_retro'
  | 'start_care' | 'open_care' | 'view_care';

export interface WorkflowInputs {
  booking: Pick<Booking, 'status' | 'checkedInAt'>;
  /** Registro de atendimento do agendamento (se existir). */
  encounter?: Pick<Encounter, 'status'> | null;
  /** Entrada de fila ligada ao agendamento (se existir). */
  queue?: Pick<QueueEntry, 'status'> | null;
}

/** Etapa canônica. Terminais do Booking vencem; depois o clínico; depois a chegada. */
export function appointmentWorkflowState(i: WorkflowInputs): WorkflowState {
  const st = i.booking.status;
  if (st === 'cancelled') return 'cancelled';
  if (st === 'no_show') return 'no_show';
  if (st === 'completed' || i.encounter?.status === 'finalized') return 'finalized';
  if (i.encounter?.status === 'draft' || i.queue?.status === 'in_service') return 'in_care';
  if (i.booking.checkedInAt || i.queue?.status === 'waiting' || i.queue?.status === 'called') return 'arrived';
  return 'scheduled';
}

/**
 * Transições LEGAIS entre etapas (a regra única que servidor e testes usam).
 * `scheduled → scheduled` etc. (repetição) é tratada à parte como idempotente.
 */
const FLOW: Record<WorkflowState, WorkflowState[]> = {
  scheduled: ['arrived', 'cancelled', 'no_show'],
  arrived: ['in_care', 'scheduled', 'cancelled'], // scheduled = desfazer chegada
  in_care: ['finalized'],
  finalized: [],
  cancelled: ['scheduled'], // reabrir
  no_show: ['scheduled'], // reabrir
};

export function canWorkflowTransition(from: WorkflowState, to: WorkflowState): boolean {
  return FLOW[from].includes(to);
}

/** O que o papel pode fazer. `agenda` = operar a agenda; `atendimento` = área clínica. */
export interface WorkflowCaps {
  agenda: boolean;
  atendimento: boolean;
}

export interface WorkflowFacts {
  state: WorkflowState;
  /** Booking.status cru (precisa para confirmar/reabrir). */
  status: Booking['status'];
  /** Horário já passou e continua aberto (fechamento retroativo). */
  overdue: boolean;
  /** Existe registro de atendimento (qualquer estado). */
  hasEncounter: boolean;
  /** Existe registro de atendimento em rascunho. */
  hasDraft: boolean;
}

/** Ações permitidas na etapa para as capacidades informadas. Matriz ÚNICA. */
export function workflowAllowedActions(f: WorkflowFacts, caps: WorkflowCaps): WorkflowActionId[] {
  const out: WorkflowActionId[] = [];
  const a = caps.agenda;
  const c = caps.atendimento;
  switch (f.state) {
    case 'scheduled':
      if (a) {
        out.push('check_in');
        if (f.status === 'pending') out.push('confirm');
        out.push('reschedule');
        // Falta só de agendamento CONFIRMADO (máquina de status do Booking).
        if (f.status === 'confirmed') out.push('no_show');
        out.push('cancel');
      }
      // Fechamento retroativo (sem passar pela chegada): clínico + confirmado +
      // horário vencido + sem rascunho de atendimento.
      if (c && f.status === 'confirmed' && f.overdue && !f.hasDraft) out.push('close_retro');
      break;
    case 'arrived':
      if (c) out.push('start_care');
      if (a) out.push('check_in_undo', 'reschedule', 'cancel');
      break;
    case 'in_care':
      if (c) out.push('open_care');
      break;
    case 'finalized':
      if (c && f.hasEncounter) out.push('view_care');
      if (a) out.push('reschedule'); // recria um novo atendimento (histórico preservado)
      break;
    case 'cancelled':
    case 'no_show':
      if (a) out.push('reopen', 'reschedule');
      break;
  }
  return out;
}

export interface WorkflowView {
  state: WorkflowState;
  label: string;
  allowed: WorkflowActionId[];
}

export function workflowView(
  i: WorkflowInputs & { overdue?: boolean },
  caps: WorkflowCaps,
): WorkflowView {
  const state = appointmentWorkflowState(i);
  const hasEncounter = !!i.encounter;
  return {
    state,
    label: WORKFLOW_LABEL[state],
    allowed: workflowAllowedActions({
      state, status: i.booking.status, overdue: !!i.overdue,
      hasEncounter, hasDraft: i.encounter?.status === 'draft',
    }, caps),
  };
}
