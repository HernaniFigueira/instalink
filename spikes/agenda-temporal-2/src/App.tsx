import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
const ExistingGridAdapter = lazy(() => import('./adapters/ExistingGridAdapter'));
const ReactBigCalendarAdapter = lazy(() => import('./adapters/ReactBigCalendarAdapter'));
const FullCalendarAdapter = lazy(() => import('./adapters/FullCalendarAdapter'));
const ScheduleXAdapter = lazy(() => import('./adapters/ScheduleXAdapter'));
import type { CalendarAdapterProps } from './adapters/types';
import {
  eventPresentation,
  instantToLocalDateTime,
  resizeToDuration,
  selectWindow,
  viewForViewport,
  type AppointmentWindow,
  type CalendarView,
} from './domain/temporal-contract';
import {
  benchmarkEvents,
  DEMO_TIME_ZONE,
  DEMO_WEEK_START,
  demoEvents,
  eventLocalStart,
  PROFESSIONALS,
  SERVICES,
  type SpikeEvent,
} from './domain/fixtures';

export type CalendarCandidate = 'grid' | 'rbc' | 'fullcalendar' | 'schedule-x';

const CANDIDATES: Array<{ id: CalendarCandidate; label: string; hint: string }> = [
  { id: 'grid', label: 'Grade atual', hint: 'implementação própria' },
  { id: 'rbc', label: 'React Big Calendar', hint: 'MIT' },
  { id: 'fullcalendar', label: 'FullCalendar Standard', hint: 'MIT' },
  { id: 'schedule-x', label: 'Schedule-X Community', hint: 'MIT · sem Premium' },
];

const ADAPTERS: Record<CalendarCandidate, ComponentType<CalendarAdapterProps>> = {
  grid: ExistingGridAdapter,
  rbc: ReactBigCalendarAdapter,
  fullcalendar: FullCalendarAdapter,
  'schedule-x': ScheduleXAdapter,
};

type DraftWindow = AppointmentWindow & { professionalId?: string; serviceId: string };
type RenderMetric = { candidate: CalendarCandidate; eventCount: number; elapsedMs: number; generatedMs?: number };

function addCivilDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function formatDateRange(date: string, view: CalendarView): string {
  if (view !== 'week') return formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const end = addCivilDays(date, 6);
  const first = formatDate(date, { day: '2-digit', month: 'short' });
  const last = formatDate(end, { day: '2-digit', month: 'short', year: 'numeric' });
  return `${first} — ${last}`;
}

function windowFor(event: SpikeEvent): AppointmentWindow {
  return {
    startAt: event.startAt,
    endAt: event.endAt,
    durationMin: event.durationMin,
    timeZone: event.timeZone,
  };
}

function firstServiceForDuration(durationMin: number): string {
  return SERVICES.find((service) => service.durationMin === durationMin)?.id || SERVICES[0]!.id;
}

function statusTone(status: SpikeEvent['status']): string {
  return {
    pending: 'sp-status-pill--pending',
    confirmed: 'sp-status-pill--confirmed',
    cancelled: 'sp-status-pill--cancelled',
    completed: 'sp-status-pill--completed',
    no_show: 'sp-status-pill--no-show',
  }[status];
}

function AdapterPaintMarker({ onPaint }: { onPaint: () => void }) {
  useLayoutEffect(() => {
    let afterPaintFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      afterPaintFrame = requestAnimationFrame(onPaint);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(afterPaintFrame);
    };
  }, [onPaint]);
  return null;
}

export default function App() {
  const [candidate, setCandidate] = useState<CalendarCandidate>('grid');
  const [view, setView] = useState<CalendarView>(() =>
    typeof window === 'undefined' ? 'day' : viewForViewport(window.innerWidth, 'day'),
  );
  const [focusDate, setFocusDate] = useState(DEMO_WEEK_START);
  const [professionalFilter, setProfessionalFilter] = useState('');
  const [eventCount, setEventCount] = useState(7);
  const [events, setEvents] = useState<SpikeEvent[]>(() => demoEvents());
  const [draft, setDraft] = useState<DraftWindow | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [pendingEventId, setPendingEventId] = useState('');
  const [notice, setNotice] = useState('Dados fictícios · alterações validadas apenas no servidor efêmero deste spike.');
  const [lastRender, setLastRender] = useState<RenderMetric | null>(null);
  const [lastServerMs, setLastServerMs] = useState<number | null>(null);
  const [measureSequence, setMeasureSequence] = useState(0);
  const renderStartRef = useRef<{ startedAt: number; generatedMs?: number } | null>(null);

  const visibleEventCount = useMemo(() => events.filter((event) =>
    !professionalFilter || event.professionalId === professionalFilter,
  ).length, [events, professionalFilter]);
  const selectedEvent = events.find((event) => event.id === selectedEventId) || null;
  const Adapter = ADAPTERS[candidate];

  useEffect(() => {
    function updateResponsiveView() {
      if (window.innerWidth <= 600) setView('list');
    }
    updateResponsiveView();
    window.addEventListener('resize', updateResponsiveView);
    return () => window.removeEventListener('resize', updateResponsiveView);
  }, []);

  const finishAdapterPaint = useCallback(() => {
    const pending = renderStartRef.current;
    if (!pending) return;
    setLastRender({
      candidate,
      eventCount,
      elapsedMs: performance.now() - pending.startedAt,
      ...(pending.generatedMs === undefined ? {} : { generatedMs: pending.generatedMs }),
    });
    renderStartRef.current = null;
  }, [candidate, eventCount]);

  function markRenderStart(generatedMs?: number) {
    renderStartRef.current = { startedAt: performance.now(), ...(generatedMs === undefined ? {} : { generatedMs }) };
    setMeasureSequence((sequence) => sequence + 1);
  }

  function chooseCandidate(next: CalendarCandidate) {
    if (next === candidate) return;
    markRenderStart();
    setCandidate(next);
    setDraft(null);
    setSelectedEventId(null);
    setNotice(`Adapter ${CANDIDATES.find((item) => item.id === next)?.label} ativo; contrato e fixtures permanecem os mesmos.`);
  }

  function chooseWorkload(nextCount: number) {
    if (nextCount === eventCount) return;
    const startedAt = performance.now();
    const nextEvents = nextCount === 7 ? demoEvents() : benchmarkEvents(nextCount);
    const generatedMs = performance.now() - startedAt;
    markRenderStart(generatedMs);
    setEventCount(nextCount);
    setEvents(nextEvents);
    setDraft(null);
    setSelectedEventId(null);
    setNotice(`Carga redefinida: ${nextCount} eventos em 5 profissionais, sem gravar no produto.`);
    void fetch('/__agenda_temporal_spike/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventCount: nextCount }),
    }).catch(() => setNotice('Não foi possível reiniciar o servidor de demonstração.'));
  }

  function handleViewChange(nextView: CalendarView) {
    if (nextView === view) return;
    markRenderStart();
    setView(nextView);
    setDraft(null);
    setSelectedEventId(null);
  }

  function navigateDate(direction: -1 | 1) {
    const jump = view === 'week' ? 7 : 1;
    markRenderStart();
    setFocusDate((date) => addCivilDays(date, jump * direction));
    setDraft(null);
    setSelectedEventId(null);
  }

  function selectEvent(eventId: string) {
    markRenderStart();
    setSelectedEventId(eventId);
    setDraft(null);
  }

  function selectRange(startAt: string, endAt: string, professionalId?: string) {
    try {
      markRenderStart();
      const selected = selectWindow(startAt, endAt, DEMO_TIME_ZONE, 5);
      setDraft({ ...selected, professionalId, serviceId: firstServiceForDuration(selected.durationMin) });
      setSelectedEventId(null);
      setNotice(`Horário selecionado: ${instantToLocalDateTime(selected.startAt, DEMO_TIME_ZONE).time}–${instantToLocalDateTime(selected.endAt, DEMO_TIME_ZONE).time}. Duração sugerida editável.`);
    } catch {
      setNotice('Selecione um intervalo válido de pelo menos 5 minutos.');
    }
  }

  function setDraftDuration(durationMin: number) {
    if (!draft || !Number.isFinite(durationMin) || durationMin < 5) return;
    try {
      markRenderStart();
      const next = resizeToDuration(draft, durationMin, 5);
      setDraft({ ...draft, ...next });
    } catch {
      setNotice('A duração precisa ser maior que zero.');
    }
  }

  function setDraftService(serviceId: string) {
    const service = SERVICES.find((item) => item.id === serviceId);
    if (!draft || !service) return;
    markRenderStart();
    const next = resizeToDuration(draft, service.durationMin, 5);
    setDraft({ ...draft, ...next, serviceId });
  }

  async function mutateEvent(eventId: string, action: 'move' | 'resize', next: AppointmentWindow): Promise<boolean> {
    const current = events.find((event) => event.id === eventId);
    if (!current || pendingEventId) return false;
    const currentWindow = windowFor(current);
    const optimistic = { ...current, ...next };
    const startedAt = performance.now();
    markRenderStart();
    setPendingEventId(eventId);
    setEvents((previous) => previous.map((event) => event.id === eventId ? optimistic : event));
    setNotice(action === 'move' ? 'Validando novo horário no servidor de demonstração…' : 'Validando nova duração no servidor de demonstração…');
    try {
      const response = await fetch('/__agenda_temporal_spike/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, eventId, current: currentWindow, next, eventCount }),
      });
      const result = await response.json() as { ok: boolean; event?: SpikeEvent; message: string };
      if (!response.ok || !result.ok || !result.event) {
        markRenderStart();
        setEvents((previous) => previous.map((event) => event.id === eventId ? current : event));
        setNotice(result.message || 'O servidor rejeitou a alteração; horário original restaurado.');
        setLastServerMs(performance.now() - startedAt);
        return false;
      }
      markRenderStart();
      setEvents((previous) => previous.map((event) => event.id === eventId ? result.event! : event));
      setNotice(result.message);
      setLastServerMs(performance.now() - startedAt);
      return true;
    } catch {
      markRenderStart();
      setEvents((previous) => previous.map((event) => event.id === eventId ? current : event));
      setNotice('Servidor de demonstração indisponível; horário original restaurado.');
      setLastServerMs(performance.now() - startedAt);
      return false;
    } finally {
      setPendingEventId('');
    }
  }

  function restoreDemo() {
    const initial = eventCount === 7 ? demoEvents() : benchmarkEvents(eventCount);
    markRenderStart();
    setEvents(initial);
    setDraft(null);
    setSelectedEventId(null);
    void fetch('/__agenda_temporal_spike/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventCount }),
    });
    setNotice('Agenda de demonstração restaurada.');
  }

  function makeAdapterProps(): CalendarAdapterProps {
    return {
      events,
      view,
      focusDate,
      professionalFilter,
      pendingEventId,
      eventCount,
      onSelectEvent: selectEvent,
      onSelectRange: selectRange,
      onMutation: mutateEvent,
      onNotice: setNotice,
    };
  }

  const adapterProps = makeAdapterProps();
  const draftStart = draft ? instantToLocalDateTime(draft.startAt, draft.timeZone) : null;
  const draftEnd = draft ? instantToLocalDateTime(draft.endAt, draft.timeZone) : null;
  const draftProfessional = draft?.professionalId ? PROFESSIONALS.find((pro) => pro.id === draft.professionalId) : null;

  return (
    <main className="sp-app" data-testid="agenda-temporal-spike">
      <header className="sp-topbar">
        <div className="sp-brand-lockup">
          <span className="sp-brand-mark" aria-hidden="true">i</span>
          <div>
            <strong>GoDoutor <span>· Agenda</span></strong>
            <small>Estudo de arquitetura temporal</small>
          </div>
        </div>
        <div className="sp-topbar-meta">
          <span className="sp-isolated-badge"><i /> Spike isolado</span>
          <span className="sp-timezone">{DEMO_TIME_ZONE}</span>
        </div>
      </header>

      <div className="sp-page-shell">
        <section className="sp-intro">
          <div>
            <p className="sp-eyebrow">AGENDA TEMPORAL 2.0 · ETAPA A</p>
            <h1>Compare a interação, sem tocar na agenda de produção.</h1>
            <p className="sp-intro-copy">Quatro adapters, um contrato independente de biblioteca e um servidor de demonstração. Nenhum dado é persistido.</p>
          </div>
          <div className="sp-intro-callout">
            <span className="sp-callout-icon" aria-hidden="true">↗</span>
            <span><strong>Regra de segurança</strong><small>move/resize só muda após confirmação do servidor</small></span>
          </div>
        </section>

        <nav className="sp-candidate-tabs" aria-label="Comparar calendário" data-testid="candidate-tabs">
          {CANDIDATES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sp-candidate-tab ${candidate === item.id ? 'is-active' : ''}`}
              aria-pressed={candidate === item.id}
              onClick={() => chooseCandidate(item.id)}
              data-testid={`candidate-${item.id}`}
            >
              <strong>{item.label}</strong><span>{item.hint}</span>
            </button>
          ))}
        </nav>

        <section className="sp-workspace" aria-label="Agenda comparativa">
          <div className="sp-workspace-heading">
            <div>
              <div className="sp-kicker"><span className="sp-live-dot" /> UNIDADE DEMO · 5 PROFISSIONAIS</div>
              <h2>Agenda da clínica <span>· semana de demonstração</span></h2>
            </div>
            <button type="button" className="sp-button sp-button--quiet" onClick={restoreDemo} data-testid="reset-demo">Restaurar demo</button>
          </div>

          <div className="sp-toolbar" data-testid="calendar-toolbar">
            <div className="sp-date-navigation">
              <button className="sp-icon-button" type="button" aria-label="Período anterior" onClick={() => navigateDate(-1)}>‹</button>
              <button className="sp-button sp-button--today" type="button" onClick={() => { markRenderStart(); setFocusDate(DEMO_WEEK_START); }}>Hoje</button>
              <button className="sp-icon-button" type="button" aria-label="Próximo período" onClick={() => navigateDate(1)}>›</button>
              <strong className="sp-date-title" data-testid="date-title">{formatDateRange(focusDate, view)}</strong>
            </div>
            <div className="sp-toolbar-controls">
              <div className="sp-segmented" role="group" aria-label="Visualização">
                {(['day', 'week', 'list'] as CalendarView[]).map((choice) => (
                  <button key={choice} type="button" aria-pressed={view === choice} onClick={() => handleViewChange(choice)} data-testid={`view-${choice}`}>
                    {choice === 'day' ? 'Dia' : choice === 'week' ? 'Semana' : 'Lista'}
                  </button>
                ))}
              </div>
              <label className="sp-select-label">
                <span className="sp-sr-only">Profissional</span>
                <select value={professionalFilter} onChange={(event) => { markRenderStart(); setProfessionalFilter(event.target.value); }} aria-label="Filtrar por profissional" data-testid="professional-filter">
                  <option value="">Toda a equipe</option>
                  {PROFESSIONALS.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
                </select>
              </label>
              <label className="sp-select-label sp-load-select">
                <span className="sp-sr-only">Carga de benchmark</span>
                <select value={eventCount} onChange={(event) => chooseWorkload(Number(event.target.value))} aria-label="Carga de benchmark" data-testid="benchmark-workload">
                  <option value={7}>Demo · 7 eventos</option>
                  <option value={200}>Benchmark · 200 semanais</option>
                  <option value={1000}>Stress · 1000 eventos</option>
                </select>
              </label>
            </div>
          </div>

          <div className="sp-benchmark-strip" aria-label="Parâmetros do benchmark">
            <span><b>{visibleEventCount}</b> eventos visíveis</span>
            <span><b>5 min</b> snap visual</span>
            <span><b>40 min</b> Consulta clínica padrão</span>
            <span className="sp-benchmark-strip__right">Grade de 05:00 a 23:00 · fuso da clínica</span>
          </div>

          <div className="sp-content-layout">
            <section className="sp-calendar-column" aria-label="Calendário">
              <div className="sp-adapter-wrap" key={`${candidate}:${view}:${focusDate}:${professionalFilter}:${eventCount}`} data-testid="calendar-adapter">
                <Suspense fallback={<div className="sp-adapter-loading">Preparando o adapter de demonstração…</div>}>
                  <AdapterPaintMarker key={measureSequence} onPaint={finishAdapterPaint} />
                  <Adapter {...adapterProps} />
                </Suspense>
              </div>
            </section>

            <aside className="sp-detail-pane" aria-label="Detalhes e métricas" data-testid="detail-pane">
              {draft && draftStart && draftEnd ? (
                <div className="sp-detail-card sp-detail-card--draft">
                  <div className="sp-detail-card__heading">
                    <div><span className="sp-detail-icon sp-detail-icon--brand">＋</span><span><small>NOVO HORÁRIO</small><strong>Seleção rápida</strong></span></div>
                    <button type="button" className="sp-close-button" aria-label="Fechar seleção" onClick={() => setDraft(null)}>×</button>
                  </div>
                  <div className="sp-selected-window">
                    <strong>{formatDate(draftStart.date, { weekday: 'short', day: '2-digit', month: 'short' })}</strong>
                    <span>{draftStart.time}–{draftEnd.time}</span>
                    <small>{draftProfessional?.name || 'Profissional a validar'}</small>
                  </div>
                  <label className="sp-field-label" htmlFor="draft-service">Serviço</label>
                  <select id="draft-service" className="sp-control" value={draft.serviceId} onChange={(event) => setDraftService(event.target.value)}>
                    {SERVICES.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMin} min</option>)}
                  </select>
                  <label className="sp-field-label" htmlFor="draft-duration">Duração sugerida · editável</label>
                  <div className="sp-duration-control">
                    <input id="draft-duration" type="number" min={5} step={5} value={draft.durationMin} onChange={(event) => setDraftDuration(Number(event.target.value))} />
                    <span>minutos · passos de 5</span>
                  </div>
                  <div className="sp-inline-info"><span>i</span><p>Esta seleção é apenas uma intenção visual. Disponibilidade, serviço e conflito exigem validação real do servidor.</p></div>
                  <button className="sp-button sp-button--primary sp-button--full" type="button" onClick={() => setNotice('Rascunho de horário pronto. A criação/persistência está deliberadamente fora deste spike.')}>Pronto para criar</button>
                </div>
              ) : selectedEvent ? (
                <div className="sp-detail-card">
                  <div className="sp-detail-card__heading">
                    <div><span className="sp-detail-icon sp-detail-icon--blue">◷</span><span><small>AGENDAMENTO</small><strong>Detalhes</strong></span></div>
                    <button type="button" className="sp-close-button" aria-label="Fechar detalhes" onClick={() => setSelectedEventId(null)}>×</button>
                  </div>
                  <div className="sp-detail-person"><strong>{selectedEvent.customerName}</strong><span>{selectedEvent.serviceName}</span></div>
                  <span className={`sp-status-pill ${statusTone(selectedEvent.status)}`}>{eventPresentation({ customerName: selectedEvent.customerName, serviceName: selectedEvent.serviceName, status: selectedEvent.status }).statusLabel}</span>
                  <dl className="sp-detail-list">
                    <div><dt>Horário</dt><dd>{eventLocalStart(selectedEvent).time}–{instantToLocalDateTime(selectedEvent.endAt, selectedEvent.timeZone).time}</dd></div>
                    <div><dt>Profissional</dt><dd>{PROFESSIONALS.find((professional) => professional.id === selectedEvent.professionalId)?.name}</dd></div>
                    <div><dt>Duração congelada</dt><dd>{selectedEvent.durationMin} minutos</dd></div>
                    <div><dt>Serviço padrão</dt><dd>{SERVICES.find((service) => service.id === selectedEvent.serviceId)?.durationMin} min · somente novos agendamentos</dd></div>
                  </dl>
                  {selectedEvent.note && <p className="sp-detail-note">{selectedEvent.note}</p>}
                  <p className="sp-muted-note">Clique abre o detalhe; arrastar ou redimensionar passa pelo servidor de demonstração.</p>
                </div>
              ) : (
                <div className="sp-side-empty">
                  <span className="sp-empty-icon" aria-hidden="true">⌁</span>
                  <strong>Uma agenda mais simples</strong>
                  <p>Arraste no espaço livre para sugerir um horário, ou selecione um atendimento para abrir seus detalhes.</p>
                  <div className="sp-shortcut"><span>SELEÇÃO</span><b>10:00 → 10:40</b><small>Consulta clínica · 40 min</small></div>
                  <div className="sp-status-legend">
                    <span><i className="legend-blue" /> Confirmado</span>
                    <span><i className="legend-amber" /> Aguardando</span>
                    <span><i className="legend-green" /> Concluído</span>
                    <span><i className="legend-red" /> Não compareceu</span>
                    <span><i className="legend-slate" /> Cancelado</span>
                  </div>
                </div>
              )}

              <div className="sp-measure-card" aria-live="polite" data-testid="benchmark-metrics">
                <div className="sp-measure-card__heading"><strong>Observação local</strong><span>sem persistência</span></div>
                {lastRender ? (
                  <p><b>{lastRender.elapsedMs.toFixed(1)} ms</b> · adapter {lastRender.candidate} com {lastRender.eventCount} eventos{lastRender.generatedMs === undefined ? '' : ` · geração ${lastRender.generatedMs.toFixed(1)} ms`}</p>
                ) : <p>Troque 7 / 200 / 1000 eventos para medir o próximo paint do adapter.</p>}
                {lastServerMs !== null && <p>API mock · request/ack: <b>{lastServerMs.toFixed(1)} ms</b></p>}
                <small>Para scroll, seleção, drag e rerender, siga o roteiro de benchmark documentado.</small>
              </div>
            </aside>
          </div>

          <div className="sp-notice" role="status" aria-live="polite" data-testid="server-notice">
            <span className={pendingEventId ? 'sp-notice-spinner' : 'sp-notice-check'} aria-hidden="true">{pendingEventId ? '↻' : '✓'}</span>
            <span>{notice}</span>
            <span className="sp-notice-authority">{pendingEventId ? 'VALIDANDO' : 'DEMO'}</span>
          </div>
        </section>

        <footer className="sp-footnote">
          <span>Agenda Temporal 2.0 — SPIKE/ADR CONCLUÍDO / IMPLEMENTAÇÃO PENDENTE</span>
          <span>Booking / API de produção intocados · {DEMO_TIME_ZONE}</span>
        </footer>
      </div>
    </main>
  );
}
