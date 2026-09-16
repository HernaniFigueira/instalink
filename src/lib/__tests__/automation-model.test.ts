// ═══════════════════════════════════════════════════════════════
// P4.1/P4.4/P4.10/P4.11/P4.13 — definição, validação, projeção e capacidades
// ═══════════════════════════════════════════════════════════════
// A definição de automação é o contrato do sistema (com a UI, com a API e com
// o futuro agente de IA). Estes testes travam: o que é aceito, o que é recusado,
// como o grafo é projetado na forma linear e o que acontece com dados antigos.
import { describe, expect, it } from 'vitest';
import {
  addLead, automationFixtures, buildAutomation, FIXED_NOW,
} from './helpers/automation-fixtures';
import {
  analyzeGraph, automationActionDef, automationEventLabel, automationFieldLabel,
  automationsForEvent, graphToLinear, isFieldAllowed, isTerminalStatus, linearToGraph,
  normalizeAutomationRecord, normalizeAutomationRunRecord, normalizeDateTimeInput, nodeLabel,
  resolveStageAlias, resolveWait, sanitizeCondition, validateAutomationDraft,
} from '../automation/model';
import {
  ADVANCED_LIMITS, BASIC_LIMITS, CAPABILITIES, capabilityStateFor, hasCapability,
  limitsFor, sanitizeCapabilityFlags,
} from '../automation/capabilities';
import { AUTOMATION_TEMPLATES, applyTemplate, templateOffers, templateToDraft } from '../automation/templates';
import { DEFAULT_PIPELINE_STAGES, getBusinessPipeline } from '../pipeline';
import { emitAutomationEvent } from '../automation/events';
import { isAutomationRunClaimLive, processAutomationRunsInDb } from '../automation/executor';
import { openTasks } from '../automation/tasks';
import type { Automation, AutomationNode, DB } from '../types';

function validate(draft: Parameters<typeof validateAutomationDraft>[0], extra: Record<string, any> = {}) {
  return validateAutomationDraft(draft, {
    stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ id: s.id, name: s.name })),
    serviceIds: ['srv1'],
    businessCaps: capabilityStateFor(null),
    ...extra,
  });
}

describe('P4.1 — definição da automação', () => {
  it('1) aceita a forma linear (Quando/Se/Então/Depois/E) e devolve o grafo', () => {
    const steps = [
      { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying' } } },
      { kind: 'wait', wait: { mode: 'duration', minutes: 120 } },
      { kind: 'action', action: { type: 'create_task', params: { title: 'Contatar {{lead.name}}' } } },
    ];
    const result = validate({
      name: 'Lead do Instagram',
      event: 'lead.created',
      condition: { logic: 'and', conditions: [{ field: 'lead.origin', operator: 'equals', value: 'instagram' }] },
      steps,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const types = result.automation.nodes.map((n) => n.type);
    expect(types).toEqual(['trigger', 'condition', 'action', 'wait', 'action', 'end']);
    expect(result.automation.trigger.event).toBe('lead.created');
    expect(result.automation.nodes[0].config.event).toBe('lead.created');
  });

  it('recusa: sem nome, sem gatilho, gatilho inexistente, ação inexistente', () => {
    expect(validate({ name: '', event: 'lead.created' }).errors).toContain('dê um nome para a automação');
    expect(validate({ name: 'x', event: 'nada.aqui' as any }).errors.some((e) => e.includes('gatilho'))).toBe(true);
    const bad = validate({ name: 'x', event: 'lead.created', nodes: [
      { id: 't', type: 'trigger', config: { event: 'lead.created' } },
      { id: 'a', type: 'action', config: { action: { type: 'invocar_feitico', params: {} } } },
    ], edges: [{ from: 't', to: 'a' }] });
    expect(bad.errors.some((e) => e.includes('ação desconhecida'))).toBe(true);
  });

  it('recusa campo que o gatilho não oferece e operador inválido', () => {
    const wrongEvent = validate({
      name: 'x', event: 'lead.created',
      condition: { field: 'booking.status', operator: 'equals', value: 'confirmed' },
    });
    expect(wrongEvent.errors.some((e) => e.includes('campo não disponível'))).toBe(true);

    const badOp = sanitizeCondition({ field: 'lead.origin', operator: 'regex', value: '.*' }, 'lead.created');
    expect(badOp.errors.some((e) => e.includes('operador inválido'))).toBe(true);

    const missingValue = sanitizeCondition({ field: 'lead.origin', operator: 'equals' }, 'lead.created');
    expect(missingValue.errors.some((e) => e.includes('informe o valor'))).toBe(true);
  });

  it('descarta parâmetros fora do catálogo da ação (nunca passa nada extra)', () => {
    const result = validate({
      name: 'x', event: 'lead.created', steps: [{
        kind: 'action',
        action: { type: 'add_lead_note', params: { text: 'oi', __proto__: { evil: 1 }, sql: 'DROP' } },
      }],
    });
    expect(result.ok).toBe(true);
    const action = result.automation.nodes.find((n) => n.type === 'action')!.config.action!;
    expect(Object.keys(action.params).sort()).toEqual(['text']);
  });

  it('valida a etapa contra a esteira REAL da unidade (aceita alias por nome)', () => {
    const bad = validate({ name: 'x', event: 'lead.created', steps: [
      { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'etapa-fantasma' } } },
    ] });
    expect(bad.errors.some((e) => e.includes('não existe na esteira'))).toBe(true);

    const ok = validate({ name: 'x', event: 'lead.created', steps: [
      { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'Qualificando' } } },
    ] });
    expect(ok.ok).toBe(true);
    const stage = ok.automation.nodes.find((n) => n.type === 'action')!.config.action!.params.stageId;
    expect(stage).toBe('qualifying');
    expect(resolveStageAlias('qualificando', [{ id: 'qualifying', name: 'Qualificando' }])).toBe('qualifying');
  });

  it('valida serviço contra os serviços da unidade', () => {
    const bad = validate({ name: 'x', event: 'lead.created', steps: [
      { kind: 'action', action: { type: 'create_booking', params: { serviceId: 'srv-inexistente' } } },
    ] });
    expect(bad.errors.some((e) => e.includes('serviço informado'))).toBe(true);
  });

  it('idempotência da criação: reenvio com a mesma chave não cria gêmeos', async () => {
    const { validateAutomationDraft: _v } = { validateAutomationDraft };
    void _v;
    const draft = { name: 'Idempotente', event: 'lead.created' as const };
    const first = validate(draft);
    const second = validate(draft);
    expect(first.ok && second.ok).toBe(true);
  });

  it('automação grande demais é recusada (teto de nós por capacidade)', () => {
    const graph = linearToGraph({
      event: 'lead.created',
      steps: Array.from({ length: 60 }, () => ({ kind: 'action', action: { type: 'add_lead_note', params: { text: 'x' } } } as any)),
    });
    const basic = validate({ name: 'x', event: 'lead.created', nodes: graph.nodes, edges: graph.edges }, { limits: BASIC_LIMITS });
    expect(basic.errors.some((e) => e.includes('automação grande demais'))).toBe(true);
  });
});

describe('P4.4 — grafo, ciclos e limites', () => {
  it('ciclo SEM espera é erro (nunca grava fluxo que não termina)', () => {
    const nodes: AutomationNode[] = [
      { id: 't', type: 'trigger', config: { event: 'lead.created' } },
      { id: 'a', type: 'action', config: { action: { type: 'add_lead_note', params: { text: 'x' } } } },
      { id: 'c', type: 'condition', config: { condition: { field: 'lead.name', operator: 'exists' } } },
    ];
    const report = analyzeGraph(nodes, [
      { from: 't', to: 'a' }, { from: 'a', to: 'c' }, { from: 'c', to: 'a', branch: 'yes' }, { from: 'c', to: 'a', branch: 'no' },
    ]);
    expect(report.errors.some((e) => e.includes('ciclo sem espera'))).toBe(true);
  });

  it('ciclo COM espera é permitido (aviso) — o motor limita os passos', () => {
    const nodes: AutomationNode[] = [
      { id: 't', type: 'trigger', config: { event: 'lead.created' } },
      { id: 'c', type: 'condition', config: { condition: { field: 'lead.name', operator: 'exists' } } },
      { id: 'w', type: 'wait', config: { wait: { mode: 'duration', minutes: 60 } } },
    ];
    const report = analyzeGraph(nodes, [{ from: 't', to: 'c' }, { from: 'c', to: 'w', branch: 'yes' }, { from: 'w', to: 'c' }]);
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((w) => w.includes('ciclo com espera'))).toBe(true);
  });

  it('aponta para nó inexistente ⇒ erro; nó fora do caminho ⇒ aviso', () => {
    const nodes: AutomationNode[] = [
      { id: 't', type: 'trigger', config: { event: 'lead.created' } },
      { id: 'x', type: 'action', config: { action: { type: 'add_lead_note', params: { text: 'órfão' } } } },
    ];
    const report = analyzeGraph(nodes, [{ from: 't', to: 'nao-existe' }]);
    expect(report.errors.some((e) => e.includes('nó inexistente'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('fora do caminho'))).toBe(true);
  });

  it('rótulos legíveis dos nós (usados na UI e no histórico)', () => {
    expect(nodeLabel({ id: 't', type: 'trigger', config: { event: 'lead.created' } })).toBe('Lead criado');
    expect(nodeLabel({ id: 'a', type: 'action', config: { action: { type: 'create_task', params: {} } } })).toBe('Criar tarefa');
    expect(automationEventLabel('booking.completed')).toBe('Atendimento concluído');
    expect(automationFieldLabel('lead.origin')).toBe('Lead · origem');
    expect(automationActionDef('update_lead')?.delegate).toContain('pipeline');
    expect(isTerminalStatus('waiting')).toBe(false);
    expect(isTerminalStatus('completed')).toBe(true);
  });
});

describe('P4.6 — espera', () => {
  it('durações válidas em minutos viram rótulo e timestamp', () => {
    const res = resolveWait({ mode: 'duration', minutes: 120 }, new Date(FIXED_NOW));
    expect(res.ok).toBe(true);
    expect(res.resumeAt).toBe(new Date(Date.parse(FIXED_NOW) + 7200000).toISOString());
    expect(res.label).toBe('2 horas');
    expect(resolveWait({ mode: 'duration', minutes: 1440 }, new Date(FIXED_NOW)).label).toBe('1 dia');
    expect(resolveWait({ mode: 'duration', minutes: 10 }, new Date(FIXED_NOW)).label).toBe('10 minutos');
  });

  it('recusa duração inválida/acima do limite e aceita "até" no futuro', () => {
    expect(resolveWait({ mode: 'duration', minutes: 0 }, new Date(FIXED_NOW)).ok).toBe(false);
    expect(resolveWait({ mode: 'duration', minutes: 999999 }, new Date(FIXED_NOW), BASIC_LIMITS).ok).toBe(false);
    const future = resolveWait({ mode: 'until', at: '2026-12-01 09:00' }, new Date(FIXED_NOW));
    expect(future.ok).toBe(true);
    expect(future.resumeAt).toBe('2026-12-01T09:00');
    expect(resolveWait({ mode: 'until', at: 'ontem' }, new Date(FIXED_NOW)).ok).toBe(false);
    // Linguagem de negócio, resolvida de forma determinística (sem IA):
    expect(resolveWait({ mode: 'until', at: 'amanhã às 09:00' }, new Date(FIXED_NOW)).resumeAt).toBe('2026-09-17T09:00');
    expect(resolveWait({ mode: 'until', at: 'amanhã 9h' }, new Date(FIXED_NOW)).resumeAt).toBe('2026-09-17T09:00');
    expect(resolveWait({ mode: 'until', at: 'hoje às 23:30' }, new Date(FIXED_NOW)).resumeAt).toBe('2026-09-16T23:30');
    expect(normalizeDateTimeInput('hoje às 25:00')).toBe('');
    // Data passada ⇒ retoma na hora (nunca espera para sempre).
    expect(resolveWait({ mode: 'until', at: '2020-01-01T08:00' }, new Date(FIXED_NOW)).label).toContain('já passou');
    // Estrutura preparada para o futuro, sem comportamento surpresa hoje.
    expect(resolveWait({ mode: 'event', waitForEvent: 'x' }, new Date(FIXED_NOW)).ok).toBe(false);
  });
});

describe('P4.10 — projeção linear ⇄ grafo', () => {
  it('round-trip: linear → grafo → linear preserva a intenção', () => {
    const linear = {
      event: 'lead.created' as const,
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' } as any,
      steps: [
        { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying' } } } as any,
        { kind: 'wait', wait: { mode: 'duration', minutes: 120 } } as any,
      ],
      elseSteps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'ver depois' } } } as any],
    };
    const graph = linearToGraph(linear);
    const back = graphToLinear({
      trigger: { event: linear.event },
      nodes: graph.nodes as Automation['nodes'],
      edges: graph.edges as Automation['edges'],
    });
    expect(back).not.toBeNull();
    expect(back!.event).toBe('lead.created');
    expect(back!.steps).toHaveLength(2);
    expect(back!.steps[1].kind).toBe('wait');
    expect(back!.elseSteps).toHaveLength(1);
    expect((back!.condition as any).field).toBe('lead.origin');
  });

  it('grafo livre não é forçado em linha (a UI mostra o modo avançado)', () => {
    const nodes: AutomationNode[] = [
      { id: 't', type: 'trigger', config: { event: 'lead.created' } },
      { id: 'a', type: 'action', config: { action: { type: 'add_lead_note', params: { text: 'x' } } } },
      { id: 'b', type: 'branch', config: { branches: [{ id: 'r1', label: 'R', condition: { field: 'lead.name', operator: 'exists' } }] } },
    ];
    expect(graphToLinear({ trigger: { event: 'lead.created' }, nodes, edges: [{ from: 't', to: 'a' }, { from: 'a', to: 'b' }] })).toBeNull();
  });

  it('whitelist de campos: só o catálogo é lido pelo motor', () => {
    expect(isFieldAllowed('lead.origin', 'lead.created')).toBe(true);
    expect(isFieldAllowed('lead.passwordHash', 'lead.created')).toBe(false);
    expect(isFieldAllowed('business.googleApiKey', 'lead.created')).toBe(false);
    expect(isFieldAllowed('webhooks.0.secret', 'lead.created')).toBe(false);
    expect(isFieldAllowed('booking.status', 'lead.created')).toBe(false);
    expect(isFieldAllowed('booking.status', 'booking.created')).toBe(true);
  });
});

describe('P4.13 — capacidades (sem plano no código)', () => {
  it('padrão: automações ligadas; IA e canais ainda não existem', () => {
    const state = capabilityStateFor(null, {} as NodeJS.ProcessEnv);
    expect(state['automation.basic']).toBe(true);
    expect(state['automation.advanced']).toBe(true);
    expect(state['automation.ai']).toBe(false);
    expect(state['channel.whatsapp']).toBe(false);
    expect(CAPABILITIES.every((c) => c.available || !c.default)).toBe(true);
  });

  it('override por unidade vence o ambiente; flag sem motor não libera nada', () => {
    const env = { AUTOMATION_CAPS: 'automation.advanced=0,automation.ai=1' } as unknown as NodeJS.ProcessEnv;
    expect(hasCapability(null, 'automation.advanced', env)).toBe(false);
    // 'automation.ai' ligada no ambiente continua indisponível (não existe motor).
    expect(hasCapability(null, 'automation.ai', env)).toBe(false);
    expect(hasCapability({ capabilityFlags: { 'automation.advanced': true } }, 'automation.advanced', env)).toBe(true);
    expect(hasCapability({ capabilityFlags: { 'automation.basic': false } }, 'automation.basic', {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('tetos vêm da capacidade e a ação avançada é barrada na validação', () => {
    expect(limitsFor({ capabilityFlags: { 'automation.advanced': false } })).toBe(BASIC_LIMITS);
    expect(limitsFor(null)).toBe(ADVANCED_LIMITS);
    const withoutAdvanced = validate(
      { name: 'x', event: 'lead.created', steps: [{ kind: 'action', action: { type: 'create_booking', params: { serviceId: 'srv1' } } } as any] },
      { businessCaps: { 'automation.basic': true, 'automation.advanced': false } },
    );
    expect(withoutAdvanced.errors.some((e) => e.includes('exige o recurso'))).toBe(true);
  });

  it('sanitização do override só aceita capacidades conhecidas', () => {
    expect(sanitizeCapabilityFlags({ 'automation.basic': false, 'outra.coisa': true, x: 'sim' })).toEqual({ 'automation.basic': false });
    expect(sanitizeCapabilityFlags('nada')).toBeUndefined();
  });
});

describe('P4.11 — templates internos', () => {
  it('20) todo template vira automação válida no contexto da unidade', () => {
    for (const t of AUTOMATION_TEMPLATES) {
      const db = automationFixtures();
      const applied = applyTemplate(db, 'b1', t.id, { userId: 'owner-b1' });
      expect(applied.ok, `${t.id}: ${applied.errors.join(' | ')}`).toBe(true);
      expect(applied.automation.nodes[0].type).toBe('trigger');
      expect(applied.automation.nodes[0].config.event).toBe(t.event);
      expect(applied.automation.templateId).toBe(t.id);
    }
  });

  it('template aplicável vs bloqueado (módulo de agenda e capacidade)', () => {
    const db = automationFixtures();
    const offers = templateOffers(db, 'b1');
    expect(offers.length).toBeGreaterThanOrEqual(5);
    expect(offers.every((o) => o.applicable)).toBe(true);
    expect(offers.find((o) => o.id === 'lead_followup_no_booking')!.preview.thens.length).toBe(2);

    // Unidade SEM agenda: os templates de agendamento ficam bloqueados (com
    // explicação), os demais continuam disponíveis.
    db.businesses[0].modes = ['services'];
    const blocked = templateOffers(db, 'b1');
    expect(blocked.find((o) => o.id === 'booking_created_task')!.applicable).toBe(false);
    expect(blocked.find((o) => o.id === 'booking_created_task')!.reason).toContain('Agendamentos');
    expect(blocked.find((o) => o.id === 'lead_assign_owner')!.applicable).toBe(true);

    const db2 = automationFixtures();
    db2.businesses[0].modes = ['services'];
    expect(applyTemplate(db2, 'b1', 'booking_created_task').ok).toBe(false);
  });

  it('template com ramificação projeta o "Senão" no editor', () => {
    const draft = templateToDraft(AUTOMATION_TEMPLATES.find((t) => t.id === 'lead_by_origin_branch')!, 'b1');
    const linear = graphToLinear({ trigger: { event: 'lead.created' }, nodes: draft.nodes as any, edges: draft.edges as any });
    expect(linear!.condition).toBeTruthy();
    expect(linear!.steps[0].kind).toBe('action');
    expect(linear!.elseSteps![0].kind).toBe('action');
  });
});

describe('migração defensiva (P4 sobre documento antigo)', () => {
  it('registro corrompido é descartado na leitura; válido é preservado', () => {
    const now = FIXED_NOW;
    const good = normalizeAutomationRecord({
      id: 'a1', businessId: 'b1', name: 'Boa', nodes: [{ id: 't', type: 'trigger', config: { event: 'lead.created' } }],
      edges: [], active: true, trigger: { event: 'lead.created' },
    }, now);
    expect(good).not.toBeNull();
    expect(good!.version).toBe(1);

    expect(normalizeAutomationRecord({ name: 'sem id nem negócio' }, now)).toBeNull();
    expect(normalizeAutomationRecord(null, now)).toBeNull();
    expect(normalizeAutomationRecord('x', now)).toBeNull();
    // Sem nodes/edges: ganha arrays vazios (não explode o resto do banco).
    const minimal = normalizeAutomationRecord({ id: 'a2', businessId: 'b1' }, now);
    expect(minimal!.nodes).toEqual([]);
    expect(minimal!.active).toBe(true);
  });

  it('execução legada ganha defaults sem perder estado existente', () => {
    const run = normalizeAutomationRunRecord({
      id: 'r1', businessId: 'b1', automationId: 'a1', status: 'waiting',
      currentNodeId: 'do_2', context: { lead: { id: 'l1' } }, waitingUntil: '2026-09-20T10:00:00.000Z',
      history: [{ at: FIXED_NOW, label: 'x' }, { lixo: true }],
      claimToken: 'velho', claimExpiresAt: '2020-01-01T00:00:00.000Z',
    }, FIXED_NOW)!;
    expect(run.automationName).toBe('Automação');
    expect(run.steps).toBe(1);           // deduzido do histórico preservado
    expect(run.history).toHaveLength(1); // entrada inválida fora, válida dentro
    expect(run.context.lead.id).toBe('l1');
    // Posse é preservada VERBATIM: quem decide se ela vale é o motor, com o
    // "agora" da varredura (nada de relógio na leitura — senão uma fila
    // processada com `now` injetado perderia a posse no meio do caminho).
    expect(run.claimToken).toBe('velho');
    expect(isAutomationRunClaimLive(run, FIXED_NOW)).toBe(false);       // vencida
    expect(isAutomationRunClaimLive(run, '2020-01-01T00:00:00.000Z')).toBe(false);
    expect(run.status).toBe('waiting');
    expect(normalizeAutomationRunRecord({ id: 'x' }, FIXED_NOW)).toBeNull();
  });
});

// ── Cenários ponta a ponta exigidos na entrega ──────────────
describe('P4 — cenários E2E do motor', () => {
  it('E2E 1: lead.created → condição → alterar etapa → esperar 2h → criar tarefa → fim', async () => {
    const db: DB = automationFixtures();
    addLead(db, { origin: 'instagram' });
    db.automations.push(buildAutomation({
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
      steps: [
        { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying', note: 'via automação' } } },
        { kind: 'wait', wait: { mode: 'duration', minutes: 120 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'Contatar {{lead.name}}', dueInMinutes: 240 } } },
      ],
    }));

    // 09:00 — o evento acontece.
    emitAutomationEvent(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: FIXED_NOW });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    const run = db.automationRuns[0];
    expect(db.leads[0].stageId).toBe('qualifying');          // ação executada
    expect(run.status).toBe('waiting');                       // pausada no delay
    expect(run.waitingUntil).toBe('2026-09-16T14:00:00.000Z');
    expect(openTasks(db, 'b1')).toHaveLength(0);

    // 11:00 — outra varredura retoma, executa e finaliza.
    await processAutomationRunsInDb(db, { nowISO: '2026-09-16T14:01:00.000Z' });
    expect(run.status).toBe('completed');
    const tasks = openTasks(db, 'b1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Contatar Rafael');
    expect(tasks[0].dueAt).toBe('2026-09-16T18:01:00.000Z');

    expect(run.history.map((h) => h.outcome)).toEqual(['triggered', 'true', 'executed', 'waiting', 'executed', 'finished']);
  });

  it('E2E 2: condição falsa → ramificação alternativa → fim', async () => {
    const db: DB = automationFixtures();
    addLead(db, { origin: 'whatsapp' });
    db.automations.push(buildAutomation({
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
      steps: [{ kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualified' } } }],
      elseSteps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'Sem prioridade: responder na fila normal' } } }],
    }));

    emitAutomationEvent(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: FIXED_NOW });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });

    expect(db.leads[0].stageId).toBe('new'); // o ramo "sim" NÃO rodou
    expect(db.leads[0].notes?.[0].text).toContain('fila normal');
    const run = db.automationRuns[0];
    expect(run.status).toBe('completed');
    expect(run.history.map((h) => h.outcome)).toEqual(['triggered', 'false', 'executed', 'finished']);
  });

  it('E2E 3: execução interrompida enquanto esperava sobrevive e continua (processo novo)', async () => {
    const db: DB = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({
      steps: [
        { kind: 'action', action: { type: 'add_lead_note', params: { text: 'antes da espera' } } },
        { kind: 'wait', wait: { mode: 'duration', minutes: 30 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'Depois da espera' } } },
      ],
    }));
    emitAutomationEvent(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: FIXED_NOW });

    // Primeira varredura para no wait (e libera a posse).
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.automationRuns[0].status).toBe('waiting');

    // O estado foi gravado: nada em memória, nada em request aberto — só o
    // documento. Simulamos um processo novo carregando o MESMO db.
    const fresh = JSON.parse(JSON.stringify({ automationRuns: db.automationRuns })) as { automationRuns: DB['automationRuns'] };
    expect(fresh.automationRuns[0].currentNodeId).toBe('do_3');
    expect(fresh.automationRuns[0].waitingUntil).toBe('2026-09-16T12:30:00.000Z');

    // Depois do vencimento, a retomada continua do ponto salvo (não repete o
    // primeiro passo nem perde o terceiro).
    await processAutomationRunsInDb(db, { nowISO: '2026-09-16T12:31:00.000Z' });
    expect(db.automationRuns[0].status).toBe('completed');
    expect(db.leads[0].notes).toHaveLength(1);
    expect(openTasks(db, 'b1')[0].title).toBe('Depois da espera');
    expect(db.automationRuns[0].resumes).toBe(0);
    expect(db.automationRuns[0].history.filter((h) => h.outcome === 'executed')).toHaveLength(2);
  });

  it('automação sem passos depois do gatilho conclui sem efeito (nada travado)', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({}));
    emitAutomationEvent(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: FIXED_NOW });
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(db.automationRuns[0].status).toBe('completed');
  });

  it('várias automações do mesmo evento rodam independente e na ordem da fila', async () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(
      buildAutomation({ id: 'auto-a', steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'A' } } }] }),
      buildAutomation({ id: 'auto-b', steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'B' } } }] }),
    );
    const created = emitAutomationEvent(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: FIXED_NOW }).created;
    expect(created).toHaveLength(2);
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect((db.leads[0].notes || []).map((n) => n.text)).toEqual(['A', 'B']);
    expect(db.automationRuns.every((r) => r.status === 'completed')).toBe(true);
  });

  it('fila cheia não cria execução (teto do documento) e o evento é ignorado com aviso', () => {
    const db = automationFixtures();
    addLead(db);
    db.automations.push(buildAutomation({ steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'x' } } }] }));
    for (let i = 0; i < 400; i++) {
      db.automationRuns.push({
        id: `r${i}`, businessId: 'b1', automationId: 'auto-1', automationName: 'x', status: 'queued',
        triggerEvent: 'lead.created', currentNodeId: 'do_1', context: {}, waitingUntil: '',
        startedAt: FIXED_NOW, updatedAt: FIXED_NOW, finishedAt: '', error: '', history: [],
        eventKey: `lead.created:outro-${i}:abc`, emittedByRunId: '', steps: 0, resumes: 0,
      });
    }
    const res = emitAutomationEvent(db, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1', at: FIXED_NOW });
    expect(res.created).toHaveLength(0);
    expect(res.skipped[0].reason).toContain('fila');
  });

  it('automationsForEvent só enxerga a própria unidade e o próprio evento', () => {
    const db = automationFixtures();
    db.automations.push(buildAutomation({ id: 'a1', businessId: 'b1' }));
    db.automations.push(buildAutomation({ id: 'a2', businessId: 'b2', event: 'booking.created' }));
    expect(automationsForEvent(db, 'b1', 'lead.created').map((a) => a.id)).toEqual(['a1']);
    expect(automationsForEvent(db, 'b2', 'lead.created')).toHaveLength(0);
    expect(automationsForEvent(db, 'b2', 'booking.created')).toHaveLength(1);
    // Automação sem nós não é acionada (estaria quebrada).
    db.automations.push({ ...buildAutomation({ id: 'a3' }), nodes: [], edges: [] });
    expect(automationsForEvent(db, 'b1', 'lead.created').map((a) => a.id)).toEqual(['a1']);
    expect(getBusinessPipeline(db, 'b1').stages.length).toBeGreaterThan(0);
  });
});
