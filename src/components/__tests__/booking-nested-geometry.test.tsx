// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// NOVO AGENDAMENTO + CADASTRO ANINHADO — GEOMETRIA (§19–25)
// ═══════════════════════════════════════════════════════════════
// Comportamento preservado (homologado):
//   • Novo agendamento abre em sheet;
//   • "Cadastrar novo paciente" abre dentro do MESMO overlay;
//   • salvar/cancelar o cadastro volta ao agendamento;
//   • paciente/pet recém-criado permanece selecionado;
//   • guards de descarte continuam; headers/subtítulos continuam.
//
// Correção desta rodada (somente geometria):
//   5. composição aninhada usa o preset COMPARTILHADO 50/50
//      (mesma largura, mesma altura, headers alinhados, UM overlay);
//   6. em viewport estreita o cadastro assume a faixa e, ao voltar, o
//      agendamento preserva o estado (data/hora/profissional/serviço).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Drawer } from '@/components/ui';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { WORKSPACE_NESTED_PANEL, WORKSPACE_SHEET_SIZES } from '@/lib/workspace-sheet-sizes';

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const SERVICES = [
  { id: 'svc-1', businessId: 'biz-t1', name: 'Consulta', durationMin: 30, price: 0, active: true, bookable: true, professionalIds: ['pro-a', 'pro-b'] },
];
const PROS = [
  { id: 'pro-a', businessId: 'biz-t1', name: 'Dra. Ana', role: 'Clínica geral', photo: '', active: true, createdAt: '2026-01-01' },
  { id: 'pro-b', businessId: 'biz-t1', name: 'Dr. Bruno', role: 'Cirurgião', photo: '', active: true, createdAt: '2026-01-01' },
];

const slotsApi = vi.hoisted(() => ({
  slots: ['09:00', '09:30', '10:00'],
  posts: 0,
}));

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async () => ({ ok: true, status: 200, data: { pets: [], results: [] } })),
  apiSend: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
}));

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
});

beforeEach(() => {
  document.body.innerHTML = '';
  slotsApi.posts = 0;
  global.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (init?.method === 'POST') slotsApi.posts += 1;
    if (url.includes('mode=slots-admin')) {
      return { ok: true, status: 200, json: async () => ({ slots: slotsApi.slots, state: 'open', full: false, closed: false }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(cleanup);

const dialog = () => document.querySelector<HTMLElement>('dialog.il-drawer')!;
const strip = () => document.querySelector<HTMLElement>('.il-drawer__strip')!;
const basePanel = () => document.querySelector<HTMLElement>('.il-drawer__panel--base')!;
const sidePanel = () => document.querySelector<HTMLElement>('.il-drawer__panel--side');

// ═════════════════════════════════════════════════════════════════════════
describe('5 · composição aninhada usa o preset compartilhado 50/50', () => {
  it('os DOIS painéis recebem exatamente o mesmo preset de largura', () => {
    render(
      <Drawer open onClose={() => {}} title="Novo agendamento" subtitle="Paciente → serviço → data e horário → confirmação"
        width={WORKSPACE_SHEET_SIZES.standard}
        side={<button type="button">Salvar paciente</button>}
        sideTitle="Cadastrar novo paciente" sideSubtitle="Dados do tutor e do paciente"
        sideWidth={WORKSPACE_SHEET_SIZES.nestedForm} onSideClose={() => {}}>
        <input aria-label="serviço" defaultValue="Consulta" />
      </Drawer>,
    );

    expect(basePanel().className).toContain(WORKSPACE_NESTED_PANEL);
    expect(sidePanel()!.className).toContain(WORKSPACE_NESTED_PANEL);
    // Nenhum painel carrega largura própria/exclusiva no par: a simetria é o
    // contrato (nada de base esticado + auxiliar estreito).
    expect(basePanel().className).not.toContain('flex-1');
    expect(sidePanel()!.className).not.toMatch(/max-w-|w-full|shrink-0/);
  });

  it('a faixa usa o preset compartilhado de overlay expandido', () => {
    render(
      <Drawer open onClose={() => {}} title="Novo agendamento"
        width={WORKSPACE_SHEET_SIZES.standard}
        side={<button type="button">Salvar paciente</button>} sideTitle="Cadastrar novo paciente">
        <span>corpo</span>
      </Drawer>,
    );
    expect(strip().className).toContain(WORKSPACE_SHEET_SIZES.expanded);
    expect(strip().getAttribute('data-expanded')).toBe('true');
  });

  it('o par é um grid de duas colunas iguais: mesma altura e headers alinhados', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain(".il-drawer__strip[data-expanded='true'] .il-drawer__panels {");
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);');
    // Os dois painéis do par ficam com a largura do grid (não a do preset de
    // formulário), o que garante metades idênticas.
    expect(css).toContain(".il-drawer__strip[data-expanded='true'] .il-drawer__panel {");
    expect(css).toContain('max-width: none !important;');
  });

  it('é UM overlay só (nunca sheet dentro de sheet) com headers do mesmo padrão', () => {
    render(
      <Drawer open onClose={() => {}} title="Novo agendamento" subtitle="Paciente → serviço → data e horário"
        width={WORKSPACE_SHEET_SIZES.standard}
        side={<button type="button">Salvar paciente</button>} sideTitle="Cadastrar novo paciente" sideSubtitle="Dados do tutor e do paciente">
        <span>corpo</span>
      </Drawer>,
    );
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    const headers = Array.from(dialog().querySelectorAll('header'));
    expect(headers).toHaveLength(2);
    for (const h of headers) expect(h.className).toContain('ws-sheet__header');
    // Títulos e subtítulos preservados nos dois lados.
    expect(screen.getByRole('heading', { name: 'Novo agendamento' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cadastrar novo paciente' })).toBeTruthy();
  });

  it('sozinho, o Novo agendamento usa o preset operacional compartilhado (nem esticado, nem estreito)', () => {
    const booking = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(booking).toContain('width={WORKSPACE_SHEET_SIZES.standard}');
    expect(booking).not.toContain('width={WORKSPACE_SHEET_SIZES.wide}');
    // Preset existe na fonte única do Design System.
    const sizes = read('src/lib/workspace-sheet-sizes.ts');
    expect(sizes).toContain("standard: 'max-w-2xl'");
    expect(sizes).toContain("expanded: 'max-w-[1280px]'");
    expect(sizes).toContain('WORKSPACE_NESTED_PANEL');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('6 · viewport estreita: cadastro assume a faixa e o agendamento volta preservado', () => {
  it('a CSS declara o desmonte do par e a faixa inteira para o cadastro', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('@media (max-width: 1359px)');
    expect(css).toContain(".il-drawer__strip[data-expanded='true'] .il-drawer__panels { grid-template-columns: minmax(0, 1fr); }");
    expect(css).toContain(".il-drawer__strip[data-expanded='true'] .il-drawer__panel--recessed { display: none; }");
    expect(css).toContain(".il-drawer__strip[data-expanded='true'] .il-drawer__panel--side {");
  });

  it('abrir o cadastro mantém o agendamento montado; fechar preserva data/hora/serviço/profissional', async () => {
    const user = userEvent.setup();
    render(
      <NewBookingSheet
        businessId="biz-t1"
        services={SERVICES as never}
        pros={PROS as never}
        horizonDays={60}
        timezone="America/Sao_Paulo"
        initial={{ name: '', phone: '', date: '2026-10-01', time: '09:30', professionalId: 'pro-a' }}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    // Estado inicial do prefill.
    const sheet = () => within(dialog());
    expect((sheet().getByLabelText(/^3\. Data/) as HTMLInputElement).value).toBe('2026-10-01');
    await user.selectOptions(sheet().getByLabelText(/^2\. Serviço/), 'svc-1');
    await waitFor(() => expect(sheet().queryByLabelText(/^Profissional/)).toBeTruthy());
    expect((sheet().getByLabelText(/^Profissional/) as HTMLSelectElement).value).toBe('pro-a');
    await waitFor(() => expect(within(dialog()).getAllByRole('button').some((b) => b.textContent?.trim() === '09:30')).toBe(true));

    // Abre o cadastro DENTRO do mesmo overlay.
    const openRegister = within(dialog()).getAllByRole('button').find((b) => /Cadastrar/i.test(b.textContent || ''))!;
    await user.click(openRegister);
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    expect(sidePanel()).toBeTruthy();
    // O agendamento continua MONTADO (é isso que preserva o estado na volta).
    expect(basePanel()).toBeTruthy();

    // Volta (cancelar o cadastro).
    await user.click(within(dialog()).getByRole('button', { name: 'Voltar' }));

    await waitFor(() => expect(sidePanel()).toBeNull());
    expect((sheet().getByLabelText(/^3\. Data/) as HTMLInputElement).value).toBe('2026-10-01');
    expect((sheet().getByLabelText(/^2\. Serviço/) as HTMLSelectElement).value).toBe('svc-1');
    expect((sheet().getByLabelText(/^Profissional/) as HTMLSelectElement).value).toBe('pro-a');
    await waitFor(() => expect(within(dialog()).getAllByRole('button').some((b) => b.textContent?.trim() === '09:30')).toBe(true));
    expect(slotsApi.posts).toBe(0);
  });
});
