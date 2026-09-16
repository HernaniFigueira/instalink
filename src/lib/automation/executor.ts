// ═══════════════════════════════════════════════════════════════
// P4.4/P4.6/P4.7/P4.8 — EXECUTOR (determinístico, retomável, sem loop)
// ═══════════════════════════════════════════════════════════════
// O motor faz UMA coisa por vez: pega o nó atual da execução, processa,
// persiste e decide o próximo. Nada de laço solto, nada de requisição aberta.
//
//   1. iniciar execução ............ events.ts (status 'queued')
//   2. carregar contexto ........... run.context (fotografia do evento)
//   3. processar nó atual .......... trigger | condition | branch | action | wait | end
//   4. avaliar condições ........... conditions.ts (operadores fixos)
//   5. executar ação ............... actions.ts → serviços oficiais do P3
//   6. avançar para o próximo nó ... model.ts (arestas + ramificação)
//   7. persistir estado ............ MESMA transação da ação (sem estado perdido)
//   8. pausar em espera ............ status 'waiting' + waitingUntil + nó de retomada
//   9. retomar depois .............. claim de execução vencida (cron/agendador)
//   10. finalizar .................. 'completed'
//   11. registrar erro ............. 'failed' + mensagem curta no histórico
//
// PROTEÇÕES (testadas uma a uma):
//   • passos por execução (`settings.maxSteps` ∩ teto da capacidade);
//   • visitas por nó (2) ⇒ ciclo acidental encerra com erro claro;
//   • idade máxima da execução (não fica esperando para sempre);
//   • posse (claim + lease) ⇒ a MESMA execução nunca é processada por duas
//     instâncias ao mesmo tempo — o banco é o árbitro (sem Redis/BullMQ);
//   • orçamento por varredura ⇒ cabe no timeout de uma função serverless;
//   • businessId revalidado em cada passo: uma execução jamais toca linha de
//     outra empresa, mesmo se o contexto/param vier adulterado.
import { randomUUID } from 'node:crypto';
import type {
  Automation, AutomationEdge, AutomationNode, AutomationRun, AutomationRunStep, Business, DB,
} from '../types';
import { updateDB, updateDBWithCas } from '../db';
import { hasCapability, limitsFor, type CapabilityLimits } from './capabilities';
import { evaluateCondition } from './conditions';
import { executeAction, prepareActionParams, type ActionResult } from './actions';
import { NODE_TYPE_DEFS, automationActionDef, isTerminalStatus, nextNodeId, nodeLabel, resolveWait } from './model';

/** Posse de uma execução pelo motor (lease curto: a função pode ser morta). */
export const AUTOMATION_CLAIM_LEASE_MS = 30_000;
/** Execuções reivindicadas por varredura. */
export const AUTOMATION_BATCH_SIZE = 20;
/** Orçamento de tempo por varredura (o resto volta na próxima). */
export const AUTOMATION_BUDGET_MS = 6_000;
/** Passos máximos de UMA execução por varredura (evita monopolizar o request). */
export const AUTOMATION_STEPS_PER_PASS = 12;
/** Quantas vezes o MESMO nó pode ser visitado antes de declarar ciclo. */
export const MAX_NODE_VISITS = 2;
/** Histórico máxmo por execução (crescimento do documento é limitado). */
export const MAX_RUN_HISTORY_DEFAULT = 80;

function envPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// ── Estado e elegibilidade ───────────────────────────────────
export const isAutomationTerminal = (run: AutomationRun): boolean => isTerminalStatus(run.status);

/** Posse ainda válida? (expirada ⇒ outra varredura pode assumir). */
export function isAutomationRunClaimLive(run: AutomationRun, nowISO = new Date().toISOString()): boolean {
  if (!run.claimToken || !run.claimExpiresAt) return false;
  const expiresAt = Date.parse(run.claimExpiresAt);
  const now = Date.parse(nowISO);
  return Number.isFinite(expiresAt) && Number.isFinite(now) && expiresAt > now;
}

/**
 * A execução está pronta para processar?
 *  • `queued`              → gatilho novo (ou devolvido por falta de orçamento);
 *  • `waiting` + vencida    → retomada do delay;
 *  • `running` + posse morta→ a instância anterior foi interrompida: retoma.
 * `completed`/`failed`/`cancelled` nunca voltam (sem reexecução fantasma).
 */
export function isAutomationRunDue(run: AutomationRun, nowISO = new Date().toISOString()): boolean {
  if (isAutomationTerminal(run)) return false;
  if (run.status === 'queued') return true;
  if (run.status === 'waiting') {
    const at = Date.parse(run.waitingUntil || '');
    if (!Number.isFinite(at)) return true; // espera ilegível não trava a fila
    return at <= Date.parse(nowISO);
  }
  if (run.status === 'running') return !isAutomationRunClaimLive(run, nowISO);
  return false;
}

export function dueAutomationRuns(db: DB, nowISO: string, businessId = ''): AutomationRun[] {
  if (!Array.isArray(db.automationRuns)) return [];
  return db.automationRuns
    .filter((r) => !!r && (businessId ? r.businessId === businessId : true) && isAutomationRunDue(r, nowISO))
    .sort((a, b) => {
      const ka = Date.parse(a.waitingUntil || a.updatedAt || a.startedAt || '');
      const kb = Date.parse(b.waitingUntil || b.updatedAt || b.startedAt || '');
      return (Number.isFinite(ka) ? ka : 0) - (Number.isFinite(kb) ? kb : 0);
    });
}

export function countDueAutomationRuns(db: DB, nowISO: string, businessId = ''): number {
  return dueAutomationRuns(db, nowISO, businessId).length;
}

/** Reivindica as execuções devidas (puro sobre `db`; quem grava é o chamador). */
export function claimDueAutomationRuns(
  db: DB,
  options: { nowISO: string; holder: string; leaseMs?: number; limit?: number; businessId?: string },
): AutomationRun[] {
  const { nowISO, holder } = options;
  const leaseMs = options.leaseMs ?? envPositiveInt('AUTOMATION_LEASE_MS', AUTOMATION_CLAIM_LEASE_MS);
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const nowMs = Date.parse(nowISO);
  const claimed: AutomationRun[] = [];
  for (const run of dueAutomationRuns(db, nowISO, options.businessId || '')) {
    if (claimed.length >= limit) break;
    run.status = 'running';
    run.claimToken = holder;
    run.claimExpiresAt = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + leaseMs).toISOString();
    run.updatedAt = nowISO;
    claimed.push(run);
  }
  return claimed;
}

export function releaseAutomationRunClaim(run: AutomationRun, backToQueue = false): void {
  run.claimToken = undefined;
  run.claimExpiresAt = undefined;
  if (backToQueue && !isAutomationTerminal(run)) run.status = 'queued';
}

/** Visão de exibição de uma execução (a posse do motor nunca sai na API). */
export function sanitizeAutomationRunForDisplay(run: AutomationRun): Omit<AutomationRun, 'claimToken' | 'claimExpiresAt'> {
  const { claimToken, claimExpiresAt, ...safe } = run;
  void claimToken; void claimExpiresAt;
  return safe;
}

// ── Passos ───────────────────────────────────────────────────
export type StepStatus =
  | 'advanced'   // processou e seguiu para outro nó (continuar)
  | 'waiting'    // pausada em delay (parar esta varredura)
  | 'completed'
  | 'failed'
  | 'cancelled'  // automação desativada/removida no meio do fluxo
  | 'released'   // devolvida à fila por orçamento
  | 'not_mine'   // posse perdida (outra varredura assumiu)
  | 'missing';   // execução/automação não existem mais

export interface StepOutcome {
  status: StepStatus;
  detail?: string;
  actionType?: string;
  actionOk?: boolean;
}

interface StepContext {
  runId: string;
  holder: string;
  nowISO: string;
  limits: CapabilityLimits;
}

function pushHistory(run: AutomationRun, step: AutomationRunStep, max = MAX_RUN_HISTORY_DEFAULT): void {
  if (!Array.isArray(run.history)) run.history = [];
  run.history.push(step);
  if (run.history.length > max) run.history = run.history.slice(run.history.length - max);
}

function finish(run: AutomationRun, status: 'completed' | 'failed' | 'cancelled', nowISO: string, detail: string, error = ''): StepOutcome {
  run.status = status;
  run.error = error || run.error || '';
  if (error) run.lastError = error.slice(0, 300);
  run.updatedAt = nowISO;
  if (status !== 'cancelled') run.finishedAt = nowISO;
  run.waitingUntil = '';
  pushHistory(run, {
    at: nowISO,
    nodeId: run.currentNodeId,
    nodeType: 'run',
    outcome: status === 'completed' ? 'finished' : status === 'failed' ? 'error' : 'cancelled',
    label: status === 'completed' ? 'Execução concluída' : status === 'failed' ? 'Execução encerrada com erro' : 'Execução cancelada',
    detail: detail.slice(0, 300),
  });
  releaseAutomationRunClaim(run);
  return { status, detail };
}

function moveTo(run: AutomationRun, nextId: string, nowISO: string): void {
  run.currentNodeId = nextId;
  run.updatedAt = nowISO;
}

function visitsOf(run: AutomationRun, nodeId: string): number {
  return (run.history || []).filter((h) => h.nodeId === nodeId && h.outcome !== 'triggered').length;
}

/**
 * Processa UM nó de UMA execução. Chamado dentro de `updateDB` (a ação e o
 * novo estado da execução são gravados juntos — não existe "meio passo").
 */
export async function stepAutomationRun(
  db: DB,
  ctx: StepContext,
): Promise<StepOutcome> {
  const { runId, holder, nowISO } = ctx;
  if (!Array.isArray(db.automationRuns)) return { status: 'missing' };
  const run = db.automationRuns.find((r) => r.id === runId);
  if (!run) return { status: 'missing' };
  // Posse: duas varreduras não processam a mesma execução.
  // Posse perdida (lease vencido e outro ciclo assumiu) ⇒ este ciclo PARA de
  // tocar nela: processar a mesma execução duas vezes duplicaria efeitos.
  if (run.status !== 'running' || run.claimToken !== holder) return { status: 'not_mine' };

  const business = db.businesses.find((b) => b.id === run.businessId);
  const automation = db.automations.find((a) => a.id === run.automationId && a.businessId === run.businessId);
  if (!business) return finish(run, 'failed', nowISO, 'empresa não existe mais', 'empresa não encontrada');
  if (!automation) return finish(run, 'failed', nowISO, 'automação removida', 'automação não encontrada');
  // Desativar a automação no meio do fluxo encerra a execução (sem efeito novo).
  if (!automation.active) return finish(run, 'cancelled', nowISO, 'automação desativada', '');

  const limits = ctx.limits;
  const maxSteps = Math.min(
    automation.settings?.maxSteps && automation.settings.maxSteps > 0 ? automation.settings.maxSteps : limits.maxStepsPerRun,
    limits.maxStepsPerRun,
  );
  const maxHistory = Math.min(limits.maxRunHistory, MAX_RUN_HISTORY_DEFAULT * 4);

  // Tetos globais de segurança (P4.9).
  if (run.steps >= maxSteps) {
    return finish(run, 'failed', nowISO, `limite de ${maxSteps} passos atingido`, 'limite de passos atingido');
  }
  const startedAt = Date.parse(run.startedAt || nowISO);
  const ageMs = Number.isFinite(startedAt) ? Date.parse(nowISO) - startedAt : 0;
  if (ageMs > limits.maxRunAgeDays * 86400000) {
    return finish(run, 'failed', nowISO, `execução expirada (${limits.maxRunAgeDays} dias)`, 'execução expirada');
  }

  const node: AutomationNode | undefined = automation.nodes.find((n) => n.id === run.currentNodeId);
  if (!node) {
    // Nó não existe mais (automação editada): encerra sem efeito, com diagnóstico.
    return finish(run, 'completed', nowISO, 'nó não existe mais na definição — fluxo encerrado');
  }

  run.steps = (run.steps || 0) + 1;
  const edges: AutomationEdge[] = automation.edges || [];

  if (visitsOf(run, node.id) >= MAX_NODE_VISITS) {
    return finish(run, 'failed', nowISO, `ciclo detectado em "${nodeLabel(node)}"`, 'ciclo detectado');
  }

  // ── gatilho: a linha "trigger recebido" já existe (criada no disparo);
  // aqui o motor só atravessa o nó e segue (sem duplicar o registro).
  if (node.type === 'trigger') {
    const next = nextNodeId(node.id, edges);
    if (!next) return finish(run, 'completed', nowISO, 'gatilho sem passos depois');
    moveTo(run, next, nowISO);
    return { status: 'advanced', detail: 'gatilho' };
  }

  // ── condição: sim/não (P4.3/P4.4) ──
  if (node.type === 'condition') {
    const evaluation = evaluateCondition(run.context, node.config.condition);
    const branch = evaluation.passed ? 'yes' : 'no';
    pushHistory(run, {
      at: nowISO, nodeId: node.id, nodeType: 'condition',
      outcome: evaluation.passed ? 'true' : 'false',
      label: `Condição → ${evaluation.passed ? 'sim' : 'não'}`,
      detail: evaluation.explain.slice(0, 300),
    }, maxHistory);
    const next = nextNodeId(node.id, edges, branch) || (evaluation.passed ? nextNodeId(node.id, edges, '') : '');
    if (!next) {
      return finish(run, 'completed', nowISO, evaluation.passed ? 'fim do caminho "sim"' : 'condição falsa e nenhum caminho alternativo');
    }
    moveTo(run, next, nowISO);
    return { status: 'advanced', detail: evaluation.explain };
  }

  // ── ramificação: vários caminhos, avaliados em ordem (P4.4) ──
  if (node.type === 'branch') {
    const branches = node.config.branches || [];
    let chosen = '';
    let explain = '';
    for (const b of branches) {
      const evaluation = evaluateCondition(run.context, b.condition);
      if (evaluation.passed) { chosen = b.id; explain = `${b.label}: ${evaluation.explain}`; break; }
    }
    if (!chosen) {
      const fallback = nextNodeId(node.id, edges, 'else') || nextNodeId(node.id, edges, 'no');
      pushHistory(run, {
        at: nowISO, nodeId: node.id, nodeType: 'branch', outcome: 'false',
        label: 'Ramificação → nenhum caminho',
        detail: branches.map((b) => b.label).join(' · ').slice(0, 300),
      }, maxHistory);
      if (!fallback) return finish(run, 'completed', nowISO, 'nenhum ramo correspondeu');
      moveTo(run, fallback, nowISO);
      return { status: 'advanced', detail: 'nenhum ramo' };
    }
    const next = nextNodeId(node.id, edges, chosen) || nextNodeId(node.id, edges, '');
    pushHistory(run, {
      at: nowISO, nodeId: node.id, nodeType: 'branch', outcome: 'true',
      label: `Ramificação → ${chosen}`, detail: explain.slice(0, 300),
    }, maxHistory);
    if (!next) return finish(run, 'completed', nowISO, `ramo "${chosen}" sem continuidade`);
    moveTo(run, next, nowISO);
    return { status: 'advanced', detail: explain };
  }

  // ── espera/delay (P4.6) ──
  if (node.type === 'wait') {
    const next = nextNodeId(node.id, edges);
    const waitMode = node.config.wait?.mode;
    if (waitMode === 'event') {
      // Estrutura preparada; ainda não dispara. Seguir o fluxo é mais honesto
      // do que travar a execução para sempre.
      pushHistory(run, {
        at: nowISO, nodeId: node.id, nodeType: 'wait', outcome: 'skipped',
        label: 'Espera por evento ainda não disponível',
        detail: 'o passo seguinte foi executado em seguida',
      }, maxHistory);
      if (!next) return finish(run, 'completed', nowISO, 'espera por evento sem continuidade');
      moveTo(run, next, nowISO);
      return { status: 'advanced', detail: 'wait_for_event não suportado' };
    }
    const res = resolveWait(node.config.wait, new Date(nowISO), {
      ...limits,
      maxWaitMinutes: Math.min(limits.maxWaitMinutes, automation.settings?.maxWaitMinutes || limits.maxWaitMinutes),
    });
    if (!res.ok) {
      // Duração inválida: não trava a fila — registra e encerra com diagnóstico.
      return finish(run, 'failed', nowISO, res.error || 'espera inválida', res.error || 'espera inválida');
    }
    const due = Date.parse(res.resumeAt);
    if (Number.isFinite(due) && due <= Date.parse(nowISO)) {
      pushHistory(run, {
        at: nowISO, nodeId: node.id, nodeType: 'wait', outcome: 'resumed',
        label: `Espera vencida (${res.label})`, detail: 'retomada imediata',
      }, maxHistory);
      if (!next) return finish(run, 'completed', nowISO, 'espera sem continuidade');
      moveTo(run, next, nowISO);
      return { status: 'advanced', detail: res.label };
    }
    run.status = 'waiting';
    run.waitingUntil = res.resumeAt;
    // O ponto de retomada é o nó SEGUINTE: nada é perdido se o processo morrer.
    moveTo(run, next, nowISO);
    pushHistory(run, {
      at: nowISO, nodeId: node.id, nodeType: 'wait', outcome: 'waiting',
      label: `Esperando ${res.label}`,
      detail: `retoma em ${res.resumeAt.replace('T', ' ').slice(0, 16)}`,
    }, maxHistory);
    releaseAutomationRunClaim(run);
    return { status: 'waiting', detail: res.resumeAt };
  }

  // ── fim explícito ──
  if (node.type === 'end') {
    // `finish` registra a linha final (com o detalhe do nó) — uma só vez.
    return finish(run, 'completed', nowISO, `fim do fluxo em "${nodeLabel(node)}"`);
  }

  // ── ação (P4.5) — sempre delegada ao serviço oficial ──
  if (node.type !== 'action') {
    return finish(run, 'failed', nowISO, `tipo de nó não suportado: ${node.type}`, 'nó inválido');
  }
  const params = prepareActionParams(node.config.action, run);
  const actionType = node.config.action?.type;
  const def = automationActionDef(actionType);
  if (!def) return finish(run, 'failed', nowISO, 'ação não existe mais no catálogo', `ação inválida: ${actionType || ''}`);
  // A capacidade é revalidada na EXECUÇÃO: a definição pode ter sido salva
  // antes de o recurso ser desligado para esta empresa (falha segura).
  if (def.requires && !hasCapability(business, def.requires)) {
    return finish(
      run, 'failed', nowISO,
      `recurso "${def.requires}" não liberado para esta empresa`,
      `recurso não liberado: ${def.requires}`,
    );
  }

  const result: ActionResult = await executeAction({
    db, business, automation, run, nodeId: node.id, now: nowISO, params,
  });

  if (result.ok && result.contextPatch) {
    run.context = {
      ...run.context,
      result: { ...((run.context?.result || {}) as Record<string, unknown>), [String(actionType)]: result.contextPatch },
    };
  }

  pushHistory(run, {
    at: nowISO,
    nodeId: node.id,
    nodeType: 'action',
    outcome: result.ok ? (result.skipped ? 'skipped' : 'executed') : 'error',
    label: `${def.label}${result.skipped ? ' (já feito)' : ''}`,
    detail: (result.ok ? result.summary : result.error || 'falha na ação').slice(0, 300),
  }, maxHistory);
  run.lastActionType = actionType || '';

  if (!result.ok) {
    const stopOnError = automation.settings?.stopOnActionError !== false;
    if (stopOnError) {
      return finish(run, 'failed', nowISO, `${def.label}: ${result.error || 'falhou'}`, (result.error || 'falha na ação').slice(0, 300));
    }
    // Modo "seguir em frente": o erro fica no histórico, o fluxo continua.
  }

  const next = nextNodeId(node.id, edges) || '';
  if (!next) return finish(run, 'completed', nowISO, 'última ação do fluxo executada');
  moveTo(run, next, nowISO);
  return {
    status: 'advanced',
    detail: result.summary || result.error,
    actionType: String(actionType || ''),
    actionOk: result.ok,
  };
}

// ── Varredura determinística (testes, uso embutido) ──────────
export interface AutomationDrainSummary {
  claimed: number;
  advanced: number;
  completed: number;
  waiting: number;
  failed: number;
  cancelled: number;
  released: number;
  notMine: number;
  steps: number;
  durationMs: number;
}

function emptySummary(durationMs = 0): AutomationDrainSummary {
  return { claimed: 0, advanced: 0, completed: 0, waiting: 0, failed: 0, cancelled: 0, released: 0, notMine: 0, steps: 0, durationMs };
}

function bump(summary: AutomationDrainSummary, outcome: StepOutcome): void {
  if (outcome.status === 'advanced') summary.advanced += 1;
  else if (outcome.status === 'completed') summary.completed += 1;
  else if (outcome.status === 'failed') summary.failed += 1;
  else if (outcome.status === 'waiting') summary.waiting += 1;
  else if (outcome.status === 'cancelled') summary.cancelled += 1;
  else if (outcome.status === 'released') summary.released += 1;
  else if (outcome.status === 'not_mine') summary.notMine += 1;
  summary.steps += 1;
}

/**
 * Roda as execuções devidas sobre um `db` JÁ carregado (sem I/O de banco).
 * É a mesma lógica da produção — o que muda é só quem persiste.
 */
export async function processAutomationRunsInDb(
  db: DB,
  options: {
    nowISO?: string;
    businessId?: string;
    holder?: string;
    limit?: number;
    stepsPerRun?: number;
  } = {},
): Promise<AutomationDrainSummary> {
  const nowISO = options.nowISO || new Date().toISOString();
  const holder = options.holder || `local_${randomUUID().slice(0, 8)}`;
  const limit = options.limit ?? AUTOMATION_BATCH_SIZE;
  const stepsPerRun = options.stepsPerRun ?? AUTOMATION_STEPS_PER_PASS;
  const summary = emptySummary();

  const claimed = claimDueAutomationRuns(db, { nowISO, holder, limit: Number.POSITIVE_INFINITY, businessId: options.businessId });
  summary.claimed = Math.min(claimed.length, limit);
  if (claimed.length === 0) return summary;

  let processed = 0;
  for (const run of claimed) {
    if (processed >= limit) {
      releaseAutomationRunClaim(run, true);
      summary.released += 1;
      continue;
    }
    processed += 1;
    const limits = limitsFor(db.businesses.find((b) => b.id === run.businessId));
    for (let i = 0; i < stepsPerRun; i++) {
      const outcome = await stepAutomationRun(db, { runId: run.id, holder, nowISO, limits });
      bump(summary, outcome);
      if (outcome.status !== 'advanced') break;
    }
    // Ainda andando: devolve para a fila (a próxima varredura continua).
    const still = db.automationRuns.find((r) => r.id === run.id);
    if (still && still.status === 'running' && still.claimToken === holder) {
      releaseAutomationRunClaim(still, true);
      summary.released += 1;
    }
  }
  return summary;
}

export interface DrainOptions {
  /** Filtro por unidade (a API "testar/rodar agora" usa). */
  businessId?: string;
  nowISO?: string;
  limit?: number;
  budgetMs?: number;
  holder?: string;
  stepsPerRun?: number;
}

/**
 * Produção: reivindica as execuções devidas com CAS, processa nó a nó
 * (cada passo é UMA transação com a ação dentro) e devolve o que não coube no
 * orçamento. Pode ser chamado por um cron, por um request (gancho do db.ts) ou
 * por script — a decisão de quem processa é sempre do banco.
 */
export async function drainAutomations(options: DrainOptions = {}): Promise<AutomationDrainSummary> {
  const started = Date.now();
  const nowISO = options.nowISO || new Date().toISOString();
  const holder = options.holder || `auto_${randomUUID().slice(0, 12)}`;
  const limit = options.limit ?? envPositiveInt('AUTOMATION_BATCH_SIZE', AUTOMATION_BATCH_SIZE);
  const budgetMs = options.budgetMs ?? envPositiveInt('AUTOMATION_BUDGET_MS', AUTOMATION_BUDGET_MS);
  const stepsPerRun = options.stepsPerRun ?? AUTOMATION_STEPS_PER_PASS;

  const claim = await updateDBWithCas(
    (db) => claimDueAutomationRuns(db, { nowISO, holder, limit }),
    { guard: (db) => countDueAutomationRuns(db, nowISO, options.businessId || '') > 0 },
  );
  const claimed = claim.result || [];
  const summary = emptySummary();
  summary.claimed = claimed.length;
  if (claimed.length === 0) return summary;

  const runIds = claimed.map((r) => r.id);
  for (const runId of runIds) {
    if (Date.now() - started >= budgetMs) {
      await updateDB((db) => {
        const run = db.automationRuns.find((r) => r.id === runId && r.claimToken === holder);
        if (run) { releaseAutomationRunClaim(run, true); summary.released += 1; }
      });
      continue;
    }
    for (let i = 0; i < stepsPerRun; i++) {
      let outcome: StepOutcome = { status: 'missing' };
      try {
        outcome = await updateDB((db) => {
          const run = db.automationRuns.find((r) => r.id === runId);
          const limits = limitsFor(run ? db.businesses.find((b) => b.id === run.businessId) : null);
          return stepAutomationRun(db, { runId, holder, nowISO, limits });
        });
      } catch (e: any) {
        // Falha de infraestrutura: marca o erro na execução e segue — o
        // próximo ciclo decide de novo (nenhum estado é perdido).
        outcome = { status: 'failed', detail: e?.message || 'falha no motor de automações' };
        await updateDB((db) => {
          const run = db.automationRuns.find((r) => r.id === runId && r.claimToken === holder);
          if (run) {
            run.status = 'failed';
            run.error = String(e?.message || 'falha no motor').slice(0, 300);
            run.finishedAt = new Date().toISOString();
            run.updatedAt = run.finishedAt;
            releaseAutomationRunClaim(run);
            pushHistory(run, {
              at: run.updatedAt, nodeId: run.currentNodeId, nodeType: 'run', outcome: 'error',
              label: 'Erro interno do motor', detail: run.error,
            });
          }
        }).catch(() => { /* melhor esforço: a posse expira e o ciclo tenta de novo */ });
      }
      bump(summary, outcome);
      if (outcome.status !== 'advanced') break;
    }
    // Orçamento da execução esgotado dentro do passo: devolve para a fila.
    await updateDB((db) => {
      const run = db.automationRuns.find((r) => r.id === runId && r.status === 'running' && r.claimToken === holder);
      if (run) { releaseAutomationRunClaim(run, true); summary.released += 1; }
    });
  }

  summary.durationMs = Math.max(0, Date.now() - started);
  return summary;
}

/** Cancela execuções vivas de uma automação (edição pesada / exclusão). */
export function cancelRunsOfAutomation(db: DB, businessId: string, automationId: string, reason: string, nowISO = new Date().toISOString()): number {
  if (!Array.isArray(db.automationRuns)) return 0;
  let count = 0;
  for (const run of db.automationRuns) {
    if (run.businessId !== businessId || run.automationId !== automationId) continue;
    if (isAutomationTerminal(run)) continue;
    run.status = 'cancelled';
    run.error = '';
    run.waitingUntil = '';
    run.updatedAt = nowISO;
    run.finishedAt = nowISO;
    releaseAutomationRunClaim(run);
    pushHistory(run, {
      at: nowISO, nodeId: run.currentNodeId, nodeType: 'run', outcome: 'cancelled',
      label: 'Execução encerrada', detail: reason.slice(0, 300),
    });
    count += 1;
  }
  return count;
}

/** Rótulo estável do tipo de nó (usado na UI de histórico). */
export function nodeTypeLabel(type: AutomationNode['type'] | 'run'): string {
  if (type === 'run') return 'Execução';
  return NODE_TYPE_DEFS[type]?.label || type;
}
