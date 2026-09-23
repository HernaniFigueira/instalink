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

  it('BookingDetailSheet repassa onSaved ao EncounterSheet e só fecha em onClose', () => {
    expect(BOOKING_DETAIL).toMatch(/onSaved\?:/);
    expect(BOOKING_DETAIL).toMatch(/onSaved=\{onSaved\}/);
    // Ações explícitas (act/check-in) podem fechar — é decisão do usuário
    expect(BOOKING_DETAIL).toMatch(/onChanged\(\);\s*onClose\(\);/);
  });

  it('Agenda: onSaved/onChanged do detalhe NÃO fazem setDetail(null)', () => {
    // O bloco do BookingDetailSheet não pode fechar o detalhe em onChanged
    const detailBlock = AGENDA.match(/<BookingDetailSheet[\s\S]*?\/>/);
    expect(detailBlock).toBeTruthy();
    const block = detailBlock![0];
    expect(block).toMatch(/onSaved=/);
    expect(block).toMatch(/onChanged=\{\(\) => \{ void load\(\); \}\}/);
    expect(block).not.toMatch(/setDetail\(null\).*load/);
    expect(block).not.toMatch(/onChanged=\{\(\) => \{ setDetail\(/);
  });

  it('Agenda: detail aberto é atualizado em silêncio quando a lista recarrega', () => {
    expect(AGENDA).toMatch(/setDetail\(\(d\) => \(d \? bookings\.find/);
  });
});

describe('P0-2 · novo cliente dentro do agendamento', () => {
  it('estágios explícitos: search → new-form → new-ready', () => {
    expect(NEW_BOOKING).toMatch(/type ClientStage = 'search' \| 'new-form' \| 'new-ready'/);
    expect(NEW_BOOKING).toMatch(/setClientStage\('new-form'\)/);
    expect(NEW_BOOKING).toMatch(/confirmNewDraft/);
    expect(NEW_BOOKING).toMatch(/cancelNewDraft/);
  });

  it('formulário avisa que o cadastro só nasce na confirmação do agendamento', () => {
    expect(NEW_BOOKING).toContain('O cliente será cadastrado quando este agendamento for confirmado.');
    expect(NEW_BOOKING).toContain('Usar neste agendamento');
    expect(NEW_BOOKING).toContain('Cadastrar novo cliente');
  });

  it('badge correto: "Novo cliente" nunca diz "Cadastro vinculado" sem contactId', () => {
    expect(NEW_BOOKING).toMatch(/\{contactId \? 'Cadastro vinculado' : 'Novo cliente'\}/);
  });

  it('cancelar LIMPA nome/telefone/e-mail/estágio e volta para a busca', () => {
    const cancel = NEW_BOOKING.match(/function cancelNewDraft\(\) \{[\s\S]{0,400}?\}/);
    expect(cancel).toBeTruthy();
    const body = cancel![0];
    expect(body).toContain("setName('')");
    expect(body).toContain("setPhone('')");
    expect(body).toContain("setEmail('')");
    expect(body).toContain("setClientStage('search')");
    expect(body).toContain("setContactId('')");
  });

  it('picked só com contactId ou rascunho confirmado (new-ready) — formulário não finge seleção', () => {
    expect(NEW_BOOKING).toMatch(/const picked = !!contactId \|\| clientStage === 'new-ready'/);
    // "Voltar para a busca" antigo não pode deixar nome órfão virar selecionado
    expect(NEW_BOOKING).not.toContain('Voltar para a busca');
  });

  it('submit exige rascunho confirmado e usa saving flag (sem duplicidade por duplo clique)', () => {
    expect(NEW_BOOKING).toMatch(/if \(saving \|\| reviewing\) return/);
    expect(NEW_BOOKING).toMatch(/clientStage !== 'new-ready'/);
    expect(NEW_BOOKING).toMatch(/requestId/);
  });

  it('gatilho de busca usa "Cadastrar novo cliente"', () => {
    expect(NEW_BOOKING).toContain('+ Cadastrar novo cliente');
  });
});
