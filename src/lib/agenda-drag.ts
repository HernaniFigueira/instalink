// ═══════════════════════════════════════════════════════════════
// AGENDA — interação (clique × arraste) e drag-and-drop real
// ═══════════════════════════════════════════════════════════════
// Regra obrigatória de interação:
//
//   pointerdown → guarda posição inicial → aguarda movimento
//     movimento ≤ threshold → CLIQUE simples → abre BookingDetailSheet
//     movimento > threshold → inicia DRAG (e só então busca horários)
//
// Durante o drag NADA é salvo, nenhum modal é aberto e nenhum request é
// feito por pixel: os horários livres são buscados UMA vez no início e o
// destino é calculado por geometria (este arquivo), não por DOM.
//
// Módulo PURO (sem React, sem DOM, sem I/O) — todo o comportamento é
// coberto por testes em src/lib/__tests__/agenda-drag.test.ts.
import { timeToMin, minToTime } from './utils';

/** Threshold de movimento (px) exigido pela especificação: 5–8px. */
export const DRAG_THRESHOLD_PX = 6;

export interface Point {
  x: number;
  y: number;
}

export function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function exceedsDragThreshold(
  origin: Point,
  current: Point,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  return pointerDistance(origin, current) > threshold;
}

// ── Máquina de interação (clique × drag) ─────────────────────
export type InteractionPhase = 'idle' | 'pressed' | 'dragging';

/**
 * Efeitos que a tela deve executar. Note que `move` nunca produz efeito de
 * rede: o preview é puramente visual.
 */
export type InteractionEffect =
  | 'none'
  | 'start-drag'   // threshold ultrapassado: buscar horários UMA vez
  | 'open-detail'  // soltou sem arrastar: abrir BookingDetailSheet
  | 'drop'         // soltou arrastando: validar destino e confirmar
  | 'cancel';      // ESC / perda de ponteiro

export interface InteractionState {
  phase: InteractionPhase;
  id: string;
  origin: Point | null;
  last: Point | null;
  movedPx: number;
}

export const IDLE_INTERACTION: InteractionState = {
  phase: 'idle', id: '', origin: null, last: null, movedPx: 0,
};

export type InteractionEvent =
  | { type: 'down'; id: string; at: Point }
  | { type: 'move'; at: Point }
  | { type: 'up'; at: Point }
  | { type: 'cancel' };

export interface InteractionStep {
  state: InteractionState;
  effect: InteractionEffect;
}

/**
 * Redutor puro da interação. Um único `down` seguido de `up` (sem movimento)
 * é SEMPRE clique → detalhe. Drag só existe depois do threshold.
 */
export function reduceInteraction(
  state: InteractionState,
  event: InteractionEvent,
  threshold: number = DRAG_THRESHOLD_PX,
): InteractionStep {
  switch (event.type) {
    case 'down': {
      if (state.phase !== 'idle') return { state, effect: 'none' };
      return {
        state: { phase: 'pressed', id: event.id, origin: event.at, last: event.at, movedPx: 0 },
        effect: 'none',
      };
    }
    case 'move': {
      if (state.phase === 'idle' || !state.origin) return { state, effect: 'none' };
      const movedPx = pointerDistance(state.origin, event.at);
      if (state.phase === 'pressed') {
        if (!exceedsDragThreshold(state.origin, event.at, threshold)) {
          // Movimento pequeno: continua sendo clique (nunca vira drag).
          return { state: { ...state, last: event.at, movedPx }, effect: 'none' };
        }
        return {
          state: { ...state, phase: 'dragging', last: event.at, movedPx },
          effect: 'start-drag',
        };
      }
      // Já está arrastando: apenas registra a posição (sem efeito de rede).
      return { state: { ...state, last: event.at, movedPx }, effect: 'none' };
    }
    case 'up': {
      if (state.phase === 'idle') return { state, effect: 'none' };
      const effect: InteractionEffect = state.phase === 'dragging' ? 'drop' : 'open-detail';
      return { state: { ...IDLE_INTERACTION }, effect };
    }
    case 'cancel': {
      if (state.phase === 'idle') return { state, effect: 'none' };
      return { state: { ...IDLE_INTERACTION }, effect: 'cancel' };
    }
    default:
      return { state, effect: 'none' };
  }
}

/** Quantos efeitos de rede/rede-reagendamento uma sequência produziu. */
export function runInteraction(
  events: InteractionEvent[],
  threshold: number = DRAG_THRESHOLD_PX,
): { state: InteractionState; effects: InteractionEffect[] } {
  let state = { ...IDLE_INTERACTION };
  const effects: InteractionEffect[] = [];
  for (const ev of events) {
    const step = reduceInteraction(state, ev, threshold);
    state = step.state;
    if (step.effect !== 'none') effects.push(step.effect);
  }
  return { state, effects };
}

// ── Geometria da grade (destino calculado, não por DOM) ───────
export interface GridGeometry {
  /** clientX onde começa a primeira coluna (depois do gutter e do scroll). */
  left: number;
  /** clientY onde começa a linha do minuto `startMinute`. */
  top: number;
  columnWidth: number;
  columnCount: number;
  startMinute: number;
  endMinute: number;
  pxPerHour: number;
}

export interface GridMetrics {
  gutterWidth: number;
  scrollLeft: number;
  scrollTop: number;
  columnWidth: number;
  columnCount: number;
  startMinute: number;
  endMinute: number;
  pxPerHour: number;
}

/** Converte o rect do corpo da grade + scrolls em geometria utilizável. */
export function geometryFromRect(
  rect: { left: number; top: number },
  m: GridMetrics,
): GridGeometry {
  return {
    left: rect.left + m.gutterWidth - m.scrollLeft,
    top: rect.top - m.scrollTop,
    columnWidth: m.columnWidth,
    columnCount: m.columnCount,
    startMinute: m.startMinute,
    endMinute: m.endMinute,
    pxPerHour: m.pxPerHour,
  };
}

/** Índice da coluna sob o ponteiro (-1 quando fora da grade). */
export function columnAt(x: number, g: GridGeometry): number {
  if (g.columnWidth <= 0) return -1;
  const index = Math.floor((x - g.left) / g.columnWidth);
  if (index < 0 || index >= g.columnCount) return -1;
  return index;
}

/** Minuto do dia sob o ponteiro (bruto, sem snap). */
export function minuteAt(y: number, g: GridGeometry): number {
  if (g.pxPerHour <= 0) return g.startMinute;
  return g.startMinute + ((y - g.top) / g.pxPerHour) * 60;
}

/** Minuto limitado à grade, já descontando a duração do atendimento. */
export function clampMinuteToGrid(
  minute: number,
  g: GridGeometry,
  durationMin: number,
): number | null {
  const max = g.endMinute - Math.max(0, durationMin);
  if (max < g.startMinute) return null;
  return Math.max(g.startMinute, Math.min(max, Math.round(minute)));
}

export interface GridCell {
  column: number;
  minute: number;
}

export function cellFromPoint(
  p: Point,
  g: GridGeometry,
  durationMin: number,
): GridCell | null {
  const column = columnAt(p.x, g);
  if (column < 0) return null;
  const minute = clampMinuteToGrid(minuteAt(p.y, g), g, durationMin);
  if (minute === null) return null;
  return { column, minute };
}

// ── Colunas e destino ────────────────────────────────────────
export interface DropColumn {
  key: string;
  label: string;
  /** Dia representado pela coluna (dia da semana ou o dia em foco). */
  date: string;
  /** '' = qualquer profissional (o servidor resolve). */
  professionalId: string;
  isProfessional: boolean;
}

export interface DropTarget {
  date: string;
  time: string;
  professionalId: string;
  columnKey: string;
}

// ── Disponibilidade carregada UMA vez por drag ────────────────
export type CellAvailability = 'loading' | 'unknown' | 'free' | 'busy';

export interface DragSlots {
  loading: boolean;
  error: string;
  /** date → horários livres (união da equipe). */
  slots: Record<string, string[]>;
  /** date → professionalId → horários livres daquele profissional. */
  byPro: Record<string, Record<string, string[]>>;
}

export function emptyDragSlots(): DragSlots {
  return { loading: false, error: '', slots: {}, byPro: {} };
}

/**
 * URLs buscadas no início do drag — UMA por dia visível. Nada aqui depende do
 * movimento do ponteiro (prova de "nenhum request por pixel").
 */
export function dragSlotUrls(businessId: string, serviceId: string, dates: string[]): string[] {
  return dates.map(
    (d) => `/api/bookings?businessId=${encodeURIComponent(businessId)}&serviceId=${encodeURIComponent(serviceId)}&date=${d}`,
  );
}

/**
 * O atendimento arrastado não bloqueia a si mesmo (o servidor valida o novo
 * horário ignorando o próprio registro) — devolvemos o horário original à
 * lista de livres.
 */
export function withOwnSlot(
  date: string,
  slots: string[],
  own: { date: string; time: string } | null,
): string[] {
  if (!own || own.date !== date) return slots;
  if (slots.includes(own.time)) return slots;
  return [...slots, own.time].sort();
}

/** Horários livres da coluna (por profissional quando a coluna é de um). */
export function slotsForColumn(
  drag: DragSlots,
  date: string,
  professionalId: string,
): string[] {
  if (professionalId) return drag.byPro[date]?.[professionalId] || [];
  return drag.slots[date] || [];
}

export function cellAvailability(
  drag: DragSlots,
  date: string,
  time: string,
  professionalId: string,
): CellAvailability {
  if (drag.error) return 'unknown';
  if (drag.loading) return 'loading';
  if (!(date in drag.slots)) return 'unknown';
  const list = slotsForColumn(drag, date, professionalId);
  return list.includes(time) ? 'free' : 'busy';
}

/**
 * Horário livre mais próximo do ponteiro (dentro da tolerância). É assim que o
 * preview mostra um destino REAL: nunca inventamos um minuto fora da grade de
 * disponibilidade calculada pelo servidor.
 */
export function nearestSlot(
  slots: string[],
  minute: number,
  toleranceMin = 90,
): { time: string; minute: number; deltaMin: number } | null {
  let best: { time: string; minute: number; deltaMin: number } | null = null;
  for (const time of slots) {
    const m = timeToMin(time);
    const delta = Math.abs(m - minute);
    if (delta > toleranceMin) continue;
    if (!best || delta < best.deltaMin) best = { time, minute: m, deltaMin: delta };
  }
  return best;
}

export interface DropPlan {
  target: DropTarget | null;
  availability: CellAvailability;
  /** Minuto a destacar na coluna (snap do horário escolhido). */
  minute: number;
  column: number;
}

/**
 * Resolve o destino do drag a partir do ponteiro. Não faz I/O: usa os
 * horários já carregados no início do arraste.
 */
export function planDrop(opts: {
  point: Point;
  geometry: GridGeometry;
  columns: DropColumn[];
  drag: DragSlots;
  durationMin: number;
  toleranceMin?: number;
  own?: { date: string; time: string } | null;
}): DropPlan {
  const { point, geometry, columns, drag, durationMin } = opts;
  const tolerance = opts.toleranceMin ?? 90;
  const cell = cellFromPoint(point, geometry, durationMin);
  if (!cell) return { target: null, availability: 'unknown', minute: 0, column: -1 };
  const col = columns[cell.column];
  if (!col) return { target: null, availability: 'unknown', minute: cell.minute, column: cell.column };

  if (drag.loading) {
    return { target: null, availability: 'loading', minute: cell.minute, column: cell.column };
  }
  // Busca falhou: não podemos afirmar que está ocupado — o estado é desconhecido
  // (a tela mostra o erro e o botão de tentar de novo).
  if (drag.error) {
    return { target: null, availability: 'unknown', minute: cell.minute, column: cell.column };
  }
  const list = withOwnSlot(col.date, slotsForColumn(drag, col.date, col.professionalId), opts.own || null);
  const near = nearestSlot(list, cell.minute, tolerance);
  if (!near) {
    return { target: null, availability: 'busy', minute: cell.minute, column: cell.column };
  }
  return {
    target: {
      date: col.date,
      time: near.time,
      professionalId: col.professionalId,
      columnKey: col.key,
    },
    availability: 'free',
    minute: near.minute,
    column: cell.column,
  };
}

// ── Rótulos do preview e da confirmação ──────────────────────
/** "16/09" */
export function shortDateBR(dateISO: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) return dateISO || '';
  return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}`;
}

/** Rótulo do destino durante o arraste: "16/09 · 14:30". */
export function dragPreviewLabel(dateISO: string, time: string): string {
  if (!time) return shortDateBR(dateISO);
  return `${shortDateBR(dateISO)} · ${time}`;
}

/** Pergunta explícita de confirmação no drop (nada acontece em silêncio). */
export function dropConfirmQuestion(dateISO: string, time: string): string {
  return `Reagendar atendimento para ${shortDateBR(dateISO)} às ${time}?`;
}

/** Altura (px) do bloco de um atendimento na grade. */
export function blockHeight(durationMin: number, pxPerHour: number, minHeight = 22): number {
  return Math.max(minHeight, (Math.max(5, durationMin) / 60) * pxPerHour);
}

/** Topo (px) de um horário na grade. */
export function blockTop(timeOrMinute: string | number, startMinute: number, pxPerHour: number): number {
  const minute = typeof timeOrMinute === 'number' ? timeOrMinute : timeToMin(timeOrMinute);
  return Math.max(0, ((minute - startMinute) / 60) * pxPerHour);
}

/** Passo de snap visual da grade (nunca menor que 10min). */
export function gridSnapMinutes(slotMin: number, durationMin: number, fallback = 30): number {
  const base = slotMin > 0 ? slotMin : durationMin > 0 ? durationMin : fallback;
  return Math.max(10, Math.min(120, base));
}

/** Rótulo legível de um minuto do dia (usado em testes/preview). */
export function minuteLabel(minute: number): string {
  return minToTime(Math.max(0, Math.round(minute)));
}

// ── Layout de blocos na coluna (sobreposição → faixas lado a lado) ──
export interface BlockInput {
  id: string;
  /** Minuto do dia em que o atendimento começa. */
  minute: number;
  durationMin: number;
}

export interface BlockLayout {
  id: string;
  top: number;
  height: number;
  /** % da largura da coluna. */
  leftPct: number;
  widthPct: number;
  lane: number;
  lanes: number;
}

/**
 * Posiciona os atendimentos de uma coluna. Itens que se sobrepõem no tempo
 * são divididos em faixas lado a lado (nunca um por cima do outro), o que
 * mantém a semana legível quando vários profissionais atendem no mesmo dia.
 */
export function layoutBlocks(
  items: BlockInput[],
  opts: { startMinute: number; pxPerHour: number; minHeight?: number },
): BlockLayout[] {
  const minHeight = opts.minHeight ?? 22;
  const sorted = [...(items || [])].sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id));
  const spans = sorted.map((it) => ({
    ...it,
    start: it.minute,
    end: it.minute + Math.max(5, it.durationMin),
  }));

  // Agrupa em clusters de itens que se sobrepõem (direta ou indiretamente).
  const clusters: Array<typeof spans> = [];
  let current: typeof spans = [];
  let clusterEnd = -Infinity;
  for (const s of spans) {
    if (current.length > 0 && s.start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(s);
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  if (current.length > 0) clusters.push(current);

  const out: BlockLayout[] = [];
  for (const cluster of clusters) {
    // Faixas (lanes): coloca cada item na primeira faixa livre.
    const laneEnds: number[] = [];
    const lanes: number[] = [];
    for (const s of cluster) {
      let lane = laneEnds.findIndex((end) => end <= s.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = s.end;
      lanes.push(lane);
    }
    const total = laneEnds.length || 1;
    cluster.forEach((s, i) => {
      out.push({
        id: s.id,
        top: blockTop(s.start, opts.startMinute, opts.pxPerHour),
        height: blockHeight(s.end - s.start, opts.pxPerHour, minHeight),
        leftPct: (lanes[i] / total) * 100,
        widthPct: 100 / total,
        lane: lanes[i],
        lanes: total,
      });
    });
  }
  return out;
}

