import { describe, expect, it } from 'vitest';
import {
  SLOT_STATE_MESSAGE, canShowEmptyState, slotState, slotStateMessage, slotStateView,
} from '../slot-states';

// Regra obrigatória: NUNCA mostrar "nenhum horário disponível" enquanto ainda
// está carregando, e nunca mostrar vazio quando a chamada falhou.
describe('slot-states — prioridade dos estados', () => {
  it('loading ganha de tudo (inclusive de lista vazia e de erro)', () => {
    expect(slotState({ loading: true, slots: [] })).toBe('loading');
    expect(slotState({ loading: true, error: 'falhou', slots: [] })).toBe('loading');
    expect(slotState({ loading: true, slots: ['09:00'] })).toBe('loading');
  });

  it('erro ganha de vazio', () => {
    expect(slotState({ loading: false, error: 'Não foi possível carregar', slots: [] })).toBe('error');
  });

  it('vazio só depois de carregar, sem erro e sem horários', () => {
    expect(slotState({ loading: false, error: '', slots: [] })).toBe('empty');
    expect(slotState({ slots: [] })).toBe('empty');
  });

  it('com horários, o estado é ready', () => {
    expect(slotState({ loading: false, slots: ['09:00'] })).toBe('ready');
  });

  it('idle = ainda não houve tentativa (data não escolhida)', () => {
    expect(slotState({ idle: true, slots: [] })).toBe('idle');
    // loading ainda vence o idle (começou a buscar)
    expect(slotState({ idle: true, loading: true })).toBe('loading');
  });
});

describe('slot-states — mensagem exibida', () => {
  it('cada estado tem texto próprio (e ready/idle não mostram aviso)', () => {
    expect(SLOT_STATE_MESSAGE.loading).toMatch(/carregando/i);
    expect(SLOT_STATE_MESSAGE.empty).toMatch(/nenhum horário/i);
    expect(SLOT_STATE_MESSAGE.error).toMatch(/não foi possível/i);
    expect(SLOT_STATE_MESSAGE.ready).toBe('');
    expect(SLOT_STATE_MESSAGE.idle).toBe('');
  });

  it('o erro do servidor é preservado como mensagem', () => {
    expect(slotStateMessage('error', 'Este dia está fechado para agendamento online.'))
      .toBe('Este dia está fechado para agendamento online.');
    expect(slotStateMessage('error')).toBe(SLOT_STATE_MESSAGE.error);
  });

  it('"nenhum horário" só pode aparecer com a busca concluída', () => {
    expect(canShowEmptyState({ loading: true, slots: [] })).toBe(false);
    expect(canShowEmptyState({ loading: false, error: 'x', slots: [] })).toBe(false);
    expect(canShowEmptyState({ loading: false, slots: [] })).toBe(true);
    expect(canShowEmptyState({ loading: false, slots: ['09:00'] })).toBe(false);
  });
});

describe('slot-states — view pronta para a UI', () => {
  it('carregando: mostra aviso, esconde a grade', () => {
    const v = slotStateView({ loading: true, slots: [] });
    expect(v.isLoading).toBe(true);
    expect(v.showGrid).toBe(false);
    expect(v.isError).toBe(false);
    expect(v.message).toBe(SLOT_STATE_MESSAGE.loading);
  });

  it('erro: mostra erro, esconde a grade e não diz "nenhum horário"', () => {
    const v = slotStateView({ loading: false, error: 'Falha de rede', slots: [] });
    expect(v.isError).toBe(true);
    expect(v.showGrid).toBe(false);
    expect(v.message).not.toMatch(/nenhum horário/i);
  });

  it('vazio: mostra a mensagem de vazio (busca concluída)', () => {
    const v = slotStateView({ loading: false, slots: [] });
    expect(v.state).toBe('empty');
    expect(v.showGrid).toBe(false);
    expect(v.message).toBe(SLOT_STATE_MESSAGE.empty);
  });

  it('sucesso: mostra a grade e nenhum aviso', () => {
    const v = slotStateView({ loading: false, slots: ['09:00', '10:00'] });
    expect(v.state).toBe('ready');
    expect(v.showGrid).toBe(true);
    expect(v.message).toBe('');
  });
});
