'use client';
// ═══════════════════════════════════════════════════════════════
// AGENDA — clique abre detalhe, arraste move o atendimento
// ═══════════════════════════════════════════════════════════════
// REGRA DE INTERAÇÃO (obrigatória, implementada em lib/agenda-drag.ts):
//
//   pointerdown → guarda posição inicial → aguarda movimento
//     movimento ≤ 6px → CLIQUE simples → abre BookingDetailSheet
//     movimento > 6px → inicia DRAG (e só então busca os horários livres)
//
// DRAG-AND-DROP REAL:
//   clicar e segurar → arrastar → preview visual (ghost + célula destacada)
//   → soltar → validar no servidor → confirmar → salvar.
//
// Durante o arraste: nenhum request por pixel, nenhuma re-renderização da
// grade inteira (colunas são memoizadas), nenhum modal, nenhum change de
// status e nenhuma gravação. O destino é calculado por geometria e validado
// contra os horários livres buscados UMA única vez no início do movimento.
//
// REAGENDAMENTO (lib/booking-ops.rescheduleDecision, regra preservada):
//   pending/confirmed            → move o registro existente
//   completed/no_show/cancelled  → cria NOVO agendamento 'pending'
//   preservando previousId, rescheduleCount e histórico.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { todayISO, addDaysISO, weekdayOf, formatDateBR, nowHM } from '@/lib/tz';
import { WEEKDAYS, WEEKDAYS_LONG, timeToMin, minToTime, cn } from '@/lib/utils';
import type { Availability, Booking, BookingConfig, BookingStatus, Professional, Service } from '@/lib/types';
import { ListSkeleton, Button, AttentionStrip, Tabs } from '@/components/ui';
import { Icon } from '@/components/icons';
import {
  ATTENTION_MARK_CLS, ATTENTION_RING_CLS, BOOKING_BLOCK, BOOKING_DOT, BOOKING_STATUS,
} from '@/lib/status';
import { BookingDetailSheet } from '@/components/dashboard/BookingDetailSheet';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { AccessDenied, PermissionNotice, useAreaLoad, useForbiddenNotice } from '@/components/dashboard/AccessNotice';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';
import { bookingDuration, effectiveHorizonDays, needsClosure, rescheduleDecision } from '@/lib/booking-ops';
import { apiGet, apiSend } from '@/lib/api-client';
import { SLOT_STATE_MESSAGE, slotState } from '@/lib/slot-states';
import {
  IDLE_INTERACTION, blockHeight, blockTop, dragPreviewLabel, dragSlotUrls, dropConfirmQuestion,
  emptyDragSlots, geometryFromRect, layoutBlocks, planDrop, reduceInteraction, withOwnSlot,
  type CellAvailability, type DragSlots, type DropColumn, type GridGeometry, type InteractionState,
  type Point,
} from '@/lib/agenda-drag';

type View = 'day' | 'week' | 'month';

// Cores dos estados vêm da fonte única (lib/status.ts). P1.1: os blocos da
// grade usam a apresentação SUAVE definida lá (BOOKING_BLOCK) — a semântica
// permanece, sem o peso da cor sólida na Semana. Nada de mapa local de cor.

const PX_PER_HOUR = 52;
const GUTTER_W = 56;
const COL_MIN = 148;
const HEADER_H = 36;
/** Folga mínima entre o fim da grade e o fim da tela (não é a causa do
 *  scroll, só respiro visual — a página continua rolando normalmente). */
const VIEWPORT_BOTTOM_PAD = 16;

// Espessura REAL da barra de rolagem horizontal (0 quando o SO usa barra
// overlay). A grade usa a classe `.ws-scroll` (6px custom no Chromium); o
// probe usa a MESMA classe para medir o espaço que a barra realmente consome
// — assim a reserva abaixo nunca "chuta" um valor.
let _hbarCache: number | null = null;
function horizontalScrollbarH(): number {
  if (_hbarCache !== null) return _hbarCache;
  if (typeof document === 'undefined') { _hbarCache = 6; return _hbarCache; }
  const probe = document.createElement('div');
  probe.className = 'ws-scroll';
  probe.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;width:48px;height:48px;overflow:scroll;visibility:hidden;';
  probe.innerHTML = '<div style="width:96px;height:96px"></div>';
  document.body.appendChild(probe);
  _hbarCache = Math.max(0, probe.offsetHeight - probe.clientHeight);
  document.body.removeChild(probe);
  return _hbarCache;
}

// ResizeObserver com fallback silencioso (NoopRO): o gauge da largura é o
// próprio scroller — recolher da sidebar / redimensionar muda o content-box
// do scroller e dispara o observer. NUNCA lança.
type RO = new (cb: () => void) => { observe(el: Element): void; disconnect(): void };
let ROClass: RO | null | undefined;
function lightRO(): RO {
  if (ROClass === undefined) {
    ROClass = (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null) as unknown as RO | null;
  }
  return (ROClass || NoopRO) as RO;
}
const NoopRO = (class {
  observe() { /* noop */ }
  disconnect() { /* noop */ }
}) as unknown as RO;
let scrollerResizeObserver: RO | null = null;
/** Tolerância para "encaixar" o ponteiro no horário livre mais próximo. */
const DROP_TOLERANCE_MIN = 75;

// ── Modelo de visualização (pré-calculado: a coluna memoizada não faz conta) ──
interface BlockVM {
  id: string;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  time: string;
  /** Linha 1: cliente · Linha 2: serviço · Linha 3: horário + estado. */
  name: string;
  service: string;
  timeRange: string;
  statusLabel: string;
  cls: string;
  /** Horário passou e continua em aberto: marcador amarelo de atenção. */
  attention: boolean;
  dragging: boolean;
  label: string;
}

interface ColumnVM {
  key: string;
  label: string;
  sub: string;
  date: string;
  professionalId: string;
  isProfessional: boolean;
  isToday: boolean;
  blocks: BlockVM[];
}

interface HighlightVM {
  top: number;
  height: number;
  label: string;
  tone: 'free' | 'busy' | 'loading';
}

interface HoverTarget {
  column: number;
  columnKey: string;
  date: string;
  time: string;
  minute: number;
  availability: CellAvailability;
}

// ── Coluna da grade (memoizada: o drag não re-renderiza a grade inteira) ──
const GridColumn = memo(function GridColumn({ column, basisPct, variant, highlight, onPressStart, onPressMove, onPressEnd, onPressCancel, onBlockClick, gridHeight, hours }: {
  column: ColumnVM;
  basisPct: number;
  variant: 'day' | 'week';
  highlight: HighlightVM | null;
  onPressStart: (id: string, e: React.PointerEvent) => void;
  onPressMove: (id: string, e: React.PointerEvent) => void;
  onPressEnd: (id: string, e: React.PointerEvent) => void;
  onPressCancel: () => void;
  onBlockClick: (id: string) => void;
  gridHeight: number;
  hours: number;
}) {
  return (
    // border-b = linha final da grade. As linhas internas param em
    // hours-1: NADA ultrapassa gridHeight (zero scroll fantasma).
    // Largura em % exata (N colunas = 100%/N + min-width) com box-sizing
    // border-box: larguras inteiras determinísticas — nenhuma divergência
    // de subpixel contra o minWidth calculado em JS, nenhum resíduo que
    // fabrique overflow nas bordas.
    <div className="relative shrink-0 border-r border-b border-zinc-100 last:border-r-0" style={{ minWidth: COL_MIN, width: `${basisPct}%`, height: gridHeight }}>
      {Array.from({ length: Math.max(0, hours - 1) }, (_, idx) => idx + 1).map((i) => (
        <span key={i} className="absolute left-0 right-0 border-t border-zinc-100" style={{ top: i * PX_PER_HOUR }} />
      ))}
      {column.isToday && (
        <span className="absolute inset-0 bg-emerald-50/25 pointer-events-none" aria-hidden="true" />
      )}

      {/* Célula destino destacada durante o arraste */}
      {highlight && (
        <div
          className={
            // A3.3 — feedback de arraste legível: verde = pode soltar,
            // vermelho = não pode (e o rótulo diz por quê), tracejado = ainda
            // verificando. O rótulo vai na BORDA SUPERIOR para não cobrir o
            // horário vizinho.
            'pointer-events-none absolute z-20 rounded-md border-2 flex items-start justify-center overflow-hidden '
            + (highlight.tone === 'free'
              ? 'border-[var(--success)] bg-[var(--success-bg)]'
              : highlight.tone === 'loading'
                ? 'border-[var(--border-strong)] bg-[var(--surface-3)] border-dashed'
                : 'border-[var(--danger)] bg-[var(--danger-bg)]')
          }
          style={{ top: highlight.top, height: highlight.height, left: 2, right: 2 }}
          aria-hidden="true"
        >
          <span className={
            'text-[10px] font-bold px-1.5 py-0.5 rounded-b-md shadow-xs '
            + (highlight.tone === 'free'
              ? 'bg-[var(--success)] text-white'
              : highlight.tone === 'loading'
                ? 'bg-[var(--text-faint)] text-white'
                : 'bg-[var(--danger)] text-white')
          }>
            {highlight.label}
          </span>
        </div>
      )}

      {column.blocks.map((b) => (
        <button
          key={b.id}
          type="button"
          aria-label={b.label}
          title={b.label}
          draggable={false}
          onPointerDown={(e) => onPressStart(b.id, e)}
          onPointerMove={(e) => onPressMove(b.id, e)}
          onPointerUp={(e) => onPressEnd(b.id, e)}
          onPointerCancel={onPressCancel}
          onClick={() => onBlockClick(b.id)}
          className={
            'absolute rounded-md border border-l-4 px-2 py-1 text-left overflow-hidden touch-none select-none shadow-sm '
            + b.cls
            + (b.attention && !b.dragging ? ` ${ATTENTION_RING_CLS}` : '')
            + (b.dragging
              ? ' il-dragging ring-2 ring-[var(--brand)] ring-offset-1 cursor-grabbing shadow-lg'
              : ' hover:brightness-[0.97] hover:shadow-md cursor-grab active:cursor-grabbing')
          }
          style={{
            top: b.top,
            height: b.height,
            left: `calc(${b.leftPct}% + 2px)`,
            width: `calc(${b.widthPct}% - 4px)`,
          }}
        >
          {/* quem + quando + o quê + em que estado — detalhe fica no drawer. */}
          <span className="block text-[11px] font-bold leading-tight truncate">{b.name}</span>
          {b.height > 34 && <span className="block text-[10px] font-medium leading-tight truncate opacity-90">{b.service}</span>}
          {b.height > 54 && (
            <span className="mt-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide leading-tight">
              <span className="tabular-nums opacity-90 whitespace-nowrap">{b.timeRange}</span>
              <span aria-hidden="true" className="opacity-60">·</span>
              <span className="truncate">{b.statusLabel}</span>
            </span>
          )}
          {b.attention && (
            <span title="Precisa de fechamento" aria-hidden="true"
              className={`absolute top-1 right-1 w-4 h-4 rounded-full text-[10px] font-black leading-4 text-center ${ATTENTION_MARK_CLS}`}>
              !
            </span>
          )}
        </button>
      ))}
      {variant === 'week' && column.blocks.length === 0 && (
        <span className="absolute inset-x-0 top-3 text-center text-[11px] text-zinc-300 pointer-events-none">—</span>
      )}
    </div>
  );
});

// Chip de filtro do popover — ativo usa a cor de AÇÃO (tokens), não cor de
// estado: filtrar não é status.
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="il-chip">
      {children}
    </button>
  );
}

export default function AgendaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [view, setView] = useState<View>('day');
  // Deep-link operacional: /agenda?b=…&data=2026-09-20 abre focada no dia
  // (usado pelo "Ver na agenda" do histórico do cliente). Valor inválido
  // é ignorado e cai para hoje — nunca quebra a tela.
  const dataParam = params.get('data') || '';
  const [focus, setFocus] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(dataParam) ? dataParam : todayISO(),
  );
  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataParam)) setFocus(dataParam);
  }, [dataParam]);
  // Tela cheia do produto (expande sobre a sidebar; ESC sai) + filtros.
  const [fullscreen, setFullscreen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | BookingStatus>('');
  const [proFilter, setProFilter] = useState('');
  // P1.1 — filtros em escala: UM popover compacto (Status + Especialidade +
  // Profissional pesquisável). "Especialidade" deriva do campo `role` que JÁ
  // existe no Professional — nenhum schema novo.
  const [specFilter, setSpecFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [proSearch, setProSearch] = useState('');
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  // ── Drag: estado mínimo (o movimento em si vive em refs, sem re-render) ──
  const [dragId, setDragId] = useState('');
  const [drag, setDrag] = useState<DragSlots>(emptyDragSlots);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [dropAsk, setDropAsk] = useState<{ booking: Booking; date: string; time: string; professionalId: string; columnLabel: string } | null>(null);
  const [dropError, setDropError] = useState('');
  const [saving, setSaving] = useState(false);

  const interactionRef = useRef<InteractionState>({ ...IDLE_INTERACTION });
  const dragSlotsRef = useRef<DragSlots>(emptyDragSlots());
  const hoverRef = useRef<HoverTarget | null>(null);
  const columnsRef = useRef<DropColumn[]>([]);
  const bookingsRef = useRef<Map<string, Booking>>(new Map());
  const durationRef = useRef(30);
  const geometryRef = useRef<{ g: GridGeometry; minX: number; minY: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const dragSeq = useRef(0);
  const lastPointerUpRef = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(COL_MIN);

  const { notice, dismiss } = useForbiddenNotice('Agenda');
  const { denied, report } = useAreaLoad('Agenda');

  // A2-B5 (F9): '' enquanto carrega = default do produto (America/Sao_Paulo).
  const [bizTz, setBizTz] = useState('');
  // "hoje" e "agora" no FUSO DO NEGÓCIO (nunca o do navegador).
  const today = todayISO(new Date(), bizTz);
  const nowMin = timeToMin(nowHM(new Date(), bizTz));

  const range = useMemo(() => {
    if (view === 'month') {
      const first = focus.slice(0, 8) + '01';
      const dow = weekdayOf(first);
      const gridStart = addDaysISO(first, -((dow + 6) % 7));
      return { from: gridStart, to: addDaysISO(gridStart, 41) };
    }
    return { from: addDaysISO(focus, -21), to: addDaysISO(focus, 28) };
  }, [view, focus]);

  const load = useCallback(async () => {
    if (!businessId) return;
    const [cat, bk] = await Promise.all([
      apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Agenda' }),
      // A2-B3 (F6): pede o teto real do servidor (500) — pedir 1000 só
      // produzia um corte silencioso; o contrato agora é explícito.
      apiGet<{ bookings?: Booking[] }>(
        `/api/bookings?businessId=${businessId}&mode=manage&from=${range.from}&to=${range.to}&limit=500`,
        { scope: 'area', area: 'Agenda' },
      ),
    ]);
    // Sem permissão (403): mostra o aviso amigável e PARA de carregar — a tela
    // não pode ficar em skeleton para sempre. A sessão continua intacta.
    if (!report(cat)) { setLoaded(true); return; }
    const d = cat.data || {};
    setServices(d.services || []);
    setPros(d.professionals || []);
    // A2-B3 (F5): horizonte real do negócio (1–365) — nunca 60 hardcoded.
    if (d.business?.booking) setBookingCfg(d.business.booking);
    // A2-B5 (F9): fuso do negócio para "hoje/agora" locais (needsClosure,
    // linha do agora, destaque de hoje) — mesma referência do servidor.
    setBizTz(d.business?.businessTimezone || '');
    setRules(d.availability || []);
    setBookings(bk.ok ? (bk.data?.bookings || []) : []);
    setLoaded(true);
  }, [businessId, range.from, range.to, report]);

  useEffect(() => { load(); }, [load]);

  // Estado real da agenda (P2): quem atende vê a confirmação/chegada registrada
  // pela recepção ao VOLTAR para a tela — sem F5 e sem polling.
  useRevalidateOnFocus(load);

  useEffect(() => { bookingsRef.current = new Map(bookings.map((b) => [b.id, b])); }, [bookings]);

  const activePros = useMemo(() => pros.filter((p) => p.active !== false), [pros]);
  // A2-B3 (F5): enquanto o catálogo chega, o default do produto (60) vale;
  // depois, a configuração REAL do negócio manda (1–365).
  const [bookingCfg, setBookingCfg] = useState<BookingConfig | null>(null);
  const horizonDays = effectiveHorizonDays(bookingCfg);

  // ── Filtros em escala (P1.1) ──
  // Especialidades = valores únicos do campo `role` já existente (sem novo
  // cadastro). Papéis vazios ficam fora da lista, mas seguem em "Todas".
  const specialties = useMemo(() => {
    const set = new Set<string>();
    for (const p of activePros) {
      const r = (p.role || '').trim();
      if (r) set.add(r);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [activePros]);

  const proRoleOf = useCallback(
    (id: string) => (pros.find((p) => p.id === id)?.role || '').trim(),
    [pros],
  );

  // Especialidade + profissional combinam: escolher um valor que conflita
  // com o outro limpa o outro — o resultado nunca é um beco sem saída.
  function pickSpec(role: string) {
    setSpecFilter(role);
    if (role && proFilter) {
      const p = activePros.find((x) => x.id === proFilter);
      if (p && (p.role || '').trim() !== role) setProFilter('');
    }
  }
  function pickPro(id: string) {
    setProFilter(id);
    if (id && specFilter) {
      const p = activePros.find((x) => x.id === id);
      if (p && (p.role || '').trim() !== specFilter) setSpecFilter('');
    }
  }
  function clearFilters() {
    setStatusFilter('');
    setSpecFilter('');
    setProFilter('');
    setProSearch('');
  }
  const activeFilterCount = [statusFilter, specFilter, proFilter].filter(Boolean).length;

  // Lista pesquisável do popover (respeita a especialidade selecionada).
  const prosInFilter = useMemo(() => {
    const q = proSearch.trim().toLowerCase();
    return activePros
      .filter((p) => !specFilter || (p.role || '').trim() === specFilter)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.role || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [activePros, specFilter, proSearch]);

  // Fecha o popover clicando fora (ESC é tratado junto com drag/tela cheia).
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterWrapRef.current && !filterWrapRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen]);

  const grid = useMemo(() => {
    let s = 8 * 60, e = 20 * 60;
    for (const r of rules) {
      s = Math.min(s, timeToMin(r.start));
      e = Math.max(e, timeToMin(r.end));
    }
    s = Math.floor(s / 60) * 60;
    e = Math.ceil(e / 60) * 60;
    if (e - s < 6 * 60) e = s + 6 * 60;
    return { start: s, end: e, span: e - s, hours: Math.floor((e - s) / 60) };
  }, [rules]);

  const weekStart = useMemo(() => {
    const dow = weekdayOf(focus);
    return addDaysISO(focus, -((dow + 6) % 7));
  }, [focus]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)), [weekStart]);

  const serviceOf = useCallback((id: string) => services.find((s) => s.id === id), [services]);
  const serviceName = useCallback((id: string) => serviceOf(id)?.name || 'Serviço', [serviceOf]);
  const proName = useCallback((id: string) => pros.find((p) => p.id === id)?.name || '', [pros]);
  const durationOf = useCallback((b: Booking) => bookingDuration(serviceOf(b.serviceId), 30), [serviceOf]);

  const pendencies = useMemo(
    () => bookings
      .filter((b) => needsClosure(b, bookingDuration(serviceOf(b.serviceId)), today, nowHM(new Date(), bizTz)))
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)),
    [bookings, serviceOf, today, bizTz],
  );

  // ── Colunas: dia = profissionais; semana = dias ──
  // Filtros compactos (status + profissional) só escondem blocos/colunas da
  // grade — dados, drag e ações continuam sobre os mesmos agendamentos.
  const columns = useMemo<ColumnVM[]>(() => {
    const base: Array<{ key: string; label: string; sub: string; date: string; professionalId: string; isProfessional: boolean }> = [];
    if (view === 'week') {
      for (const d of weekDays) {
        base.push({
          key: d, label: WEEKDAYS[weekdayOf(d)], sub: `${d.slice(8, 10)}/${d.slice(5, 7)}`,
          date: d, professionalId: '', isProfessional: false,
        });
      }
    } else if (activePros.length === 0) {
      base.push({ key: '__all', label: 'Agenda', sub: '', date: focus, professionalId: '', isProfessional: false });
    } else {
      // Especialidade restringe o conjunto; profissional, a coluna. Filtro
      // obsoleto (id que não existe mais) cai para "tudo" — nunca grade
      // vazia sem motivo.
      const specPros = specFilter ? activePros.filter((x) => (x.role || '').trim() === specFilter) : activePros;
      const filtering = proFilter ? specPros.some((x) => x.id === proFilter) : false;
      const shown = filtering ? specPros.filter((x) => x.id === proFilter) : specPros;
      for (const p of shown) {
        base.push({ key: p.id, label: p.name, sub: p.role || '', date: focus, professionalId: p.id, isProfessional: true });
      }
      // Com especialidade ativa não existe coluna "sem profissional".
      if (!filtering && !specFilter && bookings.some((b) => b.date === focus && !b.professionalId)) {
        base.push({ key: '__none', label: 'Sem profissional', sub: '', date: focus, professionalId: '', isProfessional: false });
      }
    }

    return base.map((c) => {
      const list = bookings
        .filter((b) => b.date === c.date)
        .filter((b) => (c.isProfessional ? b.professionalId === c.professionalId : c.key === '__none' ? !b.professionalId : true))
        .filter((b) => !statusFilter || b.status === statusFilter)
        // Semana: especialidade/profissional filtram os blocos. Dia: as
        // colunas já restringem (só existem as colunas escolhidas).
        .filter((b) => !specFilter || view !== 'week' || proRoleOf(b.professionalId || '') === specFilter)
        .filter((b) => !proFilter || view !== 'week' || b.professionalId === proFilter)
        .sort((a, b) => (a.time < b.time ? -1 : 1));
      const layout = layoutBlocks(
        list.map((b) => ({ id: b.id, minute: timeToMin(b.time), durationMin: durationOf(b) })),
        { startMinute: grid.start, pxPerHour: PX_PER_HOUR },
      );
      const byId = new Map(layout.map((l) => [l.id, l]));
      const blocks: BlockVM[] = list.map((b) => {
        const l = byId.get(b.id)!;
        const pro = b.professionalId ? proName(b.professionalId) : '';
        const dur = durationOf(b);
        const endMin = timeToMin(b.time) + dur;
        const endHM = minToTime(endMin % (24 * 60));
        const attention = needsClosure(b, dur, today, nowHM(new Date(), bizTz));
        const statusLabel = BOOKING_STATUS[b.status]?.panel || b.status;
        return {
          id: b.id,
          top: l.top,
          height: l.height,
          leftPct: l.leftPct,
          widthPct: l.widthPct,
          time: b.time,
          name: b.customerName,
          service: view === 'week' && pro ? `${serviceName(b.serviceId)} · ${pro}` : serviceName(b.serviceId),
          timeRange: `${b.time}–${endHM}`,
          statusLabel,
          cls: BOOKING_BLOCK[b.status],
          attention,
          dragging: dragId === b.id,
          label: `${b.customerName} · ${serviceName(b.serviceId)} · ${formatDateBR(b.date)} ${b.time}${pro ? ` · ${pro}` : ''} · ${statusLabel}${attention ? ' — precisa de fechamento' : ''} — clique para ver o detalhe ou arraste para reagendar`,
        };
      });
      return { ...c, isToday: c.date === today, blocks };
    });
  }, [view, weekDays, activePros, focus, bookings, grid.start, durationOf, proName, serviceName, dragId, today, statusFilter, proFilter, specFilter, proRoleOf, bizTz]);

  // Colunas usadas pelo cálculo de destino (mesma ordem da renderização).
  useEffect(() => {
    columnsRef.current = columns.map((c) => ({
      key: c.key, label: c.label, date: c.date, professionalId: c.professionalId, isProfessional: c.isProfessional,
    }));
  }, [columns]);

  const gridHeight = Math.max(460, Math.round((grid.span / 60) * PX_PER_HOUR));
  const dayWidth = GUTTER_W + columns.length * COL_MIN;

  // ── Geometria (medida, não por pixel de evento) ──
  useLayoutEffect(() => {
    const measure = () => {
      const el = colsRef.current;
      if (!el) return;
      const w = el.getBoundingClientRect().width / Math.max(1, columns.length);
      setColWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (colsRef.current && ro) ro.observe(colsRef.current);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [columns.length, view, loaded]);

  // ── Altura útil da grade (P1.1 — viewport real, sem scroll fantasma) ──
  // Medimos a posição REAL do container (header + toolbar + margens +
  // sidebar + tela cheia já estão embutidos no `top` medido) e usamos o
  // resto da viewport. A altura final é `min(conteúdo, disponível)`:
  //   • a grade cabe  → o container fica do tamanho exato do conteúdo e a
  //                     barra de rolagem NÃO aparece (nem por alguns pixels);
  //   • não cabe      → scroll SOMENTE interno da grade.
  // Nenhum min-height arbitrário força overflow; nada é "escondido".
  const gridContentH = HEADER_H + gridHeight;
  // Conteúdo horizontal REAL da grade: pode estourar a largura no dia com
  // muitos profissionais / na semana em tela estreita. Quando estoura, a
  // barra horizontal entra — e é ELA o gatilho do scroll vertical fantasma
  // (consome ~6px de altura de um painel que tinha o tamanho EXATO do
  // conteúdo). Medimos o overflow do próprio scroller e reservamos a
  // espessura da barra só quando ela aparece.
  const [hbarReserve, setHbarReserve] = useState(0);
  useLayoutEffect(() => {
    const bodyEl = document.body;
    const docEl = document.documentElement;
    if (!scrollRef.current || !bodyEl || !docEl || columns.length === 0) { setHbarReserve(0); return; }
    if (!scrollerResizeObserver) scrollerResizeObserver = lightRO();
    const captive: Element[] = [bodyEl, docEl].filter((n) => n !== scrollRef.current);
    const measure = () => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const overflowX =
        columns.length > 0 &&
        scroller.clientWidth > 0 &&
        scroller.scrollWidth > scroller.clientWidth + 1; // +1: tolera borda
      setHbarReserve(overflowX ? horizontalScrollbarH() : 0);
    };
    measure();
    const obs = new scrollerResizeObserver(() => {
      if (!scrollRef.current) return;
      const overflowX =
        columns.length > 0 &&
        scrollRef.current.clientWidth > 0 &&
        scrollRef.current.scrollWidth > scrollRef.current.clientWidth + 1;
      setHbarReserve(overflowX ? horizontalScrollbarH() : 0);
    });
    // O gauge principal é o próprio scroller: quando a sidebar recolhe (ou a
    // janela muda), o <main> alarga e o content-box do scroller muda — o RO
    // dispara e a reserva é recalculada. Body/documentElement cobrem o resto
    // (refluxo de fonte, faixas que entram/saem acima da grade).
    obs.observe(scrollRef.current);
    captive.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, [columns.length]);

  const [gridMaxH, setGridMaxH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // Reserva a altura da barra horizontal QUANDO ela está visível: é o
      // que impede `scrollHeight` de passar de `clientHeight` por causa dela
      // e fabricar a rolagem vertical fantasma de alguns pixels.
      const reserve = top >= 0 && window.innerHeight - top < VIEWPORT_BOTTOM_PAD
        ? window.innerHeight - top
        : hbarReserve;
      const h = window.innerHeight - top - VIEWPORT_BOTTOM_PAD - reserve;
      setGridMaxH(Math.max(320, Math.floor(h)));
    };
    fit();
    const ro = lightRO();
    const obs = new ro(fit);
    if (typeof document !== 'undefined') obs.observe(document.body);
    window.addEventListener('resize', fit);
    return () => { obs.disconnect(); window.removeEventListener('resize', fit); };
  }, [loaded, view, fullscreen, pendencies.length, notice?.title, statusFilter, proFilter, specFilter, hbarReserve]);

  const readGeometry = useCallback((): { g: GridGeometry; minX: number; minY: number } | null => {
    const scroll = scrollRef.current;
    const cols = colsRef.current;
    if (!scroll || !cols || colWidth <= 0) return null;
    const scrollRect = scroll.getBoundingClientRect();
    const colsRect = cols.getBoundingClientRect();
    const g = geometryFromRect(
      { left: colsRect.left, top: colsRect.top },
      {
        gutterWidth: 0, scrollLeft: 0, scrollTop: 0,
        columnWidth: colWidth, columnCount: columns.length,
        startMinute: grid.start, endMinute: grid.end, pxPerHour: PX_PER_HOUR,
      },
    );
    // O gutter (horas) e o cabeçalho são fixos: nada de destino atrás deles.
    return { g, minX: scrollRect.left + GUTTER_W, minY: scrollRect.top + HEADER_H };
  }, [colWidth, columns.length, grid.start, grid.end]);

  useEffect(() => { geometryRef.current = readGeometry(); }, [readGeometry]);

  // ── Busca de horários: UMA vez por drag (nunca por pixel) ──
  const loadDragSlots = useCallback((b: Booking, dates: string[]) => {
    const seq = ++dragSeq.current;
    const initial: DragSlots = { loading: true, error: '', slots: {}, byPro: {} };
    dragSlotsRef.current = initial;
    setDrag(initial);
    const own = { date: b.date, time: b.time, professionalId: b.professionalId || '' };
    Promise.all(dragSlotUrls(businessId, b.serviceId, dates).map(async (url, i) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return [dates[i], null] as const;
        const j = await r.json();
        return [dates[i], j] as const;
      } catch {
        return [dates[i], null] as const;
      }
    })).then((entries) => {
      if (seq !== dragSeq.current) return;
      const failed = entries.filter(([, j]) => !j).length;
      const next: DragSlots = {
        loading: false,
        error: failed === entries.length ? SLOT_STATE_MESSAGE.error : '',
        slots: {},
        byPro: {},
        eligibleProIds: {},
      };
      for (const [d, j] of entries) {
        if (!j) continue;
        next.slots[d] = withOwnSlot(d, Array.isArray(j.slots) ? [...j.slots] : [], own);
        if (Array.isArray(j.eligibleProfessionalIds)) next.eligibleProIds![d] = j.eligibleProfessionalIds.map(String);
        const byPro = (j.byPro || {}) as Record<string, string[]>;
        next.byPro[d] = {};
        for (const pid of Object.keys(byPro)) {
          next.byPro[d][pid] = withOwnSlot(
            d, Array.isArray(byPro[pid]) ? [...byPro[pid]] : [],
            pid === b.professionalId ? own : null,
          );
        }
        if (!b.professionalId) next.byPro[d][''] = next.slots[d];
      }
      dragSlotsRef.current = next;
      setDrag(next);
    });
  }, [businessId]);

  const endDrag = useCallback(() => {
    dragSeq.current++;
    interactionRef.current = { ...IDLE_INTERACTION };
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setDragId('');
    const empty = emptyDragSlots();
    dragSlotsRef.current = empty;
    setDrag(empty);
    hoverRef.current = null;
    setHover(null);
    if (ghostRef.current) ghostRef.current.style.display = 'none';
  }, []);

  const visibleDates = useCallback(
    () => (view === 'week' ? weekDays : [focus]),
    [view, weekDays, focus],
  );

  // ── Preview: ghost segue o ponteiro (DOM direto) e a célula é recalculada
  //    no máximo uma vez por frame, e só atualiza estado quando muda. ──
  const positionGhost = useCallback((at: Point) => {
    const el = ghostRef.current;
    if (!el) return;
    el.style.display = 'block';
    el.style.transform = `translate3d(${Math.round(at.x + 14)}px, ${Math.round(at.y + 14)}px, 0)`;
  }, []);

  const computeHover = useCallback((at: Point) => {
    const geo = geometryRef.current || readGeometry();
    if (!geo) return;
    geometryRef.current = geo;
    const b = bookingsRef.current.get(interactionRef.current.id);
    const point: Point = { x: Math.max(at.x, geo.minX), y: Math.max(at.y, geo.minY) };
    const plan = planDrop({
      point,
      geometry: geo.g,
      columns: columnsRef.current,
      drag: dragSlotsRef.current,
      durationMin: durationRef.current,
      toleranceMin: DROP_TOLERANCE_MIN,
      own: b ? { date: b.date, time: b.time, professionalId: b.professionalId || '' } : null,
    });
    const col = columnsRef.current[plan.column];
    const next: HoverTarget | null = plan.target
      ? {
        column: plan.column, columnKey: plan.target.columnKey, date: plan.target.date,
        time: plan.target.time, minute: plan.minute, availability: plan.availability,
      }
      : col
        ? {
          column: plan.column, columnKey: col.key, date: col.date, time: '',
          minute: Math.max(0, plan.minute), availability: plan.availability,
        }
        : null;
    const prev = hoverRef.current;
    if (prev && next && prev.column === next.column && prev.time === next.time && prev.availability === next.availability) return;
    if (!prev && !next) return;
    hoverRef.current = next;
    setHover(next);
  }, [readGeometry]);

  const scheduleHover = useCallback((at: Point) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      computeHover(at);
    });
  }, [computeHover]);

  // ── Handlers de ponteiro (estáveis: as colunas memoizadas não remontam) ──
  const onPressStart = useCallback((id: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const booking = bookingsRef.current.get(id);
    if (!booking) return;
    durationRef.current = bookingDuration(services.find((s) => s.id === booking.serviceId), 30);
    geometryRef.current = readGeometry();
    interactionRef.current = reduceInteraction(interactionRef.current, {
      type: 'down', id, at: { x: e.clientX, y: e.clientY },
    }).state;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [readGeometry, services]);

  const onPressMove = useCallback((id: string, e: React.PointerEvent) => {
    const state = interactionRef.current;
    if (state.phase === 'idle' || state.id !== id) return;
    const at: Point = { x: e.clientX, y: e.clientY };
    const wasDragging = state.phase === 'dragging';
    const step = reduceInteraction(state, { type: 'move', at });
    interactionRef.current = step.state;

    if (step.effect === 'start-drag') {
      // Threshold ultrapassado: SÓ AGORA o drag começa (e só agora a rede é usada).
      const booking = bookingsRef.current.get(id);
      setDragId(id);
      if (booking) loadDragSlots(booking, visibleDates());
    }
    if (step.state.phase !== 'dragging') return;
    positionGhost(at);
    if (!wasDragging) computeHover(at);
    else scheduleHover(at);
  }, [computeHover, loadDragSlots, positionGhost, scheduleHover, visibleDates]);

  const finishDrop = useCallback((id: string) => {
    const booking = bookingsRef.current.get(id);
    const target = hoverRef.current;
    endDrag();
    if (!booking) return;
    if (!target || !target.time) {
      setFlash({
        tone: 'warn',
        text: target && target.availability === 'loading'
          ? 'Ainda carregando os horários livres. Tente soltar novamente em instantes.'
          : 'Nenhum horário livre perto de onde você soltou. Escolha outro ponto da grade.',
      });
      window.setTimeout(() => setFlash(null), 4000);
      return;
    }
    if (target.availability !== 'free') {
      setFlash({ tone: 'error', text: `${target.time} em ${formatDateBR(target.date)} não está disponível para este atendimento.` });
      window.setTimeout(() => setFlash(null), 4000);
      return;
    }
    // Nada é salvo em silêncio: o drop abre a confirmação explícita.
    // A coluna de um profissional envia o id dela; colunas de dia (semana)
    // deixam o servidor resolver quem atende (política "equilibrar equipe").
    const col = columnsRef.current[target.column];
    setDropError('');
    setDropAsk({
      booking,
      date: target.date,
      time: target.time,
      professionalId: col?.isProfessional ? col.professionalId : '',
      columnLabel: col?.label || '',
    });
  }, [endDrag]);

  const onPressEnd = useCallback((id: string, e: React.PointerEvent) => {
    const step = reduceInteraction(interactionRef.current, { type: 'up', at: { x: e.clientX, y: e.clientY } });
    interactionRef.current = step.state;
    lastPointerUpRef.current = { id, at: Date.now() };
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (step.effect === 'open-detail') {
      // CLIQUE SIMPLES → detalhe. Nunca inicia reagendamento.
      const booking = bookingsRef.current.get(id);
      if (booking) setDetail(booking);
      return;
    }
    if (step.effect === 'drop') finishDrop(id);
  }, [finishDrop]);

  const onPressCancel = useCallback(() => {
    interactionRef.current = { ...IDLE_INTERACTION };
    endDrag();
  }, [endDrag]);

  const onBlockClick = useCallback((id: string) => {
    // O clique que vem logo depois do pointerup já foi tratado (detalhe ou
    // drop). Aqui só interessa o clique de TECLADO (Enter/Espaço), que não
    // gera eventos de ponteiro.
    const last = lastPointerUpRef.current;
    if (last.id === id && Date.now() - last.at < 700) return;
    const booking = bookingsRef.current.get(id);
    if (booking) setDetail(booking);
  }, []);

  // ESC cancela o arraste sem salvar nada; fecha o popover de filtros;
  // sem nenhum dos dois, sai da tela cheia. (Ordem: mais interno primeiro.)
  useEffect(() => {
    if (!dragId && !fullscreen && !filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dragId) endDrag();
      else if (filterOpen) setFilterOpen(false);
      else setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragId, fullscreen, filterOpen, endDrag]);

  function toggleFullscreen() {
    // Nunca troca de modo no meio de um arraste: cancela primeiro.
    if (dragId) endDrag();
    setFullscreen((f) => !f);
  }

  // Em tela cheia a página de fundo não rola — só a grade, internamente.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // Cancela o drag se a view mudar no meio do movimento.
  useEffect(() => { endDrag(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [view, focus]);

  async function confirmDrop() {
    if (!dropAsk) return;
    const { booking, date, time } = dropAsk;
    const professionalId = dropAsk.professionalId;
    setSaving(true);
    setDropError('');
    // O servidor revalida tudo (disponibilidade, profissional, conflito,
    // duração, buffer, horizonte) e aplica rescheduleDecision.
    const res = await apiSend<{ ok?: boolean; created?: boolean; moved?: boolean; reason?: string }>(
      '/api/bookings',
      'PATCH',
      { businessId, id: booking.id, date, time, professionalId: professionalId || undefined },
      { scope: 'action', area: 'Agenda' },
    );
    setSaving(false);
    if (!res.ok) {
      setDropError(res.message || 'Não foi possível reagendar.');
      return;
    }
    const decision = rescheduleDecision(booking.status);
    setDropAsk(null);
    setFlash({
      tone: 'ok',
      text: decision.kind === 'recreate'
        ? `Novo atendimento criado para ${formatDateBR(date)} às ${time} (aguardando confirmação). O registro anterior continua no histórico.`
        : `Atendimento movido para ${formatDateBR(date)} às ${time}.`,
    });
    window.setTimeout(() => setFlash(null), 5000);
    load();
  }

  function move(dir: -1 | 1) {
    if (view === 'month') {
      const [y, m] = focus.split('-').map(Number);
      const nd = new Date(Date.UTC(y, m - 1 + dir, 1));
      setFocus(nd.toISOString().slice(0, 10));
      return;
    }
    setFocus((f) => addDaysISO(f, view === 'week' ? dir * 7 : dir));
  }

  // A3.3 — UMA leitura de data na barra (antes havia rótulo + campo duplicados,
  // e o usuário não sabia em qual clicar). `focusLabel` é o título grande;
  // `focusRange` explica o alcance da visão sem repetir a mesma string.
  const focusLabel = view === 'month'
    ? new Date(focus + 'T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : view === 'week'
      ? `${formatDateBR(weekDays[0])} — ${formatDateBR(weekDays[6])}`
      : `${WEEKDAYS_LONG[weekdayOf(focus)]}, ${formatDateBR(focus)}`;
  const focusRange = view === 'month'
    ? 'Mês inteiro'
    : view === 'week'
      ? '7 dias'
      : 'Um dia';
  const isToday = focus === today;
  /** Rótulo acessível do botão de navegação (não é só "anterior"). */
  const navLabel = (dir: -1 | 1) => (view === 'month'
    ? (dir < 0 ? 'Mês anterior' : 'Próximo mês')
    : view === 'week'
      ? (dir < 0 ? 'Semana anterior' : 'Próxima semana')
      : (dir < 0 ? 'Dia anterior' : 'Próximo dia'));

  const dragging = dragId ? bookingsRef.current.get(dragId) || bookings.find((b) => b.id === dragId) || null : null;
  const isDragging = !!dragId;

  // Destaque da célula destino (por coluna).
  const highlightFor = useCallback((index: number): HighlightVM | null => {
    if (!isDragging || !hover || hover.column !== index) return null;
    const duration = durationRef.current;
    if (!hover.time) {
      const minute = Math.max(grid.start, Math.min(grid.end - duration, hover.minute));
      return {
        top: blockTop(minute, grid.start, PX_PER_HOUR),
        height: blockHeight(duration, PX_PER_HOUR),
        label: hover.availability === 'loading' ? 'Carregando horários...' : 'Indisponível',
        tone: hover.availability === 'loading' ? 'loading' : 'busy',
      };
    }
    return {
      top: blockTop(hover.time, grid.start, PX_PER_HOUR),
      height: blockHeight(duration, PX_PER_HOUR),
      label: hover.availability === 'free' ? hover.time : 'Indisponível',
      tone: hover.availability === 'free' ? 'free' : 'busy',
    };
  }, [isDragging, hover, grid.start, grid.end]);

  const ghostLabel = hover?.time
    ? dragPreviewLabel(hover.date, hover.time)
    : drag.loading
      ? SLOT_STATE_MESSAGE.loading
      : drag.error
        ? SLOT_STATE_MESSAGE.error
        : 'Sem horário livre aqui';
  const slotsState = slotState({ loading: drag.loading, error: drag.error || null, slots: hover?.time ? [hover.time] : [], idle: !isDragging });

  const statusOptions = (['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as BookingStatus[]);

  return (
    <div className={fullscreen ? 'fixed inset-0 z-40 overflow-y-auto bg-[var(--bg)] px-2 py-3 sm:px-4 ws-scroll' : undefined}>
      {/* Cabeçalho compacto: a grade é o conteúdo — o título não compete. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="w-9 h-9 shrink-0 rounded-lg bg-gradient-to-br from-[var(--brand)] to-[var(--lilac)] text-white flex items-center justify-center shadow-brand">
            <Icon n="calendar" size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-[var(--text)] leading-tight">Agenda</h1>
            <span className="text-xs text-[var(--text-muted)] truncate">Clique num atendimento para ver o detalhe · arraste para reagendar.</span>
          </div>
        </div>
        <Button onClick={() => setCreating(true)} variant="primary"><Icon n="calendarPlus" size={15} /> Novo agendamento</Button>
      </div>

      <PermissionNotice message={notice?.title} hint={notice?.hint} onDismiss={dismiss} />

      {flash && (
        <div
          role="status"
          aria-live="polite"
          className={
            'mb-3 border rounded-lg px-3 py-2.5 text-xs font-semibold flex items-start gap-2 shadow-xs '
            + (flash.tone === 'ok'
              ? 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-fg)]'
              : flash.tone === 'warn'
                ? 'border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-fg)]'
                : 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-fg)]')
          }
        >
          <Icon n={flash.tone === 'ok' ? 'checkCircle' : 'alert'} size={15} className="mt-px" />
          <span>{flash.text}</span>
          <button onClick={() => setFlash(null)} className="ml-auto font-bold underline underline-offset-2 shrink-0">Fechar</button>
        </div>
      )}

      {pendencies.length > 0 && (
        <AttentionStrip
          title={`${pendencies.length} precisam de fechamento`}
          hint="horário passou e continua em aberto"
          action={(
            <>
              {pendencies.slice(0, 4).map((b) => (
                <button key={b.id} onClick={() => setDetail(b)} className="text-xs font-medium bg-white border border-amber-200 text-amber-900 px-2.5 py-1 rounded-md hover:bg-amber-50">
                  {formatDateBR(b.date)} {b.time} · {b.customerName}
                </button>
              ))}
              {pendencies.length > 4 && <span className="text-xs font-medium text-amber-900 self-center">+{pendencies.length - 4}</span>}
            </>
          )}
        />
      )}

      {/* Toolbar operacional: navegação · Dia/Semana/Mês · filtros · tela cheia.
          relative z-40: o popover de filtros abre sobre a grade e precisa
          ficar acima dos cabeçalhos sticky (z-20/30) das colunas. */}
      <div className="relative z-40 ws-panel mb-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3 py-2.5">
          {/* Navegação no tempo: [◀ ▶] + data ÚNICA (título clicável) + Hoje.
              Antes eram seta/Hoje/seta/campo e o rótulo repetido — agora cada
              elemento tem uma função só e a data aparece UMA vez. */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex rounded-md border border-[var(--border-strong)] bg-white shadow-xs overflow-hidden">
              <button onClick={() => move(-1)} aria-label={navLabel(-1)} title={navLabel(-1)}
                className="w-9 h-9 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] border-r border-[var(--border)]">
                <Icon n="chevL" size={15} />
              </button>
              <button onClick={() => move(1)} aria-label={navLabel(1)} title={navLabel(1)}
                className="w-9 h-9 flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
                <Icon n="chevR" size={15} />
              </button>
            </span>
            <label className="relative inline-flex flex-col min-w-0 max-w-[min(26rem,calc(100vw-12rem))] cursor-pointer rounded-md px-1 -mx-1 py-0.5 hover:bg-[var(--surface-hover)] focus-within:shadow-focus" title="Escolher outra data">
              <span className="text-[15px] font-bold leading-tight text-[var(--text)] capitalize truncate" aria-live="polite">{focusLabel}</span>
              <span className="text-[11px] font-semibold text-[var(--text-muted)] leading-tight inline-flex items-center gap-1">
                <Icon n="calendar" size={11} /> {focusRange} · clique para escolher a data
              </span>
              <input type="date" value={focus} max="2100-12-31" onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setFocus(e.target.value); }}
                aria-label="Escolher data" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </label>
            {!isToday && (
              <Button variant="soft" size="sm" onClick={() => setFocus(today)}>
                <Icon n="calendar" size={13} /> Hoje
              </Button>
            )}
          </div>
          <Tabs
            items={[
              { id: 'day' as View, label: 'Dia', icon: 'calendar' },
              { id: 'week' as View, label: 'Semana', icon: 'grid' },
              { id: 'month' as View, label: 'Mês', icon: 'receipt' },
            ]}
            value={view}
            onChange={(v) => { endDrag(); setView(v); }}
            ariaLabel="Visualização da agenda"
            size="sm"
          />
          <div className="flex items-center gap-1.5 ml-auto">
            {/* P1.1 — UM botão de filtro (contador quando ativo). O popover
                agrupa Status + Especialidade + Profissional pesquisável:
                escala para 10/20/50 profissionais sem poluir a toolbar. */}
            <div className="relative" ref={filterWrapRef}>
              <Button variant="secondary" size="sm" onClick={() => { setFilterOpen((o) => !o); setProSearch(''); }}
                aria-expanded={filterOpen} aria-haspopup="dialog" title="Filtros">
                <Icon n="filter" size={13} />
                {activeFilterCount > 0 ? `Filtro · ${activeFilterCount}` : 'Filtro'}
                <Icon n="chevD" size={12} className={`transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
              </Button>

              {filterOpen && (
                <div role="dialog" aria-label="Filtros da agenda"
                  className="absolute right-0 top-full mt-1.5 z-30 w-[300px] max-w-[calc(100vw-1.25rem)] bg-white border border-zinc-200 rounded-lg shadow-lg text-left">
                  <div className="px-3 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Filtros</p>
                    {activeFilterCount > 0 && (
                      <button type="button" onClick={clearFilters}
                        className="text-xs font-semibold text-[var(--danger)] hover:text-[var(--danger-strong)]">
                        Limpar filtros
                      </button>
                    )}
                  </div>

                  <div className="px-3 pb-2.5">
                    <p className="text-[11px] font-semibold text-zinc-500 mb-1.5">Status</p>
                    <div className="flex flex-wrap gap-1">
                      <FilterChip active={!statusFilter} onClick={() => setStatusFilter('')}>Todos</FilterChip>
                      {statusOptions.map((s) => (
                        <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}>
                          {BOOKING_STATUS[s].panel}
                        </FilterChip>
                      ))}
                    </div>
                  </div>

                  {specialties.length > 0 && (
                    <div className="px-3 pb-2.5 border-t border-zinc-100 pt-2.5">
                      <p className="text-[11px] font-semibold text-zinc-500 mb-1.5">Especialidade</p>
                      <div className="flex flex-wrap gap-1">
                        <FilterChip active={!specFilter} onClick={() => pickSpec('')}>Todas</FilterChip>
                        {specialties.map((r) => (
                          <FilterChip key={r} active={specFilter === r} onClick={() => pickSpec(specFilter === r ? '' : r)}>
                            {r}
                          </FilterChip>
                        ))}
                      </div>
                    </div>
                  )}

                  {activePros.length > 0 && (
                    <div className="px-3 pb-3 border-t border-zinc-100 pt-2.5">
                      <p className="text-[11px] font-semibold text-zinc-500 mb-1.5">Profissional</p>
                      <div className="relative">
                        <Icon n="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input value={proSearch} onChange={(e) => setProSearch(e.target.value)}
                          placeholder="Pesquisar profissional..." aria-label="Pesquisar profissional"
                          className="w-full text-xs bg-zinc-50 border border-zinc-200 rounded-md pl-8 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--action)] focus:bg-white" />
                      </div>
                      <div className="mt-1.5 max-h-44 overflow-y-auto ws-scroll space-y-0.5">
                        <button type="button" onClick={() => pickPro('')}
                          className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs font-medium',
                            !proFilter ? 'bg-zinc-100' : 'hover:bg-zinc-50')}>
                          <span className="flex-1">Todos</span>
                          {!proFilter && <Icon n="check" size={13} className="text-emerald-600 shrink-0" />}
                        </button>
                        {prosInFilter.map((p) => (
                          <button key={p.id} type="button" onClick={() => pickPro(proFilter === p.id ? '' : p.id)}
                            className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs',
                              proFilter === p.id ? 'bg-zinc-100' : 'hover:bg-zinc-50')}>
                            <span className="flex-1 min-w-0 truncate">
                              <span className="font-semibold text-zinc-800">{p.name}</span>
                              {p.role && <span className="text-zinc-400"> · {p.role}</span>}
                            </span>
                            {proFilter === p.id && <Icon n="check" size={13} className="text-emerald-600 shrink-0" />}
                          </button>
                        ))}
                        {prosInFilter.length === 0 && (
                          <p className="text-xs text-zinc-400 px-2 py-1.5">Nenhum profissional encontrado.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button onClick={toggleFullscreen} aria-pressed={fullscreen} title={fullscreen ? 'Sair da tela cheia (ESC)' : 'Tela cheia'}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-zinc-50 border border-zinc-200 rounded-md px-2.5 py-1.5 hover:bg-zinc-100">
              <Icon n={fullscreen ? 'shrink' : 'expand'} size={14} />
              <span className="hidden sm:inline">{fullscreen ? 'Sair' : 'Tela cheia'}</span>
            </button>
          </div>
        </div>
        {/* Legenda: cor = estado (mesma fonte da grade) + marcador de atenção. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2" aria-label="Legenda dos estados">
          {statusOptions.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
              <span className={`w-2 h-2 rounded-sm ${BOOKING_DOT[s]}`} aria-hidden="true" />
              {BOOKING_STATUS[s].panel}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
            <span className={`w-3.5 h-3.5 rounded-full text-[9px] font-black leading-[14px] text-center ${ATTENTION_MARK_CLS}`} aria-hidden="true">!</span>
            precisa de fechamento
          </span>
        </div>
        {isDragging && view !== 'month' && (
          <div
            role="status"
            aria-live="polite"
            className={
              'px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs '
              + (hover?.time
                ? 'bg-[var(--success-bg)] border-[var(--success-border)]'
                : slotsState === 'error'
                  ? 'bg-[var(--danger-bg)] border-[var(--danger-border)]'
                  : 'bg-[var(--warning-bg)] border-[var(--warning-border)]')
            }
          >
            <span className={
              'font-semibold inline-flex items-center gap-2 '
              + (hover?.time
                ? 'text-[var(--success-fg)]'
                : slotsState === 'error' ? 'text-[var(--danger-fg)]' : 'text-[var(--warning-fg)]')
            }>
              <Icon n={hover?.time ? 'checkCircle' : 'calendar'} size={14} />
              {hover?.time ? 'Pode soltar aqui' : 'Solte no novo horário'}
              <span className={
                'font-bold px-2 py-0.5 rounded-pill border bg-white shadow-xs '
                + (hover?.time
                  ? 'border-[var(--success-border)] text-[var(--success-fg)]'
                  : slotsState === 'error'
                    ? 'border-[var(--danger-border)] text-[var(--danger-fg)]'
                    : 'border-[var(--warning-border)] text-[var(--warning-fg)]')
              }>
                {hover?.time
                  ? dragPreviewLabel(hover.date, hover.time)
                  : SLOT_STATE_MESSAGE[slotsState] || 'Aponte para um horário livre'}
              </span>
              {!hover?.time && slotsState !== 'loading' && !drag.error && (
                <span className="font-medium opacity-85 hidden sm:inline">— horário ocupado ou fora do expediente</span>
              )}
            </span>
            <Button size="xs" variant="secondary" onClick={endDrag}>
              <Icon n="x" size={12} /> Cancelar arraste
            </Button>
          </div>
        )}
      </div>

      {denied ? <AccessDenied area="Agenda" /> : !loaded ? <ListSkeleton rows={4} /> : view === 'month' ? (
        <div className="bg-white border border-zinc-200 overflow-hidden p-2">
          <div className="grid grid-cols-7 gap-px mb-1">
            {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => (
              <span key={d} className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400 text-center py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-zinc-200 border border-zinc-200">
            {Array.from({ length: 42 }, (_, i) => addDaysISO(range.from, i)).map((d) => {
              const list = bookings
                .filter((b) => b.date === d && b.status !== 'cancelled')
                .filter((b) => !statusFilter || b.status === statusFilter)
                .filter((b) => !specFilter || proRoleOf(b.professionalId || '') === specFilter)
                .filter((b) => !proFilter || b.professionalId === proFilter);
              const pend = list.filter((b) => needsClosure(b, bookingDuration(serviceOf(b.serviceId)), today, nowHM(new Date(), bizTz))).length;
              const inMonth = d.slice(0, 7) === focus.slice(0, 7);
              return (
                <button key={d} onClick={() => { setFocus(d); setView('day'); }} className={`bg-white p-1.5 min-h-[72px] text-left hover:bg-zinc-50 ${d === today ? 'ring-1 ring-inset ring-emerald-500 bg-emerald-50/40' : ''} ${!inMonth ? 'bg-zinc-50 text-zinc-400' : ''}`}>
                  <span className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${d === today ? 'text-emerald-700' : inMonth ? 'text-zinc-700' : 'text-zinc-400'}`}>{Number(d.slice(8, 10))}</span>
                    {pend > 0 && <span className="text-[9px] font-bold bg-amber-500 text-white rounded-full px-1">{pend}</span>}
                  </span>
                  {list.length > 0 && (
                    <>
                      <span className="block text-[10px] font-medium text-zinc-600 mt-1">{list.length} · {list.slice(0, 2).map((b) => b.time).join(', ')}</span>
                      <span className="flex gap-0.5 mt-1">{list.slice(0, 6).map((b) => <span key={b.id} className={`w-1.5 h-1.5 rounded-full ${BOOKING_DOT[b.status]}`} />)}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 overflow-hidden">
          {/* Altura EXATA = min(conteúdo, viewport disponível). Se a grade
              cabe, o container tem o tamanho dela e não há barra alguma. */}
          <div ref={scrollRef} className={`overflow-auto ws-scroll ${isDragging ? 'select-none' : ''}`}
            style={{ height: gridMaxH ? Math.min(gridContentH, gridMaxH) : undefined }}>
            <div className="flex" style={{ minWidth: dayWidth }}>
              {/* Gutter de horas (fixo na horizontal) */}
              <div className="sticky left-0 z-30 bg-white shrink-0 border-r border-zinc-200" style={{ width: GUTTER_W }}>
                <div style={{ height: HEADER_H }} className="border-b border-zinc-200" />
                {/* O último rótulo ancora ACIMA da linha: nenhum elemento
                    ultrapassa gridHeight (zero scroll fantasma). */}
                <div className="relative" style={{ height: gridHeight }}>
                  {Array.from({ length: grid.hours + 1 }, (_, i) => (
                    <span key={i}
                      className={`absolute right-2 text-[10px] font-medium text-zinc-400 ${i === grid.hours ? '-translate-y-full' : '-translate-y-1/2'}`}
                      style={{ top: i * PX_PER_HOUR }}>{minToTime(grid.start + i * 60)}</span>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                {/* Cabeçalho das colunas (fixo na vertical) */}
                <div className="sticky top-0 z-20 flex bg-white border-b border-zinc-200">
                  {columns.map((c) => (
                    <div key={c.key} className="shrink-0 px-3 flex items-center gap-2 border-r border-zinc-100 last:border-r-0" style={{ minWidth: COL_MIN, width: `${100 / Math.max(1, columns.length)}%`, height: HEADER_H }}>
                      {view === 'day' && (
                        <span className="w-5 h-5 rounded-full bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {c.isProfessional ? c.label.slice(0, 1).toUpperCase() : '—'}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className={`block text-xs font-semibold truncate ${c.isToday ? 'text-emerald-700' : 'text-zinc-800'}`}>{c.label}</span>
                        {c.sub && <span className="block text-[10px] text-zinc-400 truncate">{c.sub}</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Corpo da grade */}
                <div className="flex relative" ref={colsRef}>
                  {view === 'day' && focus === today && nowMin >= grid.start && nowMin <= grid.end && (
                    <span className="absolute left-0 right-0 border-t border-red-500 z-10 pointer-events-none" style={{ top: ((nowMin - grid.start) / 60) * PX_PER_HOUR }}>
                      <span className="absolute -left-1 -top-[4px] w-2 h-2 rounded-full bg-red-500" />
                    </span>
                  )}
                  {columns.map((c, i) => (
                    <GridColumn
                      key={c.key}
                      column={c}
                      basisPct={100 / Math.max(1, columns.length)}
                      variant={view === 'week' ? 'week' : 'day'}
                      highlight={highlightFor(i)}
                      gridHeight={gridHeight}
                      hours={grid.hours}
                      onPressStart={onPressStart}
                      onPressMove={onPressMove}
                      onPressEnd={onPressEnd}
                      onPressCancel={onPressCancel}
                      onBlockClick={onBlockClick}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ghost do atendimento sendo arrastado (posição via DOM: zero re-render) */}
      <div
        ref={ghostRef}
        className="fixed top-0 left-0 z-[70] pointer-events-none hidden"
        aria-hidden="true"
        style={{ willChange: 'transform' }}
      >
        <div className="bg-zinc-900 text-white rounded-md shadow-lg px-2.5 py-1.5 max-w-[220px]">
          <p className="text-[11px] font-semibold leading-tight truncate">
            {dragging ? `${dragging.customerName} · ${serviceName(dragging.serviceId)}` : ''}
          </p>
          <p className={
            'text-[11px] leading-tight mt-0.5 '
            + (hover?.availability === 'free' ? 'text-emerald-300' : hover?.time ? 'text-red-300' : 'text-zinc-300')
          }>
            {isDragging ? ghostLabel : ''}
          </p>
        </div>
      </div>

      {/* Confirmação explícita do drop — nada acontece em silêncio */}
      {dropAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirmar reagendamento">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setDropAsk(null)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-lg border border-zinc-200 p-5 shadow-lg">
            <p className="font-semibold">{dropConfirmQuestion(dropAsk.date, dropAsk.time)}</p>
            <p className="text-sm text-zinc-600 mt-1.5"><strong>{dropAsk.booking.customerName}</strong> · {serviceName(dropAsk.booking.serviceId)}</p>
            <p className="text-sm mt-1">
              {formatDateBR(dropAsk.booking.date)} {dropAsk.booking.time} → <strong>{formatDateBR(dropAsk.date)} {dropAsk.time}</strong>
            </p>
            {(() => {
              const decision = rescheduleDecision(dropAsk.booking.status);
              return decision.kind === 'recreate' ? (
                <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mt-3">
                  Este atendimento está {dropAsk.booking.status === 'completed' ? 'concluído' : dropAsk.booking.status === 'no_show' ? 'marcado como falta' : 'cancelado'}: o novo horário entra como <strong>novo agendamento pendente</strong>, preservando o histórico.
                </p>
              ) : (
                <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mt-3">
                  O mesmo atendimento muda de horário e mantém “{dropAsk.booking.status === 'pending' ? 'pendente' : 'confirmado'}”.
                </p>
              );
            })()}
            {dropError && <p className="text-sm font-medium text-red-600 mt-3" role="alert">{dropError}</p>}
            <div className="flex gap-2 mt-4">
              <Button onClick={confirmDrop} disabled={saving} className="flex-1">{saving ? 'Salvando…' : 'Confirmar'}</Button>
              <Button variant="secondary" onClick={() => setDropAsk(null)} disabled={saving}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <BookingDetailSheet
          booking={detail}
          timezone={bizTz}
          service={serviceOf(detail.serviceId)}
          pro={detail.professionalId ? pros.find((p) => p.id === detail.professionalId) : undefined}
          businessId={businessId}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); load(); }}
        />
      )}

      {creating && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={horizonDays}
            timezone={bizTz}
          onClose={() => setCreating(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
