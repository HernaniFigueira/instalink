import { describe, expect, it } from 'vitest';
import {
  DURATION_IS_INTERNAL_ONLY, hasDurationText, hasTimeRangeText, isPublicSafeLabel,
  publicBookingPrice, publicBookingSummary, publicPriceLabel, publicServiceInfo,
  publicServiceMeta, publicServiceSecondary,
} from '../pricing';
import { money } from '../utils';

const SERVICE = {
  name: 'Limpeza de pele',
  price: 18000,           // R$ 180,00
  description: 'Higienização profunda com extração.',
  durationMin: 60,        // existe no domínio, mas NÃO pode aparecer ao cliente
};

describe('pricing — o que é público num serviço', () => {
  it('preço e descrição continuam públicos', () => {
    const info = publicServiceInfo(SERVICE);
    expect(info.name).toBe('Limpeza de pele');
    expect(info.price).toBe(18000);
    expect(publicPriceLabel(info.price)).toBe(money(18000));
    expect(publicPriceLabel(info.price)).toContain('180,00');
    expect(info.hasDescription).toBe(true);
    expect(info.description).toContain('Higienização');
  });

  it('a duração NÃO faz parte do recorte público', () => {
    const info = publicServiceInfo(SERVICE) as unknown as Record<string, unknown>;
    expect('durationMin' in info).toBe(false);
    expect(JSON.stringify(info)).not.toMatch(/duration/i);
    expect(JSON.stringify(info)).not.toMatch(/60/);
  });

  it('linha secundária pública usa a descrição (nunca a duração)', () => {
    expect(publicServiceSecondary(SERVICE)).toBe('Higienização profunda com extração.');
    expect(publicServiceMeta(SERVICE)).toBe('Higienização profunda com extração.');
    expect(hasDurationText(publicServiceSecondary(SERVICE))).toBe(false);
  });

  it('sem descrição, a linha secundária fica vazia (não vira "60 min")', () => {
    const noDesc = publicServiceSecondary({ description: '   ' });
    expect(noDesc).toBe('');
    expect(publicServiceMeta({ price: 100, description: '' })).toBe('');
  });

  it('serviço ausente não quebra', () => {
    const info = publicServiceInfo(null);
    expect(info).toEqual({ name: '', price: 0, description: '', hasDescription: false });
    expect(publicPriceLabel(undefined as unknown as number)).toBe(money(0));
  });

  it('a duração continua sendo informação interna do domínio', () => {
    expect(DURATION_IS_INTERNAL_ONLY).toBe(true);
  });
});

describe('pricing — resumo público do agendamento', () => {
  it('mostra dia e horário de início, sem intervalo e sem duração', () => {
    const s = publicBookingSummary('2026-09-14', '14:00');
    expect(s).toBe('14/09 · 14:00');
    expect(hasTimeRangeText(s)).toBe(false);
    expect(hasDurationText(s)).toBe(false);
    expect(isPublicSafeLabel(s)).toBe(true);
  });

  it('pode usar o dia humanizado ("Hoje · 14:00")', () => {
    const today = '2026-09-14';
    expect(publicBookingSummary(today, '14:00', { useHumanDay: true, today })).toContain('14:00');
    expect(isPublicSafeLabel(publicBookingSummary(today, '14:00', { useHumanDay: true, today }))).toBe(true);
  });

  it('preço do resumo é só o valor (sem "· 60 min")', () => {
    expect(publicBookingPrice(18000)).toBe(money(18000));
    expect(hasDurationText(publicBookingPrice(18000))).toBe(false);
  });

  it('sem horário, mostra apenas o dia', () => {
    expect(publicBookingSummary('2026-09-14', '')).toBe('14/09');
  });
});

describe('pricing — guardas de regressão da página pública', () => {
  it('detecta duração explícita em qualquer rótulo', () => {
    expect(hasDurationText('60 min')).toBe(true);
    expect(hasDurationText('45min')).toBe(true);
    expect(hasDurationText('R$ 180,00 · 30 min')).toBe(true);
    expect(hasDurationText('R$ 180,00')).toBe(false);
    expect(hasDurationText('Higienização profunda')).toBe(false);
  });

  it('detecta intervalo de horário (que também entrega a duração)', () => {
    expect(hasTimeRangeText('14:00–15:00')).toBe(true);
    expect(hasTimeRangeText('14:00-15:00')).toBe(true);
    expect(hasTimeRangeText('14:00 — 15:00')).toBe(true);
    expect(hasTimeRangeText('14/09 · 14:00')).toBe(false);
  });

  it('rótulos seguros para a página pública', () => {
    const safe = [
      publicBookingSummary('2026-09-14', '14:00'),
      publicPriceLabel(18000),
      publicServiceSecondary(SERVICE),
      publicServiceInfo(SERVICE).name,
    ];
    for (const label of safe) expect(isPublicSafeLabel(label)).toBe(true);
    expect(isPublicSafeLabel(`${SERVICE.durationMin} min`)).toBe(false);
    expect(isPublicSafeLabel('14:00–15:00')).toBe(false);
  });
});
