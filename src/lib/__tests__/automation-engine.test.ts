// ═══════════════════════════════════════════════════════════════
// P4 — MOTOR DE AUTOMAÇÕES: executor, gatilhos, condições, esperas
// ═══════════════════════════════════════════════════════════════
// Cobre os itens exigidos da suíte P4: gatilho correto/incorreto, condição
// verdadeira/falsa, AND/OR/NOT, ação, múltiplos nós, ramificação, delay,
// retomada, erro, duplicidade, loop, histórico, ativar/desativar, isolamento
// multi-tenant. Tudo sobre `emptyDB()` em memória — o motor é o mesmo da
// produção (stepAutomationRun/processAutomationRunsInDb); o que muda é só quem
// persiste (aqui, nada; lá, updateDB + CAS).
import { describe, expect, it } from 'vitest';
import {
  addContact, addLead, automationFixtures, buildAutomation, FIXED_NOW,
} from './helpers/automation-fixtures';
import { emitAutomationEvent } from '../automation/events';
import {
  claimDueAutomationRuns, countDueAutomationRuns, dueAutomationRuns, isAutomationRunDue,
  processAutomationRunsInDb, sanitizeAutomationRunForDisplay, stepAutomationRun,
  MAX_NODE_VISITS,
} from '../automation/executor';
import { evaluateCondition, renderTemplate, resolveFieldPath } from '../automation/conditions';
import { limitsFor } from '../automation/capabilities';
import { applyBookingStatusTx } from '../booking-status';
import { getBusinessPipeline, moveLeadStage } from '../pipeline';
import { openTasks } from '../automation/tasks';
import { todayISO } from '../tz';
import type { AutomationRun, DB } from '../types';

function nowISO(offsetMs = 0): string {
  return new Date(Date.parse(FIXED_NOW) + offsetMs).toISOString();
}

function engineWith(automation: ReturnType<typeof buildAutomation>, db: DB = automationFixtures()) {
  db.automations.push(automation);
  return db;
}

type EmitInput = Parameters<typeof emitAutomationEvent>[1];

async function fire(db: DB, opts: EmitInput): Promise<AutomationRun[]> {
  const res = emitAutomationEvent(db, { at: FIXED_NOW, ...opts });
  expect(res.skipped.filter((s) => s.reason.includes('cheia'))).toEqual([]);
  return res.created;
}

describe('P4.2 — gatilhos', () => {
  it('3) cria execução quando o evento casa com o gatilho ativo', async () => {
    const db = engineWith(buildAutomation({
      event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'Triagem inicial' } } }],
    }));
    addLead(db);

    const runs = await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('queued');
    expect(runs[0].businessId).toBe('b1');
    expect(runs[0].triggerEvent).toBe('lead.created');

    const summary = await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(summary.completed).toBe(1);
    const lead = db.leads.find((l) => l.id === 'lead-1')!;
    expect((lead.notes || []).map((n) => n.text)).toContain('Triagem inicial');
  });

  it('4) não executa quando o evento NÃO é o gatilho', async () => {
    const db = engineWith(buildAutomation({
      event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'não deveria rodar' } } }],
    }));
    addLead(db);

    const runs = emitAutomationEvent(db, { event: 'booking.created', businessId: 'b1', at: FIXED_NOW, bookingId: 'bk-outro' }).created;
    expect(runs).toHaveLength(0);
    expect(db.leads[0].notes || []).toHaveLength(0);
  });

  it('não executa automação inativa (19 - desligada)', async () => {
    const db = engineWith(buildAutomation({
      active: false,
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'x' } } }],
    }));
    addLead(db);
    const runs = await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    expect(runs).toHaveLength(0);
  });

  it('o lead nasce pelo serviço oficial e o gatilho dispara sozinho (ingestLead)', async () => {
    const { ingestLead } = await import('../pipeline');
    const db = automationFixtures();
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Ligar para {{lead.name}}' } } }],
    }));

    ingestLead(db, { businessId: 'b1', name: 'Nova Pessoa', phone: '11911112222', source: 'instagram' });

    const runs = db.automationRuns.filter((r) => r.triggerEvent === 'lead.created');
    expect(runs).toHaveLength(1);
    expect(runs[0].context.lead.name).toBe('Nova Pessoa');
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    const tasks = openTasks(db, 'b1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Ligar para Nova Pessoa');
    expect(tasks[0].createdBy).toBe('automation');
  });

  it('movimento de etapa pela função oficial gera lead.stage_changed', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      event: 'lead.stage_changed',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'viu a etapa {{event.stageId}}' } } }],
    }));

    moveLeadStage(db, {
      businessId: 'b1', leadId: 'lead-1', toStageId: 'qualifying',
      actor: { id: 'ana', name: 'Ana' }, now: FIXED_NOW,
    });

    expect(db.automationRuns).toHaveLength(1);
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.leads[0].notes?.[0]?.text).toBe('viu a etapa qualifying');
  });

  it('cancelamento pela transição oficial gera booking.cancelled', async () => {
    const db = automationFixtures();
    db.bookings.push({
      id: 'bk-1', businessId: 'b1', customerId: '', serviceId: 'srv1', professionalId: '',
      date: '2026-09-20', time: '10:00', customerName: 'Rafael', customerPhone: '11988887777',
      status: 'confirmed', note: '', answers: [], createdAt: FIXED_NOW, updatedAt: FIXED_NOW, history: [],
    });
    db.automations.push(buildAutomation({
      event: 'booking.cancelled',
      steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Repor horário de {{booking.customerName}}' } } }],
    }));

    const res = applyBookingStatusTx(db, { businessId: 'b1', bookingId: 'bk-1', to: 'cancelled', by: 'system', now: FIXED_NOW });
    expect(res.ok).toBe(true);
    expect(db.automationRuns).toHaveLength(1);
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(openTasks(db, 'b1')[0].title).toBe('Repor horário de Rafael');
  });
});

describe('P4.2/P4.9 — isolamento por tenant', () => {
  it('2) automação da empresa A não vê evento da empresa B', async () => {
    const db = automationFixtures();
    db.automations.push(buildAutomation({
      businessId: 'b1',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'só do b1' } } }],
    }));
    addLead(db, { id: 'lead-b2', businessId: 'b2', name: 'Pessoa de outro tenant' });

    const created = emitAutomationEvent(db, { event: 'lead.created', businessId: 'b2', leadId: 'lead-b2', at: FIXED_NOW }).created;
    expect(created).toHaveLength(0);
  });

  it('execução não consegue agir sobre lead de outra empresa', async () => {
    const db = automationFixtures();
    addLead(db, { id: 'lead-b2', businessId: 'b2', name: 'Outro tenant' });
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'tentativa de invasão' } } }],
    }));
    const own = addLead(db, { id: 'lead-b1', businessId: 'b1', name: 'Meu tenant' });

    const runs = await fire(db, { event: 'lead.created', businessId: 'b1', leadId: own.id });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    expect((db.leads.find((l) => l.id === 'lead-b1')!.notes || []).length).toBe(1);
    // O lead da outra empresa permanece intocado.
    expect(db.leads.find((l) => l.id === 'lead-b2')!.notes || []).toHaveLength(0);
  });

  it('contexto adulterado com businessId alheio não muda o alvo', async () => {
    const db = automationFixtures();
    addLead(db, { id: 'lead-b2', businessId: 'b2' });
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'x' } } }],
    }));
    const runs = await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-b2' });
    // O assunto não pertence à unidade ⇒ snapshot vazio ⇒ a ação não tem alvo.
    if (runs.length) {
      await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
      expect(runs[0].status).toBe('failed');
      expect(runs[0].error).toContain('indisponível');
    }
    expect(db.leads.find((l) => l.id === 'lead-b2')!.notes || []).toHaveLength(0);
  });
});

describe('P4.3 — condições', () => {
  const ctx = {
    lead: { origin: 'Instagram', stageId: 'qualifying', name: 'Rafa', priority: 'high', bookingId: '', createdAt: '2026-09-16T10:00:00Z' },
    booking: { status: 'confirmed', date: '2026-09-20', time: '10:00' },
    event: { isNew: true },
  };

  it('equals é case-insensitive e not_equals é o inverso', () => {
    expect(evaluateCondition(ctx, { field: 'lead.origin', operator: 'equals', value: 'instagram' }).passed).toBe(true);
    expect(evaluateCondition(ctx, { field: 'lead.origin', operator: 'not_equals', value: 'instagram' }).passed).toBe(false);
    expect(evaluateCondition(ctx, { field: 'lead.origin', operator: 'equals', value: 'whatsapp' }).passed).toBe(false);
  });

  it('contains / not_contains funcionam em texto e arrays', () => {
    expect(evaluateCondition(ctx, { field: 'lead.name', operator: 'contains', value: 'af' }).passed).toBe(true);
    expect(evaluateCondition(ctx, { field: 'lead.name', operator: 'not_contains', value: 'af' }).passed).toBe(false);
    expect(evaluateCondition({ tags: ['a', 'b'] }, { field: 'tags', operator: 'contains', value: 'b' }).passed).toBe(true);
  });

  it('exists / not_exists tratam vazio como ausente', () => {
    expect(evaluateCondition(ctx, { field: 'lead.bookingId', operator: 'not_exists' }).passed).toBe(true);
    expect(evaluateCondition(ctx, { field: 'lead.name', operator: 'exists' }).passed).toBe(true);
    expect(evaluateCondition(ctx, { field: 'lead.nada', operator: 'not_exists' }).passed).toBe(true);
  });

  it('greater_than / less_than comparam números e datas ISO', () => {
    expect(evaluateCondition({ n: 10 }, { field: 'n', operator: 'greater_than', value: '5' }).passed).toBe(true);
    expect(evaluateCondition({ n: '3' }, { field: 'n', operator: 'less_than', value: 5 }).passed).toBe(true);
    expect(evaluateCondition(ctx, { field: 'booking.date', operator: 'greater_than', value: '2026-09-01' }).passed).toBe(true);
    // Não numérico e não data ⇒ comparação impossível ⇒ falso (falha segura).
    expect(evaluateCondition(ctx, { field: 'lead.name', operator: 'greater_than', value: '5' }).passed).toBe(false);
  });

  it('7) AND exige todas · 8) OR exige uma · 9) NOT inverte', () => {
    const originIs = { field: 'lead.origin', operator: 'equals', value: 'instagram' } as const;
    const stageIs = { field: 'lead.stageId', operator: 'equals', value: 'qualifying' } as const;
    const and = { logic: 'and' as const, conditions: [originIs, stageIs] };
    expect(evaluateCondition(ctx, and).passed).toBe(true);
    const andFalse = { logic: 'and' as const, conditions: [...and.conditions, { field: 'lead.priority', operator: 'equals', value: 'low' } as const] };
    expect(evaluateCondition(ctx, andFalse).passed).toBe(false);
    const or = { logic: 'or' as const, conditions: [{ field: 'lead.priority', operator: 'equals', value: 'low' } as const, { field: 'booking.status', operator: 'equals', value: 'confirmed' } as const] };
    expect(evaluateCondition(ctx, or).passed).toBe(true);
    expect(evaluateCondition(ctx, { logic: 'not', conditions: [originIs] }).passed).toBe(false);
  });

  it('caminho desconhecido/protótipo nunca resolve', () => {
    expect(resolveFieldPath(ctx, 'lead.__proto__.polluted')).toEqual({ found: false, value: undefined });
    expect(resolveFieldPath(ctx, 'constructor.prototype')).toEqual({ found: false, value: undefined });
    expect(resolveFieldPath(ctx, 'lead.nada')).toEqual({ found: false, value: undefined });
  });

  it('renderTemplate substitui apenas caminhos do contexto (sem expressão)', () => {
    expect(renderTemplate('Olá {{lead.name}}, seu {{booking.date}}', ctx)).toBe('Olá Rafa, seu 2026-09-20');
    expect(renderTemplate('vazio: {{lead.bookingId}}', ctx)).toBe('vazio:');
    expect(renderTemplate('{{lead.__proto__.x}}', ctx)).toBe('');
    expect(renderTemplate('sem tokens', ctx)).toBe('sem tokens');
  });

  it('5/6) execução segue o caminho quando a condição é VERDADEIRA e para quando é FALSA', async () => {
    const db = automationFixtures();
    addLead(db, { origin: 'instagram' });
    db.automations.push(buildAutomation({
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
      steps: [{ kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    expect(db.leads[0].stageId).toBe('qualifying');
    expect(db.automationRuns[0].status).toBe('completed');
    expect(db.automationRuns[0].history.some((h) => h.outcome === 'true')).toBe(true);

    // Agora a mesma automação com origem diferente: nada muda, mas fica registrado.
    const db2 = automationFixtures();
    addLead(db2, { origin: 'whatsapp' });
    db2.automations.push(buildAutomation({
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
      steps: [{ kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying' } } }],
    }));
    await fire(db2, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db2, { nowISO: FIXED_NOW });
    expect(db2.leads[0].stageId).toBe('new');
    expect(db2.automationRuns[0].history.some((h) => h.outcome === 'false')).toBe(true);
    expect(db2.automationRuns[0].status).toBe('completed');
  });
});

describe('P4.4/P4.5 — grafo, ramificação e ações', () => {
  it('11) executa múltiplos nós na ordem', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [
        { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualified' } } },
        { kind: 'action', action: { type: 'update_lead', params: { priority: 'high' } } },
        { kind: 'action', action: { type: 'add_lead_note', params: { text: 'terceiro passo' } } },
      ],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    const summary = await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    expect(db.leads[0].stageId).toBe('qualified');
    expect(db.leads[0].priority).toBe('high');
    expect(db.leads[0].notes?.[0]?.text).toBe('terceiro passo');
    expect(summary.completed).toBe(1);
    expect(db.automationRuns[0].steps).toBeGreaterThanOrEqual(4);
  });

  it('12) ramificação: caminho SIM e caminho NÃO', async () => {
    const db = automationFixtures();
    addLead(db, { id: 'lead-1', origin: 'instagram' });
    addLead(db, { id: 'lead-2', origin: 'whatsapp' });
    db.automations.push(buildAutomation({
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'ramo sim' } } }],
      elseSteps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'ramo não' } } }],
    }));

    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-2' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    expect(db.leads.find((l) => l.id === 'lead-1')!.notes?.[0]?.text).toBe('ramo sim');
    expect(db.leads.find((l) => l.id === 'lead-2')!.notes?.[0]?.text).toBe('ramo não');
  });

  it('múltiplas condições nomeadas (branch) escolhem o primeiro ramo que passa', async () => {
    const db = automationFixtures();
    addLead(db, { origin: 'api' });
    const graph: { nodes: any[]; edges: any[] } = {
      nodes: [
        { id: 'trigger', type: 'trigger' as const, config: { event: 'lead.created' as const } },
        {
          id: 'split', type: 'branch', config: { branches: [
            { id: 'vip', label: 'VIP', condition: { field: 'lead.origin', operator: 'equals', value: 'whatsapp' } },
            { id: 'web', label: 'Web', condition: { field: 'lead.origin', operator: 'equals', value: 'api' } },
          ] },
        },
        { id: 'note', type: 'action' as const, config: { action: { type: 'add_lead_note' as const, params: { text: 'veio pela web' } } } },
        { id: 'end', type: 'end' as const, config: {} },
      ],
      edges: [
        { from: 'trigger', to: 'split' },
        { from: 'split', to: 'note', branch: 'web' },
        { from: 'split', to: 'end', branch: 'else' },
        { from: 'note', to: 'end' },
      ],
    };
    db.automations.push({
      ...buildAutomation({}),
      trigger: { event: 'lead.created' },
      nodes: graph.nodes as any,
      edges: graph.edges as any,
    });

    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.leads[0].notes?.[0]?.text).toBe('veio pela web');
    expect(db.automationRuns[0].history.some((h) => h.outcome === 'true' && h.label.includes('web'))).toBe(true);
  });

  it('ações delegam às funções oficiais (etapa muda status + histórico da esteira)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'waiting_secretary', note: 'via automação' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    const lead = db.leads[0];
    expect(lead.stageId).toBe('waiting_secretary');
    expect(lead.status).toBe('contacted'); // mappedStatus da etapa (regra do P3)
    const last = lead.stageHistory!.at(-1)!;
    expect(last.movedBy).toBe('automation');
    expect(last.note).toBe('via automação');
    expect(getBusinessPipeline(db, 'b1').stages.length).toBeGreaterThan(0);
  });

  it('atribuição respeita a validação de equipe (usuário de fora é recusado)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'assign_lead', params: { target: 'member', userId: 'other' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    expect(db.automationRuns[0].status).toBe('failed');
    expect(db.automationRuns[0].error).toContain('equipe');
    expect(db.leads[0].assignedUserId || '').toBe('');
  });

  it('rodízio escolhe quem tem menos trabalho aberto', async () => {
    const db = automationFixtures();
    addLead(db, { id: 'l1', assignedUserId: 'ana' });
    addLead(db, { id: 'l2', assignedUserId: 'ana', phone: '11977770000' });
    addLead(db, { id: 'l3', assignedUserId: '', phone: '11966660000', origin: 'api' });
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'assign_lead', params: { target: 'auto' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'l3' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.leads.find((l) => l.id === 'l3')!.assignedUserId).toBe('bruno');
  });

  it('dispatch_webhook reutiliza o canal de saída do P3 (fila + retry preservados)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.webhooks.push({
      id: 'wh-1', businessId: 'b1', url: 'https://exemplo.com/hook', secret: 'whsec_x',
      events: ['lead.updated'], active: true, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    });
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'dispatch_webhook', params: { event: 'lead.updated', note: 'automação avisou' } } }],
    }));
    const runs = await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(runs).toHaveLength(1);
    expect(db.webhookDeliveries).toHaveLength(1);
    expect(db.webhookDeliveries[0].event).toBe('lead.updated');
    expect(db.webhookDeliveries[0].businessId).toBe('b1');
    expect(db.webhookDeliveries[0].payloadSummary.note).toBe('automação avisou');
    // O registro de automação não guarda o segredo do webhook.
    expect(JSON.stringify(db.automationRuns[0])).not.toContain('whsec_');
  });
});

describe('P4.6/P4.7 — espera, retomada e proteções', () => {
  it('13) delay pausa a execução sem manter nada aberto', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [
        { kind: 'wait', wait: { mode: 'duration', minutes: 120 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'Follow-up {{lead.name}}' } } },
      ],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    const first = await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    const run = db.automationRuns[0];
    expect(run.status).toBe('waiting');
    expect(run.waitingUntil).toBe(nowISO(120 * 60000));
    expect(run.currentNodeId).toBe('do_2'); // ponto de RETOMADA é o próximo nó
    expect(first.waiting).toBe(1);
    expect(openTasks(db, 'b1')).toHaveLength(0);
    // Nada fica "preso" em posse do motor.
    expect((sanitizeAutomationRunForDisplay(run) as any).claimToken).toBeUndefined();
    expect((sanitizeAutomationRunForDisplay(run) as any).claimExpiresAt).toBeUndefined();
  });

  it('14) retoma depois do vencimento e continua do ponto salvo', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [
        { kind: 'wait', wait: { mode: 'duration', minutes: 120 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'Follow-up {{lead.name}}' } } },
      ],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    // Antes da hora: nada é reivindicado.
    expect(countDueAutomationRuns(db, nowISO(60 * 60000))).toBe(0);
    expect(dueAutomationRuns(db, nowISO(60 * 60000))).toHaveLength(0);
    expect(isAutomationRunDue(db.automationRuns[0], nowISO(119 * 60000))).toBe(false);

    // Venceu: retoma exatamente do nó seguinte.
    expect(countDueAutomationRuns(db, nowISO(121 * 60000))).toBe(1);
    const after = await processAutomationRunsInDb(db, { nowISO: nowISO(121 * 60000) });
    expect(after.completed).toBe(1);
    expect(db.automationRuns[0].status).toBe('completed');
    expect(openTasks(db, 'b1')[0].title).toBe('Follow-up Rafael');
    expect(db.automationRuns[0].history.some((h) => h.outcome === 'waiting')).toBe(true);
  });

  it('espera "até" usa data/hora do produto', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [
        { kind: 'wait', wait: { mode: 'until', at: '2026-09-17T09:00' } },
        { kind: 'action', action: { type: 'add_lead_note', params: { text: 'bom dia' } } },
      ],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.automationRuns[0].waitingUntil).toBe('2026-09-17T09:00');

    await processAutomationRunsInDb(db, { nowISO: '2026-09-17T09:05:00.000Z' });
    expect(db.leads[0].notes?.[0]?.text).toBe('bom dia');
  });

  it('espera por evento (futuro) não trava: registra e segue', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [
        { kind: 'wait', wait: { mode: 'event', waitForEvent: 'whatsapp.replied' } },
        { kind: 'action', action: { type: 'add_lead_note', params: { text: 'seguiu em frente' } } },
      ],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.automationRuns[0].status).toBe('completed');
    expect(db.automationRuns[0].history.some((h) => h.outcome === 'skipped' && h.label.includes('evento'))).toBe(true);
  });

  it('17) ciclo acidental é interrompido pelo teto de visitas por nó', async () => {
    const db = automationFixtures();
    addLead(db);
    // Grafo proposital: ação → condição → ação → volta para a condição (sem espera).
    db.automations.push({
      ...buildAutomation({}),
      trigger: { event: 'lead.created' },
      nodes: [
        { id: 'trigger', type: 'trigger', config: { event: 'lead.created' } },
        { id: 'act', type: 'action', config: { action: { type: 'add_lead_note', params: { text: 'volta' } } } },
        { id: 'cond', type: 'condition', config: { condition: { field: 'lead.name', operator: 'exists' } } },
      ],
      edges: [
        { from: 'trigger', to: 'act' },
        { from: 'act', to: 'cond' },
        { from: 'cond', to: 'act', branch: 'yes' },
        { from: 'cond', to: 'act', branch: 'no' },
      ],
    });
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });

    const holder = 'tester';
    const claimed = claimDueAutomationRuns(db, { nowISO: FIXED_NOW, holder, limit: 1 });
    expect(claimed).toHaveLength(1);

    let guard = 0;
    let status = '';
    while (guard++ < 40) {
      const out = await stepAutomationRun(db, {
        runId: claimed[0].id, holder, nowISO: FIXED_NOW, limits: limitsFor(db.businesses[0]),
      });
      status = out.status;
      if (out.status !== 'advanced') break;
    }
    expect(status).toBe('failed');
    expect(db.automationRuns[0].error).toMatch(/ciclo|passos/);
    // O número de notas é LIMITADO (não multiplicou sem teto).
    expect((db.leads[0].notes || []).length).toBeLessThanOrEqual(MAX_NODE_VISITS + 2);
  });

  it('limite de passos por execução vem da capacidade (e é respeitado)', async () => {
    const db = automationFixtures();
    addLead(db);
    const nodes = Array.from({ length: 30 }, (_, i) => ({
      id: `a${i}`, type: 'action' as const, config: { action: { type: 'update_lead' as const, params: { interest: `passo ${i}` } } },
    }));
    db.automations.push({
      ...buildAutomation({ settings: { maxSteps: 5 } }),
      nodes: [{ id: 'trigger', type: 'trigger', config: { event: 'lead.created' } }, ...nodes],
      edges: nodes.map((n, i) => ({ from: i === 0 ? 'trigger' : nodes[i - 1].id, to: n.id })),
    });
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW, stepsPerRun: 60 });
    expect(db.automationRuns[0].status).toBe('failed');
    expect(db.automationRuns[0].error).toContain('passos');
    expect(db.automationRuns[0].steps).toBe(5);
  });

  it('16) o MESMO evento não gera segunda execução (idempotência do gatilho)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'uma vez' } } }],
    }));
    const payload: EmitInput = { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: FIXED_NOW, data: { isNew: true } };

    const first = emitAutomationEvent(db, payload);
    const replay = emitAutomationEvent(db, payload);
    expect(first.created).toHaveLength(1);
    expect(replay.created).toHaveLength(0);
    expect(replay.skipped[0].reason).toContain('já existe');

    // Estado do lead mudou ⇒ chave nova ⇒ executa de novo (não é dedupe cego).
    db.leads[0].stageId = 'qualifying';
    const changed = emitAutomationEvent(db, { ...payload, data: { isNew: true, stageId: 'qualifying' } });
    expect(changed.created).toHaveLength(1);
  });

  it('16) uma execução não é processada por duas instâncias ao mesmo tempo', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'x' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });

    const runId = db.automationRuns[0].id;
    const a = claimDueAutomationRuns(db, { nowISO: FIXED_NOW, holder: 'A', leaseMs: 60000, limit: 1 });
    expect(a).toHaveLength(1);
    // Segunda varredura (B) não reivindica a mesma execução: posse viva.
    const b = claimDueAutomationRuns(db, { nowISO: FIXED_NOW, holder: 'B', leaseMs: 60000, limit: 1 });
    expect(b).toHaveLength(0);
    // B não consegue processar o que é de A.
    const out = await stepAutomationRun(db, { runId, holder: 'B', nowISO: FIXED_NOW, limits: limitsFor(db.businesses[0]) });
    expect(out.status).toBe('not_mine');
    // A posse expira ⇒ a execução volta a ser elegível (nada fica preso).
    expect(isAutomationRunDue(db.automationRuns[0], nowISO(61 * 60000))).toBe(true);
  });

  it('ação já aplicada não se repete quando a execução é retomada (dedupe por nó)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Única tarefa' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    // Processa só o nó da ação e "morre" antes de finalizar (simula interrupção).
    const holder = 'crash';
    claimDueAutomationRuns(db, { nowISO: FIXED_NOW, holder, limit: 1 });
    await stepAutomationRun(db, { runId: db.automationRuns[0].id, holder, nowISO: FIXED_NOW, limits: limitsFor(db.businesses[0]) });
    await stepAutomationRun(db, { runId: db.automationRuns[0].id, holder, nowISO: FIXED_NOW, limits: limitsFor(db.businesses[0]) });
    const afterCrash = openTasks(db, 'b1').length;
    // Retomada com outro dono: a MESMA tarefa não é duplicada.
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(openTasks(db, 'b1')).toHaveLength(afterCrash);
  });

  it('15) erro de execução fica registrado e a operação do usuário não quebra', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [{ kind: 'action', action: { type: 'create_booking', params: { serviceId: 'srv1', date: '2026-09-19', time: '07:15' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    const run = db.automationRuns[0];
    expect(run.status).toBe('failed');
    expect(run.error.length).toBeGreaterThan(0);
    expect(run.history.at(-1)!.outcome).toBe('error');
    // O lead continua íntegro — a automação não corrompeu nada.
    expect(db.leads[0].stageId).toBe('new');
  });

  it('erro em ação não apaga os passos já executados (falha segura)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [
        { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualified' } } },
        { kind: 'action', action: { type: 'cancel_booking', params: {} } },
      ],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.leads[0].stageId).toBe('qualified'); // o primeiro passo permanece
    expect(db.automationRuns[0].status).toBe('failed');
    expect(db.automationRuns[0].history.filter((h) => h.outcome === 'executed')).toHaveLength(1);
  });

  it('desativar a automação no meio da espera encerra a execução com clareza', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [{ kind: 'wait', wait: { mode: 'duration', minutes: 60 } }, { kind: 'action', action: { type: 'add_lead_note', params: { text: 'y' } } }],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    db.automations[0].active = false;
    await processAutomationRunsInDb(db, { nowISO: nowISO(61 * 60000) });
    expect(db.automationRuns[0].status).toBe('cancelled');
    expect(db.automationRuns[0].history.at(-1)!.detail).toContain('desativada');
  });
});

describe('P4.8 — histórico de diagnóstico', () => {
  it('18) cada passo é registrado com tipo, veredito e detalhe', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
      steps: [
        { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying' } } },
        { kind: 'wait', wait: { mode: 'duration', minutes: 30 } },
      ],
    }));
    await fire(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    const history = db.automationRuns[0].history;
    expect(history[0].outcome).toBe('triggered');
    expect(history.map((h) => h.outcome)).toEqual(expect.arrayContaining(['true', 'executed', 'waiting']));
    expect(history.every((h) => !!h.at && !!h.label)).toBe(true);
    // Nenhum segredo no histórico.
    const serialized = JSON.stringify(db.automationRuns[0]);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('whsec_');
    expect(serialized).not.toContain('keyHash');
  });
});
