// @vitest-environment node
// A linha do "agora" é honesta: só existe com o dia/hora atual no recorte
// visível. Relógio mockado aqui porque de madrugada a linha CORRETAMENTE não
// aparece — e o teste precisa cobrir os dois lados.
import { describe, expect, it } from 'vitest';
import { nowLinePlacement } from '../agenda-nowline';

const base = {
  focus: '2026-09-23',
  today: '2026-09-23',
  nowMin: 14 * 60 + 30,
  gridStart: 8 * 60,
  gridEnd: 20 * 60,
  pxPerHour: 48,
};

describe('nowLinePlacement', () => {
  it('visão de dia em hoje, horário dentro da grade: desenha a linha cheia', () => {
    const p = nowLinePlacement({ ...base, view: 'day', columns: [] });
    expect(p).toEqual({ top: ((14 * 60 + 30 - 8 * 60) / 60) * 48 });
  });

  it('visão de dia em OUTRO dia: nenhuma linha (nada de marcador fantasma)', () => {
    expect(nowLinePlacement({ ...base, view: 'day', focus: '2026-09-24', columns: [] })).toBeNull();
  });

  it('fora do horário da grade (madrugada/fechado): nenhuma linha', () => {
    expect(nowLinePlacement({ ...base, view: 'day', nowMin: 3 * 60, columns: [] })).toBeNull();
    expect(nowLinePlacement({ ...base, view: 'day', nowMin: 23 * 60, columns: [] })).toBeNull();
  });

  it('semana: a linha ocupa somente a coluna de hoje', () => {
    const columns = [{ isToday: false }, { isToday: false }, { isToday: true }, { isToday: false }];
    const p = nowLinePlacement({ ...base, view: 'week', columns });
    expect(p?.left).toBe('50%');
    expect(p?.width).toBe('25%');
  });

  it('semana sem hoje visível (ex.: semana deslocada): nenhuma linha', () => {
    const columns = [{ isToday: false }, { isToday: false }];
    expect(nowLinePlacement({ ...base, view: 'week', columns })).toBeNull();
  });

  it('mês nunca tem linha do agora', () => {
    expect(nowLinePlacement({ ...base, view: 'month', columns: [] })).toBeNull();
  });
});
