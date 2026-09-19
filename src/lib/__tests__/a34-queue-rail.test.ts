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
//   4. tela estreita usa overlay — a agenda nunca é espremida por 380px;
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
    const railAt = AGENDA.indexOf('data-queue-rail="true"');
    const closeMainAt = AGENDA.indexOf('</main>');
    expect(mainAt).toBeGreaterThan(-1);
    expect(toolbarAt).toBeGreaterThan(mainAt);
    expect(railAt).toBeGreaterThan(closeMainAt);
    expect(closeMainAt).toBeGreaterThan(toolbarAt);
  });

  it('o QueuePanel vive DENTRO da rail — nunca acima da toolbar/grade', () => {
    const railAt = AGENDA.indexOf('data-queue-rail="true"');
    const panelAt = AGENDA.indexOf('<QueuePanel');
    const toolbarAt = AGENDA.indexOf('relative z-40 ws-panel');
    expect(panelAt).toBeGreaterThan(railAt);
    expect(panelAt).toBeGreaterThan(toolbarAt);
    // E não sobrou nenhum painel antes da toolbar (o resumo acima é permitido).
    expect(AGENDA.slice(0, toolbarAt)).not.toContain('<QueuePanel');
    expect(AGENDA.slice(0, toolbarAt)).toContain('aria-expanded={showQueue}');
  });

  it('a rail é condicional por showQueue e fechar devolve 100% da largura', () => {
    const railAt = AGENDA.indexOf('data-queue-rail="true"');
    const antes = AGENDA.slice(railAt - 300, railAt);
    expect(antes).toMatch(/\{showQueue && \(/);
    expect(AGENDA).toMatch(/onClose=\{\(\) => setShowQueue\(false\)\}/);
  });

  it('tela estreita usa overlay; o rail só existe no desktop largo (sem espremer a agenda)', () => {
    const aside = AGENDA.slice(AGENDA.indexOf('<aside'), AGENDA.indexOf('</aside>'));
    // Overlay padrão: ocupa a direita, some do fluxo (position fixed).
    expect(aside).toMatch(/fixed inset-y-0 right-0/);
    expect(aside).toMatch(/w-\[min\(92vw,380px\)\]/);
    // Desktop largo: entra no fluxo como coluna do workspace.
    expect(aside).toMatch(/xl:static/);
    expect(aside).toMatch(/xl:inset-auto/);
    expect(aside).toMatch(/xl:w-\[368px\]/);
    expect(aside).toMatch(/xl:shrink-0/);
    expect(aside).toMatch(/xl:self-start/);
    // A lista rola DENTRO da rail, com a altura útil medida do workspace.
    expect(aside).toMatch(/xl:max-h-\[var\(--queue-rail-maxh\)\]/);
    expect(aside).toMatch(/overflow-y-auto/);
    // Fundo só no modo overlay (o desktop não escurece a agenda) e pelo
    // TOKEN de véu do design system (A3.3), não por opacidade avulsa.
    expect(AGENDA).toMatch(/xl:hidden fixed inset-0 z-40 bg-\[var\(--overlay\)\]/);
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
    expect(AGENDA).toContain('Fila de hoje');
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
    const rail = AGENDA.slice(AGENDA.indexOf('data-queue-rail'), AGENDA.indexOf('</aside>'));
    // A rail não calcula largura em JS: overlay por `w-[min(92vw,380px)]`,
    // desktop por `xl:w-[368px]`. O único valor medido é a ALTURA útil.
    expect(rail).not.toMatch(/setTimeout/);
    expect(rail).not.toMatch(/width:/);
    expect(rail).toMatch(/--queue-rail-maxh/);
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
