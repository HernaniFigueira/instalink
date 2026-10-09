'use client';
import { blockOnAgendaColumn } from '@/lib/agenda-blocks';
import { computeSlots } from '@/lib/slots';
import { bookingTimezone, buildBookingWindow, instantToLocalProjection } from '@/lib/booking-temporal';
import { eligibleProfessionalIds, slotEligibleProfessionalIds } from '@/lib/booking';
import { QueueDock } from '@/components/dashboard/QueueDock';
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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { todayISO, addDaysISO, weekdayOf, formatDateBR, nowHM } from '@/lib/tz';
import { nowLinePlacement } from '@/lib/agenda-nowline';
import { WEEKDAYS, WEEKDAYS_LONG, timeToMin, minToTime, cn } from '@/lib/utils';
import { durationLabel } from '@/lib/duration-label';
import { followsBusinessHours } from '@/lib/schedule';
import { exceptionUnavailableRanges } from '@/lib/agenda-exceptions';
import type { Availability, AvailabilityException, Booking, BookingConfig, BookingStatus, Professional, Service, ScheduleBlock, ScheduleResource } from '@/lib/types';
import { Avatar, Badge, Drawer, AgendaSkeleton, ListSkeleton, Button, IconButton, AttentionStrip, Segmented, DatePicker, Select, Input, Field, Notice, PageActionBar, HoverCard, StatusBadge, ContextMenu, type MenuItem } from '@/components/ui';
import { Icon } from '@/components/icons';
import {
  ATTENTION_MARK_CLS, ATTENTION_RING_CLS, BOOKING_BLOCK, BOOKING_DOT, BOOKING_FLOW, BOOKING_STATUS,
  FIT_IN_MARK_CLS, FIT_IN_STRIPE_CLS,
  bookingStatusDef, bookingBlockCls, bookingDotCls,
} from '@/lib/status';
import { ConfirmDialog, type PendingRequest } from '@/components/dashboard/OverlayDismissGuard';
import { BookingDetailSheet } from '@/components/dashboard/BookingDetailSheet';
import { BookingEditDialog } from '@/components/dashboard/BookingEditDialog';
import { QuickBookingPopover, type QuickBookingAnchor } from '@/components/dashboard/QuickBookingPopover';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { QueuePanel, type QueueRow } from '@/components/dashboard/QueuePanel';
import { encounterWorkspaceHref } from '@/lib/encounter-workspace';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { canReopenEncounter } from '@/lib/encounters';
import { AccessDenied, AreaLoadError, PermissionNotice, useAreaLoad, useForbiddenNotice } from '@/components/dashboard/AccessNotice';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';
import { bookingDurationOf, effectiveHorizonDays, needsClosure, rescheduleDecision } from '@/lib/booking-ops';
import { queueSummary, waitLabel } from '@/lib/queue';
import { apiGet, apiRequest, apiSend } from '@/lib/api-client';
import { applyBookingTemporalPatch } from '@/lib/agenda-local-update';
import { SLOT_STATE_MESSAGE, slotState } from '@/lib/slot-states';
import { newBookingSeedFromAgendaCell } from '@/lib/agenda-cell-prefill';
import {
  IDLE_INTERACTION, blockHeight, blockTop, dragPreviewLabel, dragSlotUrl, dropConfirmQuestion,
  emptyDragSlots, geometryFromRect, layoutBlocks, minuteFromOffsetY, snapGestureMinute, planDrop, reduceInteraction, withOwnSlot,
  type CellAvailability, type DragSlots, type DropColumn, type GridGeometry, type InteractionState,
  type Point,
} from '@/lib/agenda-drag';

type View = 'day' | 'week' | 'month' | 'list';

// Cores dos estados vêm da fonte única (lib/status.ts). P1.1: os blocos da
// grade usam a apresentação SUAVE definida lá (BOOKING_BLOCK) — a semântica
// permanece, sem o peso da cor sólida na Semana. Nada de mapa local de cor.

const PX_PER_HOUR = 128;
const GUTTER_W = 56;
const COL_MIN = 152;
const HEADER_H = 48;
// Passo do clique-em-área-vazia (o horário só é aceito se a grade real o
// confirmar — caso contrário o sheet abre sem horário escolhido).
const CLICK_SNAP_MIN = 15;
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
  /** Status cru do agendamento (mesma fonte do rótulo/cor: BOOKING_STATUS). */
  status: BookingStatus;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  time: string;
  /** Resumo autorizado no evento e no HoverCard. */
  name: string;
  customerName: string;
  petName: string;
  observation: string;
  dateLabel: string;
  service: string;
  timeRange: string;
  statusLabel: string;
  editable: boolean;
  cls: string;
  /** Profissional (linha discreta do cartão), ponto e ícone de estado. */
  pro: string;
  dot: string;
  ico: string;
  /** Horário passou e continua em aberto: marcador amarelo de atenção. */
  attention: boolean;
  /** A3.4 · Bloco 4: encaixe (fora da grade) e check-in do cliente. */
  fitIn: boolean;
  checkedInAt: string;
  dragging: boolean;
  label: string;
}

interface ColumnVM {
  key: string;
  label: string;
  sub: string;
  /** Foto real do profissional (fallback: iniciais no Avatar). */
  photo?: string;
  date: string;
  professionalId: string;
  isProfessional: boolean;
  isToday: boolean;
  blocks: BlockVM[];
  freeRanges: Array<{start:number;end:number}>;
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

// Momento do último pointerdown sobre um atendimento: o clique que sobra de
// um arraste/drop nunca deve abrir a criação por engano.
let lastGridPressAt = 0;

// ── Coluna da grade (memoizada: o drag não re-renderiza a grade inteira) ──
const GridColumn = memo(function GridColumn({ column, basisPct, variant, highlight, onPressStart, onPressMove, onPressEnd, onPressCancel, onBlockClick, onBlockEdit, onBlockContextMenu, onEmptyPress, onRangeSelect, selectedRange, onResize, operationalBlocks, unavailableRanges, onOperationalBlock, gridHeight, hours, startMinute, endMinute, hoverSuppressed }: {
  column: ColumnVM;
  basisPct: number;
  variant: 'day' | 'week';
  highlight: HighlightVM | null;
  onPressStart: (id: string, e: React.PointerEvent) => void;
  onPressMove: (id: string, e: React.PointerEvent) => void;
  onPressEnd: (id: string, e: React.PointerEvent) => void;
  onPressCancel: () => void;
  /** `trigger` = o BOTÃO do evento (missão 3A): o resumo vive em portal e
   *  desmonta quando o mouse sai, então o foco de volta do detalhe precisa do
   *  evento, não do CTA do card. */
  onBlockClick: (id: string, trigger?: HTMLElement | null) => void;
  /** "Editar" abre a superfície CENTRAL; o painel de detalhe permanece leitura. */
  onBlockEdit: (id: string, trigger?: HTMLElement | null) => void;
  /** Botão direito / Shift+F10 / tecla Menu no evento: menu contextual real. */
  onBlockContextMenu: (id: string, point: { x: number; y: number }, trigger: HTMLElement | null) => void;
  /** Com o MENU aberto no mesmo evento, o resumo do hover se cala: um painel
   *  por vez (o insumo da confusão "o menu era o próprio resumo"). */
  hoverSuppressed: boolean;
  /** A3.4: clique/toque em área vazia → criar agendamento naquele horário. */
  onEmptyPress: (columnKey: string, time: string, point: { x: number; y: number }) => void;
  onRangeSelect: (columnKey: string, time: string, durationMin: number, point: { x: number; y: number }) => void;
  selectedRange: { time: string; durationMin: number } | null;
  onResize: (id: string, end: string) => void;
  unavailableRanges: Array<{ start: number; end: number; label: string }>;
  operationalBlocks: Array<{ block: ScheduleBlock; top: number; height: number; label: string; timeLabel: string; scopeLabel: string }>;
  onOperationalBlock: (block: ScheduleBlock) => void;
  gridHeight: number;
  hours: number;
  startMinute: number;
  endMinute: number;
}) {
  const selection = useRef<{ origin: number; y: number; originPx: number; moved: boolean } | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  // Mapa id → botão do evento: quem devolve o foco ao fechar o detalhe quando o
  // clique veio do HoverCard (o card é portal e já saiu da tela).
  const eventRefs = useRef(new Map<string, HTMLButtonElement>());
  const snapY = (e: React.PointerEvent<HTMLDivElement>) => Math.max(startMinute, Math.min(endMinute,
    snapGestureMinute(startMinute + (e.clientY - e.currentTarget.getBoundingClientRect().top) / PX_PER_HOUR * 60),
  ));
  return (
    // border-b = linha final da grade. As linhas internas param em
    // hours-1: NADA ultrapassa gridHeight (zero scroll fantasma).
    // Largura em % exata (N colunas = 100%/N + min-width) com box-sizing
    // border-box: larguras inteiras determinísticas — nenhuma divergência
    // de subpixel contra o minWidth calculado em JS, nenhum resíduo que
    // fabrique overflow nas bordas.
    <div className="relative shrink-0 border-r border-b border-zinc-100 last:border-r-0 bg-[var(--agenda-unavailable)]"
      style={{ minWidth: COL_MIN, width: `${basisPct}%`, height: gridHeight }}
      data-agenda-column={column.key}
      data-agenda-column-date={column.date}
      data-agenda-column-professional={column.professionalId || ''}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        const origin = snapY(e);
        selection.current = { origin, y: origin, originPx: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!selection.current) return;
        const y = snapY(e);
        const active = selection.current;
        if (Math.abs(e.clientY - active.originPx) > 6 || y !== active.origin) active.moved = true;
        active.y = y;
        if (overlay.current) {
          overlay.current.style.display = active.moved ? 'block' : 'none';
          overlay.current.style.top = `${(Math.min(active.origin, y) - startMinute) / 60 * PX_PER_HOUR}px`;
          overlay.current.style.height = `${Math.max(5, Math.abs(y - active.origin)) / 60 * PX_PER_HOUR}px`;
          overlay.current.textContent = `${minToTime(Math.min(active.origin, y))}–${minToTime(Math.max(active.origin, y))}`;
        }
      }}
      onPointerUp={(e) => {
        const active = selection.current;
        selection.current = null;
        if (overlay.current) overlay.current.style.display = 'none';
        if (!active?.moved) return;
        lastGridPressAt = Date.now();
        const from = Math.min(active.origin, active.y);
        const to = Math.max(active.origin, active.y);
        // DS 1.0 · §5 — o arraste abre o quick create ANCORADO no ponto solto,
        // com a duração que o gesto desenhou (o snap continua sendo o mesmo).
        if (to > from) onRangeSelect(column.key, minToTime(from), to - from, { x: e.clientX, y: e.clientY });
      }}
      onPointerCancel={() => { selection.current = null; if (overlay.current) overlay.current.style.display = 'none'; }}
      onClick={(e) => {
        // Clique em área VAZIA = criar naquele horário. Cliques em atendimento
        // (button), no destaque de arraste e o clique que sobra de um drop são
        // ignorados — criar nunca acontece "sem querer" depois de arrastar.
        const el = e.target as HTMLElement;
        if (el.closest('button')) return;
        if (Date.now() - lastGridPressAt < 500) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const minutes = minuteFromOffsetY(e.clientY - rect.top, { startMinute, endMinute, pxPerHour: PX_PER_HOUR }, CLICK_SNAP_MIN);
        onEmptyPress(column.key, minToTime(minutes), { x: e.clientX, y: e.clientY });
      }}>
      <div ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-x-1 z-30 hidden rounded-md border-2 border-[var(--brand)] bg-[var(--brand-softer)] text-xs font-semibold p-1" />
      {selectedRange && <div data-testid="agenda-selected-range" aria-label={`Intervalo selecionado ${selectedRange.time}`} className="pointer-events-none absolute inset-x-1 z-30 rounded-md border-2 border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-fg)] text-xs font-semibold p-1" style={{ top: (timeToMin(selectedRange.time) - startMinute) / 60 * PX_PER_HOUR, height: selectedRange.durationMin / 60 * PX_PER_HOUR }}>{selectedRange.time}–{minToTime(timeToMin(selectedRange.time) + selectedRange.durationMin)}</div>}
      {column.freeRanges.map((r,i)=><span key={i} aria-hidden="true" className="ag-free-range absolute inset-x-0 bg-white transition-colors" style={{top:(r.start-startMinute)/60*PX_PER_HOUR,height:(r.end-r.start)/60*PX_PER_HOUR}}/>)}
      {column.isToday && <span aria-hidden="true" className="absolute inset-0 bg-[var(--brand-softer)] pointer-events-none" />}
      {Array.from({ length: Math.max(0, hours - 1) }, (_, idx) => idx + 1).map((i) => (
        <span key={i} className="absolute left-0 right-0 border-t border-zinc-100" style={{ top: i * PX_PER_HOUR }} />
      ))}

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
            'text-[10px] font-semibold px-1.5 py-0.5 rounded-b-md shadow-xs '
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

      {/* Sombreamento de indisponibilidade = FUNDO (z-0): a ordem de camadas da
          grade está em `globals.css` ("ORDEM DE CAMADAS DA GRADE"). Antes este
          bloco vinha com `z-[5]`, ou seja, pintava POR CIMA dos atendimentos do
          dia — um agendamento dentro de uma exceção aparecia só como uma faixa
          fina na borda. Nada muda de semântica: continua sem ação de clique
          (`pointer-events-none`) e o texto diz a janela do dia especial. */}
      {unavailableRanges.map((r, i) => <div key={i} data-availability-exception className="pointer-events-none absolute z-0 inset-x-1 rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-muted)] px-2 py-2 text-xs overflow-hidden" style={{ top: (r.start - startMinute) / 60 * PX_PER_HOUR, height: (r.end - r.start) / 60 * PX_PER_HOUR }}>
        <span className="block tabular-nums font-medium">{minToTime(r.start)}–{minToTime(r.end)}</span><span className="block">INDISPONÍVEL</span><span className="block">{r.label}</span>
      </div>)}
      {/* MISSÃO UX CLOSURE · item 4 — BLOQUEIO OPERACIONAL não domina a grade.
          O tempo bloqueado é dito por HACHURA no próprio lugar (o mesmo
          vocabulário visual do "indisponível"), com uma ETIQUETA compacta no
          topo (ícone + horário) enquanto houver altura. O bloqueio continua
          SEMANTICAMENTE distinto do atendimento: superfície própria, tracejado
          e âmbar da família de atenção — sem caixa laranja gigante de texto, e
          sem tooltip nativo: quem abre o detalhe é o clique (que sempre
          existiu) e a etiqueta carrega o texto acessível completo. */}
      {operationalBlocks.map(({ block, top, height, label, timeLabel, scopeLabel }) => (
        <button key={block.id} type="button"
          data-schedule-block={block.id}
          aria-label={`Bloqueio operacional: ${timeLabel} · ${label} · ${scopeLabel}`}
          onClick={() => onOperationalBlock(block)}
          className="ag-block absolute z-10 left-1 right-1 max-w-[380px] overflow-hidden text-left"
          style={{ top, height }}>
          <span aria-hidden="true" className="ag-block__hatch" />
          <span className="ag-block__tag">
            <Icon n="lock" size={10} aria-hidden="true" />
            <span className="tabular-nums">{timeLabel}</span>
          </span>
          {height >= 52 && <span className="ag-block__label">{label}</span>}
        </button>))}
      {column.blocks.map((b) => {
        // DS 1.0 · §5 — HOVER CARD (180ms, foco equivalente, sem hover no
        // toque): prévia da MESMA informação do cartão, sem CTA próprio. O
        // clique continua abrindo o detalhe e o arraste é o MESMO elemento —
        // o botão não é remontado, então o pointer capture segue intacto.
        const card = (
        <button
          type="button"
          ref={(el) => { if (el) eventRefs.current.set(b.id, el); else eventRefs.current.delete(b.id); }}
          aria-label={b.label}
          /* SEM tooltip nativo: o resumo do evento é o HoverCard (item 3A) —
             o `title` do navegador era o que aparecia em vez dele. */
          draggable={false}
          onPointerDown={(e) => onPressStart(b.id, e)}
          onPointerMove={(e) => onPressMove(b.id, e)}
          onPointerUp={(e) => onPressEnd(b.id, e)}
          onPointerCancel={onPressCancel}
          onClick={(e) => onBlockClick(b.id, e.currentTarget)}
          /* AUDITORIA · rodada 2 — MENU CONTEXTUAL do atendimento: botão
             direito, Shift+F10 e a tecla Menu (teclado equivalente exigido
             pelos leitores de tela). Sem `title` nativo e sem inventar ação:
             os itens vêm da máquina de estados (BOOKING_FLOW). */
          onContextMenu={(e) => {
            e.preventDefault();
            onBlockContextMenu(b.id, { x: e.clientX, y: e.clientY }, e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              onBlockContextMenu(b.id, { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }, e.currentTarget);
            }
          }}
          className={
            'ag-event absolute rounded-lg border border-l-4 px-2 py-1 text-left overflow-hidden touch-none select-none shadow-xs ' + (variant === 'day' ? 'ag-event--day ' : 'ag-event--week ')
            + b.cls
            + (b.attention && !b.dragging ? ` ${ATTENTION_RING_CLS}` : '')
            + (b.dragging
              ? ' il-dragging ring-2 ring-[var(--brand)] ring-offset-1 cursor-grabbing shadow-lg'
              : ' hover:brightness-[0.99] hover:shadow-sm cursor-grab active:cursor-grabbing')
          }
          style={{
            top: b.top,
            height: b.height,
            // Dia com coluna única: o cartão não vira faixa de largura total.
            ...(basisPct === 100 ? { maxWidth: 380 } : {}),
            left: `calc(${b.leftPct}% + 2px)`,
            width: `calc(${b.widthPct}% - 4px)`,
          }}
        >
          {/* Encaixe = acento (faixa fina no topo), não preenchimento: o fundo
              do bloco continua sendo o do STATUS. Nada de amarelo sobre verde. */}
          {b.fitIn && <span aria-hidden="true" className={FIT_IN_STRIPE_CLS} />}
          {/* quem + quando + o quê + com quem — detalhe fica no drawer.
              Densidade do mockup: nome forte, linhas de apoio discretas. */}
          <span className="ag-event__time block text-[10.5px] font-semibold tabular-nums leading-tight opacity-75">{b.timeRange}</span>
          <span className="ag-event__name block text-[12.5px] font-semibold leading-tight truncate">{b.name}</span>
          {b.height > 62 && <span className="ag-event__secondary block text-[11px] leading-tight truncate opacity-75">{b.service}</span>}
          {b.height > 80 && b.pro && <span className="ag-event__secondary block text-[11px] leading-tight truncate opacity-70">{b.pro}</span>}
          {b.fitIn && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold leading-tight">
              {/* A3.4 · Bloco 4: o encaixe é visível no cartão — quem olha a
                  grade sabe que aquele horário foi uma decisão da equipe. */}
              {b.fitIn && <span className={`px-1 rounded-sm ${FIT_IN_MARK_CLS}`}>ENCAIXE</span>}
            </span>
          )}
          {b.editable && b.height >= 30 && (
            <span data-resize-hint aria-hidden="true" className="ag-event__resize-hint" />
          )}
          {b.editable && b.height >= 30 && (
            <span aria-label={`Redimensionar ${b.name}. Arraste para alterar a duração`}
              className="absolute bottom-0 inset-x-0 h-3 cursor-ns-resize touch-none z-10 border-b-2 border-transparent hover:border-[var(--brand)]"
              onPointerDown={(e) => {
                e.stopPropagation(); e.preventDefault();
                if (e.pointerType !== 'mouse' || e.button !== 0) return;
                const handle = e.currentTarget;
                const card = handle.closest('button') as HTMLElement;
                const originY = e.clientY;
                const originalHeight = card.offsetHeight;
                const hint = card.querySelector<HTMLElement>('[data-resize-hint]');
                let finished = false;
                let moved = false;
                const cleanup = () => {
                  if (finished) return;
                  finished = true;
                  // A resize handle can release capture after Escape while the
                  // pointer is already outside the card. The browser may then
                  // synthesize a click on the empty grid; suppress that click
                  // so canceling a resize never opens Quick Create.
                  lastGridPressAt = Date.now();
                  handle.removeEventListener('pointermove', onMove);
                  handle.removeEventListener('pointerup', onUp);
                  handle.removeEventListener('pointercancel', onCancel);
                  handle.removeEventListener('lostpointercapture', onCancel);
                  window.removeEventListener('keydown', onKey, true);
                  // Restore the exact rendered height and clear every provisional
                  // label before either opening confirmation or returning to idle.
                  card.style.height = `${originalHeight}px`;
                  if (hint) hint.textContent = '';
                  try { if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId); } catch { /* noop */ }
                };
                const onMove = (ev: PointerEvent) => {
                  moved = moved || Math.abs(ev.clientY - originY) > 1;
                  const proposed = Math.max(5, Math.round((originalHeight + ev.clientY - originY) / PX_PER_HOUR * 60 / 5) * 5);
                  card.style.height = `${blockHeight(proposed, PX_PER_HOUR)}px`;
                  if (hint) hint.textContent = `${b.time}–${minToTime(timeToMin(b.time) + proposed)} · ${durationLabel(proposed)}`;
                };
                const onUp = (ev: PointerEvent) => {
                  if (finished) return;
                  cleanup();
                  if (ev.type === 'pointercancel' || ev.type === 'lostpointercapture') return;
                  const proposed = Math.max(5, Math.round((originalHeight + ev.clientY - originY) / PX_PER_HOUR * 60 / 5) * 5);
                  if (moved && Math.abs(ev.clientY - originY) > 6) {
                    lastGridPressAt = Date.now();
                    onResize(b.id, minToTime(timeToMin(b.time) + proposed));
                  }
                };
                const onCancel = () => cleanup();
                const onKey = (ev: KeyboardEvent) => {
                  if (ev.key !== 'Escape') return;
                  ev.preventDefault(); ev.stopPropagation(); cleanup();
                };
                handle.setPointerCapture(e.pointerId);
                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onUp);
                handle.addEventListener('pointercancel', onCancel);
                handle.addEventListener('lostpointercapture', onCancel);
                window.addEventListener('keydown', onKey, true);
              }} />
          )}
          {b.checkedInAt && (
            <span aria-label="Cliente já fez check-in" aria-hidden="true"
              className="absolute bottom-1 right-1 w-4 h-4 rounded-full text-[9px] font-semibold leading-4 text-center bg-[var(--success)] text-white">✓</span>
          )}
          {b.attention ? (
            <span aria-label="Precisa de fechamento" aria-hidden="true"
              className={`absolute top-1 right-1 w-4.5 h-4.5 w-[18px] h-[18px] rounded-full text-[10px] font-semibold leading-[18px] text-center ${ATTENTION_MARK_CLS}`}>
              !
            </span>
          ) : (
            <span aria-label={b.statusLabel} aria-hidden="true"
              className={`absolute top-1 right-1 w-[18px] h-[18px] rounded-full text-white flex items-center justify-center ${b.dot}`}>
              <Icon n={b.ico} size={10} />
            </span>
          )}
        </button>
        );
        return (
          <HoverCard
            key={b.id}
            side="right-start"
            className="ag-hover"
            suppress={hoverSuppressed}
            content={
              /* MISSÃO UX CLOSURE · item 3A — RESUMO CONTEXTUAL do evento:
                 horário, paciente/pet, serviço, profissional e status em um
                 cartão compacto, colado no atendimento (offset 10px, flip
                 quando falta espaço). Duas ações explícitas:
                 "Editar" (modal central) e "Ver detalhes" (painel lateral),
                 com camadas exclusivas. Nada de tooltip nativo ou card fixo. */
              <div className="ag-hover__card">
                <div className="ag-hover__head">
                  <span className="ag-hover__heading">Agendamento</span>
                  <StatusBadge tone={bookingStatusDef(b.status).tone} className="text-[12px]">{b.statusLabel}</StatusBadge>
                </div>
                <p className="ag-hover__date tabular-nums">{b.dateLabel} · {b.timeRange}</p>
                <dl className="ag-hover__rows">
                  <div><dt>{b.petName ? 'Paciente' : 'Tutor'}</dt><dd>{b.petName || b.customerName}</dd></div>
                  {b.petName && <div><dt>Tutor</dt><dd>{b.customerName}</dd></div>}
                  {b.service && <div><dt>Serviço</dt><dd>{b.service}</dd></div>}
                  {b.pro && <div><dt>Profissional</dt><dd>{b.pro}</dd></div>}
                </dl>
                {b.observation && <p className="ag-hover__observation"><strong>Observação</strong> · {b.observation}</p>}
                {b.fitIn && <p className="ag-hover__flag">Encaixe · decisão da equipe</p>}
                {b.attention && <p className="ag-hover__flag ag-hover__flag--attention">Precisa de fechamento</p>}
                <div className="ag-hover__actions">
                  {b.editable && <Button variant="secondary" onClick={() => onBlockEdit(b.id, eventRefs.current.get(b.id) ?? null)}>Editar</Button>}
                  <Button variant="ghost" onClick={() => onBlockClick(b.id, eventRefs.current.get(b.id) ?? null)}>Ver detalhes</Button>
                </div>
              </div>
            }
          >
            {card}
          </HoverCard>
        );
      })}
      {variant === 'week' && column.blocks.length === 0 && column.freeRanges.length === 0 && (
        <>
          <span aria-hidden="true" className="ag-hatch absolute inset-0 pointer-events-none" />
          <span className="absolute inset-x-0 top-24 text-center pointer-events-none">
            <Icon n="calendar" size={18} className="mx-auto text-zinc-300" />
            <span className="block text-[11px] font-semibold text-zinc-400 mt-1">Indisponível</span>
            <span className="block text-[10px] text-zinc-300">Não há atendimento</span>
          </span>
        </>
      )}
      {variant === 'week' && column.blocks.length === 0 && column.freeRanges.length > 0 && (
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
  const router = useRouter();
  const businessId = params.get('b') || '';
  const [defaultView, setDefaultView] = useState<View>('day');
  useEffect(() => { if (window.matchMedia('(max-width: 767px)').matches) setDefaultView('list'); }, []);
  const view = (['day','week','month','list'].includes(params.get('view') || '') ? params.get('view') : defaultView) as View;
  const dataParam = params.get('data') || '';
  const focus = /^\d{4}-\d{2}-\d{2}$/.test(dataParam) ? dataParam : todayISO();
  const statusFilter = Object.keys(BOOKING_STATUS).includes(params.get('status') || '') ? params.get('status') as BookingStatus : '';
  const proFilter = params.get('professionalId') || '';
  const specFilter = params.get('specialty') || '';
  // Native history integration keeps filters/date and back/forward in sync,
  // without requesting another server render or changing scheduling rules.
  function setPresentation(patch: Record<string, string>) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) { if (value) url.searchParams.set(key,value); else url.searchParams.delete(key); }
    window.history.pushState(null, '', url.pathname + url.search);
  }
  const setView = (value: View) => setPresentation({view:value});
  const setFocus = (value: string) => setPresentation({data:value});
  const setStatusFilter = (value: string) => setPresentation({status:value});
  const [filterOpen, setFilterOpen] = useState(false);
  const [proSearch, setProSearch] = useState('');
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpWrapRef = useRef<HTMLDivElement>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [exceptions,setExceptions] = useState<AvailabilityException[]>([]);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [scheduleResources, setScheduleResources] = useState<ScheduleResource[]>([]);
  const [blockMode, setBlockMode] = useState(false);
  const [selectedRange, setSelectedRange] = useState<{ columnKey: string; time: string; durationMin: number } | null>(null);
  const [editingBlock, setEditingBlock] = useState<ScheduleBlock | null>(null);
  const [blockForm, setBlockForm] = useState(false);
  const [blockDate, setBlockDate] = useState('');
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockScope, setBlockScope] = useState<'business' | 'professional' | 'resource'>('professional');
  const [blockPro, setBlockPro] = useState('');
  const [blockResource, setBlockResource] = useState('');
  const [blockNote, setBlockNote] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blockError, setBlockError] = useState('');
  const [blockBusy, setBlockBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  /** true = o detalhe abre com o formulário de reagendamento já aberto
   *  (vem do "Reagendar" do resumo do evento). O clique simples nunca ativa. */
  const [detailReschedule, setDetailReschedule] = useState(false);
  // DS 1.0 · §5 — QUICK CREATE: popover ancorado no slot clicado/arrastado.
  // O fluxo COMPLETO (`creating`) continua existindo e é o destino de
  // "Mais opções" e do CTA "Novo agendamento".
  const [quickCreate, setQuickCreate] = useState<QuickBookingAnchor | null>(null);
  const [creating, setCreating] = useState<{
    date: string; time: string; professionalId: string; selectedDurationMin?: number; quick?: boolean;
    /** A3.4 fix (revisão B5): "Encaixar na agenda" vem da FILA já preenchido. */
    contactId?: string; name?: string; phone?: string; serviceId?: string;
    /** Busca do Quick sem contato real e CTA de cadastro são intenções distintas. */
    searchQuery?: string; openRegistration?: boolean; vetMode?: boolean;
    /** Só clique direto de célula pode habilitar a conveniência de serviço único. */
    allowSingleEligibleServicePrefill?: boolean;
    /** Duplicação copia só os campos operacionais autorizados; nunca histórico clínico/pagamentos. */
    petId?: string; note?: string;
  } | null>(null);
  // FASE 2 · P9 — Quick Create global: ?novo=1 abre o sheet de agendamento
  // direto (uma abertura por visita; SPA não reabre sozinho ao voltar).
  const [novoHandled, setNovoHandled] = useState(false);
  const [returnBookingHandled, setReturnBookingHandled] = useState(false);
  useEffect(() => {
    if (returnBookingHandled || !businessId || params.get('retornoAtendimento') !== '1') return;
    setReturnBookingHandled(true);
    try {
      const raw = sessionStorage.getItem('godoutor:encounter-return-booking:v1');
      sessionStorage.removeItem('godoutor:encounter-return-booking:v1');
      const seed = raw ? JSON.parse(raw) : null;
      if (!seed || seed.businessId !== businessId) return;
      setCreating({
        date: '', time: '', professionalId: seed.professionalId || '',
        contactId: seed.contactId || '', name: seed.customerName || '', phone: seed.customerPhone || '', serviceId: seed.serviceId || '',
      });
    } catch { /* cadastro/retorno seguem disponíveis pela Agenda, sem seed corrompido */ }
  }, [returnBookingHandled, businessId, params]);
  useEffect(() => {
    if (novoHandled || !businessId || params.get('novo') !== '1') return;
    setNovoHandled(true);
    setCreating({ date: '', time: '', professionalId: '', name: '', phone: '' });
  }, [novoHandled, businessId, params]);
  // A3.4 · Bloco 4 — fila do balcão (entidade própria, fora da agenda).
  const [queueRows, setQueueRows] = useState<QueueRow[]>([]);
  // A3.4 fix (revisão B5): o registro do atendimento tem permissão PRÓPRIA —
  // a fila continua operável por quem só faz balcão, sem abrir o conteúdo.
  const { permissions, role } = usePanelPermissions();
  const canEncounter = permissions.atendimento === true;
  // Reabrir é de quem administra — a MESMA régua do servidor (nada de a tela
  // mostrar um botão que o servidor vai recusar). Ter a permissão de
  // atendimento não dá poder de reabrir.
  const canReopen = canReopenEncounter(role);
  const [queueDone, setQueueDone] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  // ── Drag: estado mínimo (o movimento em si vive em refs, sem re-render) ──
  const [dragId, setDragId] = useState('');
  const [drag, setDrag] = useState<DragSlots>(emptyDragSlots);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [resizeAsk, setResizeAsk] = useState<{ booking: Booking; end: string } | null>(null);
  const [dropAsk, setDropAsk] = useState<{ booking: Booking; date: string; time: string; professionalId: string; columnLabel: string } | null>(null);
  const [dropError, setDropError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dropChecking, setDropChecking] = useState(false);

  const interactionRef = useRef<InteractionState>({ ...IDLE_INTERACTION });
  const dragSlotsRef = useRef<DragSlots>(emptyDragSlots());
  const hoverRef = useRef<HoverTarget | null>(null);
  const columnsRef = useRef<DropColumn[]>([]);
  const bookingsRef = useRef<Map<string, Booking>>(new Map());
  const durationRef = useRef(30);
  const geometryRef = useRef<{ g: GridGeometry; minY: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const dragSeq = useRef(0);
  const pendingDropRef = useRef<{ id: string; point: Point; seq: number } | null>(null);
  const lastPointerUpRef = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  /** Botão do evento que abriu o detalhe — recebe o foco de volta no fechamento
   *  quando o gatilho do clique foi um CTA do HoverCard (que desmonta junto). */
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  // A3.4 final UX — o workspace é a linha [Agenda | Fila]. É dele que sai o
  // topo da rail (mesma região útil da grade), sem medir números na mão.
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(COL_MIN);

  const { notice, dismiss } = useForbiddenNotice('Agenda');
  const { denied, failed, report, reportFeature } = useAreaLoad('Agenda');

  // A2-B5 (F9): '' enquanto carrega = default do produto (America/Sao_Paulo).
  const [rawBizTz, setBizTz] = useState('');
  // A linguagem do Quick Create vem da unidade ativa. É só apresentação do
  // cadastro (tutor/pet), nunca uma permissão ou um modo inferido do contato.
  const [vetMode, setVetMode] = useState(false);
  useEffect(() => {
    if (!businessId) { setVetMode(false); return; }
    let active = true;
    apiGet<{ vet?: boolean }>(`/api/pets?businessId=${encodeURIComponent(businessId)}`, { scope: 'area', area: 'Agenda' })
      .then((r) => { if (active) setVetMode(!!r.data?.vet); })
      .catch(() => { if (active) setVetMode(false); });
    return () => { active = false; };
  }, [businessId]);
  const bizTz = bookingTimezone(rawBizTz);
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

  /** A3.4 · Bloco 4 — a fila do balcão é lida junto com a agenda. */
  const loadQueue = useCallback(async () => {
    if (!businessId) return;
    setQueueLoading(true);
    const res = await apiGet<{ entries?: QueueRow[]; done?: QueueRow[] }>(
      `/api/queue?businessId=${businessId}`, { scope: 'area', area: 'Agenda' },
    );
    setQueueLoading(false);
    // §8–10 — FEATURE secundária: sem fila (403 do perfil ou erro), a tela
    // apenas segue sem o bloco da fila. Nunca "sem permissão" na área inteira.
    if (!res.ok) { setQueueRows([]); setQueueDone([]); return; }
    setQueueRows(res.data?.entries || []);
    setQueueDone(res.data?.done || []);
  }, [businessId]);

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
    // §8–10 — separação PRINCIPAL × SECUNDÁRIA (causa raiz do falso 403):
    //   bookings = request PRINCIPAL da Agenda → seu 403 nega a área;
    //   catalog  = request SECUNDÁRIA (apoio da grade) → seu 403 só limita
    //              a feature: a agenda permanece na tela com o que puder.
    if (!report(bk)) { setLoaded(true); return; }
    const catalogOk = reportFeature(cat);
    const d = catalogOk ? (cat.data || {}) : {};
    setServices(d.services || []);
    setPros(d.professionals || []);
    // A2-B3 (F5): horizonte real do negócio (1–365) — nunca 60 hardcoded.
    if (d.business?.booking) setBookingCfg(d.business.booking);
    // A2-B5 (F9): fuso do negócio para "hoje/agora" locais (needsClosure,
    // linha do agora, destaque de hoje) — mesma referência do servidor.
    setBizTz(d.business?.businessTimezone || '');
    setRules(d.availability || []);
    setExceptions(d.exceptions || []);
    setScheduleBlocks(d.scheduleBlocks || []);
    setScheduleResources(d.scheduleResources || []);
    setBookings(bk.data?.bookings || []);
    setLoaded(true);
    void loadQueue();
  }, [businessId, range.from, range.to, report, reportFeature, loadQueue]);

  const loadBookingsOnly = useCallback(async () => {
    const result = await apiGet<{ bookings?: Booking[] }>(
      `/api/bookings?businessId=${businessId}&mode=manage&from=${range.from}&to=${range.to}&limit=500`,
      { scope: 'area', area: 'Agenda' },
    );
    if (result.ok) setBookings(result.data?.bookings || []);
  }, [businessId, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  // Estado real da agenda (P2): quem atende vê a confirmação/chegada registrada
  // pela recepção ao VOLTAR para a tela — sem F5 e sem polling.
  useRevalidateOnFocus(load);

  useEffect(() => {
    bookingsRef.current = new Map(bookings.map((b) => [b.id, b]));
    // P0-1: se o detalhe está aberto, atualiza o registro em silêncio com a
    // lista freca — NUNCA fecha o sheet por causa de autosave/reload.
    setDetail((d) => (d ? bookings.find((b) => b.id === d.id) || d : d));
  }, [bookings]);

  const applyConfirmedTemporalPatch = useCallback((patch: Partial<Booking> & Pick<Booking, 'id'>, queueChanged: boolean) => {
    // PATCH is the authority; the UI never moves a card before confirmation.
    setBookings((rows) => applyBookingTemporalPatch(rows, patch, range));
    if (queueChanged) void loadQueue();
  }, [range, loadQueue]);

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
    const p = activePros.find(p => p.id === proFilter);
    setPresentation({specialty:role, professionalId:role && p && (p.role || '').trim() !== role ? '' : proFilter});
  }
  function pickPro(id: string) {
    const p = activePros.find(p => p.id === id);
    setPresentation({professionalId:id, specialty:id && p && (p.role || '').trim() !== specFilter ? '' : specFilter});
  }
  function clearFilters() {
    setPresentation({status:'',specialty:'',professionalId:''});
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

  // Fecha os popovers clicando fora (ESC é tratado junto com drag/modo foco).
  useEffect(() => {
    if (!filterOpen && !helpOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (filterOpen && filterWrapRef.current && !filterWrapRef.current.contains(t)) setFilterOpen(false);
      if (helpOpen && helpWrapRef.current && !helpWrapRef.current.contains(t)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen, helpOpen]);

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
  // Agenda Temporal 2.0 (B1): altura/cartão usam a janela do PRÓPRIO Booking.
  const durationOf = useCallback((b: Booking) => bookingDurationOf(b, serviceOf(b.serviceId), 30), [serviceOf]);

  const pendencies = useMemo(
    () => bookings
      .filter((b) => needsClosure(b, bookingDurationOf(b, serviceOf(b.serviceId)), today, nowHM(new Date(), bizTz)))
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)),
    [bookings, serviceOf, today, bizTz],
  );

  // A3.4 · Bloco 4 — o que precisa de atenção AGORA no balcão: atrasados para
  // fechar (regra já existente) + fila esperando além do confortável. Uma
  // fonte só para a faixa, nada de alerta duplicado.
  const queueInfo = useMemo(
    () => queueSummary(queueRows, businessId, today, new Date()),
    [queueRows, businessId, today],
  );

  // ── Colunas: dia = profissionais; semana = dias ──
  // Filtros compactos (status + profissional) só escondem blocos/colunas da
  // grade — dados, drag e ações continuam sobre os mesmos agendamentos.
  const columns = useMemo<ColumnVM[]>(() => {
    const base: Array<{ key: string; label: string; sub: string; photo?: string; date: string; professionalId: string; isProfessional: boolean }> = [];
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
        base.push({ key: p.id, label: p.name, sub: p.role || '', photo: (p as { photo?: string }).photo, date: focus, professionalId: p.id, isProfessional: true });
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
        const statusLabel = bookingStatusDef(b.status).panel;
        return {
          id: b.id,
          status: b.status,
          top: l.top,
          height: l.height,
          leftPct: l.leftPct,
          widthPct: l.widthPct,
          time: b.time,
          // FASE 2 · P6 — veterinária: PET primeiro; tutor vira contexto.
          name: b.petName || b.customerName,
          customerName: b.customerName,
          petName: b.petName || '',
          observation: (b.note || '').trim().slice(0, 180),
          dateLabel: formatDateBR(b.date),
          service: serviceName(b.serviceId),
          timeRange: `${b.time}–${endHM}`,
          statusLabel,
          editable: rescheduleDecision(b.status).kind === 'move',
          cls: bookingBlockCls(b.status),
          pro: pro || '',
          dot: bookingDotCls(b.status),
          ico: b.status === 'pending' ? 'clock' : b.status === 'cancelled' || b.status === 'no_show' ? 'x' : 'check',
          attention,
          fitIn: b.bookingKind === 'fit_in',
          checkedInAt: b.checkedInAt || '',
          dragging: dragId === b.id,
          label: `${b.customerName} · ${serviceName(b.serviceId)} · ${formatDateBR(b.date)} ${b.time}${pro ? ` · ${pro}` : ''} · ${statusLabel}${b.bookingKind === 'fit_in' ? ' · encaixe' : ''}${b.checkedInAt ? ' · cliente já chegou' : ''}${attention ? ' — precisa de fechamento' : ''} — clique para ver o detalhe ou arraste para reagendar`,
        };
      });
      // Display only: use the SAME pure slot engine; every write still revalidates on the server.
      const ranges: Array<{start:number;end:number}> = [];
      if(bookingCfg && c.date>=today && c.date<=addDaysISO(today,effectiveHorizonDays(bookingCfg)) && bookings.length<500) {
        for(const service of services.filter(s=>s.active!==false && s.bookable!==false)) {
          const result=computeSlots({rules,exceptions,bookings,services,professionals:activePros.filter(p=>!specFilter||(p.role||'').trim()===specFilter),dateISO:c.date,weekday:weekdayOf(c.date),serviceId:service.id,durationMin:service.durationMin,professionalId:c.professionalId||proFilter,eligibleProIds:slotEligibleProfessionalIds(service as any, pros),nowHM:c.date===today?nowHM(new Date(),bizTz):'',leadMin:bookingCfg.leadMin,bufferMin:bookingCfg.bufferMin,bufferBeforeMin:bookingCfg.bufferBeforeMin,bufferAfterMin:bookingCfg.bufferAfterMin,blocks:scheduleBlocks,resources:scheduleResources,businessId,timeZone:bizTz});
          for(const time of result.slots) ranges.push({start:timeToMin(time),end:timeToMin(time)+service.durationMin});
        }
      }
      const freeRanges: typeof ranges=[];
      for(const r of ranges.sort((a,b)=>a.start-b.start)) {const last=freeRanges[freeRanges.length-1];if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else freeRanges.push({...r});}
      return { ...c, isToday: c.date === today, blocks, freeRanges };
    });
  }, [view, weekDays, activePros, focus, bookings, grid.start, durationOf, proName, serviceName, dragId, today, statusFilter, proFilter, specFilter, proRoleOf, bizTz, rules, exceptions, services, bookingCfg, scheduleBlocks, scheduleResources, businessId]);

  // Colunas usadas pelo cálculo de destino (mesma ordem da renderização).
  useEffect(() => {
    columnsRef.current = columns.map((c) => ({
      key: c.key, label: c.label, sub: c.sub, photo: c.photo, date: c.date, professionalId: c.professionalId, isProfessional: c.isProfessional,
    }));
  }, [columns]);

  // While editing a dragged interval, keep its actual column alongside the
  // drawer. Other columns return unchanged on dismiss (no synthetic booking).
  const rangeFocus = !!selectedRange && !!(creating || blockForm);
  const displayedColumns = rangeFocus ? columns.filter(c => c.key === selectedRange?.columnKey) : columns;
  useLayoutEffect(() => {
    if (rangeFocus && scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [rangeFocus]);

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

  // ── Altura da grade = altura do CONTEÚDO (a página rola, não a grade) ──
  // Regra de produto: o painel NÃO é viewport travada. Verticalmente a
  // agenda cresce no fluxo do documento; html/body é o scroll principal.
  // Horizontal permanece no próprio scroller (overflow-x) quando há mais
  // colunas que cabem na largura. Sem caixa de 700px com scrollbar interna
  // para ver 08h–21h.
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

  // Altura útil da região do workspace (viewport - topo - folga): é o teto
  // da rail da fila E da grade (FASE E: scroll interno, a página não rola
  // junto com a agenda).
  const [railMaxH, setRailMaxH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // A rail termina perto da base da viewport (o topo dela é o topo do
      // workspace) — lista rola por dentro; a agenda não.
      const wtop = workspaceRef.current?.getBoundingClientRect().top ?? top;
      setRailMaxH(Math.max(320, Math.floor(window.innerHeight - wtop - VIEWPORT_BOTTOM_PAD)));
    };
    fit();
    const ro = lightRO();
    const obs = new ro(fit);
    if (typeof document !== 'undefined') obs.observe(document.body);
    window.addEventListener('resize', fit);
    return () => { obs.disconnect(); window.removeEventListener('resize', fit); };
  }, [loaded, view, pendencies.length, notice?.title, statusFilter, proFilter, specFilter, hbarReserve, showQueue]);

  const readGeometry = useCallback((): { g: GridGeometry; minY: number } | null => {
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
    return { g, minY: scrollRect.top + HEADER_H };
  }, [colWidth, columns.length, grid.start, grid.end]);

  useEffect(() => { geometryRef.current = readGeometry(); }, [readGeometry]);

  const clearDragVisuals = useCallback(() => {
    interactionRef.current = { ...IDLE_INTERACTION };
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setDragId('');
    hoverRef.current = null;
    setHover(null);
    if (ghostRef.current) ghostRef.current.style.display = 'none';
  }, []);

  const endDrag = useCallback(() => {
    dragSeq.current++;
    pendingDropRef.current = null;
    setDropChecking(false);
    clearDragVisuals();
    const empty = emptyDragSlots();
    dragSlotsRef.current = empty;
    setDrag(empty);
  }, [clearDragVisuals]);

  const planDropAt = useCallback((booking: Booking, point: Point, slots: DragSlots) => {
    const geo = geometryRef.current || readGeometry();
    if (!geo) return null;
    geometryRef.current = geo;
    return planDrop({
      // Fora do eixo horizontal da grade é destino inválido; não clample à
      // primeira coluna (um drop à esquerda não pode virar reagendamento).
      point: { x: point.x, y: Math.max(point.y, geo.minY) },
      geometry: geo.g,
      columns: columnsRef.current,
      drag: slots,
      durationMin: bookingDurationOf(booking, services.find((s) => s.id === booking.serviceId), 30),
      toleranceMin: DROP_TOLERANCE_MIN,
      own: { date: booking.date, time: booking.time, professionalId: booking.professionalId || '' },
    });
  }, [readGeometry, services]);

  const rejectDrop = useCallback((plan: ReturnType<typeof planDrop> | null, slots: DragSlots) => {
    const col = plan && columnsRef.current[plan.column];
    const attemptedTime = plan ? minToTime(plan.minute) : '';
    const text = !plan || plan.column < 0
      ? 'Nenhum horário livre perto de onde você soltou. Escolha outro ponto da grade.'
      : slots.error
        ? `Não foi possível verificar a disponibilidade: ${slots.error}`
        : plan.availability === 'loading'
          ? 'Ainda carregando os horários livres. Tente soltar novamente em instantes.'
          : `${attemptedTime} em ${formatDateBR(col?.date || '')} não está disponível para este agendamento. O horário original foi mantido.`;
    setFlash({ tone: 'error', text });
    window.setTimeout(() => setFlash(null), 5000);
  }, []);

  const acceptDrop = useCallback((booking: Booking, plan: ReturnType<typeof planDrop> | null, slots: DragSlots) => {
    if (!plan || plan.availability !== 'free' || !plan.target) {
      rejectDrop(plan, slots);
      return;
    }
    const col = columnsRef.current[plan.column];
    setDropError('');
    setDropAsk({
      booking,
      date: plan.target.date,
      time: plan.target.time,
      professionalId: col?.isProfessional ? col.professionalId : '',
      columnLabel: col?.label || '',
    });
  }, [rejectDrop]);

  const resolvePendingDrop = useCallback((seq: number, slots: DragSlots) => {
    const pending = pendingDropRef.current;
    if (!pending || pending.seq !== seq || seq !== dragSeq.current) return;
    pendingDropRef.current = null;
    setDropChecking(false);
    const booking = bookingsRef.current.get(pending.id);
    const plan = booking ? planDropAt(booking, pending.point, slots) : null;
    // A rede já respondeu; só agora removemos o mapa e apresentamos o resultado.
    endDrag();
    setFlash(null);
    if (!booking) { rejectDrop(null, slots); return; }
    acceptDrop(booking, plan, slots);
  }, [acceptDrop, endDrag, planDropAt, rejectDrop]);

  // ── Busca de horários: UMA vez por drag (nunca por pixel) ──
  const loadDragSlots = useCallback((b: Booking, dates: string[]) => {
    const seq = ++dragSeq.current;
    pendingDropRef.current = null;
    setDropChecking(false);
    const initial: DragSlots = { loading: true, error: '', slots: {}, byPro: {} };
    dragSlotsRef.current = initial;
    setDrag(initial);
    const own = { date: b.date, time: b.time, professionalId: b.professionalId || '' };
    fetch(dragSlotUrl(businessId, b.serviceId, dates, b.id))
      .then(async (res) => res.ok ? (await res.json()).days as Record<string, { slots: string[]; byPro: Record<string, string[]>; eligibleProfessionalIds: string[] }> : null)
      .catch(() => null)
      .then((days) => {
        if (seq !== dragSeq.current) return;
        const entries = dates.map((d) => [d, days?.[d] || null] as const);
        const failed = entries.filter(([, j]) => !j).length;
        const next: DragSlots = {
          loading: false,
          error: failed === entries.length ? SLOT_STATE_MESSAGE.error : '',
          slots: {}, byPro: {}, eligibleProIds: {},
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
        // Se o ponteiro foi solto antes da resposta, resolve o MESMO destino
        // guardado. O registro continua intacto até a confirmação do usuário.
        resolvePendingDrop(seq, next);
      });
  }, [businessId, resolvePendingDrop]);

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
    const point: Point = { x: at.x, y: Math.max(at.y, geo.minY) };
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
    /**
   * DS 1.0 · §5 — clique/arraste em horário vago abre o QUICK CREATE ancorado
   * naquele ponto (Popover canônico): Paciente · Serviço · Profissional · Data ·
   * Hora · Duração, com "Mais opções" para o fluxo completo. O gesto NÃO grava
   * nada — gravação só na confirmação, e o servidor continua autoridade.
   */
  const onRangeSelect = useCallback((columnKey: string, time: string, selectedDurationMin: number, point: { x: number; y: number }) => {
    const col = columnsRef.current.find((c) => c.key === columnKey);
    if (!col) return;
    setDetail(null);
    const seed = { date: col.date, time, professionalId: col.professionalId, selectedDurationMin };
    setSelectedRange({ columnKey, time, durationMin: selectedDurationMin });
    // Bloquear horário continua sendo o fluxo de BLOQUEIO (não cria atendimento).
    if (blockMode) { openBlock(seed); return; }
    setQuickCreate({ x: point.x, y: point.y, date: col.date, time, professionalId: col.professionalId, durationMin: selectedDurationMin });
  }, [blockMode]);

  function openBlock(seed: { date: string; time: string; professionalId: string; selectedDurationMin?: number }, existing?: ScheduleBlock) {
    setEditingBlock(existing || null);
    setBlockDate(seed.date); setBlockStart(seed.time || '09:00');
    setBlockEnd(seed.time ? minToTime(Math.min(1439, timeToMin(seed.time) + (seed.selectedDurationMin ?? 60))) : '10:00');
    setBlockScope(existing?.resourceId ? 'resource' : existing?.professionalId || seed.professionalId ? 'professional' : 'business');
    setBlockPro(existing?.professionalId || seed.professionalId || ''); setBlockResource(existing?.resourceId || '');
    setBlockReason(existing?.reason || ''); setBlockNote(existing?.note || ''); setBlockError(''); setBlockForm(true);
  }
  function closeBlock() { setBlockForm(false); setBlockMode(false); setSelectedRange(null); }
  async function saveBlock(remove = false) {
    if (blockBusy) return;
    setBlockError('');
    let startAt = '', endAt = '';
    if (!remove) {
      try {
        const durationMin = timeToMin(blockEnd) - timeToMin(blockStart);
        if (!blockDate || durationMin <= 0 || durationMin > 1440) throw new Error('Informe início e fim válidos.');
        const w = buildBookingWindow({ date: blockDate, time: blockStart, durationMin, timeZone: bizTz });
        startAt = w.startAt; endAt = w.endAt;
      } catch { setBlockError('Informe início e fim válidos no fuso da clínica.'); return; }
    }
    setBlockBusy(true);
    const res = await apiRequest<{ block?: ScheduleBlock; deletedId?: string }>('/api/schedule-operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action: remove ? 'block.delete' : 'block.save', businessId, id: editingBlock?.id,
      professionalId: blockScope === 'professional' ? blockPro : '', resourceId: blockScope === 'resource' ? blockResource : '',
      startAt, endAt, reason: blockReason, note: blockNote,
    }) }, { scope: 'action', area: 'Agenda' });
    setBlockBusy(false);
    if (!res.ok) { setBlockError(res.message || 'Não foi possível salvar o bloqueio.'); return; }
    if (remove) setScheduleBlocks(rows => rows.filter(row => row.id !== editingBlock?.id));
    else if (res.data?.block) setScheduleBlocks(rows => [...rows.filter(row => row.id !== res.data!.block!.id), res.data!.block!]);
    closeBlock(); setEditingBlock(null);
  }

  const onResize = useCallback((id: string, end: string) => {
    const booking = bookingsRef.current.get(id);
    if (!booking || rescheduleDecision(booking.status).kind === 'recreate') return;
    setResizeAsk({ booking, end });
  }, []);

  const onEmptyPress = useCallback((columnKey: string, time: string, point: { x: number; y: number }) => {
    const col = columnsRef.current.find((c) => c.key === columnKey);
    if (!col) return;
    setDetail(null);
    if (blockMode) { setSelectedRange({ columnKey, time, durationMin: 60 }); openBlock(newBookingSeedFromAgendaCell(col, time)); }
    else {
      setSelectedRange({ columnKey, time, durationMin: 30 });
      // DS 1.0 · §5 — quick create ancorado no slot; o fluxo completo fica a
      // um clique ("Mais opções") com o MESMO preenchimento.
      setQuickCreate({ x: point.x, y: point.y, date: col.date, time, professionalId: col.professionalId });
    }
  }, [blockMode]);

  const onPressStart = useCallback((id: string, e: React.PointerEvent) => {
    lastGridPressAt = Date.now();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const booking = bookingsRef.current.get(id);
    if (!booking || rescheduleDecision(booking.status).kind === 'recreate' || saving || dropChecking) return;
    durationRef.current = bookingDurationOf(booking, services.find((s) => s.id === booking.serviceId), 30);
    geometryRef.current = readGeometry();
    interactionRef.current = reduceInteraction(interactionRef.current, {
      type: 'down', id, at: { x: e.clientX, y: e.clientY },
    }).state;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [readGeometry, services, saving, dropChecking]);

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

  const finishDrop = useCallback((id: string, point: Point) => {
    const booking = bookingsRef.current.get(id);
    if (!booking) { endDrag(); return; }
    const slots = dragSlotsRef.current;
    if (slots.loading) {
      // Keep the single in-flight request alive, but immediately remove the
      // ghost/selection. The user's actual pointer-up location is revalidated
      // when the authoritative slot map arrives.
      pendingDropRef.current = { id, point, seq: dragSeq.current };
      setDropChecking(true);
      setFlash({ tone: 'warn', text: 'Verificando a disponibilidade do horário…' });
      clearDragVisuals();
      return;
    }
    const plan = planDropAt(booking, point, slots);
    endDrag();
    setFlash(null);
    acceptDrop(booking, plan, slots);
  }, [acceptDrop, clearDragVisuals, endDrag, planDropAt]);


  const onPressEnd = useCallback((id: string, e: React.PointerEvent) => {
    const step = reduceInteraction(interactionRef.current, { type: 'up', at: { x: e.clientX, y: e.clientY } });
    interactionRef.current = step.state;
    lastPointerUpRef.current = { id, at: Date.now() };
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (step.effect === 'open-detail') {
      // CLIQUE SIMPLES → detalhe. Nunca inicia reagendamento.
      const booking = bookingsRef.current.get(id);
      if (booking) { detailTriggerRef.current = e.currentTarget as HTMLElement; setDetailReschedule(false); setDetail(booking); }
      return;
    }
    if (step.effect === 'drop') finishDrop(id, { x: e.clientX, y: e.clientY });
  }, [finishDrop]);

  const onPressCancel = useCallback(() => {
    interactionRef.current = { ...IDLE_INTERACTION };
    endDrag();
  }, [endDrag]);

  /**
   * MISSÃO UX CLOSURE · item 3A — ação secundária do resumo do evento.
   * Abre um editor CENTRAL para campos que o contrato PATCH da Agenda permite
   * persistir. Dados gerais sem suporte continuam explicitamente somente leitura;
   * a ação Reagendar segue sendo o fluxo de domínio já existente.
   */
  const onBlockEdit = useCallback((id: string, trigger?: HTMLElement | null) => {
    const booking = bookingsRef.current.get(id);
    if (!booking || rescheduleDecision(booking.status).kind !== 'move') return;
    detailTriggerRef.current = trigger ?? null;
    setCtxMenu(null);
    setDetail(null);
    setDetailReschedule(false);
    setEditBooking(booking);
  }, []);

  const onBlockClick = useCallback((id: string, trigger?: HTMLElement | null) => {
    // O clique que vem logo depois do pointerup já foi tratado (detalhe ou
    // drop). Aqui só interessa o clique de TECLADO (Enter/Espaço), que não
    // gera eventos de ponteiro.
    const last = lastPointerUpRef.current;
    if (last.id === id && Date.now() - last.at < 700) return;
    const booking = bookingsRef.current.get(id);
    if (booking) { detailTriggerRef.current = trigger ?? null; setDetailReschedule(false); setEditBooking(null); setDetail(booking); }
  }, []);

  /**
   * AUDITORIA · RODADA 2 — MENU CONTEXTUAL DO ATENDIMENTO.
   *
   * Botão direito (e o equivalente de teclado Shift+F10 / tecla Menu) abre um
   * menu REAL ancorado no ponteiro com as ações que o produto já sabe fazer:
   * detalhe, as transições VÁLIDAS da máquina de estados, reagendar, duplicar
   * e cancelar (com confirmação). Nada de menu decorativo e nada de transição
   * inválida: os itens vêm de `BOOKING_FLOW[b.status]` — a mesma tabela que o
   * servidor usa para recusar (`applyBookingStatusTx`).
   */
  const [ctxMenu, setCtxMenu] = useState<{ id: string; point: { x: number; y: number }; trigger: HTMLElement | null } | null>(null);
  const [ctxBusy, setCtxBusy] = useState('');
  const [ctxError, setCtxError] = useState('');
  const [ctxSuccess, setCtxSuccess] = useState('');
  const [cancelPending, setCancelPending] = useState<PendingRequest | null>(null);

  const onBlockContextMenu = useCallback((id: string, point: { x: number; y: number }, trigger: HTMLElement | null) => {
    if (!bookingsRef.current.get(id)) return;
    setCtxError(''); setCtxSuccess('');
    setCtxMenu({ id, point, trigger });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  /** Transição pelo menu: MESMA porta do detalhe (PATCH /api/bookings). */
  const changeStatus = useCallback(async (id: string, status: BookingStatus) => {
    if (!bookingsRef.current.get(id) || ctxBusy) return;
    setCtxBusy(status); setCtxError(''); setCtxSuccess('');
    try {
      // MESMA porta do detalhe: PATCH /api/bookings (o servidor revalida a
      // máquina de estados, as automações e o histórico — o menu não é atalho).
      const res = await apiRequest<{ booking?: Booking }>('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id, status }),
      }, { scope: 'action', area: 'Agenda' });
      if (!res.ok) { setCtxError(res.message || 'Não foi possível mudar o status.'); return; }
      setCtxSuccess(status === 'cancelled' ? 'Agendamento cancelado.' : 'Status do agendamento atualizado.');
      void load();
    } catch (cause) {
      setCtxError(cause instanceof Error ? cause.message : 'Não foi possível mudar o status.');
    } finally { setCtxBusy(''); }
  }, [businessId, ctxBusy, load]);

  /**
   * Check-in pelo menu contextual — MESMA porta do detalhe
   * (PATCH /api/bookings { action: 'check-in' }); não altera o status da reserva.
   */
  const checkIn = useCallback(async (id: string) => {
    if (!bookingsRef.current.get(id) || ctxBusy) return;
    setCtxBusy('check-in'); setCtxError(''); setCtxSuccess('');
    try {
      const res = await apiRequest<{ booking?: Booking }>('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id, action: 'check-in' }),
      }, { scope: 'action', area: 'Agenda' });
      if (!res.ok) {
        setCtxError(res.message || 'Não foi possível registrar a chegada.');
        return;
      }
      setCtxSuccess('Chegada registrada.');
      void load();
    } catch (cause) {
      setCtxError(cause instanceof Error ? cause.message : 'Não foi possível registrar a chegada.');
    } finally { setCtxBusy(''); }
  }, [businessId, ctxBusy, load]);

  /** Itens do menu do atendimento — derivados do estado ATUAL do registro. */
  const ctxItems: MenuItem[] = (() => {
    const b = ctxMenu ? bookingsRef.current.get(ctxMenu.id) : null;
    if (!b) return [];
    const items: MenuItem[] = [
      { id: 'detalhe', label: 'Ver detalhes', icon: 'eye', onSelect: () => { detailTriggerRef.current = ctxMenu?.trigger ?? null; setEditBooking(null); setDetailReschedule(false); setDetail(b); } },
    ];
    if (rescheduleDecision(b.status).kind === 'move') {
      items.push({
        id: 'editar', label: 'Editar', icon: 'edit',
        onSelect: () => onBlockEdit(b.id, ctxMenu?.trigger ?? null),
      });
    }
    const alvos = BOOKING_FLOW[b.status] || [];
    for (const to of alvos) {
      if (to === 'cancelled') continue;   // destrutivo fica no fim, com confirmação
      items.push({
        id: `status-${to}`,
        label: `${BOOKING_STATUS[to].panel}${to === 'pending' ? ' (reabrir)' : ''}`,
        icon: to === 'confirmed' ? 'check' : to === 'completed' ? 'checkCircle' : to === 'no_show' ? 'clock' : 'history',
        disabled: !!ctxBusy,
        separatorBefore: to === (alvos.filter((x) => x !== 'cancelled')[0]),
        onSelect: () => void changeStatus(b.id, to),
      });
    }
    // Grupo de OPERAÇÕES (chegada/reagendar): um único separador no início do grupo.
    const ops: MenuItem[] = [];
    const wf = (b as { workflow?: { allowed?: string[] } }).workflow;
    if (Array.isArray(wf?.allowed) && wf.allowed!.includes('check_in')) {
      ops.push({
        id: 'chegada', label: 'Registrar chegada', icon: 'check',
        disabled: !!ctxBusy,
        onSelect: () => void checkIn(b.id),
      });
    }
    if (rescheduleDecision(b.status).kind === 'move') {
      ops.push({
        id: 'reagendar', label: 'Reagendar', icon: 'sync',
        onSelect: () => { detailTriggerRef.current = ctxMenu?.trigger ?? null; setEditBooking(null); setDetailReschedule(true); setDetail(b); },
      });
    }
    ops.forEach((item, i) => items.push({ ...item, separatorBefore: i === 0 }));
    items.push({
      id: 'duplicar', label: 'Duplicar agendamento', icon: 'copy', separatorBefore: true,
      onSelect: () => {
        // Duplicar = abrir o fluxo COMPLETO já preenchido; a gravação continua
        // sendo a criação canônica (POST /api/bookings) — nenhuma rota nova.
        setCreating({
          date: b.date, time: b.time, professionalId: b.professionalId,
          serviceId: b.serviceId, contactId: b.customerId || undefined,
          name: b.customerName, phone: b.customerPhone,
          petId: b.petId || undefined,
          note: b.note || '',
          selectedDurationMin: durationOf(b),
        });
      },
    });
    if (alvos.includes('cancelled')) {
      items.push({
        id: 'cancelar', label: 'Cancelar agendamento', icon: 'x', danger: true, separatorBefore: true,
        onSelect: () => setCancelPending({
          reason: 'programmatic',
          state: {
            context: 'generic',
            title: 'Cancelar este atendimento?',
            description: `${b.petName || b.customerName} · ${formatDateBR(b.date)} às ${b.time}. O horário volta a ficar livre e o registro fica como cancelado no histórico — nada é apagado.`,
            confirmLabel: 'Manter atendimento',
            discardLabel: 'Cancelar agendamento',
          },
          proceed: () => setCancelPending(null),
          discard: () => { setCancelPending(null); void changeStatus(b.id, 'cancelled'); },
        }),
      });
    }
    return items;
  })();

  /* Fechar o menu quando o registro muda por fora (load/patch): nada de menu
     pendurado sobre um evento que já não é o mesmo. */
  useEffect(() => { setCtxMenu(null); }, [bookings]);

  // ESC cancela o arraste sem salvar nada; fecha o popover de filtros;
  // sem nenhum dos dois, sai da tela cheia. (Ordem: mais interno primeiro.)
  //
  // P0 · RODADA 2 — CANCELAR APAGA A SELEÇÃO NA HORA. O intervalo pendente
  // (`selectedRange`) é o que desenha a faixa na grade; ele só existe enquanto
  // existe um gesto em andamento (quick create aberto, bloqueio, criar). Por
  // isso TODO cancelamento limpa o estado no MESMO evento: ESC aqui, o
  // `onClose` do popover ancorado (inclusive o clique fora), "Cancelar
  // arraste", "Cancelar" do bloqueio, troca de modo/período. Antes o popover
  // fechava e a faixa continuava na grade até o próximo clique.
  const clearPendingSelection = useCallback(() => {
    setSelectedRange(null);
    setQuickCreate(null);
  }, []);
  useEffect(() => {
    if (!dragId && !dropChecking && !filterOpen && !helpOpen && !selectedRange) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dragId || dropChecking) { e.preventDefault(); endDrag(); clearPendingSelection(); setFlash(null); }
      else if (filterOpen) setFilterOpen(false);
      else if (helpOpen) setHelpOpen(false);
      else clearPendingSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragId, dropChecking, filterOpen, helpOpen, selectedRange, endDrag, clearPendingSelection]);



  // Cancela o drag se a view mudar no meio do movimento — e o gesto pendente
  // (quick create/seleção visual) junto: período ou modo novo, grade limpa.
  useEffect(() => {
    endDrag();
    clearPendingSelection();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [view, focus]);

  async function confirmDrop() {
    if (!dropAsk) return;
    const { booking, date, time } = dropAsk;
    const professionalId = dropAsk.professionalId;
    setSaving(true);
    setDropError('');
    // O servidor revalida tudo (disponibilidade, profissional, conflito,
    // duração, buffer, horizonte) e aplica rescheduleDecision.
    const res = await apiRequest<{ ok?: boolean; created?: boolean; moved?: boolean; reason?: string; booking?: Partial<Booking> & Pick<Booking, 'id'>; queueChanged?: boolean }>(
      '/api/bookings',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId, id: booking.id, date, time, professionalId: professionalId || undefined }) },
      { scope: 'action', area: 'Agenda' },
    );
    setSaving(false);
    if (!res.ok) {
      setDropError(res.status === 409 ? 'Esse horário acabou de ficar indisponível. Escolha outro horário.' : res.message || 'Não foi possível reagendar.');
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
    if (res.data?.booking && res.data.booking.id === booking.id) {
      applyConfirmedTemporalPatch(res.data.booking, !!res.data.queueChanged);
    } else {
      // Old server / explicit terminal recreation: refresh bookings only.
      void loadBookingsOnly();
    }
  }

  function move(dir: -1 | 1) {
    if (view === 'month') {
      const [y, m] = focus.split('-').map(Number);
      const nd = new Date(Date.UTC(y, m - 1 + dir, 1));
      setFocus(nd.toISOString().slice(0, 10));
      return;
    }
    setFocus(addDaysISO(focus, view === 'week' ? dir * 7 : dir));
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

  // Bloqueios do período VISÍVEL (mesma conta que já existia na faixa) + rótulo
  // compacto do indicador: a contagem sai do dado, nunca de texto solto.
  const blocksInView = scheduleBlocks.filter((block) => {
    const dates = view === 'week' ? weekDays : [focus];
    return dates.some((date) => block.startAt.slice(0, 10) === date
      || instantToLocalProjection(block.startAt, bizTz || 'America/Sao_Paulo').date === date);
  });
  const blockCountLabel = blocksInView.length === 1
    ? '1 bloqueio neste período'
    : `${blocksInView.length} bloqueios neste período`;

  return (
    <div data-agenda-page="true" className="ag-page">
      {/* LINHA 1 — TÍTULO / CONTROLES AUXILIARES (Agenda protagonista):
          [ícone calendário] Agenda · à direita Filtros | Fila | ?.
          São controles AUXILIARES — nada de Dia/Semana/Mês/Lista aqui (eles
          vivem na Linha 2) e nada de card só para o título. A ação principal
          ("Novo agendamento") também saiu daqui: é o CTA da Linha 2. */}
      <header className="gd-toolbar justify-between gap-x-4 mb-2">
        <div className="min-w-0 flex items-center gap-3">
          {/* CONTRATO ÚNICO de títulos (refino final): chip 40×40 neutro
              sutil + borda 1px + ícone line na cor do TEMA — igual a todas
              as outras telas (PageHeader). */}
          <span data-agenda-title-icon="calendar" className="il-page-header__icon inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--accent)]">
            <Icon n="calendar" size={19} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text)] leading-tight">Agenda</h1>
        </div>
        <div className="gd-toolbar justify-end">
          {/* Filtros: UM botão, UM popover (Status · Serviços · Profissional) e
              contador quando há filtro ativo. Nada de três selects enormes
              fixos acima da grade. */}
          <div className="relative" ref={filterWrapRef}>
            <Button variant="secondary" onClick={() => { setFilterOpen((o) => !o); setProSearch(''); }}
              aria-expanded={filterOpen} aria-haspopup="dialog" title="Filtros da agenda">
              <Icon n="filter" size={14} />
              {activeFilterCount > 0 ? `Filtros · ${activeFilterCount}` : 'Filtros'}
              <Icon n="chevD" size={12} className={`transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </Button>

            {filterOpen && (
              <div role="dialog" aria-label="Filtros da agenda"
                className="absolute right-0 top-[calc(100%+6px)] z-50 w-[310px] max-w-[calc(100vw-1.25rem)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)] shadow-lg text-left">
                <div className="px-3 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Filtros</p>
                  {activeFilterCount > 0 && (
                    <button type="button" onClick={clearFilters}
                      className="text-[12px] font-semibold text-[var(--danger-fg)] hover:underline">
                      Limpar filtros
                    </button>
                  )}
                </div>

                <div className="px-3 pb-2.5">
                  <p className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1.5">Status</p>
                  <div className="flex flex-wrap gap-1">
                    <FilterChip active={!statusFilter} onClick={() => setStatusFilter('')}>Todos</FilterChip>
                    {statusOptions.map((st) => (
                      <FilterChip key={st} active={statusFilter === st} onClick={() => setStatusFilter(statusFilter === st ? '' : st)}>
                        {BOOKING_STATUS[st].panel}
                      </FilterChip>
                    ))}
                  </div>
                </div>

                {specialties.length > 0 && (
                  <div className="px-3 pb-2.5 border-t border-[var(--border-soft)] pt-2.5">
                    <p className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1.5">Serviços</p>
                    <div className="flex flex-wrap gap-1">
                      <FilterChip active={!specFilter} onClick={() => pickSpec('')}>Todos</FilterChip>
                      {specialties.map((r) => (
                        <FilterChip key={r} active={specFilter === r} onClick={() => pickSpec(specFilter === r ? '' : r)}>
                          {r}
                        </FilterChip>
                      ))}
                    </div>
                  </div>
                )}

                {activePros.length > 0 && (
                  <div className="px-3 pb-3 border-t border-[var(--border-soft)] pt-2.5">
                    <p className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1.5">Profissional</p>
                    <div className="relative">
                      <Icon n="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input value={proSearch} onChange={(e) => setProSearch(e.target.value)}
                        placeholder="Pesquisar profissional…" aria-label="Pesquisar profissional"
                        className="w-full text-[12.5px] bg-[var(--surface-subtle)] border border-[var(--border)] rounded-[var(--radius-sm)] pl-8 pr-2 py-1.5 focus:outline-none focus:border-[var(--brand)] focus:bg-white" />
                    </div>
                    <div className="mt-1.5 max-h-44 overflow-y-auto ws-scroll space-y-0.5">
                      <button type="button" onClick={() => pickPro('')}
                        className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] text-left text-[12.5px] font-medium',
                          !proFilter ? 'bg-[var(--surface-hover)]' : 'hover:bg-[var(--surface-subtle)]')}>
                        <span className="flex-1">Todos</span>
                        {!proFilter && <Icon n="check" size={13} className="text-[var(--success-fg)] shrink-0" />}
                      </button>
                      {prosInFilter.map((p) => (
                        <button key={p.id} type="button" onClick={() => pickPro(proFilter === p.id ? '' : p.id)}
                          className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] text-left text-[12.5px]',
                            proFilter === p.id ? 'bg-[var(--surface-hover)]' : 'hover:bg-[var(--surface-subtle)]')}>
                          <Avatar name={p.name} src={p.photo} size={20} />
                          <span className="flex-1 min-w-0 truncate">
                            <span className="font-semibold text-[var(--text-primary)]">{p.name}</span>
                            {p.role && <span className="text-[var(--text-muted)]"> · {p.role}</span>}
                          </span>
                          {proFilter === p.id && <Icon n="check" size={13} className="text-[var(--success-fg)] shrink-0" />}
                        </button>
                      ))}
                      {prosInFilter.length === 0 && (
                        <p className="text-[12.5px] text-[var(--text-muted)] px-2 py-1.5">Nenhum profissional encontrado.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fila do balcão — controle auxiliar da Linha 1 (mesma família
              visual de Filtros). Abrir/fechar decide quem opera; a rail lateral
              continua sendo a superfície dela. */}
          {loaded && (
            <Button variant="secondary" onClick={() => setShowQueue((v) => !v)}
              aria-expanded={showQueue} aria-pressed={showQueue} title="Fila de atendimento">
              <Icon n="users" size={14} />
              Fila
              {(queueInfo.waiting + queueInfo.called + queueInfo.inService) > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-pill text-[10.5px] font-bold tabular-nums bg-[var(--surface-3)] text-[var(--text-soft)] border border-[var(--border)]">
                  {queueInfo.waiting + queueInfo.called}
                </span>
              )}
            </Button>
          )}

          {/* Legenda: ajuda sob demanda (popover), nunca uma faixa fixa — e
              nunca competindo com Filtros/Fila: aqui é um "?" só ícone,
              o mesmo affordance de ajuda do topbar. */}
          <div ref={helpWrapRef} className="relative">
            <IconButton icon="help" label="Legenda e como usar a grade" tip="Legenda e como usar a grade"
              variant="ghost" aria-expanded={helpOpen} aria-haspopup="dialog"
              onClick={() => setHelpOpen((v) => !v)} />
            {helpOpen && (
              <div role="dialog" aria-label="Legenda e ajuda da agenda"
                className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(24rem,calc(100vw-2rem))] rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] shadow-lg p-3.5 space-y-2.5">
                <p className="text-[12.5px] text-[var(--text-secondary)]">Clique num atendimento para detalhes e ações; arraste para reagendar.</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Legenda dos estados">
                  {statusOptions.map((st) => (
                    <span key={st} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--text-secondary)]">
                      <span className={`w-2.5 h-2.5 rounded-full ${BOOKING_DOT[st]}`} aria-hidden="true" />
                      {BOOKING_STATUS[st].panel}
                    </span>
                  ))}
                  <span className="text-[11.5px] font-medium text-[var(--text-secondary)] inline-flex items-center gap-1.5">
                    <span className={`w-3.5 h-3.5 rounded-full text-[9px] font-semibold leading-[14px] text-center ${ATTENTION_MARK_CLS}`} aria-hidden="true">!</span>
                    precisa de fechamento
                  </span>
                </div>
                <p className="text-[12px] text-[var(--text-muted)]">Branco: horário livre · Cinza: indisponível. A reserva é confirmada pelo servidor.</p>
                <p className="text-[12px] text-[var(--text-muted)] inline-flex items-center gap-1.5">
                  <Icon n="calendarPlus" size={12} /> clique num horário vago para agendar · arraste um cartão para remarcar
                </p>
              </div>
            )}
          </div>

        </div>
      </header>

      <PermissionNotice message={notice?.title} hint={notice?.hint} onDismiss={dismiss} />

      {/* DS 1.1 · §12 — a confirmação da ação que acabou de acontecer é um
          aviso LOCAL: superfície canônica (`Notice`), no fluxo, sem disputar a
          toolbar. Antes era um bloco com cor, raio, sombra e botão próprios. */}
      {flash && (
        <Notice
          live
          className="mb-3"
          tone={flash.tone === 'ok' ? 'success' : flash.tone === 'warn' ? 'warning' : 'error'}
          onDismiss={() => setFlash(null)}
        >
          {flash.text}
        </Notice>
      )}

      {pendencies.length > 0 && (
        <AttentionStrip
          title={`${pendencies.length} precisam de fechamento`}
          hint="horário passou e continua em aberto"
          action={(
            <>
              {pendencies.slice(0, 4).map((b) => (
                <button key={b.id} onClick={() => setDetail(b)} className="text-xs font-medium bg-[var(--surface)] border border-[var(--attention-border)] text-[var(--attention-fg)] px-2.5 py-1 rounded-md hover:bg-[var(--attention-bg-hover)]">
                  {formatDateBR(b.date)} {b.time} · {b.petName || b.customerName}
                </button>
              ))}
              {pendencies.length > 4 && <span className="text-xs font-medium text-[var(--attention-fg)] self-center">+{pendencies.length - 4}</span>}
            </>
          )}
        />
      )}

      {/* A3.4 · Bloco 4 — FILA DO BALCÃO. Fica na própria Agenda porque é onde
          a equipe já está olhando o dia; abrir/fechar é decisão de quem opera
          (o balcão não precisa dela o tempo todo). A faixa de atenção avisa
          quando a espera passa do confortável. */}
      {/* Fila: só o alerta REAL de espera ocupa o fluxo; o toggle vive na toolbar. */}
      {loaded && queueInfo.longWait && !showQueue && (
        <div className="mb-2.5">
          <AttentionStrip
            title={`${queueInfo.waiting + queueInfo.called} na fila — maior espera ${waitLabel(queueInfo.longestWaitMin)}`}
            hint="o balcão está esperando mais do que o normal"
            action={<Button size="sm" variant="secondary" onClick={() => setShowQueue(true)}>Abrir fila</Button>}
          />
        </div>
      )}

      {/* A3.4 final UX — WORKSPACE da agenda: [Agenda (flex-1) | Fila (rail)].
          A fila NÃO entra mais no fluxo vertical (não empurra a grade para
          baixo): ela é coluna ao lado no desktop largo e overlay no resto.
          Agenda protagonista: o workspace cresce até o fim do viewport e a
          rolagem vertical fica SÓ no painel do modo (ver .ag-page no CSS). */}
      <div ref={workspaceRef} data-agenda-workspace="true" className="flex flex-1 items-stretch gap-2.5 min-h-0 min-w-0">
        <main data-agenda-main="true" className="flex-1 min-w-0">
      {/* LINHA 2 — DATA / MODO / AÇÃO PRINCIPAL.
          Esquerda: [◀][▶] + data selecionada (fuso/regras preservados).
          Direita: [Dia | Semana | Lista] + CTA "Novo agendamento".
          relative z-40: os popovers abrem sobre a grade e precisam ficar
          acima dos cabeçalhos sticky (z-20/30) das colunas. */}
      <div className="relative z-40 ws-panel mb-2.5">
        <div className="gd-toolbar gap-x-4 px-3 py-2.5">
          {/* MISSÃO UX CLOSURE · item 5 — UMA MÉTRICA: Hoje, setas, data,
              Dia/Semana/Lista, Filtros, Fila, Bloquear horário e Novo
              agendamento são todos controles de NÍVEL MD do DS
              (`--gd-control-h`, 40px; ícone é quadrado na mesma altura).
              Antes conviviam 34/40/28px na mesma linha. */}
          {/* Navegação no tempo (correção cirúrgica): [◀] [▶] apenas.
              O botão “Hoje” saiu da UI — a data/período continua visível ao
              lado e o seletor nativo de data segue permitindo saltar para
              qualquer dia. */}
          {/* DS 1.0 · §5 — TOOLBAR CANÔNICA: `Hoje · ‹ data ›`.
              "Hoje" volta como ação de uma linha; as setas andam um passo do
              modo atual; a data é o DatePicker CANÔNICO (Popover + Calendar do
              design system). Nada de `<input type="date">` — a dependência do
              seletor nativo do navegador acabou; o rótulo rico do período
              continua sendo a leitura principal. */}
          <div className="gd-toolbar min-w-0">
            <Button
              variant="secondary"
              onClick={() => setFocus(today)}
              aria-pressed={focus === today}
              title={focus === today ? 'Você já está em hoje' : 'Ir para hoje'}
            >
              Hoje
            </Button>
            <IconButton icon="chevL" label={navLabel(-1)} tip={navLabel(-1)} variant="secondary" onClick={() => move(-1)} />
            <DatePicker
              value={focus}
              onChange={(iso) => { if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) setFocus(iso); }}
              label={`Escolher data (${focusRange})`}
              formatValue={() => focusLabel}
              max="2100-12-31"
              className="min-w-0 max-w-[min(26rem,calc(100vw-11rem))] [&>button]:capitalize"
            />
            <IconButton icon="chevR" label={navLabel(1)} tip={navLabel(1)} variant="secondary" onClick={() => move(1)} />
            <span className="sr-only" aria-live="polite">{focusRange}</span>
          </div>
          <div className="sm:ml-auto min-w-0 max-w-full gd-toolbar justify-end">
            {/* Visualização: Dia | Semana | Lista (correção cirúrgica: “Mês”
                saiu da UI — a lógica do modo mês segue intacta para links
                diretos com view=month; nada foi destruído). */}
            <Segmented
              items={[
                { id: 'day' as View, label: 'Dia', icon: 'calendar' },
                { id: 'week' as View, label: 'Semana', icon: 'grid' },
                { id: 'list' as View, label: 'Lista', icon: 'tasks' },
              ]}
              value={view}
              onChange={(v) => { endDrag(); setView(v); }}
              ariaLabel="Visualização da agenda"
            />
            {/* CTA PRINCIPAL da Agenda segue o TEMA ativo (--accent, contrato
                universal de cor) — o fluxo/sheet de criação é o mesmo. */}
            <Button variant="secondary" aria-pressed={blockMode} onClick={() => { setBlockMode(!blockMode); setSelectedRange(null); if (view === 'list' || view === 'month') setView('day'); }}>Bloquear horário</Button>
            <Button variant="primary" onClick={() => setCreating({ date: focus, time: '', professionalId: '' })}>
              <Icon n="calendarPlus" size={15} /> Novo agendamento
            </Button>
          </div>
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
                'font-semibold px-2 py-0.5 rounded-pill border bg-white shadow-xs '
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
            <Button size="xs" variant="secondary" onClick={() => { endDrag(); clearPendingSelection(); }}>
              <Icon n="x" size={12} /> Cancelar arraste
            </Button>
          </div>
        )}
      </div>

      {blockMode && <div role="status" className="mb-3 rounded-md bg-[var(--brand-soft)] text-[var(--brand-fg)] p-3 flex items-center justify-between text-sm">Selecione o intervalo que deseja bloquear<Button variant="ghost" size="sm" onClick={closeBlock}>Cancelar</Button></div>}
      {blocksInView.length > 0 && <section className="ag-blocks-bar" aria-label="Bloqueios operacionais">
        {/* MISSÃO UX CLOSURE · item 4 — a faixa laranja de "Bloqueios
            operacionais" (título + parágrafo + botões grandes) DOMINAVA a
            grade. O bloqueio agora é lido ONDE ele ocorre (hachura na coluna)
            e aqui fica só um INDICADOR compacto: ícone, contagem e as pílulas
            de horário/escopo. A explicação vira a dica curta de uma linha, e o
            clique continua abrindo o MESMO formulário do bloqueio. */}
        <span className="ag-blocks-bar__label">
          <Icon n="lock" size={13} aria-hidden="true" />
          {blockCountLabel}
        </span>
        <span className="ag-blocks-bar__hint">Não contam como atendimento.</span>
        <div className="ag-blocks-bar__items">{blocksInView.map(block => (
          <button key={block.id} type="button" className="ag-blocks-bar__chip" onClick={() => {
            const start = instantToLocalProjection(block.startAt, bizTz || 'America/Sao_Paulo');
            openBlock({ date: start.date, time: start.time, professionalId: block.professionalId }, block);
            setBlockEnd(instantToLocalProjection(block.endAt, bizTz || 'America/Sao_Paulo').time);
          }}>
            <span className="tabular-nums">{instantToLocalProjection(block.startAt, bizTz || 'America/Sao_Paulo').time}–{instantToLocalProjection(block.endAt, bizTz || 'America/Sao_Paulo').time}</span>
            <span>{block.reason || block.note || 'Operacional'}</span>
            <span className="ag-blocks-bar__scope">{block.professionalId ? proName(block.professionalId) : block.resourceId ? scheduleResources.find(r => r.id === block.resourceId)?.name : 'Clínica'}</span>
          </button>
        ))}</div>
      </section>}
      {denied ? <AccessDenied area="Agenda" /> : failed ? <AreaLoadError area="Agenda" message={failed} onRetry={load}/> : !loaded ? <AgendaSkeleton /> : view === 'list' ? (
        <section className="ag-mode-scroll ag-list" aria-label="Lista de atendimentos do dia">
          <p className="ag-list__hint">{formatDateBR(focus)} · Toque para abrir o atendimento. Horários livres e intervalos estão na visualização Dia.</p>
          {/* DS 1.0 · §5/§10 — a Lista é uma LISTA, não uma pilha de cards:
              linhas com fio de 1px, alvo de toque confortável e hover neutro. */}
          {columns.flatMap(c => c.blocks).length === 0 && (
            <div className="ag-list__empty">
              <h2 className="font-semibold">Nenhum atendimento nesta seleção</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Confira os filtros ou use Novo agendamento para consultar horários disponíveis.</p>
            </div>
          )}
          {[...new Map(columns.flatMap(c => c.blocks).map(b => [b.id,b])).values()].sort((a,b) => a.time.localeCompare(b.time)).map(item => <button key={item.id} type="button" onClick={(event) => { const booking = bookings.find(b => b.id === item.id); if (booking) { detailTriggerRef.current = event.currentTarget; setEditBooking(null); setDetailReschedule(false); setDetail(booking); } }} className="ag-list__row w-full flex gap-4 items-start text-left">
            <span className="font-semibold tabular-nums text-[var(--brand-fg)]">{item.time}</span>
            <span className="min-w-0 flex-1"><strong className="block text-sm">{(() => { const bk = bookings.find(b => b.id === item.id); return bk?.petName || bk?.customerName; })()}</strong><span className="block text-xs text-[var(--text-muted)] mt-1">{(() => { const bk = bookings.find(b => b.id === item.id); return bk?.petName ? `Tutor: ${bk.customerName} · ` : ''; })()}{item.service} · {proName(bookings.find(b => b.id === item.id)?.professionalId || '') || 'Sem profissional'}</span><span className="inline-block text-xs mt-2 font-semibold">{item.statusLabel}{bookings.find(b => b.id === item.id)?.bookingKind === 'fit_in' ? ' · Encaixe' : ''}</span></span><Icon n="chevR" size={16} />
          </button>)}
        </section>
      ) : view === 'month' ? (
        <div className="ag-mode-scroll ag-grid-surface overflow-hidden p-2">
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
              const pend = list.filter((b) => needsClosure(b, bookingDurationOf(b, serviceOf(b.serviceId)), today, nowHM(new Date(), bizTz))).length;
              const inMonth = d.slice(0, 7) === focus.slice(0, 7);
              return (
                <button key={d} onClick={() => { setPresentation({data:d,view:'day'}); }} className={`bg-white p-1.5 min-h-[72px] text-left hover:bg-zinc-50 ${d === today ? 'ring-1 ring-inset ring-emerald-500 bg-emerald-50/40' : ''} ${!inMonth ? 'bg-zinc-50 text-zinc-400' : ''}`}>
                  <span className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${d === today ? 'text-emerald-700' : inMonth ? 'text-zinc-700' : 'text-zinc-400'}`}>{Number(d.slice(8, 10))}</span>
                    {pend > 0 && <span className="text-[9px] font-semibold bg-amber-500 text-white rounded-full px-1">{pend}</span>}
                  </span>
                  {list.length > 0 && (
                    <>
                      <span className="block text-[10px] font-medium text-zinc-600 mt-1">{list.length} · {list.slice(0, 2).map((b) => b.time).join(', ')}</span>
                      <span className="flex gap-0.5 mt-1">{list.slice(0, 6).map((b) => <span key={b.id} className={`w-1.5 h-1.5 rounded-full ${bookingDotCls(b.status)}`} />)}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="ag-mode-panel ag-grid-surface" data-range-focus={rangeFocus || undefined}>
          {/* AGENDA PROTAGONISTA — SCROLL INTERNO com dono único (Dia/Semana):
              o scroller é o ÚNICO dono da rolagem vertical — ele ocupa todo o
              resto do viewport (flex:1/min-height:0 na cadeia .ag-page) e rola
              por dentro; cabeçalhos de coluna e gutter ficam presos nele e a
              PÁGINA nunca cresce com a grade. `railMaxH` permanece como teto
              de segurança (medida real da viewport — sem altura chutada) e a
              rolagem horizontal continua aqui dentro quando as colunas não
              cabem. */}
          <div
            ref={scrollRef}
            className={`ag-mode-scroll overflow-auto ws-scroll ${isDragging ? 'select-none' : ''}`}
            style={railMaxH ? { maxHeight: railMaxH } : undefined}
          >
            <div className="flex" style={{ minWidth: rangeFocus ? 0 : dayWidth }}>
              {/* Gutter de horas (fixo na horizontal) */}
              <div className="sticky left-0 z-30 bg-white shrink-0 border-r border-zinc-200" style={{ width: GUTTER_W }}>
                <div style={{ height: HEADER_H }} className="border-b border-zinc-200" />
                {/* O último rótulo ancora ACIMA da linha: nenhum elemento
                    ultrapassa gridHeight (zero scroll fantasma). */}
                <div className="relative" style={{ height: gridHeight }}>
                  {Array.from({ length: grid.hours + 1 }, (_, i) => (
                    <span key={i}
                      className={`absolute right-2 text-sm font-medium text-[var(--text-muted)] ${i === grid.hours ? '-translate-y-full' : '-translate-y-1/2'}`}
                      style={{ top: i * PX_PER_HOUR }}>{minToTime(grid.start + i * 60)}</span>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                {/* Cabeçalho das colunas (fixo na vertical) */}
                <div className="sticky top-0 z-20 flex bg-white border-b border-zinc-200">
                  {displayedColumns.map((c) => (
                    <div key={c.key} className="shrink-0 px-3 flex items-center gap-2 border-r border-zinc-100 last:border-r-0" style={{ minWidth: rangeFocus ? 0 : COL_MIN, width: `${100 / Math.max(1, displayedColumns.length)}%`, height: HEADER_H }}>
                      {view === 'day' && (
                        c.isProfessional ? (
                          <Avatar name={c.label} src={c.photo} size={22} />
                        ) : (
                          <span className="w-5 h-5 rounded-md bg-[var(--surface-2)] text-[var(--text-muted)] text-[10px] font-semibold flex items-center justify-center shrink-0">—</span>
                        )
                      )}
                      <span className="min-w-0">
                        {/* MISSÃO UX CLOSURE · item 4 — cabeçalho do profissional
                            legível: nome um passo acima e, no dia de HOJE, uma
                            etiqueta textual além do tom — a data atual não
                            depende só de cor para ser reconhecida. */}
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className={`block text-[13.5px] font-semibold truncate ${c.isToday ? 'text-[var(--brand-fg)]' : 'text-[var(--text-primary)]'}`}>{c.label}</span>
                          {c.isToday && <span className="ag-col-today">Hoje</span>}
                        </span>
                        {c.sub && <span className="block text-[11px] text-[var(--text-muted)] truncate">{c.sub}</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Corpo da grade */}
                <div className="flex relative" ref={colsRef}>
                  {/* Linha do agora: só quando o dia/hora atual está no recorte
                      visível (dia focado em hoje, ou coluna de hoje na semana).
                      Puramente visual — nenhuma regra de tempo muda. */}
                  {(() => {
                    const place = nowLinePlacement({
                      view, focus, today, nowMin,
                      gridStart: grid.start, gridEnd: grid.end,
                      columns: displayedColumns, pxPerHour: PX_PER_HOUR,
                    });
                    if (!place) return null;
                    return (
                      <span className="ag-nowline" style={place.left ? { top: place.top, left: place.left, width: place.width } : { top: place.top, left: 0, right: 0 }}>
                        <span className="ag-nowline__dot" />
                        <span className="ag-nowline__time">Agora · {nowHM(new Date(), bizTz)}</span>
                      </span>
                    );
                  })()}
                  {displayedColumns.map((c, i) => (
                    <GridColumn
                      key={c.key}
                      column={c}
                      basisPct={100 / Math.max(1, displayedColumns.length)}
                      variant={view === 'week' ? 'week' : 'day'}
                      highlight={highlightFor(i)}
                      gridHeight={gridHeight}
                      hours={grid.hours}
                      onPressStart={onPressStart}
                      onPressMove={onPressMove}
                      onPressEnd={onPressEnd}
                      onPressCancel={onPressCancel}
                      onBlockClick={onBlockClick}
                      onBlockEdit={onBlockEdit}
                      onBlockContextMenu={onBlockContextMenu}
                      hoverSuppressed={ctxMenu !== null || detail !== null || editBooking !== null || dropAsk !== null || resizeAsk !== null || quickCreate !== null || blockForm}
                      onEmptyPress={onEmptyPress}
                      onRangeSelect={onRangeSelect}
                      selectedRange={selectedRange?.columnKey === c.key ? selectedRange : null}
                      onResize={onResize}
                      unavailableRanges={exceptionUnavailableRanges(exceptions, c.date, grid.start, grid.end, rules.filter(r => r.weekday === weekdayOf(c.date) && (c.professionalId ? (followsBusinessHours(pros.find(p => p.id === c.professionalId), rules) ? !r.professionalId : r.professionalId === c.professionalId) : !r.professionalId || activePros.some(p => p.id === r.professionalId && !followsBusinessHours(p, rules)))).map(r => ({ start: timeToMin(r.start), end: timeToMin(r.end) })))}
                      operationalBlocks={scheduleBlocks.flatMap(block => {
                        const window = blockOnAgendaColumn(block, c.date, c.professionalId, view === 'week' ? 'week' : 'day', bizTz);
                        if (!window) return [];
                        return [{ block, top: (window.from - grid.start) / 60 * PX_PER_HOUR,
                          height: Math.max(18, (window.to - window.from) / 60 * PX_PER_HOUR), timeLabel: window.timeLabel,
                          scopeLabel: block.professionalId ? proName(block.professionalId) : block.resourceId ? scheduleResources.find(r => r.id === block.resourceId)?.name || 'Recurso' : 'Clínica',
                          label: block.reason || block.note || 'Operacional' }];
                      })}
                      onOperationalBlock={(block) => {
                        const start = instantToLocalProjection(block.startAt, bizTz || 'America/Sao_Paulo');
                        const end = instantToLocalProjection(block.endAt, bizTz || 'America/Sao_Paulo');
                        openBlock({ date: start.date, time: start.time, professionalId: block.professionalId }, block);
                        setBlockEnd(end.time);
                      }}
                      startMinute={grid.start}
                      endMinute={grid.end}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

        </main>

        {/* RAIL DA FILA — um só QueuePanel para os dois tamanhos de tela:
            • xl+ (desktop largo): coluna ao lado, com a MESMA linha de base da
              grade; a lista rola DENTRO da rail (max-height medida do workspace);
            • abaixo de xl: overlay deslizante (a agenda nunca é espremida por
              380px num tablet) — fecha pelo X, pelo botão ou pelo fundo. */}
        {showQueue && (
          <QueueDock onClose={() => setShowQueue(false)} maxHeight={railMaxH}>
              <QueuePanel
                businessId={businessId}
                date={today}
                rows={queueRows}
                loading={queueLoading}
                /* A tela inteira exige permissão de Agenda (a porta barra antes);
                   o escopo do profissional continua valendo no servidor por
                   entrada da fila. */
                canWrite={!denied}
                canEncounter={!denied && canEncounter}
                /* A3.4 (teste humano): a fila busca o cliente no CRM — só faz
                   sentido para quem tem a permissão de Clientes. */
                canSearchContacts={permissions.clientes === true}
                done={queueDone}
                timezone={bizTz}
                onChanged={loadQueue}
                professionals={activePros.map((p) => ({ id: p.id, name: p.name }))}
                /* A regra do serviço (`professionalIds`) vai junto: a fila só
                   oferece quem ATENDE o serviço escolhido. */
                services={services.map((x) => ({ id: x.id, name: x.name, professionalIds: x.professionalIds || [], professionalMode: (x as any).professionalMode }))}
                onOpenBooking={(id) => { const b = bookingsRef.current.get(id); if (b) setDetail(b); }}
                onEncounter={(row) => router.push(encounterWorkspaceHref({ businessId, queueId: row.id, returnTo: `${window.location.pathname}${window.location.search}` }))}
                onOpenClient={(row) => { window.location.href = `/clientes?c=${encodeURIComponent(row.contactId)}`; }}
                onClose={() => setShowQueue(false)}
                onFitIn={(row) => setCreating({
                  date: today, time: nowHM(), professionalId: row.professionalId,
                  contactId: row.contactId, name: row.customerName, phone: row.customerPhone, serviceId: row.serviceId,
                })}
              />
          </QueueDock>
        )}
      </div>

      {/* Ghost do atendimento sendo arrastado (posição via DOM: zero re-render) */}
      <div
        ref={ghostRef}
        className="fixed top-0 left-0 z-[70] pointer-events-none hidden"
        aria-hidden="true"
        style={{ willChange: 'transform' }}
      >
        <div className="bg-[var(--text)] text-white rounded-md shadow-lg px-2.5 py-1.5 max-w-[220px]">
          <p className="text-[11px] font-semibold leading-tight truncate">
            {dragging ? `${dragging.petName || dragging.customerName} · ${serviceName(dragging.serviceId)}` : ''}
          </p>
          <p className={
            'text-[11px] leading-tight mt-0.5 '
            + (hover?.availability === 'free' ? 'text-emerald-300' : hover?.time ? 'text-red-300' : 'text-zinc-300')
          }>
            {isDragging ? ghostLabel : ''}
          </p>
        </div>
      </div>

      {/* AUDITORIA · rodada 2 — CONFIRMAÇÃO DE EDIÇÃO É MODAL CENTRAL. Mudar a
          duração/alteração de horário de um atendimento é uma DECISÃO sobre o
          registro (o Material chama isso de alert dialog); estava em gaveta
          lateral, que é a geometria de LER o registro. A leitura continua no
          painel preso à direita (`.gd-detail`); a confirmação é central. */}
      {resizeAsk && <Drawer open variant="dialog" dialogWidth="460px" title="Confirmar duração" onClose={() => !saving && setResizeAsk(null)} width="max-w-lg">
        <div className="p-5 space-y-3">
          <p className="font-semibold">{resizeAsk.booking.time}–{resizeAsk.end} · {durationLabel(timeToMin(resizeAsk.end) - timeToMin(resizeAsk.booking.time))}</p>
          <p className="text-sm">O serviço não será alterado. Somente este atendimento muda.</p>
          {dropError && <p role="alert" className="text-red-600 text-sm">{dropError}</p>}
          <div className="flex gap-2">
            <Button disabled={saving} onClick={async () => {
              if (saving) return;
              setSaving(true); setDropError('');
              const res = await apiRequest<{ booking?: Partial<Booking> & Pick<Booking, 'id'>; queueChanged?: boolean }>(
                '/api/bookings',
                { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId, id: resizeAsk.booking.id, resizeEnd: resizeAsk.end }) },
                { scope: 'action', area: 'Agenda' },
              );
              setSaving(false);
              if (!res.ok) { setDropError(res.status === 409 ? 'Esse horário acabou de ficar indisponível. Escolha outro fim.' : res.message); return; }
              setResizeAsk(null);
              if (res.data?.booking && res.data.booking.id === resizeAsk.booking.id) applyConfirmedTemporalPatch(res.data.booking, !!res.data.queueChanged);
              else void loadBookingsOnly();
            }}>{saving ? 'Salvando…' : 'Confirmar'}</Button>
            <Button variant="secondary" disabled={saving} onClick={() => setResizeAsk(null)}>Cancelar</Button>
          </div>
        </div>
      </Drawer>}

      {/* Confirmação explícita do drop — nada acontece em silêncio */}
      {dropAsk && (
        <Drawer open variant="dialog" dialogWidth="520px" onClose={() => !saving && setDropAsk(null)} title="Confirmar reagendamento" width="max-w-lg">
          <div className="p-5">
            <p className="font-semibold">{dropConfirmQuestion(dropAsk.date, dropAsk.time)}</p>
            <p className="text-sm text-zinc-600 mt-1.5"><strong>{dropAsk.booking.petName || dropAsk.booking.customerName}</strong>{dropAsk.booking.petName ? ` (tutor: ${dropAsk.booking.customerName})` : ''} · {serviceName(dropAsk.booking.serviceId)}</p>
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
        </Drawer>
      )}

      {/* MISSÃO UX CLOSURE · item 5/6 — bloqueio é FORMULÁRIO CURTO: mesmo
          overlay system (Drawer), geometria de MODAL CENTRAL — a faixa lateral
          fica reservada para superfícies de trabalho longas. Nada de regra de
          agenda muda aqui: mesmos campos, mesma validação, mesma API. */}
      {blockForm && <Drawer open variant="dialog" dialogWidth="560px" onClose={() => !blockBusy && closeBlock()} title={editingBlock ? 'Editar bloqueio' : 'Bloquear horário'} width="max-w-md">
        {/* DS 1.0 · §4/§5 — o formulário do bloqueio usa os CONTROLES
            canônicos (Field/Input/Select/DatePicker): mesma altura, raio, borda,
            foco e dropdown do resto do sistema. O `<select>` cru e o
            `<input type="date">` saíram daqui — nenhuma tela desenha controle
            próprio. Regras de negócio intactas: mesmos campos, mesma validação,
            mesma chamada de API. */}
        <div className="p-4 space-y-4">
          <div>
            <h3 className="text-[var(--gd-font-size-section)] font-semibold text-[var(--gd-text)]">Indisponibilidade temporária</h3>
            <p className="mt-1 text-[var(--gd-font-size-body)] text-[var(--gd-text-muted)]">Use para períodos em que normalmente haveria atendimento, mas a clínica, um profissional ou um recurso ficará indisponível.</p>
          </div>
          <DatePicker value={blockDate} onChange={setBlockDate} label="Data do bloqueio" max="2100-12-31" />
          <div className="flex gap-2">
            <div className="flex-1"><Field label="Início">
              <Input type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)} />
            </Field></div>
            <div className="flex-1"><Field label="Fim">
              <Input type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)} />
            </Field></div>
          </div>
          <Field label="Escopo" hint={blockScope === 'business' ? 'Impede novos agendamentos para toda a clínica neste período.' : blockScope === 'professional' ? 'Bloqueia apenas a agenda do profissional selecionado.' : 'Impede que esse recurso seja reservado por outro atendimento.'}>
            <Select value={blockScope} onChange={e => setBlockScope(e.target.value as typeof blockScope)}>
              <option value="business">Clínica</option>
              <option value="professional">Profissional</option>
              <option value="resource">Sala ou equipamento</option>
            </Select>
          </Field>
          {blockScope === 'professional' && (
            <Field label="Profissional">
              <Select value={blockPro} onChange={e => setBlockPro(e.target.value)}>
                <option value="">Selecione</option>
                {pros.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}
          {blockScope === 'resource' && (
            <Field label="Recurso">
              <Select value={blockResource} onChange={e => setBlockResource(e.target.value)}>
                <option value="">Selecione</option>
                {scheduleResources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Motivo" hint="Opcional · aparece na grade e no histórico">
            <Input value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="Ex.: manutenção, reunião" />
          </Field>
          <Field label="Observação">
            <Input value={blockNote} onChange={e => setBlockNote(e.target.value)} placeholder="Ex.: manutenção, reunião" />
          </Field>
          {blockError && <Notice tone="error" title="Não foi possível salvar">{blockError}</Notice>}
          <PageActionBar hint="O bloqueio não cria atendimento — só reserva o período.">
            <Button variant="ghost" disabled={blockBusy} onClick={closeBlock}>Cancelar</Button>
            {editingBlock && <Button variant="secondary" disabled={blockBusy} onClick={() => void saveBlock(true)}>Excluir bloqueio</Button>}
            <Button disabled={blockBusy} onClick={() => void saveBlock()}>{blockBusy ? (editingBlock ? 'Salvando…' : 'Criando…') : editingBlock ? 'Salvar alterações' : 'Criar bloqueio'}</Button>
          </PageActionBar>
        </div>
      </Drawer>}
      {quickCreate && (
        <QuickBookingPopover
          anchor={quickCreate}
          businessId={businessId || ''}
          services={services}
          pros={pros}
          timezone={bizTz}
          vetMode={vetMode}
          /* Cancelar/fechar (ESC, clique fora, botão) encerra o gesto: a
             seleção sai da grade na mesma hora (P0 · rodada 2). */
          onClose={clearPendingSelection}
          onCreated={() => { setQuickCreate(null); setSelectedRange(null); void load(); }}
          onMore={(seed) => {
            // "Mais opções" = fluxo COMPLETO com o mesmo preenchimento: nada do
            // que já foi escolhido se perde ao trocar de superfície.
            setQuickCreate(null);
            setCreating({
              date: seed.date || quickCreate.date,
              time: seed.time || quickCreate.time,
              professionalId: seed.professionalId || quickCreate.professionalId,
              selectedDurationMin: seed.durationMin,
              serviceId: seed.serviceId,
              contactId: seed.contactId,
              name: seed.customerName,
              phone: seed.customerPhone,
              searchQuery: seed.searchQuery,
              openRegistration: seed.openRegistration,
              vetMode,
              // Handoff do Quick é SEMPRE explícito: serviço vazio continua
              // vazio; o formulário completo não aplica o fallback de célula.
              allowSingleEligibleServicePrefill: false,
            });
          }}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          open
          onClose={closeCtxMenu}
          point={ctxMenu.point}
          items={ctxItems}
          label="Ações do atendimento"
          returnFocus={ctxMenu.trigger}
          header={(() => {
            const b = bookingsRef.current.get(ctxMenu.id);
            if (!b) return null;
            return (
              <>
                <strong>{b.petName || b.customerName}</strong>
                <span>{formatDateBR(b.date)} · {b.time}–{minToTime(timeToMin(b.time) + durationOf(b))}</span>
              </>
            );
          })()}
        />
      )}
      {cancelPending && (
        <ConfirmDialog
          pending={cancelPending}
          onContinue={() => { const pending = cancelPending; setCancelPending(null); pending?.proceed(); }}
          onDiscard={() => { const pending = cancelPending; setCancelPending(null); pending?.discard?.(); }}
        />
      )}
      {ctxSuccess && (
        <div className="ag-ctx-success" role="status">
          <Icon n="check" size={14} />
          <span>{ctxSuccess}</span>
          <button type="button" onClick={() => setCtxSuccess('')} aria-label="Fechar aviso"><Icon n="x" size={13} /></button>
        </div>
      )}
      {ctxError && (
        <div className="ag-ctx-error" role="alert">
          <Icon n="alert" size={14} />
          <span>{ctxError}</span>
          <button type="button" onClick={() => setCtxError('')} aria-label="Fechar aviso"><Icon n="x" size={13} /></button>
        </div>
      )}
      {detail && (
        <BookingDetailSheet
          booking={detail}
          returnFocus={detailTriggerRef}
          startRescheduling={detailReschedule}
          timezone={bizTz}
          service={serviceOf(detail.serviceId)}
          resources={scheduleResources}
          pro={detail.professionalId ? pros.find((p) => p.id === detail.professionalId) : undefined}
          businessId={businessId}
          onClose={() => { setDetail(null); setDetailReschedule(false); }}
          /* Mudança estrutural (status/finalizar): atualiza dados, mantém
             sheets abertos — o fechamento é só onClose (ação do usuário). */
          onChanged={() => { void load(); }}
        />
      )}


      {editBooking && (
        <BookingEditDialog
          booking={editBooking}
          businessId={businessId}
          services={services}
          pros={pros}
          timezone={bizTz}
          returnFocus={detailTriggerRef}
          onClose={() => setEditBooking(null)}
          onChanged={() => { void load(); }}
        />
      )}

      {creating && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={horizonDays}
          timezone={bizTz}
          quick={creating.quick}
          initial={{
            name: creating.name || '', phone: creating.phone || '',
            contactId: creating.contactId, serviceId: creating.serviceId,
            searchQuery: creating.searchQuery,
            openRegistration: creating.openRegistration,
            vetMode: creating.vetMode,
            allowSingleEligibleServicePrefill: creating.allowSingleEligibleServicePrefill,
            date: creating.date || focus,
            time: creating.time,
            professionalId: creating.professionalId,
            selectedDurationMin: creating.selectedDurationMin,
            petId: creating.petId,
            note: creating.note,
          }}
          onClose={() => { setCreating(null); setSelectedRange(null); }}
          onCreated={() => { setSelectedRange(null); void load(); }}
        />
      )}
    </div>
  );
}
