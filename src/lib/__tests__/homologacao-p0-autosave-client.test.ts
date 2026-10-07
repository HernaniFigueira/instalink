import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const ENCOUNTER = read('src/components/dashboard/EncounterSheet.tsx');
const BOOKING_DETAIL = read('src/components/dashboard/BookingDetailSheet.tsx');
const AGENDA = read('src/app/(dashboard)/agenda/page.tsx');
const NEW_BOOKING = read('src/components/dashboard/NewBookingSheet.tsx');

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · P0-1 — autosave NUNCA fecha o atendimento
// HOMOLOGAÇÃO · P0-2 — novo cliente é fluxo explícito e limpo
// ═══════════════════════════════════════════════════════════════

describe('P0-1 · autosave não fecha EncounterSheet/BookingDetailSheet', () => {
  it('EncounterSheet separa onSaved (silencioso) de onChanged (estrutural) e onClose', () => {
    expect(ENCOUNTER).toMatch(/onSaved\?:/);
    expect(ENCOUNTER).toMatch(/onChanged\?:/);
    expect(ENCOUNTER).toMatch(/onClose: \(\) => void/);
    // Save (autosave/manual) chama onSaved — NUNCA onChanged
    expect(ENCOUNTER).toMatch(/onSaved\?\.\(\)/);
    // O finally do save não pode chamar onChanged
    const saveFinally = ENCOUNTER.match(/inflight\.current = null;[\s\S]{0,280}/);
    expect(saveFinally).toBeTruthy();
    expect(saveFinally![0]).toContain('onSaved?.()');
    expect(saveFinally![0]).not.toContain('onChanged?.()');
    // Finalizar/reabrir é o caminho estrutural (onChanged), sem onClose automático
    expect(ENCOUNTER).toMatch(/action: 'finalize'/);
  });

  it('BookingDetailSheet continua contextual; o atendimento abre em rota completa protegida', () => {
    // MISSÃO UX CLOSURE · item 3B — o detalhe usa o painel lateral canônico
    // (DetailPanel); continua contextual (não vira página) e mantém o autosave
    // do atendimento fora daqui.
    expect(BOOKING_DETAIL).toContain('DetailSideModal');
    expect(BOOKING_DETAIL).toContain('encounterWorkspaceHref');
    expect(BOOKING_DETAIL).toMatch(/bookingId: booking\.id/);
    expect(BOOKING_DETAIL).not.toContain('<EncounterSheet');
    // Ações explícitas (act/check-in) podem fechar — é decisão do usuário
    expect(BOOKING_DETAIL).toMatch(/onChanged\(\);\s*onClose\(\);/);
  });

  it('Agenda: detalhe permanece contextual e a fila navega para a página clínica', () => {
    const detailBlock = AGENDA.match(/<BookingDetailSheet[\s\S]*?\/>/);
    expect(detailBlock).toBeTruthy();
    const block = detailBlock![0];
    expect(block).toMatch(/onChanged=\{\(\) => \{ void load\(\); \}\}/);
    expect(block).not.toMatch(/setDetail\(null\).*load/);
    expect(AGENDA).toContain('encounterWorkspaceHref({ businessId, queueId: row.id');
    expect(AGENDA).not.toContain('<EncounterSheet');
    expect(AGENDA).toContain('retornoAtendimento');
  });

  it('Agenda: detail aberto é atualizado em silêncio quando a lista recarrega', () => {
    expect(AGENDA).toMatch(/setDetail\(\(d\) => \(d \? bookings\.find/);
  });

  it('detalhe limpo fecha sem subfluxo; reagendamento dirty é protegido pelo primitive', () => {
    expect(BOOKING_DETAIL).toMatch(/const rescheduleDirty = rescheduling &&/);
    expect(BOOKING_DETAIL).toMatch(/dismissGuard=\{\{ dirty: rescheduleDirty/);
    expect(BOOKING_DETAIL).not.toContain('window.confirm');
  });

  it('Cliente 360 calcula dirty real, restaura ao descartar e protege a navegação', () => {
    const CLIENT = read('src/components/dashboard/ClientProfileDrawer.tsx');
    expect(CLIENT).toMatch(/const editState = \{ dirty: editDirty/);
    expect(CLIENT).toContain('discardEdit');
    expect(CLIENT).toContain('useUnsavedChangesGuard(editState)');
    expect(CLIENT).toMatch(/const editDirty =/);
  });

  it('Encounter aguarda o request em curso, tenta flush e só deixa saída explícita após erro', () => {
    expect(ENCOUNTER).toContain('await inflight.current');
    expect(ENCOUNTER).toContain('for (let attempt = 0; !flushed && attempt < 4; attempt++)');
    expect(ENCOUNTER).toContain('O salvamento falhou; os dados continuam nesta tela.');
    expect(ENCOUNTER).toContain("layout = 'page'");
  });
});

// HOMOLOGAÇÃO · Fase 2 fechamento — o "cliente temporário" foi eliminado.
// "+ Cadastrar" abre o CADASTRO REAL (NewClientSheet → POST /api/contacts);
// abandonar o agendamento NÃO apaga o cadastro; sem formulário duplicado.
describe('P0-2 · cadastro real dentro do agendamento (fechamento Fase 2)', () => {
  it('SEM stages temporários — só busca + registro real via NewClientSheet', () => {
    expect(NEW_BOOKING).not.toContain('new-form');
    expect(NEW_BOOKING).not.toContain('new-ready');
    expect(NEW_BOOKING).not.toContain('confirmNewDraft');
    expect(NEW_BOOKING).not.toContain('cancelNewDraft');
    expect(NEW_BOOKING).toContain('NewClientSheet');
    expect(NEW_BOOKING).toContain('setRegisterOpen(true)');
    expect(NEW_BOOKING).toContain('onClientRegistered');
    // Nenhum formulário de cliente duplicado dentro do agendamento
    expect(NEW_BOOKING).not.toContain('data-new-client-form');
    expect(NEW_BOOKING).not.toContain('O cliente será cadastrado quando este agendamento');
  });

  it('picked = contato JÁ existente no CRM (nunca rascunho falso)', () => {
    expect(NEW_BOOKING).toMatch(/const picked = !!contactId/);
    expect(NEW_BOOKING).toContain('Cadastro vinculado');
    expect(NEW_BOOKING).not.toContain('Voltar para a busca');
  });

  it('submit exige contactId real e usa saving flag (sem duplicidade por duplo clique)', () => {
    expect(NEW_BOOKING).toMatch(/if \(saving \|\| reviewing\) return/);
    expect(NEW_BOOKING).toContain("if (!contactId)");
    expect(NEW_BOOKING).toMatch(/requestId/);
  });

  it('gatilho de busca é "+ Cadastrar paciente" e abre cadastro real', () => {
    expect(NEW_BOOKING).toContain('+ Cadastrar paciente');
    expect(NEW_BOOKING).toContain('data-new-client-trigger');
  });

  it('resetClient limpa contato/pet e volta para a busca', () => {
    const reset = NEW_BOOKING.match(/function resetClient\(\) \{[\s\S]{0,400}?\}/);
    expect(reset).toBeTruthy();
    const body = reset![0];
    expect(body).toContain("setName('')");
    expect(body).toContain("setPhone('')");
    expect(body).toContain("setEmail('')");
    expect(body).toContain("setContactId('')");
    expect(body).toContain("setPetId('')");
  });
});
