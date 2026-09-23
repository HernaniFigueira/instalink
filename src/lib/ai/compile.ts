// ═══════════════════════════════════════════════════════════════
// P5.2 / P5.3 — GRAPH GENERATION + VALIDATOR
// ═══════════════════════════════════════════════════════════════
// Plano estruturado → grafo canônico do P4 (`linearToGraph`) →
// `validateAutomationDraft` (o MESMO gate da API de automações).
//
// A IA sugere. O código decide se é válido. Nada de segundo validador
// paralelo: o que entra a mais aqui é o que o P4 não precisa saber
// (referência cross-tenant, pedido sem ação, profundidade).
import type { AiPlan, Automation, AutomationActionType, DB } from '../types';
import {
  analyzeGraph, linearToGraph, validateAutomationDraft, type AutomationDraft, type LinearAutomation,
} from '../automation/model';
import { automationActionDef } from '../automation/model';
import {
  AI_TEMPLATE_ID, asLinearSteps, classifyProfessionalRef, classifyServiceRef, classifyUserRef,
  eventEntityOf, isKnownEvent, tenantContextFor, type AiTenantContext,
} from './contract';

export interface AiCompileResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  nodes: Automation['nodes'];
  edges: Automation['edges'];
  draft: AutomationDraft;
  /** Automação sanitizada (sem id/businessId/timestamps) — pronta para gravar. */
  automation: Omit<Automation, 'createdAt' | 'updatedAt' | 'version'> | null;
}

function linearOf(plan: AiPlan): LinearAutomation {
  return {
    event: plan.event,
    condition: plan.condition || null,
    steps: asLinearSteps(plan.steps),
    elseSteps: asLinearSteps(plan.elseSteps),
  };
}

/** P5.2 — plano → grafo do P4. Puro. Não valida. */
export function planToGraph(plan: AiPlan): { nodes: Automation['nodes']; edges: Automation['edges'] } {
  return linearToGraph(linearOf(plan));
}

export function planToDraft(plan: AiPlan, extra: Partial<AutomationDraft> = {}): AutomationDraft {
  const graph = planToGraph(plan);
  return {
    name: plan.name,
    description: plan.description,
    active: false, // a IA NUNCA publica ligada
    event: plan.event,
    condition: plan.condition || null,
    nodes: graph.nodes,
    edges: graph.edges,
    settings: { ...(plan.settings || {}) } as Record<string, unknown>,
    templateId: AI_TEMPLATE_ID,
    source: 'ai',
    ...extra,
  };
}

function pushUnique(list: string[], item: string): void {
  if (item && !list.includes(item)) list.push(item);
}

function actionParamsOf(plan: AiPlan): Array<{ type: string; params: Record<string, any> }> {
  const out: Array<{ type: string; params: Record<string, any> }> = [];
  for (const step of [...(plan.steps || []), ...(plan.elseSteps || [])]) {
    if (step.kind === 'action' && step.action) {
      out.push({ type: String(step.action.type || ''), params: step.action.params || {} });
    }
  }
  return out;
}

/**
 * Checagens P5 que o P4 não faz (porque o editor humano não inventa id
 * de outro tenant). Sempre em cima do recorte do businessId informado.
 */
export function extraAiChecks(db: DB, businessId: string, plan: AiPlan, ctx: AiTenantContext): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isKnownEvent(plan.event)) {
    pushUnique(errors, `gatilho inexistente: ${String(plan.event || '(vazio)')}`);
  }
  if (!(plan.steps || []).some((s) => s.kind === 'action' || s.kind === 'wait')) {
    pushUnique(errors, 'a automação precisa de ao menos uma ação ou espera');
  }
  // `unresolved` é o que a IA não conseguiu amarrar a um id deste tenant:
  // vira aviso (o lojista vê e edita). Só escala a erro quando o plano ficou
  // sem ação — já coberto acima — ou quando a mensagem é de gatilho/módulo.
  for (const note of plan.unresolved || []) {
    if (/não entendi o gatilho|módulo de Agendamentos|não pode ser interpretado/.test(note)) {
      pushUnique(errors, note);
    } else {
      pushUnique(warnings, note);
    }
  }

  const entity = isKnownEvent(plan.event) ? eventEntityOf(plan.event) : '';
  for (const { type, params } of actionParamsOf(plan)) {
    const def = automationActionDef(type);
    if (!def) {
      pushUnique(errors, `ação inexistente: ${type || '(vazia)'}`);
      continue;
    }
    if (def.requires === 'automation.advanced' && ctx.caps['automation.advanced'] === false) {
      pushUnique(errors, `a ação "${def.label}" exige automações avançadas (não liberadas para esta empresa)`);
    }
    if (def.needs?.booking && entity !== 'booking') {
      pushUnique(errors, `a ação "${def.label}" precisa de um gatilho de agendamento`);
    }
    if (def.needs?.lead && entity === 'customer') {
      pushUnique(warnings, `a ação "${def.label}" espera um lead — o gatilho é de cliente`);
    }
    if (def.type === 'create_booking' && !ctx.hasBookings) {
      pushUnique(errors, 'criar agendamento exige o módulo de Agendamentos ativo');
    }

    const userId = String(params.userId || params.assignedUserId || '').trim();
    if (userId) {
      const kind = classifyUserRef(db, businessId, userId);
      if (kind === 'cross-tenant') pushUnique(errors, 'referência de outro negócio (responsável)');
      else if (kind === 'missing') pushUnique(errors, 'o profissional/responsável informado não existe nesta empresa');
    }
    const serviceId = String(params.serviceId || '').trim();
    if (serviceId) {
      const kind = classifyServiceRef(db, businessId, serviceId);
      if (kind === 'cross-tenant') pushUnique(errors, 'referência de outro negócio (serviço)');
      else if (kind === 'missing') pushUnique(errors, 'o serviço informado não existe nesta empresa');
    }
    const professionalId = String(params.professionalId || '').trim();
    if (professionalId) {
      const kind = classifyProfessionalRef(db, businessId, professionalId);
      if (kind === 'cross-tenant') pushUnique(errors, 'referência de outro negócio (profissional)');
      else if (kind === 'missing') pushUnique(errors, 'o profissional informado não existe nesta empresa');
    }
  }

  return { errors, warnings };
}

/**
 * P5.3 — validação determinística. Compila o plano para o grafo do P4 e
 * passa pelo MESMO `validateAutomationDraft` da API. Erros extras de
 * tenant/IA entram na mesma lista.
 */
export function compileAndValidatePlan(
  db: DB,
  businessId: string,
  plan: AiPlan,
  ctx?: AiTenantContext | null,
): AiCompileResult {
  const tenant = ctx || tenantContextFor(db, businessId);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!tenant) {
    return {
      ok: false, errors: ['negócio não encontrado'], warnings: [],
      nodes: [], edges: [], draft: { name: plan.name, event: plan.event, nodes: [], edges: [] },
      automation: null,
    };
  }
  if (!tenant.aiEnabled) errors.push('a geração por IA não está liberada para esta empresa');

  const extra = extraAiChecks(db, businessId, plan, tenant);
  errors.push(...extra.errors);
  warnings.push(...extra.warnings);

  const draft = planToDraft(plan);
  const graph = { nodes: (draft.nodes || []) as Automation['nodes'], edges: (draft.edges || []) as Automation['edges'] };

  const report = analyzeGraph(graph.nodes, graph.edges, { maxNodes: tenant.limits.maxNodes });
  errors.push(...report.errors);
  warnings.push(...report.warnings);
  if (report.maxDepth > tenant.limits.maxStepsPerRun) {
    errors.push(`grafo profundo demais (${report.maxDepth} níveis, máximo ${tenant.limits.maxStepsPerRun})`);
  }

  const validation = validateAutomationDraft(draft, {
    limits: tenant.limits,
    stages: tenant.stages,
    serviceIds: tenant.services.map((s) => s.id),
    userIds: tenant.members.map((m) => m.userId),
    businessCaps: tenant.caps,
  });
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  const uniqueErrors = [...new Set(errors)];
  const uniqueWarnings = [...new Set(warnings)].filter((w) => !uniqueErrors.includes(w));
  const ok = uniqueErrors.length === 0 && validation.ok;

  return {
    ok,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
    nodes: validation.automation.nodes || graph.nodes,
    edges: validation.automation.edges || graph.edges,
    draft,
    automation: ok ? validation.automation : null,
  };
}

export function isKnownActionType(type: unknown): type is AutomationActionType {
  return !!automationActionDef(type);
}
