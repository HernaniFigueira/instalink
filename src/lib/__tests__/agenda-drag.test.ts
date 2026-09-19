import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX, IDLE_INTERACTION, blockHeight, blockTop, cellAvailability, cellFromPoint,
  clampMinuteToGrid, columnAt, dragPreviewLabel, dragSlotUrls, emptyDragSlots,
  exceedsDragThreshold, geometryFromRect, gridSnapMinutes, layoutBlocks, minuteAt, minuteLabel,
  nearestSlot, planDrop, pointerDistance, reduceInteraction, runInteraction, shortDateBR,
  slotsForColumn, withOwnSlot, dropConfirmQuestion,
  type DragSlots, type DropColumn, type GridGeometry, type InteractionEvent,
} from '../agenda-drag';

const p = (x: number, y: number) => ({ x, y });

/** Grade de teste: 2 colunas de 150px, das 08:00 às 20:00, 60px por hora. */
const G: GridGeometry = {
  left: 100, top: 200, columnWidth: 150, columnCount: 2,
  startMinute: 8 * 60, endMinute: 20 * 60, pxPerHour: 60,
};

const COLUMNS: DropColumn[] = [
  { key: 'seg', label: 'Segunda', date: '2026-09-14', professionalId: '', isProfessional: false },
  { key: 'ter', label: 'Terça', date: '2026-09-15', professionalId: '', isProfessional: false },
];

function drag(slots: Record<string, string[]>, extra: Partial<DragSlots> = {}): DragSlots {
  return { loading: false, error: '', slots, byPro: {}, ...extra };
}

describe('agenda-drag — clique simples × arraste (threshold)', () => {
  it('threshold dentro do especificado (5–8px)', () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(5);
    expect(DRAG_THRESHOLD_PX).toBeLessThanOrEqual(8);
  });

  it('pointerdown NÃO inicia drag (nenhum efeito, fase "pressed")', () => {
    const step = reduceInteraction(IDLE_INTERACTION, { type: 'down', id: 'b1', at: p(10, 10) });
    expect(step.effect).toBe('none');
    expect(step.state.phase).toBe('pressed');
    expect(step.state.origin).toEqual(p(10, 10));
  });

  it('clicar e soltar sem mover = clique → abre o detalhe', () => {
    const { effects } = runInteraction([
      { type: 'down', id: 'b1', at: p(10, 10) },
      { type: 'up', at: p(10, 10) },
    ]);
    expect(effects).toEqual(['open-detail']);
  });

  it('movimento abaixo do threshold continua sendo clique', () => {
    const small = DRAG_THRESHOLD_PX - 1;
    const { state, effects } = runInteraction([
      { type: 'down', id: 'b1', at: p(10, 10) },
      { type: 'move', at: p(10 + small, 10) },
      { type: 'up', at: p(10 + small, 10) },
    ]);
    expect(effects).toEqual(['open-detail']);
    expect(state).toEqual(IDLE_INTERACTION);
  });

  it('movimento diagonal pequeno não vira drag (distância euclidiana)', () => {
    expect(exceedsDragThreshold(p(0, 0), p(3, 3), DRAG_THRESHOLD_PX)).toBe(false);
    expect(exceedsDragThreshold(p(0, 0), p(5, 5), DRAG_THRESHOLD_PX)).toBe(true);
    expect(pointerDistance(p(0, 0), p(3, 4))).toBe(5);
  });

  it('ultrapassou o threshold → vira drag e dispara UMA busca de horários', () => {
    const big = DRAG_THRESHOLD_PX + 1;
    const { state, effects } = runInteraction([
      { type: 'down', id: 'b1', at: p(10, 10) },
      { type: 'move', at: p(10 + big, 10) },
    ]);
    expect(effects).toEqual(['start-drag']);
    expect(state.phase).toBe('dragging');
    expect(state.id).toBe('b1');
  });

  it('arrastar muitos pixels NÃO gera efeito por pixel (nenhum request por movimento)', () => {
    const events: InteractionEvent[] = [{ type: 'down', id: 'b1', at: p(0, 0) }];
    for (let i = 1; i <= 200; i++) events.push({ type: 'move', at: p(i * 2, i) });
    events.push({ type: 'up', at: p(400, 200) });
    const { effects } = runInteraction(events);
    // exatamente: 1 início de drag + 1 drop
    expect(effects).toEqual(['start-drag', 'drop']);
  });

  it('soltar arrastando = drop (nunca abre o detalhe junto)', () => {
    const { effects } = runInteraction([
      { type: 'down', id: 'b1', at: p(0, 0) },
      { type: 'move', at: p(0, 40) },
      { type: 'up', at: p(0, 40) },
    ]);
    expect(effects).toEqual(['start-drag', 'drop']);
    expect(effects).not.toContain('open-detail');
  });

  it('ESC/cancelar encerra o arraste sem drop e sem abrir detalhe', () => {
    const { state, effects } = runInteraction([
      { type: 'down', id: 'b1', at: p(0, 0) },
      { type: 'move', at: p(0, 40) },
      { type: 'cancel' },
    ]);
    expect(effects).toEqual(['start-drag', 'cancel']);
    expect(state).toEqual(IDLE_INTERACTION);
  });

  it('eventos fora de contexto são ignorados (sem estado fantasma)', () => {
    expect(reduceInteraction(IDLE_INTERACTION, { type: 'move', at: p(5, 5) }).effect).toBe('none');
    expect(reduceInteraction(IDLE_INTERACTION, { type: 'up', at: p(5, 5) }).effect).toBe('none');
    expect(reduceInteraction(IDLE_INTERACTION, { type: 'cancel' }).effect).toBe('none');
    const dragging = reduceInteraction(IDLE_INTERACTION, { type: 'down', id: 'b1', at: p(0, 0) }).state;
    expect(reduceInteraction(dragging, { type: 'down', id: 'b2', at: p(9, 9) }).effect).toBe('none');
  });
});

describe('agenda-drag — requests do arraste', () => {
  it('UMA URL por dia visível (nunca por pixel nem por movimento)', () => {
    const urls = dragSlotUrls('b1', 's1', ['2026-09-14', '2026-09-15']);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe('/api/bookings?businessId=b1&serviceId=s1&date=2026-09-14');
  });

  it('dia único (visão dia) = 1 request; semana = 7', () => {
    expect(dragSlotUrls('b1', 's1', ['2026-09-14'])).toHaveLength(1);
    const week = Array.from({ length: 7 }, (_, i) => `2026-09-${14 + i}`);
    expect(dragSlotUrls('b1', 's1', week)).toHaveLength(7);
  });

  it('o atendimento arrastado não bloqueia a si mesmo', () => {
    expect(withOwnSlot('2026-09-14', ['10:00'], { date: '2026-09-14', time: '09:00' })).toEqual(['09:00', '10:00']);
    expect(withOwnSlot('2026-09-14', ['10:00'], { date: '2026-09-15', time: '09:00' })).toEqual(['10:00']);
    expect(withOwnSlot('2026-09-14', ['10:00'], null)).toEqual(['10:00']);
  });

  it('o own slot só é liberado na coluna do profissional original', () => {
    const own = { date: '2026-09-14', time: '10:00', professionalId: 'orlando' };
    expect(withOwnSlot('2026-09-14', [], own, 'orlando')).toEqual(['10:00']);
    expect(withOwnSlot('2026-09-14', [], own, 'silvio')).toEqual([]);
  });

  it('emptyDragSlots começa parado e sem erro', () => {
    expect(emptyDragSlots()).toEqual({ loading: false, error: '', slots: {}, byPro: {} });
  });
});

describe('agenda-drag — geometria da grade', () => {
  it('desconta gutter e scroll ao montar a geometria', () => {
    const g = geometryFromRect({ left: 100, top: 200 }, {
      gutterWidth: 56, scrollLeft: 20, scrollTop: 30, columnWidth: 150,
      columnCount: 2, startMinute: 480, endMinute: 1200, pxPerHour: 60,
    });
    expect(g.left).toBe(136);
    expect(g.top).toBe(170);
  });

  it('coluna sob o ponteiro (e -1 fora da grade)', () => {
    expect(columnAt(120, G)).toBe(0);
    expect(columnAt(260, G)).toBe(1);
    expect(columnAt(90, G)).toBe(-1);   // antes da primeira coluna
    expect(columnAt(500, G)).toBe(-1);   // depois da última
  });

  it('minuto sob o ponteiro', () => {
    expect(minuteAt(200, G)).toBe(480);          // 08:00 no topo
    expect(minuteAt(230, G)).toBe(510);          // 30px = 30min
    expect(minuteLabel(510)).toBe('08:30');
  });

  it('limita o minuto à grade descontando a duração', () => {
    expect(clampMinuteToGrid(400, G, 30)).toBe(480);
    expect(clampMinuteToGrid(1190, G, 30)).toBe(1170); // 20:00 - 30min
    expect(clampMinuteToGrid(600, G, 30)).toBe(600);
  });

  it('célula inválida quando o ponteiro sai da grade', () => {
    expect(cellFromPoint(p(50, 200), G, 30)).toBeNull();
    expect(cellFromPoint(p(120, 200), G, 30)).toEqual({ column: 0, minute: 480 });
  });
});

describe('agenda-drag — preview e destino do drop', () => {
  const slots = drag({ '2026-09-14': ['09:00', '10:00', '14:00'], '2026-09-15': ['11:00'] });

  it('durante a busca, o destino é "loading" (nunca destino inválido)', () => {
    const plan = planDrop({
      point: p(120, 260), geometry: G, columns: COLUMNS, durationMin: 30,
      drag: drag({}, { loading: true }),
    });
    expect(plan.availability).toBe('loading');
    expect(plan.target).toBeNull();
  });

  it('com erro na busca, não propõe destino', () => {
    const plan = planDrop({
      point: p(120, 260), geometry: G, columns: COLUMNS, durationMin: 30,
      drag: drag({}, { error: 'Falhou' }),
    });
    expect(plan.availability).toBe('unknown');
    expect(plan.target).toBeNull();
  });

  it('propõe o horário livre mais próximo do ponteiro (snap na disponibilidade real)', () => {
    // y=260 → 09:00 exato
    const plan = planDrop({ point: p(120, 260), geometry: G, columns: COLUMNS, drag: slots, durationMin: 30 });
    expect(plan.availability).toBe('free');
    expect(plan.target).toEqual({ date: '2026-09-14', time: '09:00', professionalId: '', columnKey: 'seg' });
    expect(plan.minute).toBe(540);
    expect(plan.column).toBe(0);
  });

  it('muda de coluna/dia conforme o ponteiro anda', () => {
    const plan = planDrop({ point: p(270, 380), geometry: G, columns: COLUMNS, drag: slots, durationMin: 30 });
    expect(plan.target?.columnKey).toBe('ter');
    expect(plan.target?.date).toBe('2026-09-15');
    expect(plan.target?.time).toBe('11:00');
  });

  it('sem horário livre por perto, informa "busy" e não inventa destino', () => {
    const plan = planDrop({
      point: p(120, 800), geometry: G, columns: COLUMNS, durationMin: 30,
      drag: drag({ '2026-09-14': ['09:00'] }),
      toleranceMin: 30,
    });
    expect(plan.availability).toBe('busy');
    expect(plan.target).toBeNull();
  });

  it('fora da grade não há destino', () => {
    const plan = planDrop({ point: p(10, 10), geometry: G, columns: COLUMNS, drag: slots, durationMin: 30 });
    expect(plan.target).toBeNull();
    expect(plan.column).toBe(-1);
  });

  it('coluna de profissional usa os horários daquele profissional', () => {
    const d: DragSlots = {
      loading: false, error: '',
      slots: { '2026-09-14': ['09:00'] },
      byPro: { '2026-09-14': { ana: ['10:00'], bruno: [] } },
    };
    expect(slotsForColumn(d, '2026-09-14', 'ana')).toEqual(['10:00']);
    expect(slotsForColumn(d, '2026-09-14', '')).toEqual(['09:00']);
    expect(slotsForColumn(d, '2026-09-14', 'bruno')).toEqual([]);
  });

  it('serviço elegível só para Orlando não cria snap verde em Silvio', () => {
    const d: DragSlots = {
      loading: false, error: '',
      slots: { '2026-09-14': ['10:00'] },
      byPro: { '2026-09-14': { orlando: ['10:00'], silvio: [] } },
      eligibleProIds: { '2026-09-14': ['orlando'] },
    };
    const columns: DropColumn[] = [
      { key: 'orlando', label: 'Orlando', date: '2026-09-14', professionalId: 'orlando', isProfessional: true },
      { key: 'silvio', label: 'Silvio Santos', date: '2026-09-14', professionalId: 'silvio', isProfessional: true },
    ];
    const own = { date: '2026-09-14', time: '10:00', professionalId: 'orlando' };
    const allowed = planDrop({ point: p(120, 260), geometry: G, columns, drag: d, durationMin: 30, own });
    const blocked = planDrop({ point: p(270, 260), geometry: G, columns, drag: d, durationMin: 30, own });
    expect(allowed.target?.professionalId).toBe('orlando');
    expect(blocked.target).toBeNull();
    expect(blocked.availability).toBe('busy');
  });

  it('nearestSlot respeita a tolerância', () => {
    expect(nearestSlot(['09:00', '14:00'], 9 * 60 + 20)?.time).toBe('09:00');
    expect(nearestSlot(['09:00', '14:00'], 12 * 60, 60)).toBeNull();
    expect(nearestSlot([], 600)).toBeNull();
  });
});

describe('agenda-drag — estados de disponibilidade da célula', () => {
  it('loading ganha de tudo; erro não vira "ocupado"', () => {
    expect(cellAvailability(drag({}, { loading: true }), '2026-09-14', '09:00', '')).toBe('loading');
    expect(cellAvailability(drag({}, { error: 'x' }), '2026-09-14', '09:00', '')).toBe('unknown');
    expect(cellAvailability(drag({}), '2026-09-14', '09:00', '')).toBe('unknown'); // dia não carregado
    expect(cellAvailability(drag({ '2026-09-14': ['09:00'] }), '2026-09-14', '09:00', '')).toBe('free');
    expect(cellAvailability(drag({ '2026-09-14': ['09:00'] }), '2026-09-14', '10:00', '')).toBe('busy');
  });
});

describe('agenda-drag — rótulos do preview e da confirmação', () => {
  it('preview mostra data e horário (sem duração)', () => {
    expect(shortDateBR('2026-09-14')).toBe('14/09');
    expect(dragPreviewLabel('2026-09-14', '14:30')).toBe('14/09 · 14:30');
    expect(dragPreviewLabel('2026-09-14', '')).toBe('14/09');
    expect(dragPreviewLabel('2026-09-14', '14:30')).not.toMatch(/\d+\s*min/);
  });

  it('a confirmação é uma pergunta explícita com data e horário', () => {
    const q = dropConfirmQuestion('2026-09-14', '14:30');
    expect(q).toBe('Reagendar atendimento para 14/09 às 14:30?');
    expect(q.endsWith('?')).toBe(true);
  });
});

describe('agenda-drag — blocos na grade', () => {
  it('altura e posição seguem duração e início da grade', () => {
    expect(blockHeight(60, 60)).toBe(60);
    expect(blockHeight(30, 60)).toBe(30);
    expect(blockHeight(5, 60)).toBeGreaterThanOrEqual(22); // mínimo legível
    expect(blockTop('09:00', 480, 60)).toBe(60);
    expect(blockTop(480, 480, 60)).toBe(0);
  });

  it('snap nunca menor que 10min', () => {
    expect(gridSnapMinutes(30, 60)).toBe(30);
    expect(gridSnapMinutes(0, 45)).toBe(45);
    expect(gridSnapMinutes(0, 0)).toBe(30);
    expect(gridSnapMinutes(5, 5)).toBe(10);
    expect(gridSnapMinutes(600, 60)).toBe(120);
  });

  it('atendimentos que se sobrepõem ficam lado a lado (nunca um sobre o outro)', () => {
    const out = layoutBlocks([
      { id: 'a', minute: 9 * 60, durationMin: 60 },
      { id: 'b', minute: 9 * 60 + 30, durationMin: 60 },
    ], { startMinute: 8 * 60, pxPerHour: 60 });
    expect(out).toHaveLength(2);
    expect(out.every((b) => b.lanes === 2)).toBe(true);
    expect(out.map((b) => b.lane).sort()).toEqual([0, 1]);
    expect(out.every((b) => b.widthPct === 50)).toBe(true);
    expect(out[0].leftPct).not.toBe(out[1].leftPct);
  });

  it('sem sobreposição, cada bloco ocupa a coluna inteira', () => {
    const out = layoutBlocks([
      { id: 'a', minute: 9 * 60, durationMin: 30 },
      { id: 'b', minute: 10 * 60, durationMin: 30 },
    ], { startMinute: 8 * 60, pxPerHour: 60 });
    expect(out.every((b) => b.lanes === 1 && b.widthPct === 100 && b.leftPct === 0)).toBe(true);
    expect(out[0].top).toBe(60);
    expect(out[1].top).toBe(120);
  });

  it('lista vazia não quebra', () => {
    expect(layoutBlocks([], { startMinute: 480, pxPerHour: 60 })).toEqual([]);
  });
});
