// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// F1B1 · SEÇÕES CLÍNICAS NO COMPONENTE REAL (jsdom)
// ═══════════════════════════════════════════════════════════════
// Travas desta suíte:
//   1. Anamnese/Avaliação renderizam campos com rótulo REAL, unidade no
//      rótulo e agrupamento (nada de tabela impossível, nada de campo solto);
//   2. a unidade é apresentação: o payload envia NÚMERO (8,5 → 8.5), nunca
//      "8,5 kg" como texto;
//   3. o autosave usa a versão da AUTORIDADE (não uma cópia da seção);
//   4. 409 → o conflito é do WORKSPACE e o texto local CONTINUA na tela;
//   5. trocar de seção grava antes: falhou → permanece na seção e o texto fica;
//   6. o peso do cadastro do Pet aparece como contexto, nunca como valor salvo.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { EncounterVisitAnamnesisSection } from '../dashboard/EncounterVisitAnamnesisSection';
import { EncounterVeterinaryAssessmentSection } from '../dashboard/EncounterVeterinaryAssessmentSection';
import { EncounterWorkspaceBody } from '../dashboard/EncounterWorkspaceBody';
import { useEncounterAuthority, type EncounterAuthorityRow } from '../dashboard/useEncounterAuthority';
import { apiGet, apiSend } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn(), apiGet: vi.fn() }));
const send = vi.mocked(apiSend);
const get = vi.mocked(apiGet);

type Result = Awaited<ReturnType<typeof apiSend>>;

function row(extra: Partial<EncounterAuthorityRow> = {}): EncounterAuthorityRow {
  return {
    id: 'e-f1b1', businessId: 'b1', status: 'draft', version: 4,
    bookingId: 'bk-1', queueId: '', serviceId: 'svc-1', professionalId: 'pro-michelle',
    customerId: '', contactId: 'ct-1', customerName: 'Isabelle',
    date: '2026-10-04', time: '14:00',
    complaint: '', evolution: '', guidance: '', followUp: '', internalNote: '', tags: [],
    createdAt: '2026-10-04T17:00:00.000Z', updatedAt: '2026-10-04T17:00:00.000Z',
    createdBy: 'u1', updatedBy: 'u1', finalizedAt: '', finalizedBy: '', signedBy: '',
    petId: 'pet-mel',
    clinicType: 'veterinaria',
    access: {
      canEditCore: true, canEditVisitAnamnesis: true, canEditVeterinaryAssessment: true,
      modules: ['core', 'vet'], reason: 'editable',
    },
    context: {
      clinicalState: 'in_progress',
      patient: { id: 'pet-mel', name: 'Mel', speciesLabel: 'Cachorro', breed: 'SRD', ageLabel: '2 anos', weightKg: 8.4 },
      responsible: { id: 'ct-1', name: 'Isabelle', phone: '11999990001' },
      service: { id: 'svc-1', name: 'Consulta clínica', durationMin: 30 },
      professional: { id: 'pro-michelle', name: 'Michelle', role: 'Veterinária' },
      booking: { id: 'bk-1', date: '2026-10-04', time: '14:00', status: 'confirmed' },
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

/** Monta a seção com uma autoridade REAL (o workspace de verdade). */
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

beforeEach(() => { send.mockReset(); get.mockReset(); });
afterEach(cleanup);

describe('F1B1 · seção Anamnese (campos, unidades e persistência)', () => {
  it('rotula os campos da visita com controles claros e opções declaradas', () => {
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => (
          <EncounterVisitAnamnesisSection
            businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
            blocked={false} editable readOnlyHint=""
          />
        )}
      </Harmony>,
    );
    expect(screen.getByLabelText(/História atual \/ evolução do problema/)).toBeTruthy();
    expect(screen.getByLabelText(/^Alimentação/)).toBeTruthy();
    for (const label of ['Apetite', 'Ingestão de água', 'Urina', 'Fezes']) {
      const select = screen.getByLabelText(new RegExp(`^${label}`)) as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent)).toEqual(['Não informado', 'Normal', 'Alterado']);
    }
    for (const label of ['Vômito', 'Diarreia']) {
      const select = screen.getByLabelText(new RegExp(`^${label}`)) as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent)).toEqual(['Não informado', 'Sim', 'Não']);
    }
    expect(screen.getByLabelText(/Medicações em uso/)).toBeTruthy();
    expect(screen.getByLabelText(/^Alergias/)).toBeTruthy();
    expect(screen.getByLabelText(/Observações da anamnese/)).toBeTruthy();
  });

  it('salva só a fatia da anamnese, com a versão da AUTORIDADE', async () => {
    send.mockResolvedValue(okResult(row({ version: 5 })));
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => (
          <EncounterVisitAnamnesisSection
            businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
            blocked={false} editable readOnlyHint=""
          />
        )}
      </Harmony>,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/História atual/), { target: { value: 'Coceira há 3 dias' } });
      fireEvent.change(screen.getByLabelText(/^Apetite/), { target: { value: 'changed' } });
    });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [, method, body] = send.mock.calls[0];
    expect(method).toBe('PATCH');
    expect(body).toMatchObject({
      businessId: 'b1', id: 'e-f1b1', expectedVersion: 4,
      clinical: { anamnesis: { history: 'Coceira há 3 dias', appetite: 'changed' } },
    });
    // Nada de avaliação no payload da anamnese (fatia por seção).
    expect(Object.keys((body as any).clinical)).toEqual(['anamnesis']);
  });

  it('409 do servidor NÃO apaga o texto local e o conflito é do workspace', async () => {
    send.mockResolvedValue(failResult(409, 'Este atendimento foi atualizado em outra aba.'));
    const conflict = vi.fn();
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => {
          (authority as any).conflict = conflict;
          return (
            <EncounterVisitAnamnesisSection
              businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
              blocked={false} editable readOnlyHint=""
            />
          );
        }}
      </Harmony>,
    );
    const field = screen.getByLabelText(/História atual/) as HTMLTextAreaElement;
    await act(async () => { fireEvent.change(field, { target: { value: 'texto que não pode sumir' } }); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    await waitFor(() => expect(conflict).toHaveBeenCalledTimes(1));
    expect(field.value).toBe('texto que não pode sumir');
  });
});

describe('F1B1 · seção Avaliação veterinária (unidade × valor)', () => {
  it('mostra a unidade no rótulo e o valor continua NÚMERO no payload', async () => {
    send.mockResolvedValue(okResult(row({ version: 5 })));
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => (
          <EncounterVeterinaryAssessmentSection
            businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
            blocked={false} editable readOnlyHint="" petWeightKg={8.4}
          />
        )}
      </Harmony>,
    );
    expect(screen.getByLabelText('Peso (kg)')).toBeTruthy();
    expect(screen.getByLabelText('Temperatura (°C)')).toBeTruthy();
    expect(screen.getByLabelText('Frequência cardíaca (bpm)')).toBeTruthy();
    expect(screen.getByLabelText('Frequência respiratória (rpm)')).toBeTruthy();
    expect(screen.getByLabelText('Tempo de preenchimento capilar (s)')).toBeTruthy();
    expect(screen.getByLabelText(/Hidratação/)).toBeTruthy();
    expect(screen.getByLabelText(/Mucosas/)).toBeTruthy();
    expect(screen.getByLabelText(/Condição corporal/)).toBeTruthy();
    expect(screen.getByLabelText(/Exame físico/)).toBeTruthy();
    // O peso do cadastro aparece como CONTEXTO de leitura.
    expect(screen.getByText(/Peso do cadastro do paciente: 8.4 kg/)).toBeTruthy();

    await act(async () => {
      // Vírgula decimal (teclado brasileiro) é aceita e vira NÚMERO no payload.
      fireEvent.change(screen.getByLabelText('Peso (kg)'), { target: { value: '8,9' } });
      fireEvent.change(screen.getByLabelText('Temperatura (°C)'), { target: { value: '38.4' } });
    });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const body = send.mock.calls[0][2] as any;
    expect(body.expectedVersion).toBe(4);
    expect(body.clinical.assessment.veterinary.weightKg).toBe(8.9);
    expect(typeof body.clinical.assessment.veterinary.weightKg).toBe('number');
    expect(body.clinical.assessment.veterinary.temperatureC).toBe(38.4);
    expect(Object.keys(body.clinical)).toEqual(['assessment']);
  });

  it('vírgula e ponto são a MESMA mudança: "9,1" grava UMA vez e o "9.1" do servidor não vira pendência', async () => {
    // O servidor devolve o número canônico (9.1) — sem chave canônica isso
    // pareceria uma alteração nova e a seção mandaria um segundo PATCH
    // idêntico, com o indicador piscando "Salvando…" sem nada ter mudado.
    const persisted = row({ version: 5 });
    persisted.clinical = {
      assessment: { veterinary: { weightKg: 9.1, temperatureC: 38.4 } },
    } as EncounterAuthorityRow['clinical'];
    send.mockResolvedValue(okResult(persisted));
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => (
          <EncounterVeterinaryAssessmentSection
            businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
            blocked={false} editable readOnlyHint="" petWeightKg={8.4}
          />
        )}
      </Harmony>,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Peso (kg)'), { target: { value: '9,1' } });
      fireEvent.change(screen.getByLabelText('Temperatura (°C)'), { target: { value: '38,4' } });
    });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // Um ciclo de autosave INTEIRO depois: nada pendente, nenhum save extra.
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1300); }); });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][2] as any).clinical.assessment.veterinary.weightKg).toBe(9.1);
    // O rascunho adota a forma canônica do servidor (mesmo valor, sem sujeira).
    expect((screen.getByLabelText('Peso (kg)') as HTMLInputElement).value).toBe('9.1');
    expect((screen.getByLabelText('Temperatura (°C)') as HTMLInputElement).value).toBe('38.4');
  });

  it('texto que não é número NÃO é gravado: erro associado ao campo e texto preservado', async () => {
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => (
          <EncounterVeterinaryAssessmentSection
            businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
            blocked={false} editable readOnlyHint="" petWeightKg={8.4}
          />
        )}
      </Harmony>,
    );
    const peso = screen.getByLabelText('Peso (kg)') as HTMLInputElement;
    await act(async () => { fireEvent.change(peso, { target: { value: '8,5x' } }); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    expect(send).not.toHaveBeenCalled();                        // não gravou lixo
    expect(peso.value).toBe('8,5x');                            // o texto continua aqui
    expect(peso.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByRole('alert').some((el) => /número válido/i.test(el.textContent || ''))).toBe(true);
    // Corrigiu: o autosave volta a gravar, agora com NÚMERO.
    send.mockResolvedValue(okResult(row({ version: 5 })));
    await act(async () => { fireEvent.change(peso, { target: { value: '8,5' } }); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((send.mock.calls[0][2] as any).clinical.assessment.veterinary.weightKg).toBe(8.5);
  });

  it('se a escrita estiver bloqueada, a seção diz o motivo e os campos ficam desabilitados', () => {
    render(
      <Harmony>
        {({ authority, row: r, adoptToken }) => (
          <EncounterVeterinaryAssessmentSection
            businessId="b1" row={r} authority={authority} adoptToken={adoptToken}
            blocked={false} editable={false} readOnlyHint="Somente o profissional responsável vinculado edita."
          />
        )}
      </Harmony>,
    );
    expect(screen.getByText('Somente o profissional responsável vinculado edita.')).toBeTruthy();
    expect((screen.getByLabelText('Peso (kg)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Exame físico/) as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe('F1B1 · troca de seção grava antes (mesma regra de saída do F1A)', () => {
  it('troca com gravação confirmada: salva o texto e só então muda de seção', async () => {
    send.mockResolvedValue(okResult(row({ version: 5, complaint: 'Coceira' })));
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          });
        },
        null,
      ),
    );
    const complaint = screen.getByLabelText(/Queixa principal/) as HTMLTextAreaElement;
    await act(async () => { fireEvent.change(complaint, { target: { value: 'Coceira' } }); });
    const nav = screen.getByRole('button', { name: 'Anamnese' });
    await act(async () => { fireEvent.click(nav); });
    expect(send).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText(/História atual/)).toBeTruthy());
  });

  it('troca com FALHA de gravação: NÃO troca de seção e o texto continua na tela', async () => {
    send.mockResolvedValue(failResult(0, 'Não foi possível conectar ao servidor.'));
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          });
        },
        null,
      ),
    );
    const complaint = screen.getByLabelText(/Queixa principal/) as HTMLTextAreaElement;
    await act(async () => { fireEvent.change(complaint, { target: { value: 'Coceira que não pode sumir' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Anamnese' })); });
    // Continua no Atendimento, com o texto preservado e o estado de erro visível.
    expect(screen.queryByLabelText(/História atual/)).toBeNull();
    expect((screen.getByLabelText(/Queixa principal/) as HTMLTextAreaElement).value).toBe('Coceira que não pode sumir');
    expect(screen.getByTestId('encounter-workspace-save-state').textContent).toMatch(/Erro ao salvar/);
    expect(screen.getByTestId('encounter-workspace-save-state').getAttribute('data-persistence-state')).toBe('error');
  });

  it('CORE-only (vertical sem módulo): gravar o Atendimento encerra o "Salvando…" no rodapé', async () => {
    // Regressão do patch: numa unidade sem módulo de especialidade o CORE é o
    // ÚNICO editor. Se o sucesso do CORE não publicasse "salvo" na autoridade,
    // a tela ficaria "Salvando…" para sempre depois de gravar de verdade.
    send.mockResolvedValue(okResult(row({ version: 8, complaint: 'Queixa gravada no CORE', clinicType: 'odontologica' })));
    render(
      createElement(
        () => {
          const [r, setR] = useState(row({
            clinicType: 'odontologica',
            access: {
              canEditCore: true, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false,
              modules: ['core', 'odontology'], reason: 'module_unavailable',
            },
          } as never));
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          } as never);
        },
        null,
      ),
    );
    const status = () => screen.getByTestId('encounter-workspace-save-state');
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Queixa principal/), { target: { value: 'Queixa gravada no CORE' } });
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(status().getAttribute('data-persistence-state')).toBe('saved'));
    expect(status().textContent).toMatch(/Salvo agora/);
  });

  it('enquanto há texto pendente, o indicador do workspace NÃO mente que está salvo', async () => {
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          });
        },
        null,
      ),
    );
    const status = () => screen.getByTestId('encounter-workspace-save-state');
    expect(status().getAttribute('data-persistence-state')).toBe('saved');   // nada digitado
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Queixa principal/), { target: { value: 'digitando' } });
    });
    expect(status().getAttribute('data-persistence-state')).toBe('dirty');
    expect(status().textContent).toMatch(/Salvando/);
  });

  it('valor que o servidor recusaria (não numérico) NÃO é anunciado como "Salvo agora"', async () => {
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          });
        },
        null,
      ),
    );
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Avaliação' })); });
    const peso = screen.getByLabelText('Peso (kg)') as HTMLInputElement;
    await act(async () => { fireEvent.change(peso, { target: { value: 'abc' } }); });
    // O texto não tem para onde ser gravado: o indicador do workspace diz a
    // VERDADE (erro), o campo explica e o texto digitado continua na tela.
    const status = screen.getByTestId('encounter-workspace-save-state');
    expect(status.getAttribute('data-persistence-state')).toBe('error');
    expect(status.textContent).toMatch(/Erro ao salvar/);
    expect(peso.value).toBe('abc');
    expect(peso.getAttribute('aria-invalid')).toBe('true');
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    expect(send).not.toHaveBeenCalled();          // nada de gravar lixo

    // CORRIGIU: o erro de validação não pode ficar latched e reaparecer como
    // "Erro ao salvar" por cima de um valor válido (achado da QA de browser).
    send.mockResolvedValue(okResult(row({ version: 5 })));
    await act(async () => { fireEvent.change(peso, { target: { value: '9,1' } }); });
    expect(status.getAttribute('data-persistence-state')).not.toBe('error');
    expect(status.textContent).not.toMatch(/Erro ao salvar/);
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1150); }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));   // o valor válido grava
    expect((send.mock.calls[0][2] as any).clinical.assessment.veterinary.weightKg).toBe(9.1);
  });

  it('Anamnese → Avaliação: grava a anamnese antes e mantém o Perfil do paciente intacto', async () => {
    send.mockResolvedValue(okResult(row({ version: 5 })));
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          });
        },
        null,
      ),
    );
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Anamnese' })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/História atual/), { target: { value: 'Coceira há 3 dias' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Avaliação' })); });
    // A troca só acontece DEPOIS de gravar: existe um PATCH com a anamnese e a
    // seção nova está na tela (o caso de falha, logo abaixo, prova o contrário).
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(1);
    const body = send.mock.calls[0][2] as any;
    expect(body.clinical).toMatchObject({ anamnesis: { history: 'Coceira há 3 dias' } });
    expect(Object.keys(body.clinical)).toEqual(['anamnesis']);
    await waitFor(() => expect(screen.getByLabelText('Peso (kg)')).toBeTruthy());
  });

  it('Anamnese → Avaliação com falha: permanece na Anamnese com o texto preservado', async () => {
    send.mockResolvedValue(failResult(500, 'O servidor não respondeu.'));
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          });
        },
        null,
      ),
    );
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Anamnese' })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/História atual/), { target: { value: 'Anamnese que fica' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Avaliação' })); });
    expect(screen.queryByLabelText('Peso (kg)')).toBeNull();
    expect((screen.getByLabelText(/História atual/) as HTMLTextAreaElement).value).toBe('Anamnese que fica');
    expect(screen.getByTestId('encounter-workspace-save-state').getAttribute('data-persistence-state')).toBe('error');
  });

  it('409 na troca de seção: não troca, não sobrescreve e oferece as duas saídas', async () => {
    send.mockResolvedValue(failResult(409, 'Este atendimento foi atualizado em outra aba.'));
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r, onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          });
        },
        null,
      ),
    );
    const complaint = screen.getByLabelText(/Queixa principal/) as HTMLTextAreaElement;
    await act(async () => { fireEvent.change(complaint, { target: { value: 'texto local' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Anamnese' })); });
    expect(screen.queryByLabelText(/História atual/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/alterado em outra tela/i);
    expect(screen.getByRole('button', { name: 'Continuar editando' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recarregar versão atual' })).toBeTruthy();
    expect(complaint.value).toBe('texto local');
    // "Recarregar versão atual" adota o servidor por ESCOLHA e libera a troca.
    get.mockResolvedValueOnce({
      ok: true, status: 200, data: { encounter: row({ version: 9, complaint: 'Da outra tela' }) },
      message: '', denied: null, flow: 'stay', networkError: false,
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recarregar versão atual' })); });
    await waitFor(() => expect((screen.getByLabelText(/Queixa principal/) as HTMLTextAreaElement).value).toBe('Da outra tela'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Anamnese' })); });
    await waitFor(() => expect(screen.getByLabelText(/História atual/)).toBeTruthy());
  });
});

describe('F1B1 · navegação por vertical (o módulo vet NÃO vaza)', () => {
  const odontoRow = () => row({
    clinicType: 'odontologica',
    access: {
      canEditCore: true, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false,
      modules: ['core', 'odontology'], reason: 'module_unavailable',
    },
  } as never);

  function renderWorkspace(initial: EncounterAuthorityRow) {
    render(
      createElement(
        () => {
          const [r, setR] = useState(initial);
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r,
            onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: () => {},
          } as never);
        },
        null,
      ),
    );
  }

  it('ODONTOLÓGICA: só Atendimento no DOM — sem Anamnese/Avaliação e nenhuma escrita vet', async () => {
    send.mockResolvedValue(okResult(row({ version: 5 })));
    renderWorkspace(odontoRow());
    // Nenhuma aba de especialidade é renderizada (nem botão morto).
    expect(document.querySelectorAll('.encounter-workspace__nav-item')).toHaveLength(0);
    expect(screen.getByLabelText(/Queixa principal/)).toBeTruthy();      // CORE presente
    expect(screen.queryByLabelText(/História atual/)).toBeNull();        // anamnese vet fora
    expect(screen.queryByLabelText('Peso (kg)')).toBeNull();             // avaliação vet fora
    expect(screen.queryByLabelText(/Exame físico/)).toBeNull();
    // A escrita do CORE continua funcionando — e o payload NÃO carrega `clinical`.
    await act(async () => { fireEvent.change(screen.getByLabelText(/Queixa principal/), { target: { value: 'Queixa da odonto' } }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const body = send.mock.calls[0][2] as any;
    expect(body.complaint).toBe('Queixa da odonto');
    expect(body.clinical).toBeUndefined();
  });

  it('GERAL/clinicType ausente: o vet não é ativado por inferência', async () => {
    renderWorkspace(row({
      clinicType: 'geral',
      access: {
        canEditCore: true, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false,
        modules: ['core'], reason: 'module_unavailable',
      },
    } as never));
    expect(document.querySelectorAll('.encounter-workspace__nav-item')).toHaveLength(0);
    expect(screen.queryByLabelText('Peso (kg)')).toBeNull();
    expect(screen.queryByLabelText(/História atual/)).toBeNull();
    expect(screen.getByLabelText(/Queixa principal/)).toBeTruthy();
  });

  it('VETERINÁRIA: as três seções continuam lá (regressão do recorte)', () => {
    renderWorkspace(row());                                 // fixture vet
    expect(document.querySelectorAll('.encounter-workspace__nav-item')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Anamnese' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Avaliação' })).toBeTruthy();
  });
});

describe('F1B1 · sair sem salvar (§13)', () => {
  it('"Sair sem salvar" + Descartar cumpre a saída — sem laço de diálogos', async () => {
    // A gravação falha: a saída só acontece por escolha explícita e CONFIRMADA.
    send.mockResolvedValue(failResult(500, 'Não foi possível salvar agora.'));
    let leave: ((reason: never, proceed: () => void) => void) | null = null;
    let left = false;
    render(
      createElement(
        () => {
          const [r, setR] = useState(row());
          return createElement(EncounterWorkspaceBody, {
            businessId: 'b1', row: r,
            onRow: (next: EncounterAuthorityRow) => setR((prev) => ({ ...prev, ...next })),
            registerLeave: (fn: never) => { leave = fn; },
          } as never);
        },
        null,
      ),
    );
    await act(async () => { fireEvent.change(screen.getByLabelText(/Queixa principal/), { target: { value: 'texto que só sai descartando' } }); });
    await act(async () => { (leave as unknown as (r: string, p: () => void) => void)('close-button', () => { left = true; }); });
    // A gravação falhou: a faixa oferece a única saída possível.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sair sem salvar' })).toBeTruthy());
    expect(left).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sair sem salvar' })); });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Descartar' })); });
    expect(left).toBe(true);                       // a decisão humana foi cumprida
    expect((screen.getByLabelText(/Queixa principal/) as HTMLTextAreaElement).value).toBe('texto que só sai descartando');
  });
});
