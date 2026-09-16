// ═══════════════════════════════════════════════════════════════
// P4.11 — TEMPLATES INTERNOS (começar sem encarar a tela vazia)
// ═══════════════════════════════════════════════════════════════
// Um template NÃO é um segundo formato nem um atalho mágico: é uma definição
// normal, escrita na forma linear do editor e compilada para o mesmo grafo de
// qualquer automação criada à mão (`linearToGraph`). Por isso:
//   • o que a galeria oferece é exatamente o que o usuário pode editar depois;
//   • nada é "escondido" atrás do template;
//   • o P5 (IA) pode gerar ESSA MESMA forma linear — sem conhecer o banco.
import type { AutomationEventId, DB } from '../types';
import { getBusinessPipeline } from '../pipeline';
import { isFeatureEnabled } from '../features';
import { describeCondition } from './conditions';
import {
  automationActionDef, automationEventLabel, automationFieldLabel, graphToLinear, humanDuration,
  linearToGraph, validateAutomationDraft, type LinearStep,
} from './model';
import { limitsFor, capabilityStateFor } from './capabilities';

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  event: AutomationEventId;
  /** Selo curto na galeria. */
  tags: string[];
  /** Recurso necessário (além do básico) — quando houver. */
  requires?: 'automation.basic' | 'automation.advanced';
  /** Pré-requisito de módulo do negócio (agenda) para a UI explicar. */
  needsBookings?: boolean;
  steps: LinearStep[];
  condition?: LinearStep['condition'];
  elseSteps?: LinearStep[];
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'lead_assign_owner',
    name: 'Novo lead → atribuir responsável',
    description: 'Cada lead novo cai com quem está menos ocupado agora. Ninguém fica sem resposta por "achei que era do outro".',
    event: 'lead.created',
    tags: ['Esteira', 'Resposta rápida'],
    steps: [
      {
        kind: 'action',
        label: 'Atribuir responsável',
        action: { type: 'assign_lead', params: { target: 'auto', note: 'Distribuído automaticamente pela automação' } },
      },
      {
        kind: 'action',
        label: 'Observação no lead',
        action: { type: 'add_lead_note', params: { text: 'Contato de {{lead.name}} ({{lead.origin}}). Precisa de resposta.' } },
      },
    ],
  },
  {
    id: 'booking_created_task',
    name: 'Novo agendamento → preparar a equipe',
    description: 'Quando sai um agendamento, já nasce a tarefa de preparo com o nome de quem vem.',
    event: 'booking.created',
    tags: ['Agenda', 'Operação'],
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Criar tarefa',
        action: {
          type: 'create_task',
          params: {
            title: 'Preparar atendimento: {{booking.customerName}}',
            note: 'Serviço {{service.name}} em {{booking.date}} às {{booking.time}}.',
            dueInMinutes: 60,
            assignee: 'none',
          },
        },
      },
    ],
  },
  {
    id: 'booking_cancelled_task',
    name: 'Agendamento cancelado → reagir',
    description: 'Cancelamento vira tarefa imediata de reposição de horário (e registro do motivo no lead, se houver).',
    event: 'booking.cancelled',
    tags: ['Agenda', 'Retenção'],
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Criar tarefa',
        action: {
          type: 'create_task',
          params: {
            title: 'Reposicionar horário cancelado de {{booking.customerName}}',
            note: 'Cancelado em {{event.at}}. Ofereça outro horário.',
            dueInMinutes: 120,
          },
        },
      },
    ],
  },
  {
    id: 'booking_completed_next_step',
    name: 'Atendimento concluído → próxima ação',
    description: 'Depois de concluir, a equipe já recebe o próximo passo combinado com o cliente.',
    event: 'booking.completed',
    tags: ['Agenda', 'Continuidade'],
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Criar tarefa de retorno',
        action: {
          type: 'create_task',
          params: {
            title: 'Definir próximo passo com {{booking.customerName}}',
            note: 'Atendimento concluído em {{booking.date}}. Combinar retorno e registrar no histórico.',
            dueInMinutes: 1440,
          },
        },
      },
    ],
  },
  {
    id: 'lead_followup_no_booking',
    name: 'Lead sem agendamento → follow-up',
    description: 'Lead novo que não virou agendamento recebe um lembrete depois de 2 horas — sem atrapalhar quem já agendou.',
    event: 'lead.created',
    tags: ['Esteira', 'Follow-up'],
    condition: { field: 'lead.bookingId', operator: 'not_exists' },
    steps: [
      { kind: 'wait', label: 'Esperar 2 horas', wait: { mode: 'duration', minutes: 120 } },
      {
        kind: 'action',
        label: 'Criar tarefa de contato',
        action: {
          type: 'create_task',
          params: {
            title: 'Retomar {{lead.name}}',
            note: 'Pediu contato ({{lead.origin}}) e ainda não agendou. Interesse: {{lead.interest}}',
            dueInMinutes: 240,
          },
        },
      },
    ],
  },
  {
    id: 'lead_by_origin_branch',
    name: 'Lead por origem → qualificar ou só anotar',
    description: 'Vem do Instagram? Vai direto para qualificação. Vem de outro lugar? Fica a observação para a equipe decidir.',
    event: 'lead.created',
    tags: ['Esteira', 'Ramificação'],
    condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
    steps: [
      {
        kind: 'action',
        label: 'Alterar etapa',
        action: { type: 'change_lead_stage', params: { stageId: 'qualifying', note: 'Origem Instagram — qualificar primeiro' } },
      },
    ],
    elseSteps: [
      {
        kind: 'action',
        label: 'Adicionar observação',
        action: { type: 'add_lead_note', params: { text: 'Entrada por {{lead.origin}} — avaliar antes de mover de etapa.' } },
      },
    ],
  },
];

export function automationTemplateById(id: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id);
}

/** Rascunho de automação a partir do template (já na forma linear). */
export function templateToDraft(template: AutomationTemplate, businessId: string, userId = '') {
  const graph = linearToGraph({
    event: template.event,
    condition: template.condition || null,
    steps: template.steps,
    elseSteps: template.elseSteps || [],
  });
  return {
    businessId,
    name: template.name,
    description: template.description,
    active: true,
    event: template.event,
    nodes: graph.nodes,
    edges: graph.edges,
    settings: {},
    templateId: template.id,
    createdByUserId: userId,
  };
}

export interface TemplateOffer {
  id: string;
  name: string;
  description: string;
  event: AutomationEventId;
  tags: string[];
  /** false quando a unidade não tem o módulo/recurso da prévia. */
  applicable: boolean;
  reason: string;
  /** Projeção linear para a prévia "Quando / Se / Então / Depois". */
  preview: {
    when: string;
    ifText: string;
    thens: string[];
    elseTexts: string[];
  };
}

function stepText(step: LinearStep): string {
  if (step.kind === 'wait') return `Esperar ${humanDuration(Number(step.wait?.minutes || 0)) || '(tempo)'}`;
  if (step.kind === 'condition') return `Se ${describeCondition(step.condition, automationFieldLabel)}`;
  const def = automationActionDef(step.action?.type);
  if (!def) return 'Ação';
  const main = step.action?.params?.stageId || step.action?.params?.title || step.action?.params?.text
    || step.action?.params?.event || (step.action?.params?.target === 'auto' ? 'rodízio' : '');
  return `${def.short}${main ? `: ${String(main).slice(0, 48)}` : ''}`;
}

/** O que a galeria mostra (com a verdade sobre o que se aplica à unidade). */
export function templateOffers(db: DB, businessId: string): TemplateOffer[] {
  const business = db.businesses.find((b) => b.id === businessId);
  const caps = capabilityStateFor(business);
  return AUTOMATION_TEMPLATES.map((t) => {
    const needsAgenda = !!t.needsBookings;
    const agendaOff = needsAgenda && business ? !isFeatureEnabled(business, 'bookings') : false;
    const needsAdvanced = t.requires === 'automation.advanced' && caps['automation.advanced'] !== true;
    const applicable = !agendaOff && !needsAdvanced && caps['automation.basic'] === true;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      event: t.event,
      tags: t.tags,
      applicable,
      reason: agendaOff
        ? 'Precisa do módulo de Agendamentos ativo (Recursos).'
        : needsAdvanced ? 'Recurso de automações avançadas desligado para esta empresa.'
        : caps['automation.basic'] !== true ? 'Automações desligadas para esta empresa.' : '',
      preview: {
        when: automationEventLabel(t.event),
        ifText: t.condition ? describeCondition(t.condition, automationFieldLabel) : '',
        thens: t.steps.map(stepText),
        elseTexts: (t.elseSteps || []).map(stepText),
      },
    };
  });
}

export interface ApplyTemplateResult {
  ok: boolean;
  automation?: any;
  errors: string[];
  warnings: string[];
}

/**
 * Aplica um template criando a automação (o template NÃO é gravado "por trás"
 * da validação: passa pelo mesmo `validateAutomationDraft` do editor).
 */
export function applyTemplate(
  db: DB,
  businessId: string,
  templateId: string,
  opts: { userId?: string; name?: string; active?: boolean } = {},
): ApplyTemplateResult {
  const template = automationTemplateById(templateId);
  if (!template) return { ok: false, errors: ['template inexistente'], warnings: [] };

  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return { ok: false, errors: ['Negócio não encontrado.'], warnings: [] };
  if (template.needsBookings && !isFeatureEnabled(business, 'bookings')) {
    return {
      ok: false,
      errors: ['este template precisa do módulo de Agendamentos ativo (Recursos)'],
      warnings: [],
    };
  }

  const draft = templateToDraft(template, businessId, opts.userId || '');
  if (opts.name) draft.name = opts.name;
  if (opts.active === false) draft.active = false;
  const pipeline = getBusinessPipeline(db, businessId);
  const validation = validateAutomationDraft(draft, {
    limits: limitsFor(business),
    stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name })),
    serviceIds: db.services.filter((s) => s.businessId === businessId && s.active !== false).map((s) => s.id),
    businessCaps: capabilityStateFor(business),
  });
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };
  return { ok: true, automation: validation.automation, errors: [], warnings: validation.warnings };
}

/** Projeção linear do template (a UI usa o MESMO renderizador da automação). */
export function templateLinear(template: AutomationTemplate) {
  const graph = linearToGraph({
    event: template.event,
    condition: template.condition || null,
    steps: template.steps,
    elseSteps: template.elseSteps || [],
  });
  return graphToLinear({ trigger: { event: template.event }, nodes: graph.nodes, edges: graph.edges });
}
