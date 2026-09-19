import { describe, expect, it } from 'vitest';
import { originBars, rankBars, statusMix } from '../insights-charts';
import type { OriginPerformance, ServicePerformance } from '../insights';

function svc(partial: Partial<ServicePerformance> & { name: string }): ServicePerformance {
  return {
    id: partial.name.toLowerCase(),
    bookings: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    revenue: 0,
    ...partial,
  };
}

// ═══════════════════════════════════════════════════════════════
// A3.3 CONVERGÊNCIA (ponto 14) — gráficos de Resultados
// O que está em jogo: Resultados passou a exibir distribuição de estados e
// barras comparativas. Se a conta errar, o lojista lê um número bonito e
// falso. Estes testes travam a aritmética E a regra de honestidade (não
// inventar divisão pendente/confirmado, não gerar fatia negativa).
// ═══════════════════════════════════════════════════════════════

describe('statusMix — distribuição de estados', () => {
  it('soma os estados das linhas e calcula a participação', () => {
    const mix = statusMix([
      svc({ name: 'Corte', bookings: 10, completed: 6, cancelled: 2, noShow: 1 }),
      svc({ name: 'Barba', bookings: 10, completed: 4, cancelled: 1, noShow: 1 }),
    ]);

    expect(mix.hasData).toBe(true);
    expect(mix.total).toBe(20);

    const byId = Object.fromEntries(mix.segments.map((s) => [s.id, s]));
    expect(byId.completed.value).toBe(10);
    expect(byId.cancelled.value).toBe(3);
    expect(byId.no_show.value).toBe(2);
    // 20 agendados − 10 concluídos − 3 cancelados − 2 faltas = 5 em agenda
    expect(byId.scheduled.value).toBe(5);

    // A soma das participações fecha em 100 (tolerância de arredondamento).
    const soma = mix.segments.reduce((a, s) => a + s.pct, 0);
    expect(soma).toBeGreaterThan(99);
    expect(soma).toBeLessThanOrEqual(100.5);
  });

  it('NÃO inventa divisão pendente/confirmado — os dois viram um segmento só', () => {
    const mix = statusMix([svc({ name: 'Corte', bookings: 4, completed: 0, cancelled: 0, noShow: 0 })]);
    const ids = mix.segments.map((s) => s.id);

    // Nem 'pending' nem 'confirmed' podem aparecer: a coleta por serviço não
    // abre essa divisão, e o gráfico não pode fingir que abre.
    expect(ids).not.toContain('pending');
    expect(ids).not.toContain('confirmed');
    expect(ids).toContain('scheduled');
    expect(mix.segments.find((s) => s.id === 'scheduled')!.value).toBe(4);
  });

  it('nunca produz fatia negativa com dado inconsistente', () => {
    const mix = statusMix([svc({ name: 'Corte', bookings: 2, completed: 5, cancelled: 3, noShow: 1 })]);
    expect(mix.segments.find((s) => s.id === 'scheduled')!.value).toBe(0);
    expect(mix.segments.every((s) => s.value >= 0 && s.pct >= 0)).toBe(true);
  });

  it('sem linhas não há dado (e nenhuma porcentagem)', () => {
    const mix = statusMix([]);
    expect(mix.hasData).toBe(false);
    expect(mix.total).toBe(0);
    expect(mix.segments.every((s) => s.pct === 0)).toBe(true);
  });

  it('toda fatia traz rótulo e cor de token — cor nunca é o único indicador', () => {
    const mix = statusMix([svc({ name: 'Corte', bookings: 3, completed: 3 })]);
    for (const seg of mix.segments) {
      expect(seg.label.length).toBeGreaterThan(0);
      expect(seg.color.startsWith('var(--')).toBe(true);
    }
  });
});

describe('rankBars — comparação por serviço/profissional', () => {
  it('ordena do maior para o menor e escala pelo maior da lista', () => {
    const bars = rankBars([
      svc({ name: 'Barba', bookings: 4, completed: 2 }),
      svc({ name: 'Corte', bookings: 20, completed: 15 }),
    ]);

    expect(bars.map((b) => b.label)).toEqual(['Corte', 'Barba']);
    expect(bars[0].widthPct).toBe(100);
    expect(bars[0].secondaryWidthPct).toBe(75);
    expect(bars[1].widthPct).toBe(20);
  });

  it('mantém visível uma barra pequena (mínimo) e zera quem não tem nada', () => {
    const bars = rankBars([
      svc({ name: 'Corte', bookings: 500 }),
      svc({ name: 'Barba', bookings: 1 }),
      svc({ name: 'Penteado', bookings: 0 }),
    ]);

    expect(bars.find((b) => b.label === 'Barba')!.widthPct).toBeGreaterThanOrEqual(3);
    expect(bars.find((b) => b.label === 'Penteado')!.widthPct).toBe(0);
  });

  it('desempate por volume resolve por nome em pt-BR (ordem estável)', () => {
    const bars = rankBars([svc({ name: 'Zebra', bookings: 5 }), svc({ name: 'Abelha', bookings: 5 })]);
    expect(bars.map((b) => b.label)).toEqual(['Abelha', 'Zebra']);
  });
});

describe('originBars — origem dos leads', () => {
  it('usa leads como barra principal e convertidos como sobreposição', () => {
    const rows: OriginPerformance[] = [
      { name: 'Instagram', leads: 10, converted: 5, rate: 50 },
      { name: 'Google', leads: 20, converted: 4, rate: 20 },
    ];
    const bars = originBars(rows);

    expect(bars.map((b) => b.label)).toEqual(['Google', 'Instagram']);
    expect(bars[0].widthPct).toBe(100);
    expect(bars[0].secondaryWidthPct).toBe(20);
    expect(bars[1].secondaryWidthPct).toBe(25);
  });

  it('lista vazia não quebra', () => {
    expect(originBars([])).toEqual([]);
  });
});
