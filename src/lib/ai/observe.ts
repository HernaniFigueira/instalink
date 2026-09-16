// ═══════════════════════════════════════════════════════════════
// P5.6 — AGENT RUNTIME / OBSERVAÇÃO (fundação, sem autonomia)
// ═══════════════════════════════════════════════════════════════
// O agente PODE: ler execuções da PRÓPRIA unidade, explicar erros,
// sugerir alterações e novas automações. NÃO PODE: executar ação
// operacional, republicar, chamar ferramenta arbitrária, olhar outro
// tenant. Autonomia irrestrita fica para um ciclo futuro.
import type { AutomationRun, DB } from '../types';
import { automationsOf, isTerminalStatus } from '../automation/model';
import { automationsForEvent } from '../automation/model';
import { openTasks } from '../automation/tasks';
import { tenantContextFor } from './contract';

export interface ObservedFailure {
  runId: string;
  automationId: string;
  automationName: string;
  error: string;
  explanation: string;
  suggestion: string;
  at: string;
}

export interface ObservedSuggestion {
  title: string;
  prompt: string;
  reason: string;
}

export interface BusinessObservation {
  businessId: string;
  stats: {
    automations: number;
    active: number;
    runs: number;
    failed: number;
    waiting: number;
    openTasks: number;
  };
  failures: ObservedFailure[];
  suggestions: ObservedSuggestion[];
}

function explainError(error: string): { explanation: string; suggestion: string } {
  const e = String(error || '').toLowerCase();
  if (!e) return { explanation: 'A execução terminou sem detalhe.', suggestion: 'Abra o histórico da automação e revise o último passo.' };
  if (/ciclo/.test(e)) return { explanation: 'O fluxo entrou em um ciclo (passou pelo mesmo passo demais vezes).', suggestion: 'Revise ramificações e esperas — um ciclo sem espera é recusado na gravação.' };
  if (/limite de passos/.test(e)) return { explanation: 'A execução atingiu o teto de passos.', suggestion: 'Enxugue ações/esperas ou aumente o teto em Avançado.' };
  if (/etapa/.test(e)) return { explanation: 'A etapa configurada não existe mais na esteira desta empresa.', suggestion: 'Edite a automação e escolha uma etapa atual da esteira.' };
  if (/horário|ocupado|slot/.test(e)) return { explanation: 'O motor de agenda recusou o horário (mesmo 409 do painel).', suggestion: 'Não force um horário fixo — ou trate o erro como tarefa para a recepção.' };
  if (/recurso/.test(e)) return { explanation: 'A ação exige um recurso que não está liberado para esta empresa.', suggestion: 'Troque a ação por uma equivalente do plano básico ou libere o recurso.' };
  if (/empresa não/.test(e)) return { explanation: 'A unidade da execução não existe mais.', suggestion: 'Nada a fazer nesta execução — ela ficou órfã.' };
  return { explanation: error.slice(0, 200), suggestion: 'Revise a automação e teste com um evento real depois de ajustar.' };
}

function runsOf(db: DB, businessId: string): AutomationRun[] {
  return (db.automationRuns || []).filter((r) => r && r.businessId === businessId);
}

/**
 * Observa a unidade. Nunca lê outro businessId, nunca muta nada.
 */
export function observeBusiness(db: DB, businessId: string): BusinessObservation | null {
  const id = String(businessId || '').trim();
  if (!id) return null;
  const ctx = tenantContextFor(db, id);
  if (!ctx) return null;

  const automations = automationsOf(db, id);
  const runs = runsOf(db, id);
  const failed = runs.filter((r) => r.status === 'failed');
  const failures: ObservedFailure[] = failed.slice(-15).reverse().map((r) => {
    const explained = explainError(r.error || r.lastError || '');
    return {
      runId: r.id,
      automationId: r.automationId,
      automationName: r.automationName,
      error: r.error || r.lastError || '',
      explanation: explained.explanation,
      suggestion: explained.suggestion,
      at: r.finishedAt || r.updatedAt,
    };
  });

  const suggestions: ObservedSuggestion[] = [];
  const has = (event: string) => automations.some((a) => a.active && a.trigger?.event === event);

  if (automations.length === 0) {
    suggestions.push({
      title: 'Primeira automação: lead novo',
      prompt: 'Quando chegar um lead, atribua para a recepção e crie uma tarefa para ligar.',
      reason: 'Esta unidade ainda não tem automações. Um follow-up de lead novo é o começo mais seguro.',
    });
  }
  if (ctx.hasBookings && !has('booking.cancelled')) {
    suggestions.push({
      title: 'Reagir a cancelamento',
      prompt: 'Quando uma consulta for cancelada, crie uma tarefa para remarcar.',
      reason: 'Há agenda nesta unidade e nenhuma automação escuta cancelamento.',
    });
  }
  if (!has('lead.created') && automations.length > 0) {
    suggestions.push({
      title: 'Acolher lead novo',
      prompt: 'Quando um cliente entrar pelo Instagram, coloque o lead como interessado e crie uma tarefa para ligar amanhã.',
      reason: 'Nenhuma automação ativa escuta a entrada de lead.',
    });
  }
  if (ctx.hasBookings && !has('booking.completed')) {
    suggestions.push({
      title: 'Recuperar quem não voltou',
      prompt: 'Quero recuperar pacientes que não voltaram há 6 meses.',
      reason: 'Depois do atendimento, ninguém está programado para retomar o contato.',
    });
  }

  return {
    businessId: id,
    stats: {
      automations: automations.length,
      active: automations.filter((a) => a.active).length,
      runs: runs.length,
      failed: failed.length,
      waiting: runs.filter((r) => r.status === 'waiting').length,
      openTasks: openTasks(db, id).length,
    },
    failures,
    suggestions: suggestions.slice(0, 4),
  };
}

/** Explica UMA execução — só se ela for da unidade pedida. */
export function explainRun(db: DB, businessId: string, runId: string): ObservedFailure | null {
  const run = (db.automationRuns || []).find((r) => r.id === runId && r.businessId === businessId);
  if (!run) return null;
  const explained = explainError(run.error || rLast(run));
  return {
    runId: run.id,
    automationId: run.automationId,
    automationName: run.automationName,
    error: run.error || rLast(run),
    explanation: explained.explanation,
    suggestion: explained.suggestion,
    at: run.finishedAt || run.updatedAt,
  };
}

function rLast(run: AutomationRun): string {
  const last = [...(run.history || [])].reverse().find((h) => h.outcome === 'error');
  return last?.detail || run.lastError || '';
}

export function liveRuns(db: DB, businessId: string): AutomationRun[] {
  return runsOf(db, businessId).filter((r) => !isTerminalStatus(r.status));
}

/** Contagem defensiva: eventos cobertos vs. catálogo (sugestão, não execução). */
export function uncoveredEvents(db: DB, businessId: string): string[] {
  const covered = new Set(automationsForEvent(db, businessId, 'lead.created').length ? ['lead.created'] : []);
  for (const a of automationsOf(db, businessId)) {
    if (a.active && a.trigger?.event) covered.add(a.trigger.event);
  }
  const interesting = ['lead.created', 'booking.cancelled', 'booking.completed'];
  return interesting.filter((e) => !covered.has(e));
}
