// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EncounterFinalizationPanel } from '../dashboard/EncounterFinalizationPanel';
import type { EncounterAuthority, EncounterAuthorityRow } from '../dashboard/useEncounterAuthority';
import { apiSend } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn() }));
const send = vi.mocked(apiSend);

function row(extra: Partial<EncounterAuthorityRow> = {}): EncounterAuthorityRow {
  return {
    id: 'e-f1c', businessId: 'b1', status: 'draft', version: 10, bookingId: '', queueId: '', serviceId: 'svc', professionalId: 'pro', customerId: '', contactId: '', customerName: 'Tutor', date: '2026-10-05', time: '10:00', complaint: 'Queixa', evolution: 'Evolução', guidance: '', followUp: '', internalNote: '', tags: [], createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', createdBy: 'u', updatedBy: 'u', finalizedAt: '', finalizedBy: '', signedBy: '', petId: 'pet', clinical: { anamnesis: {}, assessment: { veterinary: {} }, problems: [], plan: { conduct: '' }, procedures: [] }, access: null, ...extra,
  } as EncounterAuthorityRow;
}

function authority(initial: EncounterAuthorityRow) {
  let current = initial;
  return {
    version: () => current.version,
    publish: (next: EncounterAuthorityRow) => { current = next; published = next; },
    status: vi.fn(), clearStatus: vi.fn(), conflict: vi.fn(), registerSection: vi.fn(), registeredSection: vi.fn(), unregisterSection: vi.fn(), sectionDirty: vi.fn(),
  } as unknown as EncounterAuthority;
}
let published: EncounterAuthorityRow | null;

beforeEach(() => { cleanup(); send.mockReset(); published = null; });

describe('F1C · transições publicam a autoridade canônica', () => {
  it('flush dirty publica a versão recém-confirmada, sem 409 interno', async () => {
    const initial = row();
    const auth = authority(initial);
    let version = 10;
    const flush = vi.fn(async () => { version = 11; (auth.version as unknown as () => number); return true; });
    // Simula a autoridade avançando no flush, exatamente como uma seção real.
    vi.spyOn(auth, 'version').mockImplementation(() => version);
    const finalized = row({ status: 'finalized', version: 12, finalizedAt: '2026-10-05T10:01:00Z', finalizationRevisions: [{ id: 'r1', businessId: 'b1', encounterId: 'e-f1c', revisionNumber: 1, encounterVersion: 12, finalizedAt: '2026-10-05T10:01:00Z', finalizedByUserId: 'u', finalizedByProfessionalId: 'pro', snapshot: { evolution: 'Evolução' } }] });
    send.mockResolvedValue({ ok: true, status: 200, data: { encounter: finalized }, message: '', denied: null, flow: 'stay', networkError: false } as any);
    render(<EncounterFinalizationPanel businessId="b1" row={initial} canFinalize flush={flush} authority={auth} revisions={[]} addenda={[]} reopenEvents={[]} canReopen={false} canAddendum={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e finalizar' }));
    // DS 1.0 · §43 — a revisão é o Dialog CANÔNICO do produto: o foco é
    // CONTIDO no diálogo (o diálogo foca o primeiro acionável; o cabeçalho é o
    // alvo quando não há nenhum). O contrato auditável é a contenção do foco no
    // overlay — não uma classe/modal específico desta tela.
    const reviewDialog = screen.getByRole('dialog', { name: 'Revisar e finalizar' });
    expect(reviewDialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atendimento' }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][2]).toMatchObject({ expectedVersion: 11, action: 'finalize' });
    expect(published?.status).toBe('finalized');
    expect(published?.version).toBe(12);
  });

  it('oferece addendum ao responsável e publica a resposta na autoridade sem F5', async () => {
    const finalized = row({ status: 'finalized', version: 12, finalizedAt: '2026-10-05T10:01:00Z' });
    const auth = authority(finalized);
    const updated = row({ status: 'finalized', version: 13, finalizedAt: finalized.finalizedAt, addenda: [{ id: 'a1', businessId: 'b1', encounterId: 'e-f1c', revisionId: 'r1', authorUserId: 'u', authorProfessionalId: 'pro', text: 'Resultado complementar', createdAt: '2026-10-05T10:02:00Z' }] });
    send.mockResolvedValue({ ok: true, status: 200, data: { encounter: updated }, message: '', denied: null, flow: 'stay', networkError: false } as any);
    const view = render(<EncounterFinalizationPanel businessId="b1" row={finalized} canFinalize={false} flush={vi.fn(async () => true)} authority={auth} revisions={[]} addenda={[]} reopenEvents={[]} canReopen={false} canAddendum />);
    // DS 1.0 · §43 — a nota complementar é um ActionSection: o TÍTULO anuncia a
    // seção ("Adicionar nota complementar") e a ação à direita é "Adicionar nota".
    expect(screen.getByRole('heading', { name: 'Adicionar nota complementar' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nota complementar'), { target: { value: 'Resultado complementar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar nota' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('/api/encounters', 'PATCH', expect.objectContaining({ action: 'addendum', text: 'Resultado complementar' }), expect.anything()));
    expect(published?.version).toBe(13);
    view.rerender(<EncounterFinalizationPanel businessId="b1" row={updated} canFinalize={false} flush={vi.fn(async () => true)} authority={auth} revisions={[]} addenda={updated.addenda || []} reopenEvents={[]} canReopen={false} canAddendum />);
    expect(screen.getByText(/Resultado complementar/)).toBeTruthy();
  });

  it('não oferece addendum nem reabertura quando capacidades server-derived são falsas', () => {
    const finalized = row({ status: 'finalized', finalizedAt: '2026-10-05T10:01:00Z' });
    const auth = authority(finalized);
    render(<EncounterFinalizationPanel businessId="b1" row={finalized} canFinalize={false} flush={vi.fn(async () => true)} authority={auth} revisions={[]} addenda={[]} reopenEvents={[]} canReopen={false} canAddendum={false} />);
    expect(screen.queryByRole('button', { name: 'Adicionar nota complementar' })).toBeNull();
    expect(screen.queryByLabelText('Motivo da reabertura')).toBeNull();
  });
});
