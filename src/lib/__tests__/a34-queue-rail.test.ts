// ═══════════════════════════════════════════════════════════════
// A3.4 — AJUSTE FINAL DE UX: A FILA É RAIL LATERAL DA AGENDA
// ═══════════════════════════════════════════════════════════════
// O que estava errado: o QueuePanel entrava no fluxo VERTICAL da Agenda —
// resumo, painel expandido, toolbar e só então a grade. Abrir a fila empurrava
// a agenda para baixo, encolhia a altura útil da grade (`gridMaxH`) e fazia o
// painel parecer “mais um card empilhado”.
//
// O que este arquivo trava (regressão de FONTE/CONTRATO — o ambiente de teste
// não renderiza DOM, então o que se prova é a estrutura publicada no JSX):
//
//   1. o QueuePanel NÃO volta para o fluxo vertical acima da toolbar/grade;
//   2. o desktop tem workspace [Agenda flex-1 · rail da fila];
//   3. a rail é condicional (`showQueue`) e fechar devolve 100% da largura;
//   4. tela estreita usa overlay — a agenda nunca é espremida por 280px;
//   5. existe UM só QueuePanel (sem duas versões da fila) e a rail é a
//      superfície (nada de SubCard externo);
//   6. abrir/fechar a fila não deixa altura stale na agenda (o medidor roda de
//      novo e a grade continua medindo o PRÓPRIO scroller).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
/** Sem comentários: o teste se refere ao CÓDIGO, não ao que o texto promete. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const AGENDA = stripComments(read('src/app/(dashboard)/agenda/page.tsx'));
const DOCK=stripComments(read('src/components/dashboard/QueueDock.tsx'));
const CSS=read('src/app/globals.css');
const QUEUE = stripComments(read('src/components/dashboard/QueuePanel.tsx'));

describe('A3.4 final UX · workspace [Agenda | Fila]', () => {
  it('a agenda tem um workspace horizontal com a coluna da agenda em flex-1/min-w-0', () => {
    expect(AGENDA).toContain('data-agenda-workspace="true"');
    expect(AGENDA).toMatch(/data-agenda-workspace="true"[^>]*className="flex[^"]*min-w-0"/);
    expect(AGENDA).toMatch(/data-agenda-main="true" className="flex-1 min-w-0"/);
  });

  it('a toolbar e a grade ficam DENTRO da coluna da agenda (a fila é irmã, não irmã-de-cima)', () => {
    const mainAt = AGENDA.indexOf('data-agenda-main="true"');
    const toolbarAt = AGENDA.indexOf('relative z-40 ws-panel');
    const railAt = AGENDA.indexOf('<QueueDock');
    const closeMainAt = AGENDA.indexOf('</main>');
    expect(mainAt).toBeGreaterThan(-1);
    expect(toolbarAt).toBeGreaterThan(mainAt);
    expect(railAt).toBeGreaterThan(closeMainAt);
    expect(closeMainAt).toBeGreaterThan(toolbarAt);
  });

  it('o QueuePanel vive DENTRO da rail — nunca acima da toolbar/grade', () => {
    const railAt = AGENDA.indexOf('<QueueDock');
    const panelAt = AGENDA.indexOf('<QueuePanel');
    const toolbarAt = AGENDA.indexOf('relative z-40 ws-panel');
    expect(panelAt).toBeGreaterThan(railAt);
    expect(panelAt).toBeGreaterThan(toolbarAt);
    // E não sobrou nenhum painel antes da toolbar (o resumo acima é permitido).
    expect(AGENDA.slice(0, toolbarAt)).not.toContain('<QueuePanel');
    expect(AGENDA.slice(0, toolbarAt)).toContain('aria-expanded={showQueue}');
  });

  it('a rail é condicional por showQueue e fechar devolve 100% da largura', () => {
    const railAt = AGENDA.indexOf('<QueueDock');
    const antes = AGENDA.slice(railAt - 300, railAt);
    expect(antes).toMatch(/\{showQueue && \(/);
    expect(AGENDA).toMatch(/onClose=\{\(\) => setShowQueue\(false\)\}/);
  });

  it('tela estreita usa overlay; o rail só existe no desktop largo (sem espremer a agenda)', () => {
    expect(DOCK).toContain("matchMedia('(min-width:1280px)')");
    expect(DOCK).toContain('<Drawer open title="Fila de atendimento"');
    expect(DOCK).toContain('<aside data-queue-rail');
    expect(CSS).toMatch(/\[data-queue-rail\][^}]*width:280px/);
    expect(CSS).toMatch(/\[data-queue-rail\][^}]*overflow-y:auto/);

  });

  it('existe UM só QueuePanel — sem duas versões da fila', () => {
    expect(AGENDA.split('<QueuePanel').length - 1).toBe(1);
    expect(QUEUE).toContain('data-queue-panel="true"');
    // A rail é a superfície: o painel não é um card empilhado dentro dela.
    expect(QUEUE).not.toContain('SubCard');
  });

  it('a rail tem header sticky, [X] e o formulário de adicionar por dentro', () => {
    expect(QUEUE).toMatch(/sticky top-0[^"]*border-b/);
    expect(QUEUE).toMatch(/onClose && \(/);
    expect(QUEUE).toMatch(/icon="x" label="Fechar a fila"/);
    expect(QUEUE).toMatch(/\{adding && \(/);
    // O botão continua existindo para abrir/fechar a fila pela agenda.
    expect(AGENDA).toContain('Fila de atendimento');
  });

  it('abrir/fechar a fila não deixa altura stale na agenda', () => {
    expect(AGENDA).toMatch(/const \[railMaxH, setRailMaxH\] = useState<number \| null>\(null\)/);
    expect(AGENDA).toMatch(/setRailMaxH\(Math\.max\(320, Math\.floor\(window\.innerHeight - wtop - VIEWPORT_BOTTOM_PAD\)\)\)/);
    // O medidor roda de novo quando a fila abre/fecha (nada de valor velho).
    expect(AGENDA).toMatch(/hbarReserve, showQueue\]\);/);
    // E a grade continua medindo o próprio scroller — a fila não a encolhe.
    expect(AGENDA).toMatch(/const top = el\.getBoundingClientRect\(\)\.top/);
  });

  it('nada de largura na mão nem setTimeout para consertar a rail', () => {
    expect(DOCK).not.toMatch(/setTimeout/);
    expect(DOCK).not.toMatch(/style=\{\{width:/);
    expect(DOCK).toContain('--queue-rail-maxh');
    expect(AGENDA).toMatch(/data-agenda-workspace="true"[^>]*min-w-0/);

  });

  it('o comportamento da fila não mudou (layout não toca domínio)', () => {
    expect(QUEUE).toMatch(/if \(to === 'in_service' && canEncounter && onEncounter\) onEncounter\(row\)/);
    expect(QUEUE).toMatch(/apiSend\('\/api\/queue', 'POST'/);
    expect(QUEUE).toMatch(/apiSend\('\/api\/queue', 'PATCH'/);
    expect(QUEUE).toMatch(/apiSend\('\/api\/queue', 'DELETE'/);
    // A fila continua sem criar agendamento: "Encaixar" só abre o formulário.
    expect(QUEUE).toMatch(/Encaixar na agenda/);
    expect(QUEUE).not.toMatch(/apiSend\('\/api\/bookings'/);
  });
});
