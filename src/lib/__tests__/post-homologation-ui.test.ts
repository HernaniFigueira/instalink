import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrastRatio, navAccentById } from '../nav-accent';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const encounter = read('src/components/dashboard/EncounterSheet.tsx');
const bookingDetail = read('src/components/dashboard/BookingDetailSheet.tsx');
const newBooking = read('src/components/dashboard/NewBookingSheet.tsx');
const filler = read('src/components/dashboard/AnamneseFiller.tsx');
const pet360 = read('src/components/dashboard/Pet360Sheet.tsx');
const globals = read('src/app/globals.css');

describe('pós-homologação manual — atendimento, anamnese e proteção de trabalho', () => {
  it('check-in persiste/refresca sem fechar o detalhe e apresenta o estado de chegada', () => {
    const checkIn = bookingDetail.match(/async function checkIn\([\s\S]*?\n  }\n\n  async function reschedule/);
    expect(checkIn).toBeTruthy();
    expect(checkIn![0]).toContain('onChanged();');
    expect(checkIn![0]).toContain('setNotice(undo ?');
    expect(checkIn![0]).not.toContain('onClose()');
    expect(bookingDetail).toContain('<StatusBadge tone="emerald">Chegou</StatusBadge>');
    expect(bookingDetail).toContain('Desfazer o check-in deste atendimento');
  });

  it('Novo Agendamento e cadastro lateral mantêm guards dirty independentes', () => {
    expect(newBooking).toContain('dismissGuard={overlayGuard}');
    expect(newBooking).toContain('sideDismissGuard={{ ...clientPersistence, context: \'new-client\' }}');
    expect(newBooking).toContain('onPersistenceChange={setClientPersistence}');
  });

  it('resposta salva é enviada ao pai com identidade do template e exibida sem recarregar', () => {
    expect(filler).toContain('setLastResponse(savedResponse)');
    expect(filler).toContain('onSaved?.(savedResponse)');
    expect(encounter).toContain('setAnamneseLast({ id: savedResponse.id, templateId: savedResponse.templateId');
    expect(encounter).toContain('setAnamneseHistoryOpen(true)');
    expect(encounter).toContain('Ficha deste atendimento salva');
    expect(encounter).toContain('Preencher outra ficha');
  });

  it('histórico clínico usa labels do template e preserva o significado booleano', () => {
    for (const source of [filler, encounter, pet360]) {
      expect(source).toMatch(/field\.label|label: field\.label/);
      expect(source).toContain('Não informado');
      expect(source).toContain('type === \'boolean\'');
    }
    expect(filler).toContain('<option value="true">Sim</option>');
    expect(filler).toContain('<option value="false">Não</option>');
    expect(filler).toContain('<option value="">Não informado</option>');
  });

  it('Encounter universal não carrega exemplos odontológicos hardcoded', () => {
    expect(encounter).not.toMatch(/dente do fundo|aplicação de flúor|pasta para sensibilidade|"flúor"/i);
    expect(encounter).toContain('placeholder="Descreva o motivo do atendimento"');
    expect(encounter).toContain('placeholder="Registre o que foi realizado neste atendimento"');
    expect(encounter).toContain('placeholder="Registre as orientações fornecidas"');
  });

  it('anexos não revelam configuração interna na UI e apresentam fallback honesto', () => {
    expect(encounter).not.toContain('BLOB_READ_WRITE_TOKEN');
    expect(pet360).not.toContain('BLOB_READ_WRITE_TOKEN');
    expect(encounter).toContain('Anexos indisponíveis neste ambiente.');
    expect(read('src/app/api/upload/route.ts')).toContain("{ error: 'Anexos indisponíveis neste ambiente.' }");
    expect(read('src/app/api/upload/route.ts')).not.toContain('Adicione BLOB_READ_WRITE_TOKEN');
  });

  it('botão de histórico é ação secundária visível e focável nos quatro temas homologados', () => {
    for (const id of ['azul-profundo', 'verde-salvia', 'neutro', 'vinho']) {
      const accent = navAccentById(id);
      expect(contrastRatio(accent.vars['--accent-contrast'], accent.vars['--accent'])).toBeGreaterThanOrEqual(4.5);
    }
    for (const source of [filler, encounter, pet360]) {
      expect(source).toContain('variant="secondary"');
      expect(source).toContain('aria-expanded');
      expect(source).toContain('aria-controls');
    }
    expect(globals).toContain('.il-platform :focus-visible');
    expect(globals).toContain('border: 1px solid var(--border)');
  });

  it('primitives de sheet têm largura CSS válida e anatomia lateral unificada', () => {
    const workspace = read('src/components/dashboard/WorkspaceSheet.tsx');
    const ui = read('src/components/ui.tsx');
    expect(workspace).toContain('function sheetWidthValue');
    expect(workspace).toContain("width.match(/^max-w-\\[(.+)\\]$/)");
    expect(workspace).toContain("'--sheet-w': sheetWidthValue(width)");
    expect(ui).toContain('className="ws-sheet__header shrink-0"');
    expect(ui).toContain('className="ws-sheet__close"');
    expect(ui).toContain('className="ws-sheet__footer il-actionbar');
    expect(globals).toContain('dialog.il-drawer {');
    expect(globals).toContain('dialog.ws-sheet::backdrop { background: var(--overlay); }');
    expect(globals).toContain('.ag-free-range:hover');
  });
});
