// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// F1B2 · PROBLEMAS · CONDUTA · PROCEDIMENTOS NO COMPONENTE REAL (jsdom)
// ═══════════════════════════════════════════════════════════════
// Travas desta suíte:
//   1. lista COMPACTA com nomes acessíveis reais (tipo, descrição, remover);
//   2. identidade estável: adicionar/editar/reordenar não troca o `id` do item;
//   3. remoção de item COM conteúdo pede confirmação na própria linha (sem
//      diálogo nativo) e "Cancelar" preserva o item;
//   4. o payload leva SÓ a fatia da seção, com a versão da AUTORIDADE;
//   5. conduta não duplica guidance/followUp (aparecem como contexto em leitura);
//   6. procedimento aceita texto custom (catálogo é só sugestão);
//   7. a navegação por vertical continua isolando o pacote B2.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { EncounterClinicalProblemsSection } from '../dashboard/EncounterClinicalProblemsSection';
import { EncounterCarePlanSection } from '../dashboard/EncounterCarePlanSection';
import { EncounterClinicalProceduresSection } from '../dashboard/EncounterClinicalProceduresSection';
import { EncounterWorkspaceBody } from '../dashboard/EncounterWorkspaceBody';
import { useEncounterAuthority, type EncounterAuthorityRow } from '../dashboard/useEncounterAuthority';
import { apiGet, apiSend } from '@/lib/api-client';
import { ENCOUNTER_AUTOSAVE_MS } from '@/lib/encounters';

vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn(), apiGet: vi.fn() }));
const send = vi.mocked(apiSend);
const get = vi.mocked(apiGet);

type Result = Awaited<ReturnType<typeof apiSend>>;

function row(extra: Partial<EncounterAuthorityRow> = {}): EncounterAuthorityRow {
  return {
    id: 'e-f1b2', businessId: 'b1', status: 'draft', version: 7,
    bookingId: 'bk-1', queueId: '', serviceId: 'svc-1', professionalId: 'pro-michelle',
    customerId: '', contactId: 'ct-1', customerName: 'Isabelle',
    date: '2026-10-04', time: '15:00',
    complaint: 'Coceira nas orelhas', evolution: 'Eritema em orelha direita',
    guidance: 'Manter a orelha seca', followUp: 'Retorno em 15 dias', internalNote: '', tags: [],
    followUpMode: 'interval', followUpDays: 15,
    createdAt: '2026-10-04T17:00:00.000Z', updatedAt: '2026-10-04T17:00:00.000Z',
    createdBy: 'u1', updatedBy: 'u1', finalizedAt: '', finalizedBy: '', signedBy: '',
    petId: 'pet-mel',
    clinicType: 'veterinaria',
    access: {
      canEditCore: true, canEditVisitAnamnesis: true, canEditVeterinaryAssessment: true,
      canEditClinicalProblems: true, canEditCarePlan: true, canEditClinicalProcedures: true,
      modules: ['core', 'vet'], reason: 'editable',
    },
    clinical: {
      anamnesis: {},
      assessment: { veterinary: {} },
      problems: [],
      plan: { conduct: '' },
      procedures: [],
    },
    context: {
      clinicalState: 'in_progress',
      patient: { id: 'pet-mel', name: 'Mel', speciesLabel: 'Cachorro', breed: 'SRD', ageLabel: '2 anos', weightKg: 8.4 },
      responsible: { id: 'ct-1', name: 'Isabelle', phone: '11999990001' },
      service: { id: 'svc-1', name: 'Consulta dermatológica', durationMin: 30 },
      professional: { id: 'pro-michelle', name: 'Michelle', role: 'Veterinária' },
      booking: { id: 'bk-1', date: '2026-10-04', time: '15:00', status: 'confirmed' },
    },
    ...extra,
  } as EncounterAuthorityRow;
}

function okResult(encounter: EncounterAuthorityRow): Result {
  return { ok: true, status: 200, data: { encounter }, message: '', denied: null, flow: 'stay', networkError: false };
}
function failResult(status: number, message: string): Result {
  return { ok: false, status, data: null, message, denied: null, flow: 'stay', networkError: status === 0 };
}

/**
 * Mock que DEVOLVE o que foi enviado: o servidor real devolve a linha gravada,
 * e é isso que permite provar que a adoção do servidor não apaga o item.
 */
function echoServer(nextVersion: number) {
  send.mockImplementation(async (_path: unknown, _method: unknown, body: any) => {
    const previous = (row() as any).clinical;
    const clinical = { ...previous, ...(body?.clinical || {}) };
    return okResult(row({ version: nextVersion, clinical, ...(body?.clinical?.plan ? {} : {}) }) as any);
  });
}

function Harmony({
  children, initial = row(),
}: {
  children: (props: {
    authority: ReturnType<typeof useEncounterAuthority>['authority'];
    row: EncounterAuthorityRow;
    adoptToken: number;
  }) => React.ReactNode;
  initial?: EncounterAuthorityRow;
}) {
  const state = useEncounterAuthority(initial);
  const [adoptToken] = useState(0);
  return <>{children({ authority: state.authority, row: state.row, adoptToken })}</>;
}

const flushAutosave = async () => {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ENCOUNTER_AUTOSAVE_MS + 30); }); });
};

beforeEach(() => { send.mockReset(); get.mockReset(); });
afterEach(cleanup);

describe('F1B2 · seção Problemas (lista compacta, identidade estável)', () => {
  const renderProblems = (initial = row()) => render(
    <Harmony initial={initial}>
      {({ authority, row: r, adoptToken }) => (
        <EncounterClinicalProblemsSection
          businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
          blocked={false} editable readOnlyHint=""
        />
      )}
    </Harmony>,
  );

  it('renderiza a lista com nomes acessíveis reais e o tipo muito claro', () => {
    renderProblems(row({
      clinical: {
        problems: [
          { id: 'prb-1', kind: 'hypothesis', label: 'Dermatite alérgica', notes: '' },
          { id: 'prb-2', kind: 'diagnosis', label: 'Otite externa', notes: 'Confirmado na otoscopia.' },
        ],
        plan: { conduct: '' }, procedures: [],
      } as any,
    }) as any);
    const tipo = screen.getByLabelText('Tipo do problema 1') as HTMLSelectElement;
    expect([...tipo.options].map((option) => option.textContent)).toEqual(['Problema', 'Hipótese', 'Diagnóstico']);
    expect(tipo.value).toBe('hypothesis');
    expect((screen.getByLabelText('Descrição do problema 1') as HTMLInputElement).value).toBe('Dermatite alérgica');
    expect((screen.getByLabelText('Observação do problema 2') as HTMLInputElement).value).toBe('Confirmado na otoscopia.');
    // Remover tem nome acessível que diz O QUE some (não depende de cor/ícone).
    expect(screen.getByRole('button', { name: 'Remover Diagnóstico: Otite externa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adicionar problema' })).toBeTruthy();
  });

  it('adicionar item cria identidade própria e grava só a fatia de problemas', async () => {
    echoServer(8);
    renderProblems();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar problema' }));
    // Item novo já tem id estável (o índice do array nunca é identidade).
    const item = document.querySelector('[data-problem-id]')!;
    expect(item.getAttribute('data-problem-id')).toMatch(/^prb-/);

    fireEvent.change(screen.getByLabelText('Descrição do problema 1'), { target: { value: 'Otite externa' } });
    fireEvent.change(screen.getByLabelText('Tipo do problema 1'), { target: { value: 'diagnosis' } });
    await flushAutosave();

    expect(send).toHaveBeenCalledTimes(1);
    const [path, method, body] = send.mock.calls[0] as any;
    expect(path).toBe('/api/encounters');
    expect(method).toBe('PATCH');
    expect(body.businessId).toBe('b1');
    expect(body.id).toBe('e-f1b2');
    expect(body.expectedVersion).toBe(7);                 // versão da AUTORIDADE
    expect(Object.keys(body.clinical)).toEqual(['problems']);   // só a fatia da seção
    expect(body.clinical.problems).toHaveLength(1);
    expect(body.clinical.problems[0]).toMatchObject({ kind: 'diagnosis', label: 'Otite externa' });
    expect(body.clinical.problems[0].id).toMatch(/^prb-/);
  });

  it('linha ainda sem descrição NÃO é gravada (nada de item vazio no servidor)', async () => {
    echoServer(8);
    renderProblems();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar problema' }));
    await flushAutosave();
    expect(send).not.toHaveBeenCalled();
  });

  it('remover item COM conteúdo pede confirmação; Cancelar preserva e Confirmar remove', async () => {
    echoServer(8);
    renderProblems(row({
      clinical: {
        problems: [{ id: 'prb-1', kind: 'diagnosis', label: 'Otite externa', notes: '' }],
        plan: { conduct: '' }, procedures: [],
      } as any,
    }) as any);

    fireEvent.click(screen.getByRole('button', { name: 'Remover Diagnóstico: Otite externa' }));
    expect(screen.getByText('Remover “Otite externa”?')).toBeTruthy();
    expect(screen.getByLabelText('Descrição do problema 1')).toBeTruthy();   // ainda na tela

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Remover “Otite externa”?')).toBeNull();
    expect((screen.getByLabelText('Descrição do problema 1') as HTMLInputElement).value).toBe('Otite externa');
    expect(send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remover Diagnóstico: Otite externa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await flushAutosave();
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as any)[2].clinical.problems).toEqual([]);
  });

  it('editar/reordenar preserva a identidade dos itens', async () => {
    echoServer(8);
    renderProblems(row({
      clinical: {
        problems: [
          { id: 'prb-1', kind: 'hypothesis', label: 'Dermatite alérgica', notes: '' },
          { id: 'prb-2', kind: 'diagnosis', label: 'Otite externa', notes: '' },
        ],
        plan: { conduct: '' }, procedures: [],
      } as any,
    }) as any);

    fireEvent.change(screen.getByLabelText('Descrição do problema 1'), { target: { value: 'Dermatite alérgica alimentar' } });
    await flushAutosave();
    const sent = (send.mock.calls[0] as any)[2].clinical.problems;
    expect(sent.map((item: any) => item.id)).toEqual(['prb-1', 'prb-2']);
    expect(sent[0].label).toBe('Dermatite alérgica alimentar');
  });

  it('escrita bloqueada: campos desabilitados e o motivo visível', () => {
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => (
          <EncounterClinicalProblemsSection
            businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
            blocked={false} editable={false}
            readOnlyHint="Somente o profissional responsável vinculado edita o conteúdo clínico."
          />
        )}
      </Harmony>,
    );
    expect(screen.getByRole('button', { name: 'Adicionar problema' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Somente o profissional responsável/)).toBeTruthy();
  });
});

describe('F1B2 · seção Conduta (plano sem duplicar o núcleo)', () => {
  const renderPlan = (initial = row()) => render(
    <Harmony initial={initial}>
      {({ authority, row: r, adoptToken }) => (
        <EncounterCarePlanSection
          businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
          blocked={false} editable readOnlyHint=""
        />
      )}
    </Harmony>,
  );

  it('tem rótulo real e mostra orientações/retorno apenas como CONTEXTO (fonte única)', () => {
    renderPlan();
    expect(screen.getByLabelText(/Plano \/ conduta clínica/)).toBeTruthy();
    const context = screen.getByTestId('plan-context');
    expect(context.textContent).toContain('Manter a orelha seca');
    expect(context.textContent).toContain('Retorno em 15 dias');
    // Não existe um segundo campo de edição para guidance/followUp aqui.
    expect(context.querySelectorAll('input, textarea, select')).toHaveLength(0);
    expect(screen.queryByLabelText(/^Orientações ao tutor/)).toBeNull();
  });

  it('grava só clinical.plan.conduct com a versão da autoridade', async () => {
    echoServer(8);
    renderPlan();
    fireEvent.change(screen.getByLabelText(/Plano \/ conduta clínica/), {
      target: { value: 'Tratamento tópico por 14 dias; solicitar citologia.' },
    });
    await flushAutosave();
    expect(send).toHaveBeenCalledTimes(1);
    const body = (send.mock.calls[0] as any)[2];
    expect(body.expectedVersion).toBe(7);
    expect(body.clinical).toEqual({ plan: { conduct: 'Tratamento tópico por 14 dias; solicitar citologia.' } });
  });

  it('conduta NÃO copia evolução: são campos e seções diferentes', async () => {
    echoServer(8);
    renderPlan();
    expect((screen.getByLabelText(/Plano \/ conduta clínica/) as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText(/Plano \/ conduta clínica/), { target: { value: 'Reavaliar em 15 dias.' } });
    await flushAutosave();
    const body = (send.mock.calls[0] as any)[2];
    expect(body.clinical.plan.conduct).toBe('Reavaliar em 15 dias.');
    expect(body.evolution).toBeUndefined();
    expect(body.guidance).toBeUndefined();
  });
});

describe('F1B2 · seção Procedimentos (custom, sem efeito colateral)', () => {
  const renderProcedures = (initial = row()) => render(
    <Harmony initial={initial}>
      {({ authority, row: r, adoptToken }) => (
        <EncounterClinicalProceduresSection
          businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
          blocked={false} editable readOnlyHint=""
        />
      )}
    </Harmony>,
  );

  it('aceita procedimento custom (fora do catálogo) e grava a fatia', async () => {
    echoServer(8);
    renderProcedures();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar procedimento' }));
    fireEvent.change(screen.getByLabelText('Nome do procedimento 1'), { target: { value: 'Curativo simples' } });
    fireEvent.change(screen.getByLabelText('Observação do procedimento 1'), { target: { value: 'Pata dianteira direita.' } });
    await flushAutosave();

    expect(send).toHaveBeenCalledTimes(1);
    const body = (send.mock.calls[0] as any)[2];
    expect(body.expectedVersion).toBe(7);
    expect(Object.keys(body.clinical)).toEqual(['procedures']);
    expect(body.clinical.procedures[0]).toMatchObject({ name: 'Curativo simples', notes: 'Pata dianteira direita.' });
    expect(body.clinical.procedures[0].id).toMatch(/^proc-/);
    // Nenhum campo financeiro/operacional sai daqui.
    expect(JSON.stringify(body)).not.toMatch(/price|amount|stock|commission|orderId/i);
  });

  it('sugestões de catálogo existem mas o texto livre continua valendo (autocomplete opcional)', () => {
    renderProcedures();
    const list = document.getElementById('procedure-suggestions');
    expect(list).toBeTruthy();
    expect(list!.querySelectorAll('option').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar procedimento' }));
    const created = screen.getByLabelText('Nome do procedimento 1') as HTMLInputElement;
    expect(created.getAttribute('list')).toBe('procedure-suggestions');
    fireEvent.change(created, { target: { value: 'Procedimento que não existe no catálogo' } });
    expect(created.value).toBe('Procedimento que não existe no catálogo');
  });

  it('remover procedimento com conteúdo pede confirmação na linha', async () => {
    echoServer(8);
    renderProcedures(row({
      clinical: {
        problems: [], plan: { conduct: '' },
        procedures: [{ id: 'proc-1', name: 'Limpeza auricular', notes: '' }],
      } as any,
    }) as any);
    fireEvent.click(screen.getByRole('button', { name: 'Remover procedimento: Limpeza auricular' }));
    expect(screen.getByText('Remover “Limpeza auricular”?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await flushAutosave();
    expect((send.mock.calls[0] as any)[2].clinical.procedures).toEqual([]);
  });
});

describe('F1B2 · navegação por vertical (o pacote B2 não vaza)', () => {
  const renderWorkspace = (initial: EncounterAuthorityRow) => render(
    createElement(
      () => {
        const [r] = useState(initial);
        return createElement(EncounterWorkspaceBody, {
          businessId: 'b1', row: r, onRow: () => {}, registerLeave: () => {},
        });
      },
    ),
  );

  it('VETERINÁRIA: seis seções reais na ordem clínica', () => {
    renderWorkspace(row());
    const nav = [...document.querySelectorAll('.encounter-workspace__nav-item')].map((item) => item.textContent);
    expect(nav).toEqual(['Atendimento', 'Anamnese', 'Avaliação', 'Problemas', 'Conduta', 'Procedimentos']);
    expect(document.querySelector('[data-section-id="problemas"]')?.getAttribute('aria-current')).toBeNull();
  });

  it('ODONTOLÓGICA: só Atendimento — nenhuma aba B2 no DOM', () => {
    renderWorkspace(row({
      clinicType: 'odontologica',
      access: {
        canEditCore: true, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false,
        canEditClinicalProblems: false, canEditCarePlan: false, canEditClinicalProcedures: false,
        modules: ['core', 'odontology'], reason: 'module_unavailable',
      },
    } as any) as any);
    expect(document.querySelectorAll('.encounter-workspace__nav-item')).toHaveLength(0);
    for (const label of ['Anamnese', 'Avaliação', 'Problemas', 'Conduta', 'Procedimentos']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(document.querySelector('[data-section="problemas"]')).toBeNull();
  });

  it('trocar para Problemas grava a Anamnese antes (flush entre seções B1 → B2)', async () => {
    echoServer(8);
    renderWorkspace(row());
    // Digita na Anamnese.
    fireEvent.click(screen.getByRole('button', { name: 'Anamnese' }));
    await waitFor(() => expect(screen.getByLabelText(/História atual/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/História atual/), { target: { value: 'Coceira há 3 dias.' } });
    // Troca para Problemas: precisa gravar ANTES de navegar.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Problemas' })); });
    await waitFor(() => expect(document.querySelector('[data-section="problemas"]')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Adicionar problema' })).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    const body = (send.mock.calls[0] as any)[2];
    expect(Object.keys(body.clinical)).toEqual(['anamnesis']);
    expect(body.clinical.anamnesis.history).toBe('Coceira há 3 dias.');
    expect(body.expectedVersion).toBe(7);
  });

  it('falha ao gravar NÃO troca de seção e o texto continua na tela', async () => {
    send.mockResolvedValue(failResult(500, 'Não foi possível salvar agora.'));
    renderWorkspace(row());
    fireEvent.click(screen.getByRole('button', { name: 'Conduta' }));
    await waitFor(() => expect(screen.getByLabelText(/Plano \/ conduta clínica/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Plano \/ conduta clínica/), { target: { value: 'Plano que não salvou.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Procedimentos' })); });
    // Permanece na Conduta com o texto preservado.
    expect((screen.getByLabelText(/Plano \/ conduta clínica/) as HTMLTextAreaElement).value).toBe('Plano que não salvou.');
    expect(screen.queryByRole('button', { name: 'Adicionar procedimento' })).toBeNull();
  });
});
