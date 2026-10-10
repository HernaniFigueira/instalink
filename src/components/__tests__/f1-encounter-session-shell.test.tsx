// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// F1 · SESSÃO CLÍNICA DO WORKSPACE (cabeçalho, navegação, rodapé, revisão)
// ═══════════════════════════════════════════════════════════════
// Travas desta suíte (todas sobre o componente real, sem mock de regra):
//   1. cabeçalho: paciente protagonista; espécie/raça/idade/sexo SÓ do cadastro;
//      tutor com telefone real; serviço, profissional e status do AGENDAMENTO
//      separado do estado clínico;
//   2. navegação agrupada (Atendimento · Plano clínico), só com seções reais;
//   3. rodapé persistente: CTA "Finalizar atendimento" só para o responsável em
//      rascunho; leitura para os demais; finalizado sem CTA;
//   4. timer só a partir de `startedAt` PERSISTIDO — nunca criado no cliente;
//      fora da janela de 24 h não conta ao vivo (Entrega 2: mora no RAIL);
//   5. o CTA do rodapé abre a MESMA revisão (Dialog canônico);
//   6. revisão em hierarquia (avaliação/plano → retorno/pendências → autoria →
//      demais dados) com dados reais; pendências = blocos vazios;
//   7. histórico e arquivos somente leitura, com links reais.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { EncounterWorkspaceBody } from '../dashboard/EncounterWorkspaceBody';
import { EncounterWorkspace } from '../dashboard/EncounterWorkspace';
import { encounterTimer } from '@/lib/encounter-timer';
import type { EncounterAuthorityRow } from '../dashboard/useEncounterAuthority';
import { apiGet, apiSend } from '@/lib/api-client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn(), apiGet: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function row(extra: Partial<EncounterAuthorityRow> = {}): EncounterAuthorityRow {
  return {
    id: 'e-s1', businessId: 'b1', status: 'draft', version: 3,
    bookingId: 'bk-1', queueId: '', serviceId: 'svc-1', professionalId: 'pro-michelle',
    customerId: '', contactId: 'ct-1', customerName: 'Isabelle',
    date: '2026-10-09', time: '14:00',
    complaint: 'Coceira intensa', evolution: '', guidance: '', followUp: '', followUpMode: 'none',
    internalNote: '', tags: [],
    createdAt: '2026-10-09T17:00:00.000Z', updatedAt: '2026-10-09T17:00:00.000Z',
    createdBy: 'u1', updatedBy: 'u1', finalizedAt: '', finalizedBy: '', signedBy: '',
    petId: 'pet-mel', startedAt: new Date().toISOString(),
    clinicType: 'veterinaria',
    access: {
      canEditCore: true, canEditVisitAnamnesis: true, canEditVeterinaryAssessment: true,
      canEditClinicalProblems: true, canEditCarePlan: true, canEditClinicalProcedures: true,
      modules: ['core', 'vet'], reason: 'editable',
    },
    context: {
      clinicalState: 'in_progress',
      patient: {
        id: 'pet-mel', name: 'Mel', species: 'dog', speciesLabel: 'Cachorro', breed: 'SRD',
        sex: 'F', birthDate: '', ageLabel: '2 anos', weightKg: 8.4,
      },
      responsible: { id: 'ct-1', name: 'Isabelle', phone: '11999990001' },
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

function renderBody(initial: EncounterAuthorityRow) {
  get.mockResolvedValue(ok(initial));
  send.mockResolvedValue(ok(initial));
  return render(createElement(EncounterWorkspaceBody, {
    businessId: 'b1', row: initial, onRow: () => {}, registerLeave: () => {},
    fullRecordHref: '/atendimento/e-s1/registro?returnTo=%2Fagenda',
    onNavigate: () => {},
  }));
}

describe('Cabeçalho da sessão (workspace)', () => {
  it('mostra paciente, espécie/raça/idade/sexo, tutor com telefone, serviço, profissional e status do agendamento', async () => {
    get.mockResolvedValue(ok(row()));
    render(createElement(EncounterWorkspace, { businessId: 'b1', encounterId: 'e-s1', returnTo: '/agenda' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Mel' });
    const header = heading.closest('aside')!; // rail de contexto persistente (F-convergência)
    expect(header.textContent).toContain('Cachorro · SRD · 2 anos · Fêmea');
    expect(header.textContent).toContain('Tutor: Isabelle · 11999990001');
    expect(header.textContent).toContain('Consulta clínica');
    expect(header.textContent).toContain('Michelle');
    expect(header.textContent).toContain('Agendamento: Confirmado');
    // Estado clínico e agendamento são eixos distintos, ambos textuais.
    expect(header.textContent).toMatch(/EM ATENDIMENTO/i);
  });

  it('não inventa sexo quando o cadastro não tem o dado', async () => {
    const base = row();
    const patient = base.context!.patient!;
    get.mockResolvedValue(ok(row({ context: { ...base.context!, patient: { ...patient, sex: '' as const } } } as never)));
    render(createElement(EncounterWorkspace, { businessId: 'b1', encounterId: 'e-s1', returnTo: '/agenda' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Mel' });
    expect(heading.closest('aside')!.textContent).not.toMatch(/Macho|Fêmea/);
  });
});

describe('Navegação contextual agrupada', () => {
  it('veterinária: grupos "Atendimento" e "Plano clínico" com as seções reais', () => {
    renderBody(row());
    const atendimento = screen.getByRole('group', { name: 'Atendimento' });
    const plano = screen.getByRole('group', { name: 'Plano clínico' });
    expect(within(atendimento).getAllByRole('button').map((b) => b.textContent)).toEqual(['Atendimento', 'Anamnese', 'Avaliação']);
    expect(within(plano).getAllByRole('button').map((b) => b.textContent)).toEqual(['Problemas', 'Conduta', 'Procedimentos']);
  });

  it('vertical sem módulo clínico: nenhuma navegação morta', () => {
    renderBody(row({ clinicType: 'geral', access: { canEditCore: true, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false, modules: ['core'], reason: 'module_unavailable' } } as never));
    expect(screen.queryByRole('group', { name: 'Atendimento' })).toBeNull();
    expect(document.querySelectorAll('.encounter-workspace__nav-item')).toHaveLength(0);
  });
});

describe('Rodapé persistente', () => {
  it('rascunho do responsável: estado de gravação e CTA "Finalizar atendimento" — timer e switcher ficam no rail', () => {
    renderBody(row());
    const footer = screen.getByTestId('encounter-session-footer');
    expect(within(footer).getByRole('button', { name: 'Finalizar atendimento' })).toBeTruthy();
    // Entrega 2: o rodapé não duplica o switcher nem o timer do rail.
    expect(within(footer).queryByRole('button', { name: 'Registro completo' })).toBeNull();
    expect(within(footer).queryByTestId('encounter-timer')).toBeNull();
    expect(screen.getByTestId('encounter-workspace-save-state')).toBeTruthy();
  });

  it('o CTA do rodapé abre a MESMA revisão de finalização (sem finalizar sozinho)', () => {
    renderBody(row());
    const footer = screen.getByTestId('encounter-session-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Finalizar atendimento' }));
    const dialog = screen.getByRole('dialog', { name: 'Revisar e finalizar' });
    expect(dialog).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('outro profissional: leitura, sem CTA de finalizar e sem estado de gravação falso', () => {
    renderBody(row({ access: { canEditCore: false, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false, canEditClinicalProblems: false, canEditCarePlan: false, canEditClinicalProcedures: false, modules: ['core', 'vet'], reason: 'not_responsible' } } as never));
    const footer = screen.getByTestId('encounter-session-footer');
    expect(within(footer).queryByRole('button', { name: 'Finalizar atendimento' })).toBeNull();
    expect(within(footer).getByTestId('encounter-readonly-state').textContent).toContain('Somente leitura · responsável: Michelle');
    expect(screen.queryByTestId('encounter-workspace-save-state')).toBeNull();
  });

  it('finalizado: sem CTA; "Ver fechamento" no lugar e estado de finalização', () => {
    renderBody(row({ status: 'finalized', finalizedAt: '2026-10-09T18:00:00.000Z', signedBy: 'Michelle', access: { canEditCore: false, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false, canEditClinicalProblems: false, canEditCarePlan: false, canEditClinicalProcedures: false, modules: ['core', 'vet'], reason: 'finalized' } } as never));
    const footer = screen.getByTestId('encounter-session-footer');
    expect(within(footer).queryByRole('button', { name: 'Finalizar atendimento' })).toBeNull();
    expect(within(footer).getByRole('button', { name: 'Ver fechamento' })).toBeTruthy();
    expect(within(footer).getByTestId('encounter-finalized-state').textContent).toMatch(/Finalizado em/);
    expect(within(footer).queryByTestId('encounter-timer')).toBeNull();
  });
});

describe('Timer: somente a partir de timestamp persistido', () => {
  const now = new Date('2026-10-09T15:00:00.000Z');

  it('início recente: relógio HH:MM:SS ao vivo a partir do startedAt gravado', () => {
    const t = encounterTimer('2026-10-09T14:57:46.000Z', now);
    expect(t).toMatchObject({ kind: 'live', clock: '00:02:14' });
  });

  it('início fora da janela de 24 h (registro esquecido aberto): NÃO conta ao vivo', () => {
    const t = encounterTimer('2026-10-07T12:00:00.000Z', now);
    expect(t?.kind).toBe('stale');
    expect(t && t.kind === 'stale' ? t.label : '').toMatch(/^Iniciado em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}$/);
  });

  it('sem timestamp válido: não há timer', () => {
    expect(encounterTimer(undefined, now)).toBeNull();
    expect(encounterTimer('isto-não-é-data', now)).toBeNull();
  });

  it('nem o rodapé nem o timer criam timestamp de início no cliente', () => {
    const footer = readFileSync(join(process.cwd(), 'src/components/dashboard/EncounterSessionFooter.tsx'), 'utf8');
    const timer = readFileSync(join(process.cwd(), 'src/lib/encounter-timer.ts'), 'utf8');
    expect(footer).not.toMatch(/Date\.now\(|encounter-timer/);
    expect(timer).not.toMatch(/Date\.now\(/);
    expect(timer).toMatch(/startedAt/);
  });
});

describe('Revisão de finalização em hierarquia', () => {
  it('ordem: avaliação e plano → retorno e pendências → autoria → demais dados', () => {
    renderBody(row({ followUpMode: 'interval', followUpDays: 15 } as never));
    fireEvent.click(within(screen.getByTestId('encounter-session-footer')).getByRole('button', { name: 'Finalizar atendimento' }));
    const review = screen.getByTestId('encounter-review');
    const titles = within(review).getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(titles).toEqual(['Avaliação e plano', 'Retorno e pendências', 'Autoria', 'Demais dados']);
    expect(review.textContent).toContain('Retorno em 15 dias');
  });

  it('pendências são os blocos realmente vazios (sem inventar campo)', () => {
    renderBody(row({ complaint: 'Coceira' } as never));
    fireEvent.click(within(screen.getByTestId('encounter-session-footer')).getByRole('button', { name: 'Finalizar atendimento' }));
    const pending = screen.getByText('Pendências de preenchimento').parentElement!;
    const items = within(pending).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Avaliação', 'Problemas', 'Conduta']);
  });
});

describe('Histórico e arquivos (somente leitura)', () => {
  it('lista os arquivos reais com link e informa o caminho para anexar', () => {
    renderBody(row({ files: [{ id: 'f1', name: 'raio-x.pdf', url: 'https://blob.example/raio-x.pdf', size: 2048, createdAt: '2026-10-09T15:00:00.000Z', by: 'u1' }] } as never));
    const history = screen.getByTestId('encounter-history');
    const link = within(history).getByRole('link', { name: 'raio-x.pdf' });
    expect(link.getAttribute('href')).toBe('https://blob.example/raio-x.pdf');
    expect(history.textContent).toContain('2 KB');
    expect(history.textContent).toContain('Clientes');
  });

  it('sem arquivos: estado vazio honesto, sem botão de upload falso', () => {
    renderBody(row());
    const history = screen.getByTestId('encounter-history');
    expect(history.textContent).toContain('Nenhum arquivo neste atendimento');
    expect(within(history).queryByRole('button')).toBeNull();
  });
});
