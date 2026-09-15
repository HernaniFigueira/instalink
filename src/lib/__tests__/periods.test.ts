import { describe, expect, it } from 'vitest';
import {
  MAIN_PERIOD_KEYS, MAX_CUSTOM_DAYS, MORE_PERIOD_KEYS, PERIOD_VALUES, parsePeriodParam, periodLabel,
  periodParamFor, periodShortLabel, periodWindows, resolvePeriodSpec,
} from '../periods';

describe('períodos de consulta (P1)', () => {
  it('oferece 7/30/90 dias, 12 meses e todo o período', () => {
    expect([...PERIOD_VALUES]).toEqual([7, 30, 90, 365, 0]);
  });

  it('parsePeriodParam normaliza a URL e cai para 30 no desconhecido', () => {
    expect(parsePeriodParam('7')).toBe(7);
    expect(parsePeriodParam('30')).toBe(30);
    expect(parsePeriodParam('90')).toBe(90);
    expect(parsePeriodParam('365')).toBe(365);
    expect(parsePeriodParam('0')).toBe(0);
    expect(parsePeriodParam('all')).toBe(0);
    expect(parsePeriodParam(null)).toBe(30);
    expect(parsePeriodParam(undefined)).toBe(30);
    expect(parsePeriodParam('')).toBe(30);
    expect(parsePeriodParam('999')).toBe(30);
    expect(parsePeriodParam('abc')).toBe(30);
  });

  it('rótulos longo e curto cobrem todos os períodos', () => {
    expect(periodLabel(7)).toBe('7 dias');
    expect(periodLabel(30)).toBe('30 dias');
    expect(periodLabel(90)).toBe('90 dias');
    expect(periodLabel(365)).toBe('12 meses');
    expect(periodLabel(0)).toBe('Todo período');
    expect(periodShortLabel(365)).toBe('12m');
    expect(periodShortLabel(0)).toBe('Tudo');
  });

  it('janelas de 7/30 dias preservam a regra histórica (inclui hoje)', () => {
    const w7 = periodWindows(7, '2026-09-15');
    expect(w7).toEqual({
      from: '2026-09-09', to: '2026-09-15',
      prevFrom: '2026-09-02', prevTo: '2026-09-08', hasPrevious: true,
    });
    const w30 = periodWindows(30, '2026-09-15');
    expect(w30.from).toBe('2026-08-17');
    expect(w30.to).toBe('2026-09-15');
    expect(w30.hasPrevious).toBe(true);
  });

  it('todo o período não tem início nem janela anterior comparável', () => {
    const w = periodWindows(0, '2026-09-15');
    expect(w.from).toBe('');
    expect(w.to).toBe('2026-09-15');
    expect(w.hasPrevious).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// PERÍODOS DO P2 — Hoje · 7 dias · 30 dias · Este mês · Personalizado
// ═══════════════════════════════════════════════════════════════
// O seletor antigo (7/30/90/12 meses/tudo) continua aceito: nenhum link
// existente quebra. O P2 só ACRESCENTA as opções pedidas e a comparação
// sempre com o período imediatamente anterior de mesmo tamanho.
describe('períodos do P2 (resolvePeriodSpec)', () => {
  const TODAY = '2026-09-15';

  it('o seletor principal mostra as opções pedidas, na ordem de uso', () => {
    expect(MAIN_PERIOD_KEYS).toEqual(['today', '7', '30', 'month']);
    expect(MORE_PERIOD_KEYS).toEqual(['90', '365', 'all']);
  });

  it('hoje compara com ontem; 7/30 dias comparam com a janela anterior igual', () => {
    const hoje = resolvePeriodSpec({ period: 'today', today: TODAY });
    expect([hoje.from, hoje.to, hoje.prevFrom, hoje.prevTo, hoje.label]).toEqual(['2026-09-15', '2026-09-15', '2026-09-14', '2026-09-14', 'Hoje']);
    const sete = resolvePeriodSpec({ period: '7', today: TODAY });
    expect([sete.from, sete.to, sete.prevFrom, sete.prevTo]).toEqual(['2026-09-09', '2026-09-15', '2026-09-02', '2026-09-08']);
    const trinta = resolvePeriodSpec({ period: '30', today: TODAY });
    expect([trinta.from, trinta.to, trinta.prevFrom, trinta.prevTo]).toEqual(['2026-08-17', '2026-09-15', '2026-07-18', '2026-08-16']);
  });

  it('“este mês” começa no dia 1 e compara com os mesmos dias anteriores', () => {
    const mes = resolvePeriodSpec({ period: 'month', today: TODAY });
    expect([mes.from, mes.to, mes.prevFrom, mes.prevTo, mes.label]).toEqual(['2026-09-01', '2026-09-15', '2026-08-17', '2026-08-31', 'Este mês']);
  });

  it('personalizado aceita as datas, normaliza ordem e limita o tamanho', () => {
    const c = resolvePeriodSpec({ period: 'custom', from: '2026-09-05', to: '2026-09-10', today: TODAY });
    expect([c.from, c.to, c.custom]).toEqual(['2026-09-05', '2026-09-10', true]);
    expect([c.prevFrom, c.prevTo]).toEqual(['2026-08-30', '2026-09-04']);
    // invertido → o sistema entende e conserta, sem erro na cara do usuário
    const inv = resolvePeriodSpec({ period: 'custom', from: '2026-09-10', to: '2026-09-01', today: TODAY });
    expect([inv.from, inv.to]).toEqual(['2026-09-01', '2026-09-10']);
    // teto de segurança para a resposta da API não crescer sem limite
    const big = resolvePeriodSpec({ period: 'custom', from: '1900-01-01', to: TODAY, today: TODAY });
    expect(big.from > '1900-01-01').toBe(true);
    expect(MAX_CUSTOM_DAYS).toBeGreaterThan(30);
  });

  it('períodos legados da URL continuam valendo (compatibilidade)', () => {
    expect(parsePeriodParam('90')).toBe(90);
    expect(resolvePeriodSpec({ period: '90', today: TODAY }).key).toBe('90');
    expect(resolvePeriodSpec({ period: 'all', today: TODAY }).key).toBe('all');
    expect(resolvePeriodSpec({ period: '0', today: TODAY }).hasPrevious).toBe(false);
    expect(resolvePeriodSpec({ period: '', today: TODAY }).key).toBe('30');
    expect(resolvePeriodSpec({ period: 'abc', today: TODAY }).key).toBe('30');
    // a query canônica continua compatível com o que já era usado
    expect(periodParamFor('30')).toBe('30');
    expect(periodParamFor('all')).toBe('0');
    expect(periodParamFor('today')).toBe('today');
    expect(periodParamFor('custom')).toBe('custom');
  });

  it('todas as opções do seletor produzem janelas coerentes', () => {
    for (const key of [...MAIN_PERIOD_KEYS, ...MORE_PERIOD_KEYS]) {
      const spec = resolvePeriodSpec({ period: periodParamFor(key), today: TODAY });
      expect(spec.key).toBe(key);
      expect(spec.label.length).toBeGreaterThan(0);
      if (key === 'all') {
        expect(spec.hasPrevious).toBe(false);
      } else {
        expect(spec.from <= spec.to).toBe(true);
        expect(spec.hasPrevious).toBe(true);
      }
    }
  });
});
