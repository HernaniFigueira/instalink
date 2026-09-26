import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SHEET = stripComments(read('src/components/dashboard/ClientProfileDrawer.tsx'));

describe('FASE 2 · P2 — Paciente 360 (Workspace Sheet)', () => {
  it('abre no WorkspaceSheet (não no Drawer antigo)', () => {
    expect(SHEET).toContain('<WorkspaceSheet');
    expect(SHEET).not.toContain('<Drawer');
    expect(SHEET).toContain('Paciente 360');
  });

  it('abas na ordem da jornada: visão geral, agenda, atendimento, conversas, arquivos, financeiro, histórico', () => {
    const ids = [...SHEET.matchAll(/\{ id: '([a-z]+)', label:/g)].map((m) => m[1]);
    const seq = ['overview', 'bookings', 'encounters', 'conversations', 'files', 'timeline'];
    let last = -1;
    for (const id of seq) {
      const at = ids.indexOf(id);
      expect(at, `aba ${id} ausente`).toBeGreaterThanOrEqual(0);
      expect(at, `aba ${id} fora de ordem`).toBeGreaterThan(last);
      last = at;
    }
    // financeiro existe e é condicionado à permissão (nunca vaza para quem não tem).
    expect(SHEET).toMatch(/canFinance \? \[\{ id: 'finance'/);
  });

  it('ações rápidas: WhatsApp, registrar nota, iniciar atendimento e novo agendamento', () => {
    expect(SHEET).toMatch(/waLink\(person\.phone/);
    expect(SHEET).toContain('Registrar nota');
    expect(SHEET).toContain('Iniciar atendimento');
    expect(SHEET).toContain('Novo agendamento');
    // iniciar atendimento só quando há próximo E permissão própria de atendimento
    expect(SHEET).toMatch(/canEncounter && nextBooking &&/);
  });

  it('visão geral usa dados reais (próximo, último registro, retorno, financeiro)', () => {
    expect(SHEET).toContain('Próximo agendamento');
    expect(SHEET).toContain('Último atendimento');
    expect(SHEET).toContain('Retorno previsto');
    expect(SHEET).toMatch(/followUpDueDate/);
    expect(SHEET).toMatch(/financeReceived/);
  });

  it('aba Financeiro carrega /api/finance escopado no contato e a timeline inclui pagamentos', () => {
    expect(SHEET).toMatch(/\/api\/finance\?businessId=.*contactId=/);
    expect(SHEET).toMatch(/kind: 'finance'/);
    expect(SHEET).toContain('FINANCE_STATUS_LABEL');
  });

  it('aba Arquivos só com permissão de atendimento e a partir dos anexos reais', () => {
    expect(SHEET).toMatch(/!canEncounter \? .*Seu perfil não tem a permissão de Atendimento/);
    expect(SHEET).toMatch(/e\.files \|\| \[\]/);
  });
});
