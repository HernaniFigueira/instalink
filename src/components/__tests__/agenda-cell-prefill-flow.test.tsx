// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// AGENDA → NOVO AGENDAMENTO · PREFILL COMPLETO (data + hora + profissional)
// ═══════════════════════════════════════════════════════════════
// Este teste NÃO instancia o NewBookingSheet à mão com `initial` já pronto.
// Ele reproduz a INTERAÇÃO REAL da grade:
//
//   render da AgendaPage (dia, colunas por profissional)
//     → click/pointer numa célula vazia com geometria real (rect medido)
//     → cálculo da célula (minuteFromOffsetY)
//     → setCreating(seed)
//     → NewBookingSheet(initial)
//     → estado local (date/time/professionalId)
//     → seleção do serviço
//     → carregamento dos slots
//
// Cobertura exigida pelo fechamento da #43:
//   1. click real da grade → date + time + professionalId;
//   2. preservação do prefill após abertura (e após escolher o serviço);
//   3. profissional incompatível com o serviço NÃO permanece inválido;
//   4. horário indisponível NÃO vira booking (só prefill, nunca criação).
//
// Dados SINTÉTICOS em memória (api-client + fetch mockados) — zero escrita
// em banco/remoto. Nenhuma regra clínica/backend é alterada.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';

// ── Constantes da grade (espelham lib/agenda-drag + agenda/page) ──────────
const PX_PER_HOUR = 128;
const GRID_START = 8 * 60; // 08:00
const COL_RECT_TOP = 312;  // topo real da coluna (rect medido no browser)
const COL_RECT_HEIGHT = 12 * PX_PER_HOUR; // 08:00 → 20:00

const BUSINESS = 'biz-t1';
const PRO_A = 'pro-a';
const PRO_B = 'pro-b';
const PRO_C = 'pro-c';
const SVC = 'svc-1';      // aceita os três profissionais
const SVC_RESTRICT = 'svc-2'; // aceita pro-b e pro-c (pro-a NÃO realiza)
const DATE = '2026-10-01'; // 01/10/2026

// ── next/navigation: useSearchParams sincronizado com history.pushState ──
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

// ── Fixtures sintéticas ──────────────────────────────────────────────────
const FIXTURE = vi.hoisted(() => ({
  services: [
    // Aceita os TRÊS profissionais (campo "Profissional" fica visível).
    { id: 'svc-1', businessId: 'biz-t1', name: 'Consulta', durationMin: 30, price: 0, active: true, bookable: true, professionalIds: ['pro-a', 'pro-b', 'pro-c'] },
    // pro-a NÃO realiza: serve para provar que a combinação inválida sai.
    { id: 'svc-2', businessId: 'biz-t1', name: 'Cirurgia', durationMin: 60, price: 0, active: true, bookable: true, professionalIds: ['pro-b', 'pro-c'] },
  ],
  professionals: [
    { id: 'pro-a', businessId: 'biz-t1', name: 'Dra. Ana', role: 'Clínica geral', photo: '', active: true, createdAt: '2026-01-01' },
    { id: 'pro-b', businessId: 'biz-t1', name: 'Dr. Bruno', role: 'Cirurgião', photo: '', active: true, createdAt: '2026-01-01' },
    { id: 'pro-c', businessId: 'biz-t1', name: 'Dra. Carla', role: 'Cirurgiã', photo: '', active: true, createdAt: '2026-01-01' },
  ],
  availability: Array.from({ length: 7 }, (_, wd) => ({
    id: `av-${wd}`, businessId: 'biz-t1', professionalId: '', serviceId: '',
    weekday: wd, start: '08:00', end: '18:00', slotMin: 30,
  })),
  exceptions: [],
  bookings: [] as any[],
}));

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.includes('/api/catalog/get')) {
      return {
        ok: true, status: 200,
        data: {
          services: FIXTURE.services, professionals: FIXTURE.professionals,
          availability: FIXTURE.availability, exceptions: FIXTURE.exceptions,
          business: {
            booking: { leadMin: 0, bufferMin: 0, horizonDays: 60, teamMode: 'team', cancelUntilMin: 60 },
            businessTimezone: 'America/Sao_Paulo',
          },
        },
      };
    }
    if (url.includes('/api/bookings')) return { ok: true, status: 200, data: { bookings: FIXTURE.bookings } };
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

// ── Controle do que a API de slots devolve ───────────────────────────────
const slotsApi = vi.hoisted(() => ({
  slots: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00'],
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
  window.history.replaceState(null, '', `/agenda?b=${BUSINESS}&view=day&data=${DATE}`);
  slotsApi.slots = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00'];
  slotsApi.calls = [];
  slotsApi.posts = 0;
  // NewBookingSheet usa `fetch` nativo para /api/bookings?mode=slots-admin.
  global.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (init?.method === 'POST' || init?.body) slotsApi.posts += 1;
    slotsApi.calls.push(url);
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

/** Coluna da grade do profissional (elemento real que recebe o click). */
function gridColumn(professionalId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-agenda-column="${professionalId}"]`);
  if (!el) throw new Error(`coluna da grade não encontrada: ${professionalId}`);
  return el;
}

/** Geometria REAL da coluna (jsdom devolve zeros — medimos como o browser). */
function measureColumn(el: HTMLElement) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0, y: COL_RECT_TOP, top: COL_RECT_TOP, left: 0, right: 400, bottom: COL_RECT_TOP + COL_RECT_HEIGHT,
      width: 400, height: COL_RECT_HEIGHT, toJSON: () => ({}),
    }) as DOMRect,
  });
}

/** clientY, em px de viewport, do instante `hh:mm` dentro da coluna. */
function clientYFor(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const minutes = h * 60 + m;
  return COL_RECT_TOP + ((minutes - GRID_START) / 60) * PX_PER_HOUR;
}

async function renderAgenda() {
  const utils = render(<AgendaPage />);
  await screen.findByText('Dra. Ana', {}, { timeout: 8000 });
  await waitFor(() => expect(gridColumn(PRO_A)).toBeTruthy());
  return utils;
}

/** O overlay real do "Novo agendamento" (dialog do Drawer). */
function sheet(): HTMLElement {
  const el = document.querySelector<HTMLElement>('dialog.il-drawer');
  if (!el) throw new Error('overlay "Novo agendamento" não está aberto');
  return el;
}

/** Abre o "Novo agendamento" clicando de verdade numa célula vazia. */
async function clickEmptyCell(professionalId: string, time: string) {
  const col = gridColumn(professionalId);
  measureColumn(col);
  fireEvent.click(col, { clientX: 120, clientY: clientYFor(time) });
  await waitFor(() => expect(document.querySelector('dialog.il-drawer')).toBeTruthy(), { timeout: 5000 });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Novo agendamento' })).toBeTruthy(), { timeout: 5000 });
}

function dateInput(): HTMLInputElement {
  return within(sheet()).getByLabelText(/^3\. Data/) as HTMLInputElement;
}
function serviceSelect(): HTMLSelectElement {
  return within(sheet()).getByLabelText(/^2\. Serviço/) as HTMLSelectElement;
}
function proSelect(): HTMLSelectElement | null {
  return within(sheet()).queryByLabelText(/^Profissional/) as HTMLSelectElement | null;
}
function slotButton(time: string): HTMLElement | null {
  const btn = Array.from(sheet().querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === time && b.className.includes('il-option-choice'));
  return (btn as HTMLElement) || null;
}

// ═════════════════════════════════════════════════════════════════════════
describe('1 · click real da grade → date + time + professionalId', () => {
  it('o clique numa célula vazia entrega data, hora E profissional da coluna', async () => {
    await renderAgenda();
    await clickEmptyCell(PRO_A, '09:30');

    // Data = dia da coluna clicada.
    expect(dateInput().value).toBe(DATE);
    // O horário clicado chega como intenção inicial preservada no estado.
    expect(screen.queryByText(/Nenhum horário disponível/)).toBeNull();
    // O profissional da coluna chega (e é visível assim que o serviço entra).
    await userEvent.selectOptions(serviceSelect(), SVC);
    await waitFor(() => expect(proSelect()).toBeTruthy());
    expect(proSelect()!.value).toBe(PRO_A);
    // E o horário 09:30 permanece selecionado porque existe nos slots reais.
    await waitFor(() => expect(slotButton('09:30')).toBeTruthy());
    expect(slotButton('09:30')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('o clique é só prefill: nenhum booking é criado', async () => {
    await renderAgenda();
    await clickEmptyCell(PRO_A, '09:30');
    await userEvent.selectOptions(serviceSelect(), SVC);
    await waitFor(() => expect(slotButton('09:30')).toBeTruthy());
    expect(slotsApi.posts).toBe(0);
    expect(document.querySelector('[data-booking-created="true"]')).toBeNull();
  });

  it('o horário batido na grade é o horário que chega (snap de 5 min)', async () => {
    await renderAgenda();
    await clickEmptyCell(PRO_B, '14:00');
    expect(dateInput().value).toBe(DATE);
    await userEvent.selectOptions(serviceSelect(), SVC);
    await waitFor(() => expect(proSelect()).toBeTruthy());
    expect(proSelect()!.value).toBe(PRO_B);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('2 · preservação do prefill após abertura (e após escolher o serviço)', () => {
  it('data, hora e profissional sobrevivem à seleção do serviço', async () => {
    await renderAgenda();
    await clickEmptyCell(PRO_A, '09:30');
    await userEvent.selectOptions(serviceSelect(), SVC);

    await waitFor(() => expect(proSelect()).toBeTruthy());
    expect(dateInput().value).toBe(DATE);
    expect(proSelect()!.value).toBe(PRO_A);
    await waitFor(() => expect(slotButton('09:30')).toBeTruthy());
    expect(slotButton('09:30')!.getAttribute('aria-pressed')).toBe('true');
    // A consulta de disponibilidade usa o profissional pré-selecionado.
    expect(slotsApi.calls.some((u) => u.includes(SVC) && u.includes(`professionalId=${PRO_A}`))).toBe(true);
  });

  it('clique num dia/hora sem profissional (semana) preenche data e hora', async () => {
    window.history.replaceState(null, '', `/agenda?b=${BUSINESS}&view=week&data=${DATE}`);
    render(<AgendaPage />);
    // Na semana as colunas são DIAS (não profissionais): a coluna 01/10
    // existe por data e o clique entrega data + hora, sem profissional.
    await waitFor(
      () => expect(document.querySelector(`[data-agenda-column-date="${DATE}"]`)).toBeTruthy(),
      { timeout: 5000 },
    );
    const col = document.querySelector<HTMLElement>(`[data-agenda-column-date="${DATE}"]`);
    expect(col).toBeTruthy();
    measureColumn(col!);
    fireEvent.click(col!, { clientX: 40, clientY: clientYFor('10:30') });
    await waitFor(() => expect(document.querySelector('dialog.il-drawer')).toBeTruthy(), { timeout: 5000 });
    expect(dateInput().value).toBe(DATE);
    await userEvent.selectOptions(serviceSelect(), SVC);
    await waitFor(() => expect(slotButton('10:30')).toBeTruthy());
    expect(slotButton('10:30')!.getAttribute('aria-pressed')).toBe('true');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('3 · profissional incompatível com o serviço não permanece inválido', () => {
  it('ao escolher um serviço que a profissional NÃO realiza, ela sai da seleção', async () => {
    await renderAgenda();
    await clickEmptyCell(PRO_A, '09:30');
    // svc-2 não pode ser feito por pro-a (a coluna clicada).
    await userEvent.selectOptions(serviceSelect(), SVC_RESTRICT);

    await waitFor(() => expect(proSelect()).toBeTruthy());
    expect(proSelect()!.value).toBe('');
    // Nenhuma combinação inválida segue para a consulta de disponibilidade.
    await waitFor(() => expect(slotsApi.calls.some((u) => u.includes('mode=slots-admin'))).toBe(true));
    expect(slotsApi.calls.some((u) => u.includes(SVC_RESTRICT) && u.includes(`professionalId=${PRO_A}`))).toBe(false);
    // E a data segue preservada.
    expect(dateInput().value).toBe(DATE);
  });

  it('um profissional elegível da coluna permanece selecionado (não é limpo por padrão)', async () => {
    await renderAgenda();
    await clickEmptyCell(PRO_B, '09:30');
    await userEvent.selectOptions(serviceSelect(), SVC_RESTRICT);
    await waitFor(() => expect(proSelect()).toBeTruthy());
    expect(proSelect()!.value).toBe(PRO_B);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('4 · horário indisponível não vira booking', () => {
  it('hora clicada fora dos slots válidos é limpa (nunca reserva silenciosa)', async () => {
    slotsApi.slots = ['14:00', '14:30', '15:00'];
    await renderAgenda();
    await clickEmptyCell(PRO_A, '09:30');
    await userEvent.selectOptions(serviceSelect(), SVC);

    await waitFor(() => expect(slotButton('14:00')).toBeTruthy());
    expect(slotButton('09:30')).toBeNull();
    expect(slotsApi.posts).toBe(0);
    expect(document.querySelector('[data-booking-created="true"]')).toBeNull();
  });

  it('dia sem nenhum slot avisa e não cria agendamento', async () => {
    slotsApi.slots = [];
    await renderAgenda();
    await clickEmptyCell(PRO_A, '09:30');
    await userEvent.selectOptions(serviceSelect(), SVC);
    await waitFor(() => expect(screen.getByText(/Nenhum horário disponível|Fechado neste dia/)).toBeTruthy());
    expect(slotsApi.posts).toBe(0);
  });
});
