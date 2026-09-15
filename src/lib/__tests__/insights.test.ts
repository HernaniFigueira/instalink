import { describe, expect, it } from 'vitest';
import {
  NO_DATA, ARRIVAL_NOTE, SUMMARY_METRIC_IDS, bookingRow, collectResults, inWindow, leadRow,
  resultsSummary, type ResultsInput,
} from '../insights';
import { buildResults } from '../insights';
import { emptyDB } from '../db';
import { resolvePeriodSpec } from '../periods';
import { isFeatureEnabled } from '../features';
import type { Business, DB } from '../types';

// ═══════════════════════════════════════════════════════════════
// P2 — INDICADORES, PERÍODOS, COMPARAÇÃO E AGREGAÇÃO
// ═══════════════════════════════════════════════════════════════
// Cobre o que o P2 promete:
//   • cada métrica usa a DATA SEMANTICAMENTE CORRETA;
//   • período atual × anterior equivalente;
//   • funil com o estágio que NÃO existe (chegada) declarado;
//   • desempenho por serviço e por profissional;
//   • origem dos leads sem inventar origem;
//   • estado neutro quando não há base (nunca número decorativo);
//   • agregação multiunidade só do que foi passado (isolamento).
const TODAY = '2026-09-15';

function base(over: Partial<ResultsInput> = {}): ResultsInput {
  return {
    window: { from: '2026-08-17', to: TODAY },
    previous: { from: '2026-07-18', to: '2026-08-16' },
    bookings: [],
    contacts: [],
    leads: [],
    services: [],
    professionals: [],
    hasBookingsModule: true,
    hasOrdersModule: false,
    ...over,
  };
}

const metric = (input: ResultsInput, id: string) => {
  const found = buildResults(input).metrics.find((m) => m.id === id);
  if (!found) throw new Error(`métrica ${id} ausente`);
  return found;
};

describe('períodos do P2 (Hoje · 7 · 30 · Este mês · Personalizado)', () => {
  it('hoje é um único dia e compara com ontem', () => {
    const spec = resolvePeriodSpec({ period: 'today', today: TODAY });
    expect([spec.from, spec.to, spec.prevFrom, spec.prevTo]).toEqual(['2026-09-15', '2026-09-15', '2026-09-14', '2026-09-14']);
    expect(spec.label).toBe('Hoje');
    expect(spec.hasPrevious).toBe(true);
  });

  it('30 dias compara com os 30 dias imediatamente anteriores', () => {
    const spec = resolvePeriodSpec({ period: '30', today: TODAY });
    expect([spec.from, spec.to]).toEqual(['2026-08-17', TODAY]);
    expect([spec.prevFrom, spec.prevTo]).toEqual(['2026-07-18', '2026-08-16']);
  });

  it('“este mês” vai do dia 1 até hoje e compara com o bloco anterior de mesmo tamanho', () => {
    const spec = resolvePeriodSpec({ period: 'month', today: TODAY });
    expect([spec.from, spec.to]).toEqual(['2026-09-01', TODAY]);
    // 15 dias (01→15/09) ⇒ janela anterior de 15 dias: 17/08 a 31/08.
    expect([spec.prevFrom, spec.prevTo]).toEqual(['2026-08-17', '2026-08-31']);
  });

  it('período personalizado usa as datas pedidas (com teto e ordem normalizada)', () => {
    const spec = resolvePeriodSpec({ period: 'custom', from: '2026-09-10', to: '2026-09-05', today: TODAY });
    expect([spec.from, spec.to]).toEqual(['2026-09-05', '2026-09-10']);
    expect(spec.custom).toBe(true);
    expect([spec.prevFrom, spec.prevTo]).toEqual(['2026-08-30', '2026-09-04']);
  });

  it('datas inválidas caem no padrão histórico (30 dias) — sem quebrar URLs antigas', () => {
    expect(resolvePeriodSpec({ period: 'abc', today: TODAY }).key).toBe('30');
    // `custom` com data de início ilegível mantém a data final pedida e usa o
    // padrão de 30 dias para o início — em vez de descartar o pedido do usuário.
    const partial = resolvePeriodSpec({ period: 'custom', from: 'nada', to: '2026-09-01', today: TODAY });
    expect([partial.from, partial.to, partial.key]).toEqual(['2026-08-17', '2026-09-01', 'custom']);
    expect(resolvePeriodSpec({ period: '0', today: TODAY }).hasPrevious).toBe(false);
    // URLs antigas (numéricas) continuam funcionando.
    expect(resolvePeriodSpec({ period: '7', today: TODAY }).key).toBe('7');
    expect(resolvePeriodSpec({ period: '90', today: TODAY }).key).toBe('90');
    expect(resolvePeriodSpec({ period: '365', today: TODAY }).key).toBe('365');
  });
});

describe('semântica das datas (não misturar criação × atendimento)', () => {
  it('agendamento criado no período mas ATENDIDO fora não entra nos indicadores de agenda', () => {
    const input = base({
      bookings: [
        // criado hoje (dentro), atendimento em novembro (fora da janela)
        { id: 'b1', status: 'confirmed', date: '2026-11-20', serviceId: 's1', professionalId: 'p1' },
      ],
    });
    expect(metric(input, 'bookings').value).toBe(0);
    expect(metric(input, 'attendances').value).toBe(0);
  });

  it('agendamento criado fora do período mas ATENDIDO dentro entra (pela data do atendimento)', () => {
    const input = base({
      bookings: [{ id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1', professionalId: 'p1' }],
    });
    expect(metric(input, 'bookings').value).toBe(1);
    expect(metric(input, 'completed').value).toBe(1);
  });

  it('novos clientes usam a data de CADASTRO e leads usam a data de CRIAÇÃO', () => {
    const input = base({
      contacts: [
        { id: 'c1', createdAt: '2026-09-02T10:00:00.000Z' },
        { id: 'c2', createdAt: '2026-06-01T10:00:00.000Z' }, // fora da janela
      ],
      leads: [
        { id: 'l1', status: 'converted', origin: 'instagram', createdAt: '2026-09-03T10:00:00.000Z' },
        { id: 'l2', status: 'new', origin: 'whatsapp', createdAt: '2026-05-20T10:00:00.000Z' },
      ],
    });
    expect(metric(input, 'new_clients').value).toBe(1);
    expect(metric(input, 'clients').value).toBe(2); // base total, independente do período
    expect(metric(input, 'leads').value).toBe(1);
    expect(metric(input, 'lead_conversion').value).toBe(100);
  });

  it('inWindow respeita limites inclusivos e “sem início” (todo o período)', () => {
    expect(inWindow('2026-08-17', { from: '2026-08-17', to: TODAY })).toBe(true);
    expect(inWindow('2026-08-16', { from: '2026-08-17', to: TODAY })).toBe(false);
    expect(inWindow('2026-01-01', { from: '', to: TODAY })).toBe(true);
    expect(inWindow('', { from: '', to: TODAY })).toBe(false);
  });
});

describe('comparação com o período anterior equivalente', () => {
  it('calcula a variação percentual e preserva o valor anterior', () => {
    const input = base({
      bookings: [
        { id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1' },
        { id: 'b2', status: 'completed', date: '2026-09-02', serviceId: 's1' },
        { id: 'b3', status: 'completed', date: '2026-08-01', serviceId: 's1' }, // período anterior
      ],
    });
    const completed = metric(input, 'completed');
    expect(completed.value).toBe(2);
    expect(completed.prev).toBe(1);
    expect(completed.deltaPct).toBe(100);
  });

  it('sem base anterior devolve null (a tela mostra “sem base”), nunca infinito', () => {
    const input = base({
      bookings: [{ id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1' }],
    });
    const completed = metric(input, 'completed');
    expect(completed.prev).toBe(0);
    expect(completed.deltaPct).toBeNull();
  });

  it('sem período anterior (todo o período) não há comparação', () => {
    const input = base({
      window: { from: '', to: TODAY },
      previous: null,
      bookings: [{ id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1' }],
    });
    const completed = metric(input, 'completed');
    expect(completed.prev).toBeNull();
    expect(completed.deltaPct).toBeNull();
    expect(buildResults(input).period.hasPrevious).toBe(false);
  });
});

describe('funil operacional', () => {
  const input = base({
    leads: [
      { id: 'l1', status: 'converted', origin: 'instagram', createdAt: '2026-09-01T10:00:00Z' },
      { id: 'l2', status: 'new', origin: 'instagram', createdAt: '2026-09-02T10:00:00Z' },
      { id: 'l3', status: 'lost', origin: 'whatsapp', createdAt: '2026-09-03T10:00:00Z' },
    ],
    bookings: [
      { id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1', professionalId: 'p1' },
      { id: 'b2', status: 'confirmed', date: '2026-09-02', serviceId: 's1', professionalId: 'p1' },
      { id: 'b3', status: 'cancelled', date: '2026-09-03', serviceId: 's2', professionalId: 'p2' },
      { id: 'b4', status: 'no_show', date: '2026-09-04', serviceId: 's2', professionalId: 'p2' },
    ],
  });

  it('mapeia os estados reais e declara o estágio que o sistema não registra', () => {
    const { funnel } = buildResults(input);
    const byId = Object.fromEntries(funnel.steps.map((s) => [s.id, s]));
    expect(byId.leads.value).toBe(3);
    expect(byId.lead_converted.value).toBe(1);
    expect(byId.bookings.value).toBe(4);
    expect(byId.confirmed.value).toBe(2); // confirmado + concluído
    expect(byId.arrived.tracked).toBe(false); // chegada NÃO é registrada
    expect(byId.arrived.value).toBe(0);
    expect(byId.completed.value).toBe(1);
    expect(funnel.note).toBe(ARRIVAL_NOTE);
  });

  it('mostra onde houve perda (leads não convertidos, cancelamentos e faltas)', () => {
    const { funnel } = buildResults(input);
    const losses = Object.fromEntries(funnel.losses.map((l) => [l.id, l.value]));
    expect(losses.lead_lost).toBe(2);
    expect(losses.cancelled).toBe(1);
    expect(losses.no_show).toBe(1);
  });

  it('não mistura as cadeias: lead e atendimento têm taxas separadas', () => {
    const { funnel } = buildResults(input);
    const leads = funnel.steps.find((s) => s.id === 'leads')!;
    const converted = funnel.steps.find((s) => s.id === 'lead_converted')!;
    const bookings = funnel.steps.find((s) => s.id === 'bookings')!;
    expect(leads.rate).toBe(100);
    expect(converted.rate).toBeCloseTo(33.3, 1);
    // A primeira etapa do grupo "atendimento" reinicia em 100% (nenhum elo
    // inventado entre lead e agendamento).
    expect(bookings.rate).toBe(100);
  });

  it('negócio sem agenda tem funil só de captação', () => {
    const noBookings = buildResults(base({ hasBookingsModule: false, bookings: [] }));
    expect(noBookings.funnel.steps.map((s) => s.id)).toEqual(['leads', 'lead_converted']);
    expect(noBookings.metrics.some((m) => m.id === 'bookings')).toBe(false);
  });
});

describe('receita prevista, receita registrada e ticket médio', () => {
  const input = base({
    services: [
      { id: 's1', name: 'Corte', price: 5000 },
      { id: 's2', name: 'Barba', price: 0 },
    ],
    bookings: [
      { id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1', professionalId: 'p1' },
      { id: 'b2', status: 'confirmed', date: '2026-09-02', serviceId: 's1', professionalId: 'p1' },
      { id: 'b3', status: 'cancelled', date: '2026-09-03', serviceId: 's1', professionalId: 'p2' },
    ],
  });

  it('receita prevista soma elegíveis pela data do atendimento (cancelado fora)', () => {
    const forecast = buildResults(input).revenue.forecast!;
    expect(forecast.total).toBe(10000);
    expect(forecast.count).toBe(2);
    expect(metric(input, 'forecast_revenue').value).toBe(10000);
  });

  it('ticket médio usa apenas CONCLUÍDOS com valor cadastrado', () => {
    const ticket = metric(input, 'ticket');
    expect(ticket.value).toBe(5000);
    expect(ticket.hasData).toBe(true);
  });

  it('sem recebimento rastreado, a receita registrada vem como indisponível (com motivo)', () => {
    const { registered } = buildResults(input).revenue;
    expect(registered.available).toBe(false);
    expect(registered.result).toBeNull();
    expect(registered.reason).toMatch(/não registra recebimentos/i);
    expect(buildResults(input).metrics.some((m) => m.id === 'registered_revenue')).toBe(false);
  });

  it('com módulo de pedidos, a receita registrada usa a regra existente (não cancelados)', () => {
    const withOrders = buildResults(base({
      hasOrdersModule: true,
      orders: [
        { status: 'completed', createdAt: '2026-09-01T12:00:00Z', total: 3000 },
        { status: 'cancelled', createdAt: '2026-09-02T12:00:00Z', total: 9999 },
      ],
    }));
    expect(withOrders.revenue.registered.available).toBe(true);
    expect(metricOf(withOrders, 'registered_revenue').value).toBe(3000);
  });
});

function metricOf(payload: ReturnType<typeof buildResults>, id: string) {
  const found = payload.metrics.find((m) => m.id === id);
  if (!found) throw new Error(`métrica ${id} ausente`);
  return found;
}

describe('estados sem dados (nunca número inventado)', () => {
  it('sem nenhum movimento, os indicadores ficam neutros e com explicação', () => {
    const payload = buildResults(base({}));
    expect(payload.hasAnyData).toBe(false);
    expect(payload.emptyHint.length).toBeGreaterThan(10);
    for (const m of payload.metrics) {
      if (m.id === 'bookings' || m.id === 'attendances' || m.id === 'new_clients') continue; // 0 real
      expect(m.hasData).toBe(false);
      expect(m.noDataHint).toBeTruthy();
    }
    expect(payload.services.available).toBe(false);
    expect(payload.services.reason.length).toBeGreaterThan(5);
    expect(payload.professionals.available).toBe(false);
    expect(payload.origins.available).toBe(false);
    expect(NO_DATA.length).toBeGreaterThan(5);
  });

  it('serviços sem valor cadastrado não viram receita (estado explicado)', () => {
    const payload = buildResults(base({
      services: [{ id: 's2', name: 'Avaliação', price: 0 }],
      bookings: [{ id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's2' }],
    }));
    expect(payload.revenue.forecastPriced).toBe(false);
    const forecast = metricOf(payload, 'forecast_revenue');
    expect(forecast.hasData).toBe(false);
    expect(forecast.noDataHint).toMatch(/valor cadastrado/i);
  });
});

describe('desempenho por serviço e por profissional', () => {
  const input = base({
    services: [
      { id: 's1', name: 'Corte', price: 5000 },
      { id: 's2', name: 'Coloração', price: 12000 },
    ],
    professionals: [
      { id: 'p1', name: 'Ana' },
      { id: 'p2', name: 'Bruno' },
    ],
    bookings: [
      { id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1', professionalId: 'p1' },
      { id: 'b2', status: 'confirmed', date: '2026-09-02', serviceId: 's2', professionalId: 'p1' },
      { id: 'b3', status: 'cancelled', date: '2026-09-03', serviceId: 's1', professionalId: 'p2' },
      { id: 'b4', status: 'no_show', date: '2026-09-04', serviceId: 's2', professionalId: 'p2' },
    ],
  });

  it('por serviço: volume, concluídos, cancelamentos, faltas e receita elegível', () => {
    const payload = buildResults(input);
    const corte = payload.services.rows.find((r) => r.id === 's1')!;
    const color = payload.services.rows.find((r) => r.id === 's2')!;
    expect(corte).toMatchObject({ bookings: 2, completed: 1, cancelled: 1, noShow: 0, revenue: 5000 });
    expect(color).toMatchObject({ bookings: 2, completed: 0, cancelled: 0, noShow: 1, revenue: 12000 });
  });

  it('por profissional: inclui serviços DIFERENTES concluídos', () => {
    const payload = buildResults(input);
    const ana = payload.professionals.rows.find((r) => r.id === 'p1')!;
    expect(ana).toMatchObject({ bookings: 2, completed: 1, cancelled: 0, noShow: 0, servicesDone: 1, revenue: 17000 });
    const bruno = payload.professionals.rows.find((r) => r.id === 'p2')!;
    expect(bruno.completed).toBe(0);
    expect(bruno.servicesDone).toBe(0);
  });

  it('agenda sem profissionais definidos não cria uma linha artificial', () => {
    const payload = buildResults(base({
      services: [{ id: 's1', name: 'Consulta', price: 100 }],
      bookings: [{ id: 'b1', status: 'completed', date: '2026-09-01', serviceId: 's1', professionalId: '' }],
    }));
    expect(payload.professionals.available).toBe(false);
    expect(payload.professionals.reason).toMatch(/não está dividida por profissionais/i);
  });
});

describe('origem dos leads', () => {
  it('distribui pelas origens REAIS e calcula conversão', () => {
    const payload = buildResults(base({
      leads: [
        { id: 'l1', status: 'converted', origin: 'instagram', createdAt: '2026-09-01T10:00:00Z' },
        { id: 'l2', status: 'new', origin: 'instagram', createdAt: '2026-09-02T10:00:00Z' },
        { id: 'l3', status: 'converted', origin: 'whatsapp', createdAt: '2026-09-03T10:00:00Z' },
      ],
    }));
    expect(payload.origins.rows.map((o) => o.name)).toEqual(['Instagram', 'WhatsApp']);
    expect(payload.origins.rows[0]).toMatchObject({ leads: 2, converted: 1, rate: 50 });
    expect(payload.origins.rows[1]).toMatchObject({ leads: 1, converted: 1, rate: 100 });
  });

  it('origem desconhecida é exibida como gravada — nunca inventamos um rótulo', () => {
    const payload = buildResults(base({
      leads: [{ id: 'l1', status: 'new', origin: 'feira-do-bairro', createdAt: '2026-09-01T10:00:00Z' }],
    }));
    expect(payload.origins.rows[0].name).toBe('feira-do-bairro');
  });

  it('lead sem origem aparece como “Não informada”', () => {
    const payload = buildResults(base({
      leads: [{ id: 'l1', status: 'new', origin: '', createdAt: '2026-09-01T10:00:00Z' }],
    }));
    expect(payload.origins.rows[0].name).toBe('Não informada');
  });
});

describe('agregação multiunidade (visão consolidada)', () => {
  it('soma apenas o que foi passado — unidade de fora não entra na conta', () => {
    const unitA = [
      { id: 'a1', status: 'completed' as const, date: '2026-09-01', serviceId: 'sa' },
      { id: 'a2', status: 'completed' as const, date: '2026-09-02', serviceId: 'sa' },
    ];
    const unitB = [{ id: 'b1', status: 'completed' as const, date: '2026-09-03', serviceId: 'sb' }];
    // Unidade C existe no "banco", mas NÃO é passada (usuário sem acesso).
    const unitC = [{ id: 'c1', status: 'completed' as const, date: '2026-09-04', serviceId: 'sc' }];

    const onlyA = buildResults(base({ bookings: [...unitA, ...unitC], services: [] }));
    expect(metricOf(onlyA, 'completed').value).toBe(3); // A + C: é o CONJUNTO PASSADO que define o escopo

    const consolidated = buildResults(base({
      bookings: [...unitA, ...unitB],
      services: [
        { id: 'sa', name: 'Serviço A', price: 1000 },
        { id: 'sb', name: 'Serviço B', price: 2000 },
      ],
    }));
    expect(metricOf(consolidated, 'completed').value).toBe(3);
    expect(consolidated.services.rows.map((r) => r.id).sort()).toEqual(['sa', 'sb']);
    expect(consolidated.services.rows.find((r) => r.id === 'sb')!.revenue).toBe(2000);
  });

  it('leads e clientes de unidades diferentes são somados sem duplicar o mesmo id', () => {
    const payload = buildResults(base({
      leads: [
        { id: 'l1', status: 'converted', origin: 'instagram', createdAt: '2026-09-01T10:00:00Z' },
        { id: 'l2', status: 'new', origin: 'instagram', createdAt: '2026-09-01T10:00:00Z' },
      ],
      contacts: [
        { id: 'c1', createdAt: '2026-09-01T10:00:00Z' },
        { id: 'c2', createdAt: '2026-09-01T10:00:00Z' },
      ],
    }));
    expect(metricOf(payload, 'leads').value).toBe(2);
    expect(metricOf(payload, 'new_clients').value).toBe(2);
    expect(payload.origins.rows[0]).toMatchObject({ name: 'Instagram', leads: 2, converted: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════
// COLETA A PARTIR DO BANCO (mesma engine usada por Resultados, Organização
// consolidada e resumo da Dashboard)
// ═══════════════════════════════════════════════════════════════
const unit = (id: string, modes: Business['modes']): Business =>
  ({ id, ownerId: 'o', name: id, slug: id, modes, features: {} } as unknown as Business);

function unitOf(b: Business) {
  return {
    id: b.id,
    hasBookings: isFeatureEnabled(b, 'bookings') || isFeatureEnabled(b, 'services'),
    hasOrders: isFeatureEnabled(b, 'orders'),
  };
}

function seeded() {
  const db: DB = emptyDB();
  db.businesses.push(unit('u1', ['services', 'bookings']), unit('u2', ['services', 'bookings']), unit('u3', ['services', 'bookings']));
  db.services.push(
    { id: 's1', businessId: 'u1', name: 'Corte', price: 5000 } as any,
    { id: 's2', businessId: 'u3', name: 'Segredo de outro tenant', price: 999999 } as any,
  );
  db.professionals.push({ id: 'p1', businessId: 'u1', name: 'Ana', active: true } as any);
  db.bookings.push(
    { id: 'b1', businessId: 'u1', status: 'completed', date: '2026-09-01', serviceId: 's1', professionalId: 'p1' } as any,
    { id: 'b2', businessId: 'u3', status: 'completed', date: '2026-09-01', serviceId: 's2', professionalId: 'p9' } as any,
  );
  db.contacts.push(
    { id: 'c1', businessId: 'u1', createdAt: '2026-09-01T10:00:00Z' } as any,
    { id: 'c9', businessId: 'u3', createdAt: '2026-09-01T10:00:00Z' } as any,
  );
  db.leads.push(
    { id: 'l1', businessId: 'u1', status: 'converted', origin: 'instagram', createdAt: '2026-09-01T10:00:00Z' } as any,
    { id: 'l9', businessId: 'u3', status: 'new', origin: 'instagram', createdAt: '2026-09-01T10:00:00Z' } as any,
  );
  return db;
}

const W = { from: '2026-09-01', to: '2026-09-15' };

describe('collectResults — quem monta a lista define o escopo', () => {
  it('coleta apenas as unidades informadas (nada de outro tenant entra na conta)', () => {
    const db = seeded();
    const one = collectResults(db, [unitOf(db.businesses[0])], W, null);
    expect(one.metrics.find((m) => m.id === 'completed')!.value).toBe(1);
    expect(one.revenue.forecast!.total).toBe(5000);
    expect(one.services.rows.map((r) => r.id)).toEqual(['s1']);
    // a unidade de OUTRO negócio não aparece de forma alguma
    expect(one.services.rows.some((r) => r.id === 's2')).toBe(false);
    expect(one.origins.rows[0]).toMatchObject({ name: 'Instagram', leads: 1 });
  });

  it('a visão consolidada soma só o conjunto acessível e identifica o recorte', () => {
    const db = seeded();
    const consolidated = collectResults(db, [db.businesses[0], db.businesses[1]].map(unitOf), W, null, 'em 2 unidade(s)');
    expect(consolidated.metrics.find((m) => m.id === 'completed')!.value).toBe(1); // u2 não tem movimento
    expect(consolidated.metrics.find((m) => m.id === 'clients')!.value).toBe(1);
    expect(consolidated.period.label).toBe('em 2 unidade(s)');
  });

  it('negócio sem agenda não recebe indicadores de agenda (nem zero enganoso)', () => {
    const db = seeded();
    const retail = unit('loja', ['products', 'orders']);
    db.businesses.push(retail);
    db.orders.push({ id: 'o1', businessId: 'loja', status: 'completed', createdAt: '2026-09-02T10:00:00Z', total: 3000 } as any);
    const payload = collectResults(db, [unitOf(retail)], W, null);
    expect(payload.metrics.some((m) => m.id === 'bookings')).toBe(false);
    expect(payload.metrics.find((m) => m.id === 'registered_revenue')!.value).toBe(3000);
  });

  it('as linhas do motor não carregam dados sensíveis do cliente', () => {
    const b = { id: 'x', status: 'pending', date: '2026-09-01', serviceId: 's', professionalId: 'p', customerName: 'Fulano', customerPhone: '11999999999' } as any;
    expect(Object.keys(bookingRow(b)).sort()).toEqual(['date', 'id', 'professionalId', 'serviceId', 'status']);
    const l = { id: 'l', status: 'new', origin: 'instagram', createdAt: '2026-09-01T10:00:00Z', name: 'Fulano', phone: '11999999999' } as any;
    expect(Object.keys(leadRow(l)).sort()).toEqual(['createdAt', 'id', 'origin', 'status']);
  });
});

describe('resultsSummary — recorte curto da Dashboard', () => {
  it('traz os indicadores pedidos, na ordem, com comparação preservada', () => {
    const db = seeded();
    const payload = collectResults(db, [unitOf(db.businesses[0])], W, { from: '2026-08-17', to: '2026-08-31' });
    const items = resultsSummary(payload);
    expect(items.map((i) => i.id)).toEqual(SUMMARY_METRIC_IDS);
    const completed = items.find((i) => i.id === 'completed')!;
    expect(completed).toMatchObject({ value: 1, prev: 0, hasData: true, unit: 'count' });
    // estado neutro continua declarado no resumo (a tela mostra a explicação)
    const noShow = items.find((i) => i.id === 'no_show')!;
    expect(noShow.hasData).toBe(false);
    expect(noShow.noDataHint).toBeTruthy();
  });

  it('não inventa indicador que o negócio não tem', () => {
    const db = seeded();
    const retail = unit('loja2', ['products', 'orders']);
    db.businesses.push(retail);
    const payload = collectResults(db, [unitOf(retail)], W, null);
    const ids = resultsSummary(payload).map((i) => i.id);
    expect(ids).not.toContain('bookings');
    expect(ids).not.toContain('ticket');
  });

  it('aceita uma seleção explícita de indicadores (sem depender do padrão)', () => {
    const db = seeded();
    const payload = collectResults(db, [unitOf(db.businesses[0])], W, null);
    expect(resultsSummary(payload, ['new_clients', 'clients']).map((i) => i.id)).toEqual(['new_clients', 'clients']);
    expect(resultsSummary(payload, ['inexistente'])).toEqual([]);
  });
});
