// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// DS 1.0 · §5 — QUICK CREATE ANCORADO NO SLOT (AGENDA)
// ═══════════════════════════════════════════════════════════════
// Contrato provado no DOM real (não por leitura de fonte):
//
//   1. clique num slot vago abre o POPOVER canônico ancorado (camada em
//      portal), com os SEIS campos: Paciente · Serviço · Profissional · Data ·
//      Hora · Duração — e a ação "Mais opções";
//   2. o popover NÃO cria nada sozinho (nenhum POST antes da confirmação);
//   3. "Criar agendamento" exige paciente já cadastrado (regra preservada) e
//      envia para `POST /api/bookings` o MESMO payload do fluxo completo;
//   4. erro do SERVIDOR (409 conflito) é mostrado como veio, sem inventar
//      mensagem — e nenhum booking local é fabbricado;
//   5. "Mais opções" entrega a intenção ao fluxo completo (NewBookingSheet).
//
// Nada aqui toca rede real: `fetch` e o painel de API são mockados.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { addDaysISO, todayISO } from '@/lib/tz';

const PX_PER_HOUR = 128;
const COL_RECT_TOP = 312;
const COL_RECT_HEIGHT = 12 * PX_PER_HOUR;
const COL_RECT_WIDTH = 400;
const BUSINESS = 'biz-quick';
const PRO = 'pro-orlando';
const TZ = 'America/Sao_Paulo';
const DATE = addDaysISO(todayISO(new Date(), TZ), 3);

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

const spy = vi.hoisted(() => ({ props: [] as any[] }));
vi.mock('@/components/dashboard/NewBookingSheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/dashboard/NewBookingSheet')>();
  return {
    ...actual,
    NewBookingSheet: (props: any) => { spy.props.push(props); return actual.NewBookingSheet(props); },
  };
});

const CONTACT = { id: 'ct-1', name: 'Ana Tutora', phone: '21999990000', email: '' };

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.includes('/api/catalog/get')) {
      return {
        ok: true, status: 200,
        data: {
          services: [{ id: 'svc-1', businessId: BUSINESS, name: 'Consulta', durationMin: 30, price: 0, active: true, bookable: true, professionalIds: [PRO] }],
          professionals: [{ id: PRO, businessId: BUSINESS, name: 'Orlando', role: 'Clínico', photo: '', active: true, createdAt: '2026-01-01' }],
          availability: Array.from({ length: 7 }, (_, wd) => ({ id: `av-${wd}`, businessId: BUSINESS, professionalId: PRO, serviceId: '', weekday: wd, start: '09:00', end: '18:00', slotMin: 30 })),
          exceptions: [],
          business: { booking: { leadMin: 0, bufferMin: 0, horizonDays: 60, teamMode: 'team', cancelUntilMin: 60 }, businessTimezone: TZ },
        },
      };
    }
    if (url.includes('/api/bookings')) return { ok: true, status: 200, data: { bookings: [] } };
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

const net = vi.hoisted(() => ({ posts: [] as any[], postStatus: 200, postBody: {} as any }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*1280px/.test(query) || /hover:\s*hover/.test(query),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const orig = window.history.pushState.bind(window.history);
  window.history.pushState = (state: unknown, title: string, url?: string | URL | null) => {
    orig(state, title, url as string);
    nav.emit();
  };
});

beforeEach(() => {
  document.body.innerHTML = '';
  spy.props.length = 0;
  net.posts = [];
  net.postStatus = 200;
  net.postBody = {};
  global.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      net.posts.push(body);
      return {
        ok: net.postStatus < 400, status: net.postStatus,
        json: async () => (net.postStatus < 400 ? { booking: { id: 'bk-1' } } : net.postBody),
      } as unknown as Response;
    }
    if (url.includes('mode=slots-admin')) {
      return { ok: true, status: 200, json: async () => ({ slots: ['09:00', '10:00', '11:00'], state: 'open', full: false, closed: false }) } as unknown as Response;
    }
    if (url.includes('/api/contacts')) {
      return { ok: true, status: 200, json: async () => ({ contacts: [CONTACT] }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(cleanup);

function gridColumn(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`coluna não encontrada: ${selector}`);
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

function gridStartMinute(): number {
  const first = Array.from(document.querySelectorAll('span'))
    .map((el) => el.textContent?.trim() || '')
    .find((t) => /^\d{2}:\d{2}$/.test(t));
  if (!first) throw new Error('gutter não encontrado');
  const [h, m] = first.split(':').map(Number);
  return h * 60 + m;
}

const clientYFor = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return COL_RECT_TOP + (((h * 60 + m) - gridStartMinute()) / 60) * PX_PER_HOUR;
};

const quick = () => {
  const el = document.querySelector<HTMLElement>('[data-layer]');
  if (!el) throw new Error('popover do quick create não abriu');
  return el;
};
const hasQuick = () => !!document.querySelector('[data-layer]');

/** Clique no slot vago: abre o popover ancorado (e nada mais). */
async function clickSlot(time: string, clientX = 180) {
  await new Promise((r) => setTimeout(r, 510)); // supressão pós-arraste da grade
  const col = gridColumn(`[data-agenda-column-professional="${PRO}"]`);
  fireEvent.click(col, { clientX, clientY: clientYFor(time) });
  await waitFor(() => expect(hasQuick()).toBe(true), { timeout: 5000 });
}

beforeEach(async () => {
  window.history.replaceState(null, '', `/agenda?b=${BUSINESS}&view=day&data=${DATE}`);
});

describe('DS 1.0 §5 · quick create ancorado no slot', () => {
  it('1 · clique abre o popover canônico ancorado, com os SEIS campos e "Mais opções"', async () => {
    render(<AgendaPage />);
    await clickSlot('10:00');

    const layer = quick();
    expect(layer.className).toContain('gd-layer');
    expect(layer.className).toContain('gd-popover');
    expect(layer.getAttribute('role')).toBe('dialog');
    // Ancorado no PONTO do clique (âncora fixa, sem elemento fantasma no fluxo):
    // a camada nasce exatamente abaixo/esquerda do ponto onde o slot foi clicado.
    const anchors = Array.from(document.querySelectorAll<HTMLElement>('.lds-popover-anchor'));
    const fixed = anchors.filter((a) => a.style.position === 'fixed');
    expect(fixed).toHaveLength(1);
    // A âncora carrega o PONTO do clique (é o `anchorStyle` do Popover). O
    // posicionamento final da camada é medido no QA de browser real — no jsdom
    // não existe layout, e um teste de pixel aqui seria mentira.
    const clickX = 180;
    const clickY = clientYFor('10:00');
    expect(Number.parseFloat(fixed[0].style.left)).toBe(clickX);
    expect(Number.parseFloat(fixed[0].style.top)).toBe(clickY);
    expect(layer.style.left).toBeTruthy();
    expect(layer.style.top).toBeTruthy();

    expect(within(layer).getByLabelText(/Paciente/)).toBeTruthy();
    expect(within(layer).getByLabelText(/^Serviço/)).toBeTruthy();
    expect(within(layer).getByLabelText(/^Profissional/)).toBeTruthy();
    expect(within(layer).getByLabelText(/^Duração/)).toBeTruthy();
    expect(within(layer).getByRole('button', { name: /^Data/ })).toBeTruthy();
    expect(within(layer).getByLabelText(/^Hora/)).toBeTruthy();
    expect(within(layer).getByRole('button', { name: 'Mais opções' })).toBeTruthy();
    // O horário clicado já vem escolhido (intenção do gesto preservada).
    expect((within(layer).getByLabelText(/^Hora/) as HTMLSelectElement).value).toBe('10:00');
  });

  it('2 · abrir o popover NÃO cria agendamento (nenhum POST antes da confirmação)', async () => {
    render(<AgendaPage />);
    await clickSlot('10:00');
    await new Promise((r) => setTimeout(r, 50));
    expect(net.posts).toHaveLength(0);
    expect(document.querySelector('[data-booking-created="true"]')).toBeNull();
  });

  it('3 · exige paciente JÁ cadastrado — e "Criar agendamento" nunca inventa contato', async () => {
    render(<AgendaPage />);
    await clickSlot('10:00');
    const layer = quick();
    fireEvent.change(within(layer).getByLabelText(/^Serviço/), { target: { value: 'svc-1' } });
    fireEvent.click(within(layer).getByRole('button', { name: 'Criar agendamento' }));

    expect(await within(layer).findByText(/Escolha um paciente já cadastrado/)).toBeTruthy();
    expect(net.posts).toHaveLength(0);

    // Escolhendo um contato do CRM, o mesmo botão grava no endpoint canônico.
    fireEvent.change(within(layer).getByLabelText(/Paciente/), { target: { value: 'Ana' } });
    const hit = await within(layer).findByRole('button', { name: /Ana Tutora/ });
    fireEvent.click(hit);
    fireEvent.click(within(layer).getByRole('button', { name: 'Criar agendamento' }));

    await waitFor(() => expect(net.posts).toHaveLength(1));
    expect(net.posts[0]).toMatchObject({
      businessId: BUSINESS,
      contactId: CONTACT.id,
      customerName: CONTACT.name,
      customerPhone: CONTACT.phone,
      serviceId: 'svc-1',
      professionalId: PRO,
      date: DATE,
      time: '10:00',
    });
  });

  it('4 · conflito do servidor vem como veio (409) e nada é criado na tela', async () => {
    net.postStatus = 409;
    net.postBody = { error: 'Este horário já está ocupado.' };
    render(<AgendaPage />);
    await clickSlot('10:00');
    const layer = quick();
    fireEvent.change(within(layer).getByLabelText(/Paciente/), { target: { value: 'Ana' } });
    fireEvent.click(await within(layer).findByRole('button', { name: /Ana Tutora/ }));
    fireEvent.change(within(layer).getByLabelText(/^Serviço/), { target: { value: 'svc-1' } });
    fireEvent.click(within(layer).getByRole('button', { name: 'Criar agendamento' }));

    expect(await within(layer).findByText('Este horário já está ocupado.')).toBeTruthy();
    expect(document.querySelector('[data-booking-created="true"]')).toBeNull();
    // O popover continua aberto para a pessoa decidir outro horário.
    expect(hasQuick()).toBe(true);
  });

  it('5 · "Mais opções" entrega a intenção ao fluxo completo (NewBookingSheet)', async () => {
    render(<AgendaPage />);
    await clickSlot('10:00');
    const layer = quick();
    fireEvent.change(within(layer).getByLabelText(/Paciente/), { target: { value: 'Ana' } });
    fireEvent.click(await within(layer).findByRole('button', { name: /Ana Tutora/ }));
    fireEvent.change(within(layer).getByLabelText(/^Serviço/), { target: { value: 'svc-1' } });
    fireEvent.click(within(layer).getByRole('button', { name: 'Mais opções' }));

    await waitFor(() => expect(document.querySelector('dialog.il-drawer')).toBeTruthy(), { timeout: 5000 });
    const seed = spy.props[spy.props.length - 1].initial;
    expect(seed).toMatchObject({
      date: DATE, time: '10:00', professionalId: PRO,
      serviceId: 'svc-1', contactId: CONTACT.id, name: CONTACT.name, phone: CONTACT.phone,
    });
    expect(hasQuick()).toBe(false);
    expect(net.posts).toHaveLength(0);
  });
});
