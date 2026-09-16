// ═══════════════════════════════════════════════════════════════
// P5.4 — APRESENTAÇÃO HUMANA (QUANDO / SE / ENTÃO / DEPOIS)
// ═══════════════════════════════════════════════════════════════
// O lojista precisa VER o que a IA entendeu antes de ativar. Esta
// projeção é só leitura: usa os mesmos rótulos do P4.
import type { AiPlan, AiPlanStep, AiProposal } from '../types';
import {
  automationActionDef, automationEventLabel, automationFieldLabel, humanDuration,
} from '../automation/model';
import { describeCondition } from '../automation/conditions';
import type { AiTenantContext } from './contract';

export interface PresentedLine {
  kind: 'action' | 'wait';
  kicker: string; // ENTÃO / DEPOIS / SENÃO
  text: string;
  detail?: string;
}

export interface AiPresentation {
  name: string;
  description: string;
  when: string;
  ifLines: string[];
  thenLines: PresentedLine[];
  elseLines: PresentedLine[];
  deadline?: string;
  assumptions: string[];
  unresolved: string[];
  errors: string[];
  warnings: string[];
  confidence: number;
  canApprove: boolean;
  canPublish: boolean;
  status: AiProposal['status'] | 'preview';
}

function stageName(id: string, ctx?: AiTenantContext | null): string {
  if (!id) return '';
  return ctx?.stages.find((s) => s.id === id)?.name || id;
}

function memberName(id: string, ctx?: AiTenantContext | null): string {
  if (!id) return '';
  return ctx?.members.find((m) => m.userId === id)?.name || id;
}

function stepText(step: AiPlanStep, ctx?: AiTenantContext | null): { text: string; detail?: string; deadline?: string } {
  if (step.kind === 'wait') {
    const minutes = Number(step.wait?.minutes || 0);
    const until = step.wait?.mode === 'until' ? String(step.wait.at || '') : '';
    if (until) return { text: `Esperar até ${until.replace('T', ' ')}` };
    return { text: `Esperar ${humanDuration(minutes) || '(tempo)'}` };
  }
  const def = automationActionDef(step.action?.type);
  const params = step.action?.params || {};
  if (step.action?.type === 'change_lead_stage') {
    return { text: `Mover para "${stageName(String(params.stageId || ''), ctx)}"` };
  }
  if (step.action?.type === 'assign_lead') {
    if (params.target === 'auto') return { text: 'Atribuir em rodízio (menos ocupado)' };
    if (params.target === 'unassigned') return { text: 'Remover o responsável' };
    return { text: `Atribuir para "${memberName(String(params.userId || ''), ctx) || 'a equipe'}"` };
  }
  if (step.action?.type === 'create_task') {
    const due = Number(params.dueInMinutes || 0);
    const deadline = due === 1440 ? 'Amanhã' : due > 0 ? `em ${humanDuration(due)}` : '';
    return { text: `Criar tarefa: "${String(params.title || 'Tarefa')}"`, detail: params.note ? String(params.note).slice(0, 140) : '', deadline };
  }
  if (step.action?.type === 'add_lead_note') {
    return { text: `Adicionar observação: "${String(params.text || '').slice(0, 80)}"` };
  }
  if (step.action?.type === 'update_lead') {
    const bits = [params.priority && `prioridade ${params.priority}`, params.interest && `interesse "${params.interest}"`].filter(Boolean);
    return { text: `Atualizar o lead${bits.length ? `: ${bits.join(', ')}` : ''}` };
  }
  return { text: def?.short || step.label || 'Ação' };
}

function linesOf(steps: AiPlanStep[] | undefined, firstKicker: string, ctx?: AiTenantContext | null): { lines: PresentedLine[]; deadline?: string } {
  const lines: PresentedLine[] = [];
  let deadline = '';
  (steps || []).forEach((step, i) => {
    const rendered = stepText(step, ctx);
    if (rendered.deadline) deadline = rendered.deadline;
    lines.push({
      kind: step.kind === 'wait' ? 'wait' : 'action',
      kicker: i === 0 ? firstKicker : (step.kind === 'wait' ? 'DEPOIS' : 'DEPOIS'),
      text: rendered.text,
      detail: rendered.detail,
    });
  });
  return { lines, deadline };
}

export function presentPlan(
  plan: AiPlan,
  opts: { ctx?: AiTenantContext | null; errors?: string[]; warnings?: string[]; status?: AiProposal['status'] } = {},
): AiPresentation {
  const then = linesOf(plan.steps, 'ENTÃO', opts.ctx);
  const otherwise = linesOf(plan.elseSteps, 'SENÃO', opts.ctx);
  const ifText = plan.condition ? describeCondition(plan.condition, automationFieldLabel) : '';
  const ifLines = ifText
    ? ifText.split(/ e | ou /).length > 1
      ? ifText.split(/ e /).map((part, i) => (i === 0 ? part : `E ${part}`))
      : [ifText]
    : [];
  const errors = opts.errors || [];
  const status = opts.status || 'preview';
  const canApprove = errors.length === 0 && (plan.steps || []).length > 0 && status === 'draft';
  const canPublish = errors.length === 0 && status === 'approved';
  return {
    name: plan.name,
    description: plan.description,
    when: automationEventLabel(plan.event),
    ifLines,
    thenLines: then.lines,
    elseLines: otherwise.lines,
    deadline: then.deadline || otherwise.deadline,
    assumptions: plan.assumptions || [],
    unresolved: plan.unresolved || [],
    errors,
    warnings: opts.warnings || [],
    confidence: plan.confidence,
    canApprove,
    canPublish,
    status,
  };
}

export function presentProposal(proposal: AiProposal, ctx?: AiTenantContext | null): AiPresentation {
  return presentPlan(proposal.plan, {
    ctx,
    errors: proposal.validation?.errors || [],
    warnings: proposal.validation?.warnings || [],
    status: proposal.status,
  });
}
