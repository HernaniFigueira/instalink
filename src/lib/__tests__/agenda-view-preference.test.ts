// @vitest-environment jsdom
// Onda 1 · E — Semana como padrão SÓ sem preferência salva; Dia/Semana/Mês/Lista preservam a escolha.
import { beforeEach, describe, expect, it } from 'vitest';
import { agendaViewStorageKey, defaultAgendaView, readAgendaViewPreference, writeAgendaViewPreference } from '../agenda-view-preference';

beforeEach(() => window.localStorage.clear());

describe('padrão da visão (sem preferência salva)', () => {
  it('Professional com agenda própria → Semana no desktop', () => {
    expect(defaultAgendaView({ isMobile: false, professionalScoped: true })).toBe('week');
  });
  it('Owner e Recepção → Dia no desktop (sem mudança)', () => {
    expect(defaultAgendaView({ isMobile: false, professionalScoped: false })).toBe('day');
  });
  it('celular → Lista, inclusive para Professional', () => {
    expect(defaultAgendaView({ isMobile: true, professionalScoped: true })).toBe('list');
    expect(defaultAgendaView({ isMobile: true, professionalScoped: false })).toBe('list');
  });
});

describe('preferência salva por conta', () => {
  it('sem nada salvo, lê vazio (o padrão do papel decide)', () => {
    expect(readAgendaViewPreference('user-a')).toBe('');
  });
  it('a escolha explícita é lembrada para a mesma conta', () => {
    for (const v of ['day', 'week', 'month', 'list'] as const) {
      writeAgendaViewPreference('user-a', v);
      expect(readAgendaViewPreference('user-a')).toBe(v);
    }
  });
  it('é por conta: outra pessoa no mesmo navegador não herda a escolha', () => {
    writeAgendaViewPreference('user-a', 'month');
    expect(readAgendaViewPreference('user-b')).toBe('');
    expect(window.localStorage.getItem(agendaViewStorageKey('user-a'))).toBe('month');
  });
  it('valor inválido guardado à mão é ignorado (não vira visão)', () => {
    window.localStorage.setItem(agendaViewStorageKey('user-a'), 'ano');
    expect(readAgendaViewPreference('user-a')).toBe('');
  });
  it('sem conta, nada é gravado nem lido', () => {
    writeAgendaViewPreference('', 'week');
    expect(readAgendaViewPreference('')).toBe('');
    expect(window.localStorage.length).toBe(0);
  });
});
