// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// AGENDA PROTAGONISTA — toolbar de duas linhas, CTA e topo limpo
// ═══════════════════════════════════════════════════════════════
// Prova em DOM (não só texto de fonte) a hierarquia da Agenda:
//   1. título “Agenda” com ícone de calendário (Linha 1);
//   2. Filtros na Linha 1 · 3. Fila na Linha 1 · “?” de ajuda junto;
//   4. “Novo agendamento” imediatamente ao lado do seletor (Linha 2);
//   5. “+ Novo” global REMOVIDO do topo (correção cirúrgica);
//   6. topo mantém busca/sino/ajuda/avatar;
//   7. Dia/Semana/Lista funcionando (Mês fora da UI; lógica preservada);
//   8. [◀] [▶] funcionando — botão “Hoje” removido;
//   9. “Novo agendamento” continua abrindo o fluxo existente;
//  10. Filtros continuam abrindo;  11. Fila continua abrindo;
//  12. fotos reais de profissionais preservadas (Avatar src=photo);
//  13. fallback de iniciais continua funcionando;
//  14. nenhuma regra de booking foi alterada (contratos de fonte).
// Os dados são SINTÉTICOS em memória (api-client mockado) — zero escrita
// em banco/remoto.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { addDaysISO } from '@/lib/tz';

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

// ── API: fixtures sintéticas em memória ──────────────────────────────────
const FIXTURE = vi.hoisted(() => ({
  services: [
    { id: 'svc-1', businessId: 'biz-t1', name: 'Consulta demonstrativa', durationMin: 30, price: 0, active: true, bookable: true, professionalIds: ['pro-foto', 'pro-sem-foto'] },
  ],
  professionals: [
    { id: 'pro-foto', businessId: 'biz-t1', name: 'Dra. Foto Real', role: 'Clínica geral', photo: '/demo/foto-real.jpg', active: true, createdAt: '2026-01-01' },
    { id: 'pro-sem-foto', businessId: 'biz-t1', name: 'Pedro Duas', role: 'Atendimento', photo: '', active: true, createdAt: '2026-01-01' },
  ],
  availability: [
    { id: 'av-1', businessId: 'biz-t1', professionalId: '', serviceId: '', weekday: 1, start: '08:00', end: '18:00', slotMin: 30 },
    { id: 'av-2', businessId: 'biz-t1', professionalId: '', serviceId: '', weekday: 2, start: '08:00', end: '18:00', slotMin: 30 },
    { id: 'av-3', businessId: 'biz-t1', professionalId: '', serviceId: '', weekday: 3, start: '08:00', end: '18:00', slotMin: 30 },
    { id: 'av-4', businessId: 'biz-t1', professionalId: '', serviceId: '', weekday: 4, start: '08:00', end: '18:00', slotMin: 30 },
    { id: 'av-5', businessId: 'biz-t1', professionalId: '', serviceId: '', weekday: 5, start: '08:00', end: '18:00', slotMin: 30 },
    { id: 'av-6', businessId: 'biz-t1', professionalId: '', serviceId: '', weekday: 6, start: '08:00', end: '18:00', slotMin: 30 },
    { id: 'av-7', businessId: 'biz-t1', professionalId: '', serviceId: '', weekday: 0, start: '08:00', end: '18:00', slotMin: 30 },
  ],
  exceptions: [],
  bookings: [
    {
      id: 'bk-1', businessId: 'biz-t1', serviceId: 'svc-1', professionalId: 'pro-foto',
      date: '2026-09-28', time: '09:00', durationMin: 30, status: 'confirmed',
      customerName: 'Ana Sintética', customerPhone: '21999990001', petName: '', createdAt: '2026-09-20',
    },
  ],
}));

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.includes('/api/catalog/get')) {
      return {
        ok: true, status: 200, data: {
          services: FIXTURE.services, professionals: FIXTURE.professionals,
          availability: FIXTURE.availability, exceptions: FIXTURE.exceptions,
          business: { booking: { leadMin: 0, bufferMin: 0, horizonDays: 30, teamMode: 'solo', cancelUntilMin: 60 }, businessTimezone: 'America/Sao_Paulo' },
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
import { WorkspaceTopbar } from '@/components/dashboard/WorkspaceTopbar';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

beforeAll(() => {
  // jsdom: APIs que o browser tem e o ambiente de teste não.
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*1280px/.test(query), // rail da fila em overlay (drawer)
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
  // O componente usa window.history.pushState (integração nativa do Next):
  // espelhamos o evento para o useSearchParams mockado re-renderizar.
  const orig = window.history.pushState.bind(window.history);
  window.history.pushState = (state: unknown, title: string, url?: string | URL | null) => {
    orig(state, title, url as string);
    nav.emit();
  };
});

beforeEach(() => {
  window.history.replaceState(null, '', '/agenda?b=biz-t1&view=day&data=2026-09-28');
});
afterEach(cleanup);

async function renderAgenda() {
  const utils = render(<AgendaPage />);
  // Espera o catálogo sintético entrar na grade (profissionais no cabeçalho).
  await screen.findByText('Dra. Foto Real', {}, { timeout: 8000 });
  return utils;
}

// ═══ 1–4 · Hierarquia das DUAS linhas ═══════════════════════════════════
describe('Agenda — Linha 1 (título/auxiliares) e Linha 2 (data/modo/ação)', () => {
  it('1. o título “Agenda” tem ícone de calendário antes do <h1>', async () => {
    const { container } = await renderAgenda();
    const icon = container.querySelector('[data-agenda-title-icon="calendar"]');
    expect(icon).toBeTruthy();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Agenda' });
    // Antes do título, dentro do mesmo header (sem card em volta).
    expect(!!(icon!.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(!!(h1.closest('header') as Element).contains(icon as Element)).toBe(true);
    expect(h1.parentElement!.className).not.toMatch(/card|panel|border/);
  });

  it('2–3. Filtros e Fila estão na Linha 1 (header), fora da toolbar', async () => {
    await renderAgenda();
    const header = screen.getByRole('heading', { level: 1, name: 'Agenda' }).closest('header')!;
    const filtros = within(header).getByRole('button', { name: /Filtros/ });
    const fila = within(header).getByRole('button', { name: /Fila/ });
    expect(header.contains(filtros)).toBe(true);
    expect(header.contains(fila)).toBe(true);
    // Os modos NÃO se misturam com os auxiliares: o tablist fica na Linha 2.
    expect(within(header).queryByRole('tablist')).toBeNull();
    // “?” de ajuda permanece na Linha 1, depois de Filtros e Fila.
    const help = within(header).getByRole('button', { name: /Legenda/ });
    const order = [filtros, fila, help].map((el) => Array.from(header.querySelectorAll('button, [role=button]')).indexOf(el as Element));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('4. “Novo agendamento” está na Linha 2, imediatamente ao lado do seletor', async () => {
    await renderAgenda();
    const header = screen.getByRole('heading', { level: 1, name: 'Agenda' }).closest('header')!;
    const cta = screen.getByRole('button', { name: 'Novo agendamento' });
    // Não está no header (saiu da Linha 1)…
    expect(header.contains(cta)).toBe(false);
    // …e é o vizinho direito do seletor Dia/Semana/Mês/Lista.
    const tablist = screen.getByRole('tablist', { name: 'Visualização da agenda' });
    const row = tablist.parentElement!;
    expect(row.contains(cta)).toBe(true);
    const kids = Array.from(row.children);
    expect(kids[0]).toBe(tablist);
    expect(kids[kids.length - 1]).toBe(cta);
    // E tudo vive na Linha 2 (toolbar da agenda).
    expect(cta.closest('[data-agenda-main]')).toBeTruthy();
  });
});

// ═══ 5–6 · Topo limpo (“+ Novo” removido) ══════════════════════════════
describe('“+ Novo” global — removido do topo (correção cirúrgica)', () => {
  function topbarProps() {
    return {
      page: 'Agenda', query: '?b=biz-t1', searchItems: [], activePath: '/agenda',
      businessId: 'biz-t1', alerts: { unread: 0, items: [] } as never,
      user: { name: 'Dona Unidade' },
      unit: { id: 'biz-t1', name: 'Clínica T', slug: 'clinica-t', published: true } as never,
      units: [], canCreate: ['/agenda', '/clientes', '/profissionais', '/servicos', '/tarefas', '/financeiro'],
      onLogout: () => {}, onOpenNav: () => {}, onOpenHelp: () => {},
    };
  }

  it('5. não existe mais botão “+ Novo” nem o menu de quick create', () => {
    render(<WorkspaceTopbar {...topbarProps()} />);
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(screen.queryByRole('menu', { name: 'Criar novo' })).toBeNull();
    expect(document.querySelector('.ws-newbtn')).toBeNull();
  });

  it('6. os demais itens da topbar permanecem (busca · sino · ajuda · conta)', () => {
    render(<WorkspaceTopbar {...topbarProps()} />);
    expect(document.querySelector('.global-search')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Notifica/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajuda e suporte' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Dona Unidade/ })).toBeTruthy();
  });
});

// ═══ 7–8 · Modos e navegação de data ════════════════════════════════════
describe('Dia/Semana/Lista e navegação [◀][▶] (correção cirúrgica)', () => {
  it('7. os três modos (Dia/Semana/Lista) funcionam — sem tab “Mês” na UI', async () => {
    const user = userEvent.setup();
    await renderAgenda();
    const tabs = within(screen.getByRole('tablist', { name: 'Visualização da agenda' }));

    // “Mês” saiu da UI (a lógica profunda segue para links view=month).
    expect(tabs.queryByRole('tab', { name: /Mês/ })).toBeNull();

    await user.click(tabs.getByRole('tab', { name: /Semana/ }));
    await waitFor(() => expect(window.location.search).toContain('view=week'));
    expect(tabs.getByRole('tab', { name: /Semana/ }).getAttribute('aria-selected')).toBe('true');

    await user.click(tabs.getByRole('tab', { name: /Lista/ }));
    await waitFor(() => expect(window.location.search).toContain('view=list'));
    expect(screen.getByRole('region', { name: 'Lista de atendimentos do dia' })).toBeTruthy();

    await user.click(tabs.getByRole('tab', { name: /^Dia/ }));
    await waitFor(() => expect(window.location.search).toContain('view=day'));
    expect(await screen.findByText('Dra. Foto Real')).toBeTruthy();
  });

  it('8. [◀] [▶] funcionam — e o botão “Hoje” não existe mais', async () => {
    const user = userEvent.setup();
    await renderAgenda();
    // Contrato da correção: o botão “Hoje” saiu da navegação de data.
    expect(screen.queryByRole('button', { name: 'Hoje' })).toBeNull();
    // Data de partida = o foco atual da agenda (URL da fixture).
    const before = new URLSearchParams(window.location.search).get('data')!;
    // Próximo dia → +1; anterior → volta.
    await user.click(screen.getByRole('button', { name: /Próximo dia/ }));
    await waitFor(() => expect(window.location.search).toContain(`data=${addDaysISO(before, 1)}`));
    await user.click(screen.getByRole('button', { name: /Dia anterior/ }));
    await waitFor(() => expect(window.location.search).toContain(`data=${before}`));
    // A data/período continua visível.
    expect(screen.getByTitle(/clique para escolher a data/)).toBeTruthy();
  });
});

// ═══ 9–11 · Ações principais ════════════════════════════════════════════
describe('CTA, Filtros e Fila continuam abrindo os fluxos existentes', () => {
  it('9. “Novo agendamento” abre o MESMO fluxo de criação (sheet), pré-preenchido com a data', async () => {
    const user = userEvent.setup();
    await renderAgenda();
    await user.click(screen.getByRole('button', { name: 'Novo agendamento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo agendamento' });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/Paciente → serviço → data e horário/)).toBeTruthy();
  });

  it('10. Filtros continua abrindo (popover com Status · Serviços · Profissional)', async () => {
    const user = userEvent.setup();
    await renderAgenda();
    await user.click(screen.getByRole('button', { name: /Filtros/ }));
    const pop = screen.getByRole('dialog', { name: 'Filtros da agenda' });
    expect(within(pop).getByText('Status')).toBeTruthy();
    expect(within(pop).getByText('Serviços')).toBeTruthy();
    expect(within(pop).getByText('Profissional')).toBeTruthy();
  });

  it('11. Fila continua abrindo (mesmo QueuePanel, como drawer em tela estreita)', async () => {
    const user = userEvent.setup();
    await renderAgenda();
    const btn = screen.getByRole('button', { name: /Fila/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    await user.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('true'));
    // O QueuePanel REAL abre (rail no desktop largo · drawer em tela estreita).
    await waitFor(() => expect(document.querySelector('[data-queue-panel="true"]')).toBeTruthy());
  });
});

// ═══ 12–13 · Avatares dos profissionais ═════════════════════════════════
describe('Avatar do cabeçalho da grade — foto real com fallback', () => {
  it('12. profissional com photo mostra a foto real (nunca iniciais)', async () => {
    await renderAgenda();
    const img = screen.getByAltText('Dra. Foto Real') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/demo/foto-real.jpg');
  });

  it('13. sem photo, o fallback de iniciais continua funcionando', async () => {
    const { container } = await renderAgenda();
    const img = container.querySelector('img[alt="Pedro Duas"]');
    expect(img).toBeNull();
    expect(screen.getByText('PD')).toBeTruthy();
  });
});

// ═══ 14 · Regras de booking intactas ═════════════════════════════════════
describe('nenhuma regra de booking foi alterada', () => {
  it('14. criação/regras continuam no servidor — a tela não ganhou escrita nova', () => {
    const page = read('src/app/(dashboard)/agenda/page.tsx');
    // A agenda NÃO cria booking: o POST continua só do NewBookingSheet.
    expect(page).not.toMatch(/fetch\(['"`]\/api\/bookings['"`],\s*\{\s*method:\s*['"]POST['"]/);
    // Reagendar continua pela decisão canônica (move vs. recria) + servidor.
    expect(page).toContain('rescheduleDecision(');
    expect(page).toContain('dragSlotUrls(');
    // O motor de slots continua sendo o do servidor; nada virou cálculo local.
    const create = read('src/lib/booking-create.ts');
    expect(create).toContain('Não é possível agendar no passado.');
    expect(create).toContain('export function createBookingTx');
    const slots = read('src/lib/slots.ts');
    expect(slots).toContain('export function computeSlots');
    // O fluxo público de booking não foi tocado pela camada visual.
    const sheet = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(sheet).toContain("fetch('/api/bookings', {");
    expect(sheet).toContain('mode=slots-admin');
  });

  it('extra. a arquitetura de scroll único está publicada (prova de navegador no harness)', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('.il-platform.workspace-shell--fill');
    expect(css).toContain('.ag-mode-scroll');
    expect(css).toContain('overflow-y: auto');
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toContain("isAgenda && 'workspace-shell--fill'");
  });
});
