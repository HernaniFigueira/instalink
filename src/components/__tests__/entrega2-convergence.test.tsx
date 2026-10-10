// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// ENTREGA 2 · CLIENTE 360 + ATENDIMENTO + REGISTRO (convergência)
// ═══════════════════════════════════════════════════════════════
// Travas (componentes reais; só a rede e o roteador são simulados):
//   1. timer "● HH:MM:SS" derivado do startedAt do servidor, atualiza a cada
//      segundo e não zera ao remontar (reload/troca de aba);
//   2. switcher "Atendimento | Registro completo" no rail, com a superfície
//      atual marcada e navegação pela guarda — nunca rotulado "Voltar";
//   3. Voltar diz para onde vai: Cliente 360 → "Voltar para <nome>"; Agenda →
//      "Voltar para agenda" devolvendo data/visão/profissional/filtros;
//   4. Conduta mostra Orientações/Retorno como RESUMO rotulado (fonte única é
//      Atendimento) — nunca um segundo editor;
//   5. Registro finalizado = documento somente leitura (sem campo editável);
//   6. abas com overflow explícito: visíveis + "Mais", selecionada sempre
//      visível, sem rolagem lateral escondida.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EncounterWorkspace } from '../dashboard/EncounterWorkspace';
import { EncounterWorkspaceBody } from '../dashboard/EncounterWorkspaceBody';
import { EncounterSessionTimer, EncounterSurfaceSwitch } from '../dashboard/EncounterSessionRail';
import { EncounterClinicalDocument } from '../dashboard/EncounterClinicalDocument';
import { EncounterSheet, type EncounterRow } from '../dashboard/EncounterSheet';
import { OverflowTabs, type TabItem } from '../ui';
import type { EncounterAuthorityRow } from '../dashboard/useEncounterAuthority';
import { apiGet, apiSend } from '@/lib/api-client';
import { encounterHref, encounterReturnLabel, encounterSurfaceHref } from '@/lib/encounter-workspace';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn(), apiGet: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ encounterId: 'e-s1' }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock('../dashboard/usePanelPermissions', () => ({
  usePanelPermissions: () => ({ permissions: { atendimento: true }, ready: true }),
}));
vi.mock('../dashboard/useBusinessId', () => ({
  useBusinessId: () => ({ businessId: 'b1', resolving: false, noBusiness: false, contextError: '' }),
}));

const get = vi.mocked(apiGet);
const send = vi.mocked(apiSend);
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

function row(extra: Partial<EncounterAuthorityRow> = {}): EncounterAuthorityRow {
  return {
    id: 'e-s1', businessId: 'b1', status: 'draft', version: 3,
    bookingId: 'bk-1', queueId: '', serviceId: 'svc-1', professionalId: 'pro-michelle',
    customerId: '', contactId: 'ct-1', customerName: 'Bernardo Almeida',
    date: '2026-10-09', time: '14:00',
    complaint: 'Coceira', evolution: 'Pele melhor', guidance: 'Limpeza otológica 2x por semana',
    followUp: 'Ligar se piorar', followUpMode: 'interval', followUpDays: 15,
    internalNote: 'NOTA-SO-DA-UNIDADE', tags: [],
    createdAt: '2026-10-09T17:00:00.000Z', updatedAt: '2026-10-09T17:00:00.000Z',
    createdBy: 'u1', updatedBy: 'u1', finalizedAt: '', finalizedBy: '', signedBy: '',
    petId: 'pet-thor', startedAt: new Date(Date.now() - 134_000).toISOString(),
    clinicType: 'veterinaria',
    access: {
      canEditCore: true, canEditVisitAnamnesis: true, canEditVeterinaryAssessment: true,
      canEditClinicalProblems: true, canEditCarePlan: true, canEditClinicalProcedures: true,
      modules: ['core', 'vet'], reason: 'editable',
    },
    context: {
      clinicalState: 'in_progress',
      patient: { id: 'pet-thor', name: 'Thor', species: 'dog', speciesLabel: 'Cachorro', breed: 'Golden Retriever', sex: 'M', birthDate: '', ageLabel: '7 anos', weightKg: 31 },
      responsible: { id: 'ct-1', name: 'Bernardo Almeida', phone: '21987650011' },
      service: { id: 'svc-1', name: 'Consulta clínica', durationMin: 30 },
      professional: { id: 'pro-michelle', name: 'Michelle', role: 'Veterinária' },
      booking: { id: 'bk-1', date: '2026-10-09', time: '14:00', status: 'confirmed' },
      queue: null,
    },
    files: [],
    professionalName: 'Michelle',
    ...extra,
  } as unknown as EncounterAuthorityRow;
}

function ok(encounter: EncounterAuthorityRow) {
  return { ok: true, status: 200, data: { encounter }, message: '', denied: null, flow: 'stay', networkError: false } as never;
}

describe('Timer da sessão (startedAt do servidor)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T15:00:00.000Z')); });

  it('mostra "Em atendimento 00:02:14", avança a cada segundo e não zera ao remontar', () => {
    const startedAt = '2026-10-09T14:57:46.000Z';
    const first = render(createElement(EncounterSessionTimer, { startedAt }));
    const timer = screen.getByTestId('encounter-timer');
    expect(timer.getAttribute('data-timer-state')).toBe('live');
    expect(timer.textContent).toContain('Em atendimento');
    expect(timer.textContent).toContain('00:02:14');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('encounter-timer').textContent).toContain('00:02:15');
    // "reload": desmonta e monta de novo — o relógio continua do startedAt.
    first.unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    render(createElement(EncounterSessionTimer, { startedAt }));
    expect(screen.getByTestId('encounter-timer').textContent).toContain('00:02:20');
  });

  it('pulso discreto respeita prefers-reduced-motion', () => {
    const css = src('src/app/globals.css');
    expect(css).toMatch(/\.encounter-timer__dot/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.encounter-timer__dot/);
  });
});

describe('Switcher Atendimento | Registro completo', () => {
  it('marca a superfície atual e só navega para a outra', () => {
    const onSelect = vi.fn();
    render(createElement(EncounterSurfaceSwitch, { current: 'atendimento', onSelect }));
    const nav = screen.getByTestId('encounter-surface-switch');
    const [atendimento, registro] = within(nav).getAllByRole('button');
    expect(atendimento.textContent).toBe('Atendimento');
    expect(atendimento.getAttribute('aria-current')).toBe('page');
    expect(registro.textContent).toBe('Registro completo');
    expect(nav.textContent).not.toMatch(/Voltar/);
    fireEvent.click(atendimento);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(registro);
    expect(onSelect).toHaveBeenCalledWith('registro');
  });

  it('as duas telas usam o MESMO switcher no rail (Atendimento e Registro)', () => {
    expect(src('src/components/dashboard/EncounterWorkspace.tsx')).toMatch(/surfaces=\{\{ current: 'atendimento'/);
    expect(src('src/components/dashboard/EncounterSheet.tsx')).toMatch(/current: 'registro'/);
    // e o rodapé não tem um segundo atalho para o Registro
    expect(src('src/components/dashboard/EncounterSessionFooter.tsx')).not.toMatch(/>\s*Registro completo\s*</);
  });
});

describe('Voltar previsível (returnTo)', () => {
  it('rótulo diz o destino: Cliente 360 → nome; Agenda → agenda', () => {
    expect(encounterReturnLabel('/clientes/contact%3Act-1?b=b1', 'Bernardo Almeida')).toBe('Voltar para Bernardo');
    expect(encounterReturnLabel('/agenda?b=b1&data=2026-10-09&view=semana', 'Bernardo')).toBe('Voltar para agenda');
    expect(encounterReturnLabel(null, 'Bernardo')).toBe('Voltar para agenda');
    expect(encounterReturnLabel('https://evil.example/x', 'Bernardo')).toBe('Voltar para agenda');
  });

  it('a troca de superfície preserva a MESMA origem de volta', () => {
    const back = '/agenda?b=b1&data=2026-10-09&view=semana&prof=pro-michelle&status=confirmed';
    for (const surface of ['atendimento', 'registro'] as const) {
      const href = encounterSurfaceHref(surface, 'e-s1', 'b1', back);
      expect(new URL(href, 'http://x').searchParams.get('returnTo')).toBe(back);
    }
    expect(new URL(encounterHref('e-s1', 'b1', back), 'http://x').searchParams.get('returnTo')).toBe(back);
  });

  it('a partir da Agenda: "Voltar para agenda" devolve data/visão/profissional/filtros intactos', async () => {
    const back = '/agenda?b=b1&data=2026-10-09&view=semana&prof=pro-michelle&status=confirmed';
    get.mockResolvedValue(ok(row()));
    render(createElement(EncounterWorkspace, { businessId: 'b1', encounterId: 'e-s1', returnTo: back }));
    const button = await screen.findByRole('button', { name: 'Voltar para agenda' });
    fireEvent.click(button);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(back));
  });

  it('a partir do Cliente 360: "Voltar para Bernardo" volta para a ficha', async () => {
    const back = '/clientes/contact%3Act-1?b=b1';
    get.mockResolvedValue(ok(row()));
    render(createElement(EncounterWorkspace, { businessId: 'b1', encounterId: 'e-s1', returnTo: back }));
    const button = await screen.findByRole('button', { name: 'Voltar para Bernardo' });
    fireEvent.click(button);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(back));
  });

  it('o rail do Atendimento mostra o timer ao vivo e o switcher', async () => {
    get.mockResolvedValue(ok(row()));
    render(createElement(EncounterWorkspace, { businessId: 'b1', encounterId: 'e-s1', returnTo: '/agenda' }));
    const rail = (await screen.findByRole('heading', { level: 1, name: 'Thor' })).closest('aside')!;
    expect(within(rail).getByTestId('encounter-timer').textContent).toMatch(/Em atendimento\s*\d{2}:\d{2}:\d{2}/);
    fireEvent.click(within(within(rail).getByTestId('encounter-surface-switch')).getByRole('button', { name: 'Registro completo' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/atendimento/e-s1/registro')));
    expect(router.push.mock.calls[0][0]).toContain('returnTo=%2Fagenda');
  });
});

describe('Conduta × Orientações ao tutor (fonte única)', () => {
  it('Conduta mostra orientações e retorno como resumo rotulado, sem segundo editor', async () => {
    const initial = row();
    get.mockResolvedValue(ok(initial));
    send.mockResolvedValue(ok(initial));
    render(createElement(EncounterWorkspaceBody, {
      businessId: 'b1', row: initial, onRow: () => {}, registerLeave: () => {},
      fullRecordHref: '/atendimento/e-s1/registro', onNavigate: () => {},
    }));
    // No Atendimento o campo é editável…
    expect(screen.getByLabelText('Orientações ao tutor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Conduta' }));
    // …na Conduta, é um resumo (sem textarea com esse rótulo).
    const summary = await screen.findByTestId('plan-context');
    expect(screen.queryByLabelText('Orientações ao tutor')).toBeNull();
    expect(summary.textContent).toContain('Limpeza otológica 2x por semana');
    expect(within(summary).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(summary).getByRole('button', { name: 'Editar em Atendimento' })).toBeTruthy();
  });

  it('a seção Conduta só grava a própria fatia (conduct) — orientações não viajam por ela', () => {
    const care = src('src/components/dashboard/EncounterCarePlanSection.tsx');
    expect(care).toMatch(/clinical: \{ plan: \{ conduct: form\.conduct \} \}/);
    expect(care).not.toMatch(/guidance:\s*form\./);
  });
});

describe('Registro completo finalizado = documento', () => {
  it('renderiza as seções clínicas em leitura, sem nenhum campo editável', () => {
    const finalized = row({ status: 'finalized', finalizedAt: '2026-10-09T18:00:00.000Z', signedBy: 'Michelle' } as never);
    render(createElement(EncounterClinicalDocument, { row: finalized as never }));
    const doc = screen.getByTestId('encounter-clinical-document');
    expect(doc.textContent).toContain('Limpeza otológica 2x por semana');
    expect(doc.textContent).toContain('Pele melhor');
    expect(doc.querySelectorAll('textarea, input, select, [contenteditable="true"]')).toHaveLength(0);
  });

  it('quem não reabre vê a regra de reabertura DENTRO de Pós-finalização (não solta)', () => {
    const finalized = { id: 'e-reg', businessId: 'b1', status: 'finalized', version: 3,
      customerName: 'Bernardo', date: '2026-10-09', time: '08:00', tags: [],
      complaint: 'Retorno', evolution: 'Pele melhor', guidance: '', internalNote: '', followUp: '',
      createdAt: '2026-10-09T11:00:00Z', updatedAt: '2026-10-09T11:10:00Z',
      bookingId: '', queueId: '', serviceId: '', professionalId: '', customerId: '', contactId: '',
      createdBy: 'u1', updatedBy: 'u1', finalizedAt: '2026-10-09T11:10:00Z', finalizedBy: 'u1', signedBy: 'Michelle',
      professionalName: '', serviceName: '', bookingStatus: '', customerPhone: '',
    } as unknown as EncounterRow;
    get.mockResolvedValue({ ok: false, status: 404, error: 'x' } as never);
    const html = (canReopen: boolean) => {
      cleanup();
      return render(createElement(EncounterSheet, { businessId: 'b1', existing: finalized, onClose: () => {}, layout: 'page', canReopen })).container;
    };
    const vet = html(false);
    const info = vet.querySelector('[data-doc-section="addenda"] [data-testid="registro-reopen-info"]');
    expect(info?.textContent).toContain('Somente quem administra a unidade reabre um registro finalizado.');
    expect(vet.querySelector('[data-doc-section="addenda"]')?.textContent).toContain('Pós-finalização');
    // Uma única ocorrência — nenhuma linha órfã fora da seção.
    expect(vet.textContent!.split('Somente quem administra a unidade reabre').length - 1).toBe(1);
    // Quem pode reabrir não vê o aviso (regra de permissão inalterada).
    expect(html(true).querySelector('[data-testid="registro-reopen-info"]')).toBeNull();
  });

  it('o Registro não tem Salvar/Finalizar próprios: a escrita é no Atendimento', () => {
    const sheet = src('src/components/dashboard/EncounterSheet.tsx');
    expect(sheet).toMatch(/Revisar e finalizar no Atendimento/);
    expect(sheet).toMatch(/#encounter-closing/);
  });
});

describe('Abas com overflow explícito ("Mais")', () => {
  const items: TabItem<string>[] = [
    { id: 'a', label: 'Visão geral' },
    { id: 'b', label: 'Agenda', count: 3 },
    { id: 'c', label: 'Atendimento' },
    { id: 'd', label: 'Conversas' },
    { id: 'e', label: 'Financeiro' },
  ];

  function Harness({ initial = 'a', onChange }: { initial?: string; onChange?: (id: string) => void }) {
    const [value, setValue] = useState(initial);
    return createElement(OverflowTabs<string>, {
      items, value, ariaLabel: 'Seções', onChange: (id: string) => { setValue(id); onChange?.(id); },
    });
  }

  beforeEach(() => {
    // jsdom não faz layout: host com 300px, cada aba 100px, "Mais" 72px.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('gd-overflow-tabs') ? 300 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.hasAttribute('data-ruler-more') ? 72 : this.hasAttribute('data-ruler-tab') ? 100 : 0;
      return { width, height: 30, top: 0, left: 0, right: width, bottom: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('mostra as que cabem e manda o resto para "Mais", sem rolagem lateral', () => {
    render(createElement(Harness));
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Visão geral', 'Agenda3']);
    const more = screen.getByRole('button', { name: /Mais — 3 seções/ });
    expect(more).toBeTruthy();
    expect(src('src/components/dashboard/ClientProfileDrawer.tsx')).not.toMatch(/client360-tabs-wrap|data-overflow-right/);
  });

  it('escolher no "Mais" seleciona e a aba passa a ficar visível; teclado abre o menu', () => {
    const onChange = vi.fn();
    render(createElement(Harness, { onChange }));
    const more = screen.getByRole('button', { name: /Mais — 3 seções/ });
    fireEvent.keyDown(more, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    fireEvent.click(within(menu).getByText('Financeiro'));
    expect(onChange).toHaveBeenCalledWith('e');
    const tabs = screen.getAllByRole('tab');
    const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent).toBe('Financeiro');
    expect(tabs).toHaveLength(2);
  });

  it('aba selecionada no excedente aparece já no primeiro layout', () => {
    render(createElement(Harness, { initial: 'd' }));
    const selected = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent).toBe('Conversas');
  });
});

describe('Cliente 360 — rail de contexto', () => {
  it('rail com Voltar, Identidade (avatar + nome ao lado), Contato e Cadastro; sem barra sticky por cima', () => {
    const drawer = src('src/components/dashboard/ClientProfileDrawer.tsx');
    const rail = drawer.slice(drawer.indexOf('<aside className="entity-rail"'), drawer.indexOf('</aside>'));
    expect(rail).toMatch(/Voltar para clientes/);
    expect(rail).toMatch(/entity-rail__who[\s\S]*<Avatar[\s\S]*entity-rail__name/);
    expect(rail).toMatch(/>Contato</);
    expect(rail).toMatch(/>Cadastro</);
    expect(rail).toMatch(/label="CPF"/);
    expect(drawer).not.toMatch(/client-profile-page__toolbar/);
    expect(drawer).not.toMatch(/entity-main__admin/);
  });

  it('sticky abaixo da topbar, com altura limitada e sem ancestral que corte', () => {
    const css = src('src/app/globals.css');
    expect(css).toMatch(/--gd-context-sticky-top: calc\(var\(--topbar-h, 64px\) \+ 16px\)/);
    expect(css).toMatch(/\.entity-rail \{\s*top: var\(--gd-context-sticky-top[\s\S]*?max-height: calc\(100dvh - var\(--gd-context-sticky-top/);
    expect(css).not.toMatch(/\.entity-panel \{ overflow: clip; \}/);
    expect(css).toMatch(/\.gd-page-frame--context \{ max-width:none; \}/);
  });
});
