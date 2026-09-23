// ═══════════════════════════════════════════════════════════════
// P4.10 — PROJEÇÕES PARA A INTERFACE (o que a API devolve)
// ═══════════════════════════════════════════════════════════════
// A UI do lojista NÃO precisa entender o grafo para operar o produto, então a
// API devolve AS DUAS visões: o grafo canônico (para o editor visual futuro e
// para um agente de IA ler/escrever) e a projeção linear ("Quando / Se / Então
// / Depois / Senão"). A posse interna do motor (claim) NUNCA sai daqui.
import type { Automation, AutomationRun, DB } from '../types';
import {
  analyzeGraph, automationActionDef, automationEventLabel, automationFieldLabel,
  automationStatusOf, graphToLinear, humanDuration, isTerminalStatus, type LinearAutomation,
} from './model';
import { describeCondition } from './conditions';

export interface AutomationView {
  id: string;
  name: string;
  description: string;
  active: boolean;
  /** draft | active | paused | archived (derivado de `active` em docs antigos). */
  status: string;
  /** manual | template | ai. */
  source: string;
  event: string;
  eventLabel: string;
  templateId: string;
  version: number;
  settings: Automation['settings'];
  nodes: Automation['nodes'];
  edges: Automation['edges'];
  trigger: Automation['trigger'];
  linear: LinearAutomation | null;
  createdAt: string;
  updatedAt: string;
  stats: {
    runs: number;
    live: number;
    waiting: number;
    completed: number;
    failed: number;
    lastRunAt: string;
    lastStatus: string;
    lastError: string;
  };
  issues: string[];
  summary: string;
}

export interface AutomationRunView {
  id: string;
  automationId: string;
  automationName: string;
  status: AutomationRun['status'];
  triggerEvent: string;
  currentNodeId: string;
  waitingUntil: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
  error: string;
  steps: number;
  resumes: number;
  lastActionType: string;
  lastError: string;
  context: Record<string, any>;
  history: AutomationRun['history'];
}

function statsFor(db: DB, automationId: string, businessId: string): AutomationView['stats'] {
  const runs = (db.automationRuns || []).filter((r) => r.businessId === businessId && r.automationId === automationId);
  let last: AutomationRun | null = null;
  for (const r of runs) {
    const at = r.updatedAt || r.startedAt || '';
    if (!last || at > (last.updatedAt || last.startedAt || '')) last = r;
  }
  return {
    runs: runs.length,
    live: runs.filter((r) => !isTerminalStatus(r.status)).length,
    waiting: runs.filter((r) => r.status === 'waiting').length,
    completed: runs.filter((r) => r.status === 'completed').length,
    failed: runs.filter((r) => r.status === 'failed').length,
    lastRunAt: last?.updatedAt || last?.startedAt || '',
    lastStatus: last?.status || '',
    lastError: last?.status === 'failed' ? last.error || '' : '',
  };
}

/** Resumo em texto livre para a lista ("Quando Lead criado → Se origem é …"). */
function summaryOf(automation: Automation, linear: LinearAutomation | null): string {
  const parts: string[] = [`Quando ${automationEventLabel(automation.trigger?.event)}`];
  if (linear?.condition) parts.push(`Se ${describeCondition(linear.condition, automationFieldLabel)}`);
  for (const step of linear?.steps || []) {
    if (step.kind === 'wait') {
      const w = step.wait;
      if (w?.mode === 'booking_offset') {
        const off = Math.abs(Number(w.offsetMinutes || 0));
        parts.push(off >= 1440
          ? `Depois: ${off / 1440} dia(s) ${Number(w.offsetMinutes) < 0 ? 'antes' : 'depois'} do agendamento`
          : `Depois: ${off} min ${Number(w.offsetMinutes) < 0 ? 'antes' : 'depois'} do agendamento`);
      } else if (w?.mode === 'until' && w.at) parts.push(`Depois: até ${String(w.at).replace('T', ' ')}`);
      else parts.push(`Depois: esperar ${humanDuration(Number(w?.minutes || 0)) || '(tempo)'}`);
    }
    else if (step.kind === 'action') parts.push(`Então: ${automationActionDef(step.action?.type)?.short || 'ação'}`);
  }
  if (linear?.elseSteps?.length) parts.push(`Senão: ${automationActionDef(linear.elseSteps[0]?.action?.type)?.short || 'outro caminho'}`);
  return parts.join(' · ');
}

export function automationView(db: DB, automation: Automation): AutomationView {
  const linear = graphToLinear(automation);
  const report = analyzeGraph(automation.nodes || [], automation.edges || []);
  return {
    id: automation.id,
    name: automation.name,
    description: automation.description,
    active: automation.active,
    status: automationStatusOf(automation),
    source: automation.source || 'manual',
    event: automation.trigger?.event || '',
    eventLabel: automationEventLabel(automation.trigger?.event),
    templateId: automation.templateId || '',
    version: automation.version,
    settings: automation.settings || {},
    nodes: automation.nodes || [],
    edges: automation.edges || [],
    trigger: automation.trigger,
    linear,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
    stats: statsFor(db, automation.id, automation.businessId),
    issues: [...report.errors, ...report.warnings],
    summary: summaryOf(automation, linear),
  };
}

export function automationRunView(run: AutomationRun): AutomationRunView {
  const { claimToken, claimExpiresAt, ...safe } = run;
  void claimToken; void claimExpiresAt;
  return {
    ...safe,
    lastActionType: run.lastActionType || '',
    lastError: run.lastError || '',
    // Contexto é devolvido para o diagnóstico, mas SEM nada sensível: a
    // fotografia do evento já é uma whitelist (events.ts) — nada de segredo
    // de webhook, chave de API ou hash de senha existe ali.
    context: run.context || {},
  };
}
