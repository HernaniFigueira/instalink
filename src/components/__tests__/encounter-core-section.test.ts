// ═══════════════════════════════════════════════════════════════
// F1A · O WORKSPACE CANÔNICO É O NÚCLEO — e só o núcleo
// ═══════════════════════════════════════════════════════════════
// A revisão independente achou (e estava certa) um vazamento: o workspace
// montava o `EncounterSheet` LEGADO, que carrega anamnese, anexos, pagamento,
// pós-atendimento e reabertura — tudo de fases futuras. Este teste trava a
// cerca no código e na renderização:
//
//   1. o workspace monta o núcleo (não o componente legado);
//   2. o núcleo renderiza SÓ as capacidades declaradas;
//   3. nenhum módulo diferido aparece no HTML do núcleo;
//   4. o legado CONTINUA existindo, intacto, com os módulos dele.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { EncounterCoreSection, type EncounterCoreRow } from '../dashboard/EncounterCoreSection';
import { EncounterSheet, type EncounterRow } from '../dashboard/EncounterSheet';
import {
  ENCOUNTER_CORE_CAPABILITIES, ENCOUNTER_DEFERRED_MODULES, encounterCoreCapabilities,
  isEncounterModuleDeferred, supportsEncounterCapability,
} from '@/lib/encounter-sections';

const read = (p: string) => fs.readFileSync(p, 'utf8');

/** Texto que só existe nos módulos que NÃO são desta etapa. */
const FORBIDDEN = [
  'Preencher anamnese',
  'Anamnese',
  'Arquivos',
  'anexar',
  'Registrar pagamento',
  'Reabrir para editar',
  'como fica o acompanhamento',
  'Agendar retorno',
];

function coreRow(extra: Partial<EncounterCoreRow> = {}): EncounterCoreRow {
  return {
    id: 'e-core', businessId: 'b1', status: 'draft', version: 3,
    bookingId: 'bk-1', queueId: '', serviceId: 'svc-1', professionalId: 'pro-1',
    customerId: '', contactId: 'ct-1', customerName: 'Isabelle Tutora',
    date: '2026-10-04', time: '14:00',
    complaint: 'Coceira nas orelhas',
    evolution: 'Conduta realizada',
    guidance: 'Limpeza e medicação tópica',
    followUp: 'retorno em 15 dias',
    internalNote: 'tutor relata recorrência',
    tags: ['derma'],
    createdAt: '2026-10-04T17:00:00.000Z', updatedAt: '2026-10-04T17:00:00.000Z',
    createdBy: 'u1', updatedBy: 'u1', finalizedAt: '', finalizedBy: '', signedBy: '',
    petId: 'pet-mel',
    ...extra,
  } as EncounterCoreRow;
}

describe('F1A · capacidades do núcleo clínico', () => {
  it('o núcleo declara exatamente os campos aprovados para esta etapa', () => {
    expect([...encounterCoreCapabilities()]).toEqual([
      'complaint', 'evolution', 'guidance', 'followUp', 'internalNote', 'tags',
    ]);
    expect(ENCOUNTER_CORE_CAPABILITIES).toHaveLength(6);
  });

  it('o que é de F1B/F1C está nomeado como DIFERIDO (documentado, não esquecido)', () => {
    for (const id of ['anamnese', 'arquivos', 'pagamento', 'reabertura', 'pos_atendimento', 'especialidade']) {
      expect(isEncounterModuleDeferred(id)).toBe(true);
      expect(supportsEncounterCapability(id)).toBe(false);
    }
    expect(ENCOUNTER_DEFERRED_MODULES).toContain('anamnese');
  });

  it('a cerca é estrutural: o workspace NÃO monta o EncounterSheet legado', () => {
    const workspace = read('src/components/dashboard/EncounterWorkspace.tsx');
    expect(workspace).not.toMatch(/from '\.\/EncounterSheet'/);
    expect(workspace).not.toMatch(/<EncounterSheet/);
    // F1B1 — o workspace delega o corpo (seções reais + autoridade única) e o
    // corpo monta o NÚCLEO; o legado continua fora dos dois.
    expect(workspace).toMatch(/<EncounterWorkspaceBody/);
    const body = read('src/components/dashboard/EncounterWorkspaceBody.tsx');
    expect(body).toMatch(/<EncounterCoreSection/);
    expect(body).not.toMatch(/from '\.\/EncounterSheet'/);
    expect(body).not.toMatch(/<EncounterSheet/);
    // E o núcleo não é o legado com `if` de layout: não existe esse modo.
    const sheet = read('src/components/dashboard/EncounterSheet.tsx');
    expect(sheet).not.toMatch(/layout\?: 'page' \| 'section'/);
    expect(sheet).not.toMatch(/if \(layout === 'section'\)/);
  });
});

describe('F1A · o núcleo renderiza só o que é do F1A', () => {
  const html = renderToStaticMarkup(
    createElement(EncounterCoreSection, { businessId: 'b1', encounter: coreRow() }),
  );

  it('mostra os campos do núcleo com o conteúdo real do registro', () => {
    expect(html).toContain('Coceira nas orelhas');
    expect(html).toContain('Conduta realizada');
    expect(html).toContain('Limpeza e medicação tópica');
    expect(html).toContain('retorno em 15 dias');
    expect(html).toContain('tutor relata recorrência');
    expect(html).toContain('derma');
  });

  it('NÃO mostra nenhum módulo fora do escopo (anamnese, arquivos, pagamento, reabrir)', () => {
    for (const term of FORBIDDEN) expect(html).not.toContain(term);
  });

  it('é o corpo do workspace (uma seção real), não um card solto', () => {
    expect(html).toContain('encounter-workspace__section');
    expect(html).toContain('aria-label="Registro do atendimento"');
  });

  // DS 1.1 · §11 — o contrato mudou DE PROPÓSITO: escrita bloqueada = DOCUMENTO
  // (valor em leitura, motivo dito uma vez), não um formulário desabilitado.
  it('finalizado é leitura: documento, sem nenhum controle de formulário', () => {
    const finalized = renderToStaticMarkup(
      createElement(EncounterCoreSection, {
        businessId: 'b1', encounter: coreRow({ status: 'finalized' }),
      }),
    );
    expect(finalized).toContain('Conduta realizada');           // o conteúdo continua legível
    expect(finalized).not.toContain('Reabrir para editar');
    // Nenhum campo — nem habilitado, nem desabilitado: leitura é texto.
    const controls = finalized.match(/<(?:textarea|input|select)\b[^>]*>/g) || [];
    expect(controls.length).toBe(0);
    expect(finalized).toContain('gd-ro-section');
    expect(finalized).toMatch(/Leitura: editar o conteúdo clínico|Registro finalizado/);
  });
});

describe('F1A · o legado continua intacto (nada foi apagado do sistema)', () => {
  function legacyRow(): EncounterRow {
    return {
      ...coreRow(),
      professionalName: 'Michelle', serviceName: 'Consulta dermatológica',
      bookingStatus: 'confirmed', customerPhone: '11999990001', petName: 'Mel',
    } as unknown as EncounterRow;
  }

  it('o EncounterSheet legado segue renderizando o registro (onde já funcionava)', () => {
    const html = renderToStaticMarkup(
      createElement(EncounterSheet, { businessId: 'b1', existing: legacyRow(), onClose: () => {} }),
    );
    expect(html).toContain('Conduta realizada');
  });

  it('os módulos diferidos continuam existindo no componente legado', () => {
    const sheet = read('src/components/dashboard/EncounterSheet.tsx');
    // A cerca é do WORKSPACE, não uma remoção: o legado mantém as telas dele.
    expect(sheet).toMatch(/Anamnese/);
    expect(sheet).toMatch(/Registrar pagamento/);
    expect(sheet).toMatch(/Reabrir para editar/);
    expect(sheet).toMatch(/AnamneseFiller/);
  });
});
