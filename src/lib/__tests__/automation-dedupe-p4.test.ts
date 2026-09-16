// ═══════════════════════════════════════════════════════════════
// P4 (auditoria final) — DEDUPE DE EVENTOS, REENTRÂNCIA E NORMALIZAÇÃO
// ═══════════════════════════════════════════════════════════════
// Este arquivo existe porque a auditoria da PR #18 encontrou comportamento que
// os testes anteriores não travavam. Cada `it` abaixo é o contrato escrito à
// prova: A–E do dedupe, profundidade de reentrada e o que `normalizeDB`/`prune`
// podem (e não podem) fazer com dados do usuário.
//
// Tudo roda sobre `emptyDB()` em memória: `emitAutomationEvent` é puro sobre o
// documento, então a decisão de dedupe é observável sem I/O.
import { describe, expect, it } from 'vitest';
import {
  addLead, automationFixtures, buildAutomation, FIXED_NOW,
} from './helpers/automation-fixtures';
import { emitAutomationEvent, MAX_REENTRY_DEPTH, reentryDepth } from '../automation/events';
import { normalizeDB } from '../db';
import type { DB } from '../types';

type EmitInput = Parameters<typeof emitAutomationEvent>[1];

function iso(offsetMs = 0): string {
  return new Date(Date.parse(FIXED_NOW) + offsetMs).toISOString();
}

function fire(db: DB, opts: EmitInput) {
  return emitAutomationEvent(db, { at: FIXED_NOW, ...opts });
}

function noteStep(text: string) {
  return { kind: 'action' as const, action: { type: 'add_lead_note' as const, params: { text } } };
}

describe('P4 auditoria — dedupe do gatilho (A–E)', () => {
  it('A) mesma eventKey explícita: nunca uma segunda execução da mesma automação', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({ steps: [noteStep('uma vez')] }));

    const first = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', eventKey: 'pedido-123' });
    // Reenvio uma hora depois (outro instante, MESMA chave de negócio).
    const replay = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', eventKey: 'pedido-123', at: iso(3600_000) });

    expect(first.created).toHaveLength(1);
    expect(replay.created).toHaveLength(0);
    expect(replay.skipped[0].reason).toContain('já existe');
    expect(db.automationRuns).toHaveLength(1);
    expect(db.automationRuns[0].eventKey).toBe('pedido-123');

    // Execução terminal não abre exceção: a chave continua empenhada.
    db.automationRuns[0].status = 'completed';
    const afterDone = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', eventKey: 'pedido-123', at: iso(7200_000) });
    expect(afterDone.created).toHaveLength(0);
  });

  it('A2) chaves diferentes do mesmo lead disparam as duas execuções (dedupe não é trava por assunto)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({ steps: [noteStep('x')] }));
    expect(fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', eventKey: 'a' }).created).toHaveLength(1);
    expect(fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', eventKey: 'b' }).created).toHaveLength(1);
    expect(db.automationRuns).toHaveLength(2);
  });

  it('B) evento legítimo posterior não é bloqueado pelo dedupe', async () => {
    const db = automationFixtures();
    addLead(db, { origin: 'instagram' });
    db.automations.push(buildAutomation({ event: 'lead.updated', steps: [noteStep('atualizou')] }));

    const one = fire(db, { event: 'lead.updated', businessId: 'b1', leadId: 'lead-1', data: { changed: 'priority' } });
    expect(one.created).toHaveLength(1);

    // O lead mudou de verdade (nova fotografia) ⇒ novo evento, nova execução.
    db.leads[0].stageId = 'qualifying';
    db.leads[0].lastInteraction = iso(60_000);
    const two = fire(db, { event: 'lead.updated', businessId: 'b1', leadId: 'lead-1', at: iso(60_000), data: { changed: 'stageId' } });
    expect(two.created).toHaveLength(1);
    expect(db.automationRuns).toHaveLength(2);
  });

  it('B2) múltiplas automações ouvindo o MESMO evento: cada uma cria a sua execução', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(
      buildAutomation({ id: 'auto-1', steps: [noteStep('uma')] }),
      buildAutomation({ id: 'auto-2', steps: [noteStep('duas')] }),
    );
    const res = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', data: { isNew: true } });
    expect(res.matched).toBe(2);
    expect(res.created.map((r) => r.automationId).sort()).toEqual(['auto-1', 'auto-2']);
    // Nenhuma delas bloqueou a outra: as duas chaves derivadas são iguais.
    expect(db.automationRuns[0].eventKey).toBe(db.automationRuns[1].eventKey);
  });

  it('C) dedupeField = uma execução por lead, seja lá quando for', async () => {
    const db = automationFixtures();
    addLead(db);
    addLead(db, { id: 'lead-2', name: 'Bia', phone: '11977776666' });
    db.automations.push(buildAutomation({
      steps: [noteStep('follow-up')],
      settings: { dedupeField: 'lead.id' },
    }));

    const first = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', data: { isNew: true } });
    expect(first.created).toHaveLength(1);
    expect(db.automationRuns[0].eventKey).toBe('lead.created:field:lead-1');

    // Mesmo lead, um dia depois, conteúdo DIFERENTE: a intenção documentada é
    // "uma vez por lead para esta automação" ⇒ nada de segunda execução.
    db.leads[0].stageId = 'qualifying';
    db.leads[0].lastInteraction = iso(86400_000);
    const same = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: iso(86400_000), data: { isNew: true, extra: 1 } });
    expect(same.created).toHaveLength(0);
    expect(same.skipped[0].reason).toContain('já existe');

    // Outro lead da mesma unidade: dispara normalmente.
    const other = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-2', at: iso(86400_000), data: { isNew: true } });
    expect(other.created).toHaveLength(1);
  });

  it('D) unidade A nunca consome nem contamina o dedupe da unidade B', async () => {
    const db = automationFixtures();
    addLead(db, { id: 'lead-1', name: 'Mesmo Nome', phone: '11000000000' });
    // Lead idêntico em conteúdo na unidade B (mesma fotografia possível).
    addLead(db, { id: 'lead-2', businessId: 'b2', name: 'Mesmo Nome', phone: '11000000000' });
    db.automations.push(
      buildAutomation({ id: 'auto-1', businessId: 'b1', steps: [] }),
      buildAutomation({ id: 'auto-2', businessId: 'b2', steps: [] }),
    );

    // A chave explícita é idêntica nas duas unidades (cenário real: o lojista
    // manda o MESMO id de pedido do sistema dele para duas empresas).
    const inA = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', eventKey: 'pedido-123' });
    const inB = fire(db, { event: 'lead.created', businessId: 'b2', leadId: 'lead-2', eventKey: 'pedido-123' });
    expect(inA.created).toHaveLength(1);
    expect(inB.created).toHaveLength(1);
    expect(inB.skipped.filter((s) => s.reason.includes('já existe'))).toEqual([]);

    // Reenvio em B não é bloqueado pela existência da chave em A...
    expect(fire(db, { event: 'lead.created', businessId: 'b2', leadId: 'lead-2', eventKey: 'outra-chave' }).created).toHaveLength(1);
    // ...e cada unidade continua bloqueando apenas o próprio reenvio.
    expect(fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', eventKey: 'pedido-123' }).created).toHaveLength(0);
    expect(fire(db, { event: 'lead.created', businessId: 'b2', leadId: 'lead-2', eventKey: 'pedido-123' }).created).toHaveLength(0);

    // O contexto lido pelas condições também não atravessa unidades.
    const runOfB = db.automationRuns.find((r) => r.businessId === 'b2')!;
    expect((runOfB.context.lead as any).id).toBe('lead-2');
    expect(db.automationRuns.every((r) => r.businessId === 'b1' || r.businessId === 'b2')).toBe(true);
  });

  it('E) execução originada por automação não reabre nada (anti-loop por padrão)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({ steps: [noteStep('x')] }));
    const first = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', data: { isNew: true } });
    const runId = first.created[0].id;

    const loop = fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', fromRunId: runId, data: { isNew: true, by: 'run' } });
    expect(loop.created).toHaveLength(0);
    expect(loop.skipped[0].reason).toContain('reentrada desativada');
    // A origem fica registrada para diagnóstico mesmo quando nada é criado.
    expect(db.automationRuns).toHaveLength(1);
  });

  it('E2) reentrada explícita tem fundo: a corrente para em MAX_REENTRY_DEPTH', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      event: 'lead.updated',
      steps: [noteStep('reentrou')],
      settings: { allowReentry: true },
    }));

    let from: string | undefined;
    let created = 0;
    let blockedAt = -1;
    for (let hop = 0; hop < 20 && blockedAt < 0; hop++) {
      // Conteúdo novo a cada salto: o dedupe por conteúdo não pode ser o
      // responsável por parar a corrente — quem para é a profundidade.
      db.leads[0].lastInteraction = iso(hop * 1000);
      const res = fire(db, {
        event: 'lead.updated', businessId: 'b1', leadId: 'lead-1', at: iso(hop * 1000),
        data: { hop }, fromRunId: from,
      });
      if (res.created.length === 0) {
        expect(res.skipped[0].reason).toContain('cadeia de reentrada');
        blockedAt = hop;
        break;
      }
      created += 1;
      from = res.created[0].id;
    }
    expect(blockedAt).toBeGreaterThan(0);
    expect(created).toBe(MAX_REENTRY_DEPTH + 1);
    // O primeiro elo da cadeia não tem linhagem; um salto isolado é sempre aceito.
    expect(reentryDepth(db, '')).toBe(0);
    expect(reentryDepth(db, db.automationRuns[0].id)).toBe(0);
  });

  it('E3) allowReentry não quebra a corrente quando o pai já saiu do histórico', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({ event: 'lead.updated', steps: [], settings: { allowReentry: true } }));
    // Run órfão (a execução de origem foi podada do histórico): o caminho de
    // volta não existe ⇒ profundidade 0, e nada trava o evento legítimo.
    const res = fire(db, { event: 'lead.updated', businessId: 'b1', leadId: 'lead-1', fromRunId: 'run-que-nao-existe-mais', data: { hop: 1 } });
    expect(res.created).toHaveLength(1);
    expect(res.created[0].emittedByRunId).toBe('run-que-nao-existe-mais');
  });
});

describe('P4 auditoria — normalização e poda (o banco não perde dado)', () => {
  it('automação com formato inesperado é CONSERTADA, não descartada', () => {
    const db = normalizeDB({
      businesses: [],
      automations: [{
        id: 'auto-1', businessId: 'b1', name: 'Minha automação',
        // tipo de nó que ainda não existia + aresta incompleta + campo novo
        nodes: [{ id: 'n1', type: 'trigger' }, { id: 'n2', type: 'muito-futuro', config: {} }, { id: 'n3' }],
        edges: [{ from: 'n1', to: 'n2' }, { from: 'n2' }],
        trigger: { event: 'nao-existe' },
        settings: { campoNovoDoFuturo: 7 },
        campoNovoDaEmpresa: 'x',
      }],
    }) as DB;

    const kept = db.automations.find((a) => a.id === 'auto-1');
    expect(kept, 'definição com id e dono nunca é apagada pela normalização').toBeTruthy();
    expect(kept!.name).toBe('Minha automação');
    expect(kept!.nodes).toHaveLength(2);                    // entrada sem id some; as outras ficam
    expect(kept!.nodes[1].type).toBe('end');                 // tipo desconhecido vira inofensivo
    expect(kept!.edges).toHaveLength(1);                     // aresta sem destino é descartada
    expect(kept!.trigger.event).toBe('lead.created');        // evento inexistente cai no padrão
    expect((kept!.settings as any).campoNovoDoFuturo).toBe(7);
  });

  it('execução ilegível é ignorada pelo motor sem arrastar as execuções vizinhas', () => {
    const db = normalizeDB({
      businesses: [],
      automationRuns: [
        'lixo',
        { id: 'r1' },                                          // sem dono ⇒ fora
        { id: 'r2', businessId: 'b1', automationId: 'auto-1', status: 'invente' },
        { id: 'r3', businessId: 'b1', automationId: 'auto-1', status: 'waiting', waitingUntil: iso(3600_000) },
      ],
    }) as DB;
    expect(db.automationRuns.map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(db.automationRuns[0].status).toBe('queued');        // status desconhecido = trabalhável
    expect(db.automationRuns[1].status).toBe('waiting');
  });

  it('documentos antigos (sem as chaves do P4) ganham arrays vazios, nunca perdas', () => {
    const db = normalizeDB({ users: [], businesses: [], leads: [] }) as DB;
    expect(db.automations).toEqual([]);
    expect(db.automationRuns).toEqual([]);
    expect(db.tasks).toEqual([]);
  });
});
