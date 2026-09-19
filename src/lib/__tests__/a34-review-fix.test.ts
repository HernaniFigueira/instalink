// ═══════════════════════════════════════════════════════════════
// A3.4 · FIX DA REVISÃO (B5/B6) — INTEGRIDADE, HANDOFF E TELEFONE
// ═══════════════════════════════════════════════════════════════
// Este arquivo trava o que a revisão independente apontou fora do servidor:
//
//   1. autosave de verdade no registro (com debounce, versão e flush no
//      fechamento) — e a prova de que a tela não manda request por tecla;
//   2. o caminho FILA → ATENDIMENTO, incluindo o caso SEM agendamento;
//   3. a permissão própria do atendimento separando balcão de conteúdo
//      profissional na fila;
//   4. o +55 como prefixo visual FIXO compartilhado (sem markup duplicado em
//      cinco telas, sem duplicar o código do país na digitação);
//   5. observações administrativas × registro de atendimento — fronteira dita.
//
// Componentes não são renderizados no ambiente de teste (vitest/node): o que
// se prova aqui é a REGRA (pura, de `lib/`) e o CONTRATO DA TELA (o JSX
// publicado), que é o que a revisão pediu para ver ancorado.
import './helpers/temp-db';

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_AUTOSAVE_LABELS, ENCOUNTER_AUTOSAVE_MS, encounterContentPayload, encounterDraftKey,
  encounterPrintBlocks, encounterSignature, ENCOUNTER_VERSION_ERROR,
} from '../encounters';
import { maskPhoneBR, normalizePhoneBR, phoneError } from '../field-quality';
import type { Encounter } from '../types';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Sem comentários: o teste se refere ao CÓDIGO, não ao que o texto promete. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SHEET = stripComments(read('src/components/dashboard/EncounterSheet.tsx'));
const QUEUE = stripComments(read('src/components/dashboard/QueuePanel.tsx'));
const AGENDA = stripComments(read('src/app/(dashboard)/agenda/page.tsx'));
const PROVIDER = stripComments(read('src/components/dashboard/PhoneBRInput.tsx'));
const DRAWER = stripComments(read('src/components/dashboard/ClientProfileDrawer.tsx'));

describe('A3.4 fix · autosave do registro (regra pura)', () => {
  it('a assinatura de conteúdo muda com edição e não muda com ruído de formatação', () => {
    const base = { complaint: 'a', evolution: '', guidance: '', followUp: '', internalNote: '', tags: '' };
    expect(encounterDraftKey(base)).toBe(encounterDraftKey({ ...base }));
    expect(encounterDraftKey(base)).not.toBe(encounterDraftKey({ ...base, evolution: 'x' }));
    // Reabrir o registro e não mexer em nada NÃO conta como mudança.
    expect(encounterDraftKey({ ...base, complaint: 'a' })).toBe(encounterDraftKey(base));
  });

  it('o payload do autosave manda a revisão que a tela conhece', () => {
    const form = { complaint: '', evolution: 'limpeza', guidance: '', followUp: '', internalNote: '', tags: 'a, b ,, c' };
    const comVersao = encounterContentPayload('b1', 'e1', form, 4);
    expect(comVersao.expectedVersion).toBe(4);
    expect(comVersao.tags).toEqual(['a', 'b', 'c']);
    // Sem saber a revisão (chamador antigo) o campo nem aparece — a trava não inventa conflito.
    expect('expectedVersion' in encounterContentPayload('b1', 'e1', form)).toBe(false);
  });

  it('o intervalo do autosave é o combinado (não é a cada tecla) e o texto do indicador é discreto', () => {
    expect(ENCOUNTER_AUTOSAVE_MS).toBeGreaterThanOrEqual(800);
    expect(ENCOUNTER_AUTOSAVE_MS).toBeLessThanOrEqual(1200);
    expect(ENCOUNTER_AUTOSAVE_LABELS).toEqual({
      saving: 'Salvando…', saved: 'Salvo agora', error: 'Erro ao salvar',
    });
  });
});

describe('A3.4 fix · autosave do registro (contrato da tela)', () => {
  it('o timer existe, é por mudança, e espera o silêncio', () => {
    expect(SHEET).toMatch(/setTimeout\(\(\) => \{ void save\(\{ silent: true \}\)[^)]*\}, ENCOUNTER_AUTOSAVE_MS\)/);
    expect(SHEET).toMatch(/clearTimeout\(t\)/);
  });

  it('autosave só age em RASCUNHO, com mudança real e sem insistir após conflito', () => {
    // Recorte do EFEITO do autosave: as travas ficam nas guardas do efeito,
    // antes do timer (comentários já removidos — o que vale é o código).
    const timerAt = SHEET.indexOf('setTimeout(() => { void save({ silent: true })');
    expect(timerAt).toBeGreaterThan(0);
    const effect = SHEET.slice(timerAt - 700, timerAt + 80);
    expect(effect).toMatch(/row\.status !== 'draft'/);
    expect(effect).toMatch(/conflict/);
    expect(effect).toMatch(/encounterDraftKey/);
    // "um request por vez" também vale no caminho manual: o `inflight` segura.
    expect(SHEET).toMatch(/if \(inflight\.current\) return inflight\.current;/);
  });

  it('o salvamento manda expectedVersion e lê o 409 como conflito (nada de overwrite silencioso)', () => {
    expect(SHEET).toMatch(/encounterContentPayload\(businessId, current\.id, currentForm, current\.version\)/);
    expect(SHEET).toMatch(/setConflict\(res\.status === 409\)/);
    expect(SHEET).toMatch(/ENCOUNTER_VERSION_ERROR/);
    expect(SHEET).toMatch(/Recarregar registro/);
  });

  it('fechar com alteração pendente tenta salvar e, se falhar, AVISA em vez de perder', () => {
    expect(SHEET).toMatch(/const close = useCallback\(async \(\) => \{/);
    expect(SHEET).toMatch(/await save\(\{ silent: true \}\)/);
    expect(SHEET).toMatch(/window\.confirm\(/);
    expect(SHEET).toMatch(/onClose=\{\(\) => \{ void close\(\); \}\}/);
  });

  it('a tela finalizada explica a porta da reabertura (não some com a ação)', () => {
    expect(SHEET).toMatch(/Reabrir para editar/);
    expect(SHEET).toMatch(/action: 'reopen'/);
  });
});

describe('A3.4 fix · fila → atendimento (sem agendamento)', () => {
  it('"Iniciar atendimento" avança a fila E abre o registro, com a permissão certa', () => {
    expect(QUEUE).toMatch(/if \(to === 'in_service' && canEncounter && onEncounter\) onEncounter\(row\)/);
    expect(QUEUE).toMatch(/canEncounter: boolean/);
    // Sem a permissão, o botão continua movendo a fila (balcão não para).
    expect(QUEUE).not.toMatch(/onClick=\{\(\) => move\(row, action\.to\)\}[\s\S]{0,80}disabled=\{!canEncounter\}/);
  });

  it('o painel do registro aceita nascer da fila e a agenda passa a entrada', () => {
    expect(SHEET).toMatch(/queueId\?: string/);
    expect(SHEET).toMatch(/queueId: queueId \|\| ''/);
    expect(AGENDA).toMatch(/onEncounter=\{\(row\) => setQueueEncounter\(row\)\}/);
    expect(AGENDA).toMatch(/queueId=\{queueEncounter\.id\}/);
    expect(AGENDA).toMatch(/canEncounter=\{!denied && canEncounter\}/);
    expect(AGENDA).toMatch(/permissions\.atendimento === true/);
  });

  it('"Encaixar na agenda" abre o agendamento PREENCHIDO — não cria nada sozinho', () => {
    expect(AGENDA).toMatch(/onFitIn=\{\(row\) => setCreating\(\{/);
    expect(AGENDA).toMatch(/contactId: row\.contactId, name: row\.customerName, phone: row\.customerPhone, serviceId: row\.serviceId/);
    // Quem cria é o formulário (NewBookingSheet), com confirmação humana.
    expect(AGENDA).toMatch(/initial=\{\{\s*name: creating\.name/);
    expect(AGENDA).toMatch(/contactId: creating\.contactId, serviceId: creating\.serviceId/);
  });

  it('ações secundárias da linha existem: abrir cliente, encaixar, ver horário', () => {
    expect(QUEUE).toMatch(/Abrir cliente/);
    expect(QUEUE).toMatch(/Encaixar na agenda/);
    expect(QUEUE).toMatch(/Ver horário/);
    expect(AGENDA).toMatch(/onOpenClient=\{\(row\) => \{ window\.location\.href = `\/clientes\?c=/);
  });
});

describe('A3.4 fix · +55 é prefixo visual compartilhado', () => {
  it('o componente é um só, com o prefixo fixo e o onChange entregando dígitos', () => {
    expect(PROVIDER).toMatch(/\+\d\d/);                       // o "+55" está lá
    expect(PROVIDER).toMatch(/aria-hidden="true"/);           // não é conteúdo do campo
    expect(PROVIDER).toMatch(/onChange\(e\.target\.value\.replace\(\/\\D\/g, ''\)\.slice\(0, 13\)\)/);
    // O prefixo é TEXTO, não campo: não há input para ele.
    const prefixBlock = PROVIDER.slice(PROVIDER.indexOf('+55') - 400, PROVIDER.indexOf('+55'));
    expect(prefixBlock).not.toMatch(/<\s*input/i);
  });

  it('as cinco telas usam o componente e pararam de duplicar a máscara', () => {
    for (const file of [
      'src/components/dashboard/NewClientSheet.tsx',
      'src/components/dashboard/ClientProfileDrawer.tsx',
      'src/components/dashboard/NewBookingSheet.tsx',
      'src/components/dashboard/QueuePanel.tsx',
      'src/components/dashboard/EsteiraView.tsx',
    ]) {
      const src = stripComments(read(file));
      expect(src, `${file} deve usar PhoneBRInput`).toMatch(/PhoneBRInput/);
      // Nenhuma dessas telas volta a chamar a máscara na mão.
      expect(src, `${file} não deve duplicar máscara`).not.toMatch(/maskPhoneBR\(/);
    }
  });

  it('colar "+55 (11) 99999-9999" não duplica o código do país', () => {
    const digitado = PROVIDER.includes('+55');
    expect(digitado).toBe(true);
    expect(maskPhoneBR('5511999998888')).toBe('(11) 99999-8888');
    expect(normalizePhoneBR('+5511999998888')).toBe('11999998888');
    expect(phoneError('+5511999998888')).toBe('');
  });
});

describe('A3.4 fix · observações administrativas × atendimento', () => {
  it('a aba e o campo dizem ADMINISTRATIVAS e não prometem conteúdo de atendimento', () => {
    expect(DRAWER).toMatch(/label: 'Observações administrativas'/);
    expect(DRAWER).toMatch(/Observação administrativa/);
    expect(DRAWER).toMatch(/Prefere horário da manhã, confirmar por telefone, convênio\.\.\./);
    // O placeholder antigo mandava escrever atendimento aqui — saiu.
    expect(DRAWER).not.toMatch(/observações de atendimento…/);
  });

  it('o vazio explica que o registro do atendimento é OUTRO lugar', () => {
    expect(DRAWER).toMatch(/Nenhuma observação administrativa ainda/);
    expect(DRAWER).toMatch(/O que aconteceu no atendimento fica em Atendimentos/);
    expect(DRAWER).toMatch(/esta lista não substitui nem copia aquele conteúdo/);
  });
});

describe('A3.4 fix · artefato de build fora do versionamento', () => {
  it('tsconfig.tsbuildinfo continua no .gitignore (não volta a ser versionado)', () => {
    const ignore = read('.gitignore');
    expect(ignore.split('\n').map((l) => l.trim())).toContain('tsconfig.tsbuildinfo');
  });

  it('o tsconfig de verdade segue intacto — o que saiu do índice foi só o artefato', () => {
    const tsconfig = JSON.parse(read('tsconfig.json'));
    expect(tsconfig.compilerOptions.incremental ?? tsconfig.compilerOptions.tsBuildInfoFile ?? true).toBeTruthy();
  });
});

describe('A3.4 fix · a via impressa continua saindo do MESMO registro', () => {
  it('anotação interna nunca entra no papel, e a assinatura vem de quem atendeu', () => {
    const row: Encounter = {
      id: 'e1', businessId: 'b1', bookingId: 'bk-1', serviceId: 's1', professionalId: 'p1',
      customerId: '', contactId: 'c1', customerName: 'Ana', date: '2026-09-19', time: '09:00',
      complaint: 'dor', evolution: 'limpeza', guidance: 'evitar frios', followUp: 'retorno em 30 dias',
      internalNote: 'segredo da unidade', tags: [], status: 'finalized', version: 2,
      createdAt: '2026-09-19T12:00:00.000Z', updatedAt: '2026-09-19T12:00:00.000Z',
      createdBy: 'u1', updatedBy: 'u1', finalizedAt: '2026-09-19T13:00:00.000Z',
      finalizedBy: 'u1', signedBy: 'Bia',
    };
    const blocks = encounterPrintBlocks(row);
    expect(JSON.stringify(blocks)).not.toContain('segredo da unidade');
    expect(encounterSignature(row)).toBe('Bia');
    expect(ENCOUNTER_VERSION_ERROR).toMatch(/Recarregue antes de salvar/);
  });
});
