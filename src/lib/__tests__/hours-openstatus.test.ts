import { describe, expect, it } from 'vitest';
import { openStatus } from '../hours';
import type { DayHours } from '../types';

// O 'agora' dos testes usa offset -03:00 porque o fuso do produto é
// America/Sao_Paulo (lib/tz) — sem offset o Date cairia em outra hora.
const H = (open: string, close: string): DayHours => ({ open, close });

describe('openStatus — honesto, derivado só de Business.hours', () => {
  it('sem horário configurado algum → null (página não mostra chip)', () => {
    expect(openStatus(undefined, new Date('2026-09-15T10:00-03:00'))).toBeNull();
    expect(openStatus({}, new Date('2026-09-15T10:00-03:00'))).toBeNull();
    expect(openStatus({ '1': { open: '', close: '' } as DayHours }, new Date('2026-09-15T10:00-03:00'))).toBeNull();
  });

  it('dentro da janela de hoje → aberto com hora de fechar', () => {
    // 2026-09-15 é terça-feira (weekday 2)
    const s = openStatus({ '2': H('09:00', '19:00') }, new Date('2026-09-15T12:30-03:00'));
    expect(s).toEqual({ open: true, label: 'Aberto agora · até 19:00' });
  });

  it('antes da abertura de hoje → "abre hoje às"', () => {
    const s = openStatus({ '2': H('09:00', '19:00') }, new Date('2026-09-15T08:00-03:00'));
    expect(s?.open).toBe(false);
    expect(s?.label).toBe('Fechado · abre hoje às 09:00');
  });

  it('depois do fechamento de hoje → próximo dia (amanhã)', () => {
    const s = openStatus({ '2': H('09:00', '19:00'), '3': H('09:00', '18:00') }, new Date('2026-09-15T20:00-03:00'));
    expect(s?.open).toBe(false);
    expect(s?.label).toBe('Fechado · abre amanhã às 09:00');
  });

  it('hoje sem expediente pula para o próximo dia com atendimento (data por extenso)', () => {
    // terça (15) fechado; quarta não; quinta sim → "dia 17/09"
    const s = openStatus({ '2': null, '4': H('10:00', '16:00') }, new Date('2026-09-15T11:00-03:00'));
    expect(s?.label).toBe('Fechado · abre dia 17/09 às 10:00');
  });

  it('limite: exatamente no fechar está fechado; no abrir está aberto', () => {
    const close = openStatus({ '2': H('09:00', '19:00') }, new Date('2026-09-15T19:00-03:00'));
    expect(close?.open).toBe(false);
    const open = openStatus({ '2': H('09:00', '19:00') }, new Date('2026-09-15T09:00-03:00'));
    expect(open?.open).toBe(true);
  });

  it('domingo (chave "0") é respeitado', () => {
    // 2026-09-13 foi domingo
    const s = openStatus({ '0': H('10:00', '14:00') }, new Date('2026-09-13T12:00-03:00'));
    expect(s?.open).toBe(true);
  });
});
