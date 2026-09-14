// ═══════════════════════════════════════════════════════════════
// ESTADOS DE "HORÁRIOS" — loading / empty / error / success
// ═══════════════════════════════════════════════════════════════
// Regra obrigatória: NUNCA mostrar "nenhum horário" enquanto ainda está
// carregando, e nunca mostrar vazio quando a chamada falhou.
//
// Este módulo é a fonte única dos quatro estados e dos seus textos — usado
// pela página pública, pelo BookingDetailSheet, pelo NewBookingSheet e pelo
// drag-and-drop da agenda.
export type SlotState = 'idle' | 'loading' | 'error' | 'empty' | 'ready';

export const SLOT_STATE_MESSAGE: Record<SlotState, string> = {
  idle: '',
  loading: 'Carregando horários...',
  error: 'Não foi possível carregar os horários.',
  empty: 'Nenhum horário disponível nesta data.',
  ready: '',
};

export interface SlotStateInput {
  loading?: boolean;
  error?: string | null;
  slots?: Array<unknown> | null;
  /** Ainda não houve nenhuma tentativa (ex.: data não escolhida). */
  idle?: boolean;
}

/**
 * Resolve o estado de uma lista de horários. A ordem importa:
 *   loading → error → empty → ready.
 * `loading` ganha de tudo: enquanto carrega, nada de "vazio" na tela.
 */
export function slotState(input: SlotStateInput = {}): SlotState {
  if (input.loading) return 'loading';
  if (input.idle) return 'idle';
  if (input.error) return 'error';
  const slots = input.slots || [];
  return slots.length === 0 ? 'empty' : 'ready';
}

/** Mensagem exibida para o estado (vazia em 'idle' e 'ready'). */
export function slotStateMessage(state: SlotState, override?: string): string {
  if (state === 'error' && override) return override;
  return SLOT_STATE_MESSAGE[state] || '';
}

/** Atalho usado pelas telas: mensagem + se deve esconder a grade. */
export function slotStateView(input: SlotStateInput = {}): {
  state: SlotState;
  message: string;
  /** `true` quando há horários para renderizar. */
  showGrid: boolean;
  /** `true` quando é uma falha (texto em tom de erro). */
  isError: boolean;
  /** `true` enquanto busca (mostrar skeleton/pulso). */
  isLoading: boolean;
} {
  const state = slotState(input);
  return {
    state,
    message: slotStateMessage(state, input.error || undefined),
    showGrid: state === 'ready',
    isError: state === 'error',
    isLoading: state === 'loading',
  };
}

/**
 * "Nenhum horário" só pode aparecer com a busca concluída e sem erro.
 * Mantido como predicado explícito porque era exatamente este o bug.
 */
export function canShowEmptyState(input: SlotStateInput = {}): boolean {
  return slotState(input) === 'empty';
}
