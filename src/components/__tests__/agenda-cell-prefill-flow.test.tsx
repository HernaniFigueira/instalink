// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// AGENDA (modo DIA) → NOVO AGENDAMENTO · CONTEXTO REAL DA CÉLULA
// ═══════════════════════════════════════════════════════════════
// Este arquivo existe porque a versão anterior PASSAVA e o browser continuava
// quebrado. O catálogo daquele teste era irreal: todo serviço aceitava todos
// os profissionais, então `eligiblePros.length > 1` e o campo "Profissional"
// aparecia — situação que NÃO EXISTE no catálogo real (clinicavitta), onde
// cada serviço está ligado a UM profissional (`professionalIds`) e o campo nem
// é renderizado. Além disso, o teste inferia o seed pelo DOM em vez de provar
// as PROPS recebidas pelo NewBookingSheet.
//
// Aqui o fluxo é o REAL e o catálogo é o REAL:
//   AgendaPage (Dia, colunas por profissional)
//     → click numa coordenada vertical conhecida (rect medido)
//     → GridColumn → minuteFromOffsetY → newBookingSeedFromAgendaCell
//     → setCreating → NewBookingSheet(initial)  [PROPS ESPIADAS]
//     → serviço / slots / preservação
//
// Provas exigidas:
//   1. o seed recebido contém date + time + professionalId;
//   2. a intenção é preservada (e aparece no fluxo);
//   3. profissional elegível fica; inelegível sai, mantendo as opções válidas;
//   4. serviço só é pré-escolhido quando existe EXATAMENTE UM elegível;
//   5. Semana não inventa profissional;
//   6. nenhum booking é criado automaticamente.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { addDaysISO, todayISO } from '@/lib/tz';

const PX_PER_HOUR = 128;
const COL_RECT_TOP = 312;
const COL_RECT_HEIGHT = 12 * PX_PER_HOUR;
const COL_RECT_WIDTH = 400;

const BUSINESS = 'biz-clinica';
// Catálogo REAL (padrão clinicavitta): 1 serviço ↔ 1 profissional.
const ORLANDO = 'pro-orlando';
const MICHELLE = 'pro-michelle';
const HERNANI = 'pro-hernani';
const SVC_ODONTO = 'svc-odonto';   // só Orlando  → Orlando tem 1 elegível
const SVC_CARDIO = 'svc-cardio';   // só Hernani  → Hernani tem 1 elegível
const SVC_ESTETICA = 'svc-estetica'; // só Michelle
const SVC_LIMPEZA = 'svc-limpeza';   // só Michelle → Michelle tem 2 elegíveis
const SVC_INATIVO = 'svc-inativo';   // inativo/não agendável: nunca conta

const TZ = 'America/Sao_Paulo';
const DATE = addDaysISO(todayISO(new Date(), TZ), 2);

// ── next/navigation ──────────────────────────────────────────────────────
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    emit() { listeners.forEach((f) => f()); },
    snapshot: () => (typeof window === 'undefined' ? '' : window.location.search),
  };
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(nav.subscribe, nav.snapshot, () => '')),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/agenda',
}));

// ── ESPiÃO do NewBookingSheet: prova as PROPS (não o DOM) ─────────────────
const spy = vi.hoisted(() => ({ props: [] as any[] }));
vi.mock('@/components/dashboard/NewBookingSheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/dashboard/NewBookingSheet')>();
  return {
    ...actual,
    NewBookingSheet: (props: any) => {
      spy.props.push(props);
      return actual.NewBookingSheet(props);
    },
  };
});

const FIXTURE = vi.hoisted(() => {
  const defaults = () => ({
    services: [
      { id: 'svc-odonto', businessId: 'biz-clinica', name: 'Consulta Odontológica', durationMin: 60, price: 0, active: true, bookable: true, professionalIds: ['pro-orlando'] },
      { id: 'svc-cardio', businessId: 'biz-clinica', name: 'Consulta Cardiológica', durationMin: 45, price: 0, active: true, bookable: true, professionalIds: ['pro-hernani'] },
      { id: 'svc-estetica', businessId: 'biz-clinica', name: 'Estética', durationMin: 30, price: 0, active: true, bookable: true, professionalIds: ['pro-michelle'] },
      { id: 'svc-limpeza', businessId: 'biz-clinica', name: 'Limpeza de pele', durationMin: 30, price: 0, active: true, bookable: true, professionalIds: ['pro-michelle'] },
      { id: 'svc-inativo', businessId: 'biz-clinica', name: 'Serviço inativo', durationMin: 30, price: 0, active: false, bookable: false, professionalIds: ['pro-michelle'] },
    ],
    professionals: [
      { id: 'pro-orlando', businessId: 'biz-clinica', name: 'Orlando', role: 'Dentista', photo: '', active: true, createdAt: '2026-01-01' },
      { id: 'pro-michelle', businessId: 'biz-clinica', name: 'Michelle', role: 'Esteticista', photo: '', active: true, createdAt: '2026-01-01' },
      { id: 'pro-hernani', businessId: 'biz-clinica', name: 'Hernani', role: 'Cardiologista', photo: '', active: true, createdAt: '2026-01-01' },
    ],
    // Regras POR PROFISSIONAL (como no catálogo real).
    availability: Array.from({ length: 7 }, (_, wd) => [
      { id: `av-o-${wd}`, businessId: 'biz-clinica', professionalId: 'pro-orlando', serviceId: '', weekday: wd, start: '09:00', end: '18:00', slotMin: 30 },
      { id: `av-m-${wd}`, businessId: 'biz-clinica', professionalId: 'pro-michelle', serviceId: '', weekday: wd, start: '09:00', end: '18:00', slotMin: 30 },
      { id: `av-h-${wd}`, businessId: 'biz-clinica', professionalId: 'pro-hernani', serviceId: '', weekday: wd, start: '09:00', end: '18:00', slotMin: 30 },
    ]).flat(),
    exceptions: [] as any[],
    bookings: [] as any[],
  });
  const state = defaults();
  return {
    state,
    reset() {
      const d = defaults();
      state.services = d.services;
      state.professionals = d.professionals;
      state.availability = d.availability;
      state.exceptions = d.exceptions;
      state.bookings = d.bookings;
    },
  };
});

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.includes('/api/catalog/get')) {
      return {
        ok: true, status: 200,
        data: {
          services: FIXTURE.state.services, professionals: FIXTURE.state.professionals,
          availability: FIXTURE.state.availability, exceptions: FIXTURE.state.exceptions,
          business: {
            booking: { leadMin: 0, bufferMin: 0, horizonDays: 60, teamMode: 'team', cancelUntilMin: 60 },
            businessTimezone: 'America/Sao_Paulo',
          },
        },
      };
    }
    if (url.includes('/api/bookings')) return { ok: true, status: 200, data: { bookings: FIXTURE.state.bookings } };
    if (url.includes('/api/queue')) return { ok: true, status: 200, data: { entries: [], done: [] } };
    return { ok: true, status: 200, data: {} };
  }),
  apiSend: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
}));
vi.mock('@/components/dashboard/usePanelPermissions', () => ({
  usePanelPermissions: () => ({ permissions: { clientes: true, atendimento: true }, role: 'OWNER', ready: true }),
}));
vi.mock('@/components/dashboard/use-revalidate', () => ({ useRevalidateOnFocus: () => {} }));

import AgendaPage from '@/app/(dashboard)/agenda/page';

const slotsApi = vi.hoisted(() => ({
  slots: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'],
  calls: [] as string[],
  posts: 0,
}));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*1280px/.test(query),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  const orig = window.history.pushState.bind(window.history);
  window.history.pushState = (state: unknown, title: string, url?: string | URL | null) => {
    orig(state, title, url as string);
    nav.emit();
  };
});

beforeEach(() => {
  document.body.innerHTML = '';
  FIXTURE.reset();
  spy.props.length = 0;
  slotsApi.slots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
  slotsApi.calls = [];
  slotsApi.posts = 0;
  global.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (init?.method === 'POST') slotsApi.posts += 1;
    if (url.includes('mode=slots-admin')) slotsApi.calls.push(url);
    if (url.includes('mode=slots-admin')) {
      return {
        ok: true, status: 200,
        json: async () => ({ slots: slotsApi.slots, state: 'open', full: false, closed: false }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(cleanup);

// ── helpers de geometria REAL (nada de chutar constantes) ─────────────────
function gridColumn(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`coluna da grade não encontrada: ${selector}`);
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0, y: COL_RECT_TOP, top: COL_RECT_TOP, left: 0, right: COL_RECT_WIDTH,
      bottom: COL_RECT_TOP + COL_RECT_HEIGHT, width: COL_RECT_WIDTH, height: COL_RECT_HEIGHT,
      toJSON: () => ({}),
    }) as DOMRect,
  });
  return el;
}

/** Primeiro rótulo do gutter de horas = início real da grade (medido do DOM). */
function gridStartMinute(): number {
  const first = Array.from(document.querySelectorAll('span'))
    .map((el) => el.textContent?.trim() || '')
    .find((t) => /^\d{2}:\d{2}$/.test(t));
  if (!first) throw new Error('gutter de horas não encontrado');
  const [h, m] = first.split(':').map(Number);
  return h * 60 + m;
}

function clientYFor(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return COL_RECT_TOP + (((h * 60 + m) - gridStartMinute()) / 60) * PX_PER_HOUR;
}

async function renderAgenda(search = `?b=${BUSINESS}&view=day&data=${DATE}`) {
  window.history.replaceState(null, '', `/agenda${search}`);
  render(<AgendaPage />);
  // Na SEMANA as colunas são dias (não profissionais): esperar por coluna.
  await waitFor(() => expect(document.querySelector('[data-agenda-column]')).toBeTruthy(), { timeout: 5000 });
}

/** Clique REAL numa coordenada vertical conhecida da coluna. */
async function clickEmptyCell(professionalId: string, time: string) {
  // Respect the grid's post-drag click suppression between independently mounted test cases.
  await new Promise(resolve => setTimeout(resolve, 510));
  const start = gridStartMinute();
  const col = gridColumn(`[data-agenda-column-professional="${professionalId}"]`);
  fireEvent.click(col, { clientX: 120, clientY: clientYFor(time) });
  await waitFor(() => expect(document.querySelector('dialog.il-drawer')).toBeTruthy(), { timeout: 5000 });
  return start;
}

const sheet = () => document.querySelector<HTMLElement>('dialog.il-drawer')!;
const dateInput = () => within(sheet()).getByLabelText(/^3\. Data/) as HTMLInputElement;
const serviceSelect = () => within(sheet()).getByLabelText(/^2\. Serviço/) as HTMLSelectElement;
const proSelect = () => within(sheet()).queryByLabelText(/^Profissional/) as HTMLSelectElement | null;
const slotButton = (time: string) =>
  (Array.from(sheet().querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === time && b.className.includes('il-option-choice')) as HTMLElement) || null;
/** Últimas props entregues ao NewBookingSheet (o seed do clique). */
const seed = () => spy.props[spy.props.length - 1];

// ═════════════════════════════════════════════════════════════════════════
describe('1 · o clique entrega date + time + professionalId ao NewBookingSheet', () => {
  it('clique na coluna do Hernani às 10:00 entrega o trio completo (prova por PROPS)', async () => {
    await renderAgenda();
    await clickEmptyCell(HERNANI, '10:00');

    // PROVA: o seed recebido pelo componente, não inferência pelo DOM.
    expect(seed().initial).toMatchObject({
      date: DATE,
      time: '10:00',
      professionalId: HERNANI,
    });
    // E o campo de data reflete a data da coluna.
    expect(dateInput().value).toBe(DATE);
  });

  it('o horário vem da posição vertical (snap de 15 min, medido na grade real)', async () => {
    await renderAgenda();
    const start = gridStartMinute();
    const col = gridColumn(`[data-agenda-column-professional="${ORLANDO}"]`);
    // 07 minutos após 10:00 → snap para 10:00.
    const [h, m] = '10:00'.split(':').map(Number);
    const y = COL_RECT_TOP + (((h * 60 + m + 7) - start) / 60) * PX_PER_HOUR;
    fireEvent.click(col, { clientX: 120, clientY: y });
    await waitFor(() => expect(document.querySelector('dialog.il-drawer')).toBeTruthy(), { timeout: 5000 });
    expect(seed().initial.time).toBe('10:00');
  });

  it('cada coluna entrega o SEU profissional', async () => {
    await renderAgenda();
    await clickEmptyCell(MICHELLE, '11:00');
    expect(seed().initial.professionalId).toBe(MICHELLE);
    expect(seed().initial.time).toBe('11:00');
  });

  it('o clique é só prefill: nenhum booking é criado', async () => {
    await renderAgenda();
    await clickEmptyCell(HERNANI, '10:00');
    await waitFor(() => expect(slotButton('10:00')).toBeTruthy());
    expect(slotsApi.posts).toBe(0);
    expect(document.querySelector('[data-booking-created="true"]')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('2–3 · a intenção é preservada: serviço único, profissional elegível e horário válido', () => {
  it('Hernani tem EXATAMENTE UM serviço elegível → entra pré-selecionado e o horário aparece', async () => {
    await renderAgenda();
    await clickEmptyCell(HERNANI, '10:00');

    // catálogo real: svc-cardio é o único de Hernani (o inativo não conta).
    expect(serviceSelect().value).toBe(SVC_CARDIO);
    // Com serviço escolhido o bloco de horários existe e a intenção aparece.
    await waitFor(() => expect(slotButton('10:00')).toBeTruthy());
    expect(slotButton('10:00')!.getAttribute('aria-pressed')).toBe('true');
    // A disponibilidade é consultada para o profissional da coluna.
    expect(slotsApi.calls.some((u) => u.includes(`serviceId=${SVC_CARDIO}`) && u.includes(`professionalId=${HERNANI}`))).toBe(true);
    expect(dateInput().value).toBe(DATE);
    expect(slotsApi.posts).toBe(0);
  });

  it('Orlando (1 elegível) também abre com o serviço e a hora já visíveis', async () => {
    await renderAgenda();
    await clickEmptyCell(ORLANDO, '09:30');
    expect(serviceSelect().value).toBe(SVC_ODONTO);
    await waitFor(() => expect(slotButton('09:30')).toBeTruthy());
    expect(slotButton('09:30')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('o formulário NÃO nasce sujo por causa do prefill (abrir e fechar não pede confirmação)', async () => {
    await renderAgenda();
    await clickEmptyCell(HERNANI, '10:00');
    await waitFor(() => expect(slotButton('10:00')).toBeTruthy());
    fireEvent.click(sheet().querySelector('[aria-hidden="true"]')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('4 · serviço só é pré-escolhido com EXATAMENTE UM elegível (sem vínculo textual)', () => {
  it('Michelle tem DOIS elegíveis → serviço fica sem seleção', async () => {
    await renderAgenda();
    await clickEmptyCell(MICHELLE, '11:00');

    expect(seed().initial.professionalId).toBe(MICHELLE);
    expect(serviceSelect().value).toBe('');
    // Sem serviço, o bloco de horários ainda não aparece (comportamento atual).
    expect(screen.queryByText(/Carregando horários/)).toBeNull();

    // Escolhendo um serviço elegível, profissional E horário permanecem.
    await userEvent.selectOptions(serviceSelect(), SVC_ESTETICA);
    await waitFor(() => expect(slotButton('11:00')).toBeTruthy());
    expect(slotButton('11:00')!.getAttribute('aria-pressed')).toBe('true');
    expect(slotsApi.calls.some((u) => u.includes(`serviceId=${SVC_ESTETICA}`) && u.includes(`professionalId=${MICHELLE}`))).toBe(true);
    expect(dateInput().value).toBe(DATE);
    expect(slotsApi.posts).toBe(0);
  });

  it('serviço inativo/desativado NÃO é considerado elegível', async () => {
    await renderAgenda();
    await clickEmptyCell(MICHELLE, '11:00');
    const options = Array.from(serviceSelect().options).map((o) => o.value);
    // svc-inativo existe no catálogo mas não é agendável: não conta como
    // elegível (senão Michelle teria 3 e, se contasse, poderia ser escolhido).
    expect(options).not.toContain(SVC_INATIVO);
    expect(options).toContain(SVC_ESTETICA);
    expect(options).toContain(SVC_LIMPEZA);
    expect(options).toContain(SVC_CARDIO);
  });

  it('com UM ÚNICO serviço sem vínculo no catálogo, ele entra pré-selecionado', async () => {
    // Serviço sem `professionalIds` aceita todos — e, sendo o único agendável,
    // é o elegível único de qualquer coluna (conveniência, não palpite).
    FIXTURE.state.services = [
      { id: 'svc-unico', businessId: 'biz-clinica', name: 'Atendimento', durationMin: 30, price: 0, active: true, bookable: true, professionalIds: [] },
    ];
    await renderAgenda();
    await clickEmptyCell(HERNANI, '10:00');
    expect(serviceSelect().value).toBe('svc-unico');
    await waitFor(() => expect(slotButton('10:00')).toBeTruthy());
    expect(slotButton('10:00')!.getAttribute('aria-pressed')).toBe('true');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('3 · combinação inválida: preserva intenção e exige decisão explícita', () => {
  it('serviço incompatível: mantém Michelle, avisa, não consulta combinação inválida; usuário escolhe outro', async () => {
    await renderAgenda();
    await clickEmptyCell(MICHELLE, '11:00');
    // svc-cardio é só do Hernani.
    await userEvent.selectOptions(serviceSelect(), SVC_CARDIO);

    expect(await screen.findByText(/Michelle não realiza este serviço/)).toBeTruthy();
    expect(proSelect()!.value).toBe(MICHELLE);
    expect(slotsApi.calls.some((u) => u.includes(SVC_CARDIO) && u.includes(`professionalId=${MICHELLE}`))).toBe(false);
    expect(screen.getByTestId('booking-range-summary').textContent).toContain('Início: 11:00');
    await userEvent.selectOptions(proSelect()!, HERNANI);
    await waitFor(() => expect(slotButton('11:00')).toBeTruthy());
    expect(slotButton('11:00')!.getAttribute('aria-pressed')).toBe('true');
    expect(dateInput().value).toBe(DATE);
    expect(slotsApi.posts).toBe(0);
  });

  it('horário indisponível permanece no resumo com motivo e opções válidas, nunca reserva silenciosa', async () => {
    slotsApi.slots = ['14:00', '14:30'];
    await renderAgenda();
    await clickEmptyCell(HERNANI, '10:00');
    await waitFor(() => expect(slotButton('14:00')).toBeTruthy());
    expect(slotButton('10:00')).toBeNull();
    expect(screen.getByTestId('booking-range-summary').textContent).toContain('Início: 10:00');
    expect(screen.getByText(/Este profissional não está disponível neste intervalo/)).toBeTruthy();
    expect(slotsApi.posts).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('5 · Semana: coluna é dia — não inventa profissional', () => {
  it('clique na coluna do dia entrega data + hora e NENHUM profissional', async () => {
    await renderAgenda(`?b=${BUSINESS}&view=week&data=${DATE}`);
    await waitFor(
      () => expect(document.querySelector(`[data-agenda-column-date="${DATE}"]`)).toBeTruthy(),
      { timeout: 5000 },
    );
    const col = gridColumn(`[data-agenda-column-date="${DATE}"]`);
    fireEvent.click(col, { clientX: 40, clientY: clientYFor('10:30') });
    await waitFor(() => expect(document.querySelector('dialog.il-drawer')).toBeTruthy(), { timeout: 5000 });

    expect(seed().initial.date).toBe(DATE);
    expect(seed().initial.time).toBe('10:30');
    expect(seed().initial.professionalId).toBe('');
    // Sem profissional, não há pré-seleção de serviço.
    expect(serviceSelect().value).toBe('');
  });
});

// Clinical UX Closure: pointer range is authoritative, not a +60 suggestion.
describe('Clinical UX Closure — range and block mode', () => {
  function pointerRange(proId: string, start: string, end: string) {
    const col = gridColumn(`[data-agenda-column-professional="${proId}"]`);
    col.setPointerCapture = () => {};
    const dispatch = (type: string, time: string) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 120, clientY: clientYFor(time) });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      fireEvent(col, event);
    };
    dispatch('pointerdown', start); dispatch('pointermove', end); dispatch('pointerup', end);
  }

  it('09:00–13:00 opens directly, carries 240, persists selection until close; duration advanced', async () => {
    await renderAgenda();
    pointerRange(ORLANDO, '09:00', '13:00');
    await waitFor(() => expect(seed()?.initial.selectedDurationMin).toBe(240));
    expect(seed().initial).toMatchObject({ time: '09:00', date: DATE, professionalId: ORLANDO });
    expect(screen.getByTestId('booking-range-summary').textContent).toContain('Fim: 13:00 · Duração: 240 min');
    expect(screen.getByTestId('agenda-selected-range').textContent).toBe('09:00–13:00');
    const duration = within(sheet()).getByLabelText('Duração deste atendimento em minutos') as HTMLInputElement;
    expect(duration.value).toBe('240');
    expect(duration.closest('details')?.open).toBe(false);
    expect(within(sheet()).getByRole('searchbox', { name: 'Buscar cliente' }).getAttribute('autocomplete')).toBe('off');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByTestId('agenda-selected-range')).toBeNull());
  });

  it('block mode retains 09:00–13:00, professional and range; cancel exits mode', async () => {
    await renderAgenda();
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear horário' }));
    pointerRange(ORLANDO, '09:00', '13:00');
    await screen.findByText('Intervalo operacional (não cria paciente nem atendimento).');
    expect((screen.getByLabelText('Início') as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByLabelText('Fim') as HTMLInputElement).value).toBe('13:00');
    expect((screen.getByLabelText('Profissional') as HTMLSelectElement).value).toBe(ORLANDO);
    expect(screen.getByTestId('agenda-selected-range').textContent).toBe('09:00–13:00');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByTestId('agenda-selected-range')).toBeNull());
    expect(screen.queryByText('Selecione o intervalo que deseja bloquear')).toBeNull();
  });
});

describe('Final pré-F1 intent preservation', () => {
  it('switching between two eligible services keeps Michelle and 11:00',async()=>{
    await renderAgenda(); await clickEmptyCell(MICHELLE,'11:00');
    await userEvent.selectOptions(serviceSelect(),SVC_ESTETICA);
    await waitFor(()=>expect(slotButton('11:00')).toBeTruthy());
    await userEvent.selectOptions(serviceSelect(),SVC_LIMPEZA);
    await waitFor(()=>expect(slotsApi.calls.some(u=>u.includes(SVC_LIMPEZA)&&u.includes(MICHELLE))).toBe(true));
    expect(proSelect()!.value).toBe(MICHELLE);
    expect(slotButton('11:00')!.getAttribute('aria-pressed')).toBe('true');
  });
  it('past intent stays visible and explains the interval has passed',async()=>{
    await renderAgenda(`?b=${BUSINESS}&view=day&data=2026-01-01`);await clickEmptyCell(HERNANI,'10:00');
    expect(screen.getByText('Esse intervalo já passou. Escolha um horário futuro.')).toBeTruthy();
    expect(screen.getByTestId('booking-range-summary').textContent).toContain('Início: 10:00');
    expect(screen.queryByText('Escolha serviço, data e horário.')).toBeNull();
  });
});
