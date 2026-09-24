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

  // ═══ F3 — RECEITAS PRONTAS (operação do dia a dia, sem jargão) ═══
  {
    id: 'booking_confirm_24h',
    name: 'Confirmação 24 h antes',
    description: 'Um dia antes do horário, o paciente recebe a confirmação no WhatsApp. Se cancelou ou reagendou, a mensagem NÃO vai.',
    event: 'booking.created',
    tags: ['Agenda', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      { kind: 'wait', label: 'Esperar até 24 h antes', wait: { mode: 'booking_offset', offsetMinutes: -1440 } },
      {
        kind: 'action',
        label: 'Enviar confirmação',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Olá! Passando para confirmar seu agendamento: {{service.name}} em {{booking.date}} às {{booking.time}}. Se precisar remarcar ou cancelar, é só responder por aqui.',
          },
        },
      },
    ],
  },
  {
    id: 'booking_reminder_2h',
    name: 'Lembrete 2 h antes',
    description: 'Dois horas antes, um toque no WhatsApp reduz falta. Só sai se o agendamento continuar de pé.',
    event: 'booking.created',
    tags: ['Agenda', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      { kind: 'wait', label: 'Esperar até 2 h antes', wait: { mode: 'booking_offset', offsetMinutes: -120 } },
      {
        kind: 'action',
        label: 'Enviar lembrete',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Oi! Lembrete: seu agendamento de {{service.name}} é hoje às {{booking.time}} ({{booking.date}}). Até lá!',
          },
        },
      },
    ],
  },
  {
    id: 'booking_created_msg',
    name: 'Agendamento criado → recado no WhatsApp',
    description: 'Assim que a reserva entra na agenda, o paciente recebe os dados do horário pela mensagem do canal.',
    event: 'booking.created',
    tags: ['Agenda', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Enviar dados do agendamento',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Olá! Registramos seu agendamento: {{service.name}} em {{booking.date}} às {{booking.time}}. Qualquer dúvida, responda por aqui.',
          },
        },
      },
    ],
  },
  {
    id: 'booking_rescheduled_msg',
    name: 'Agendamento alterado → avisar',
    description: 'Quando a data/hora muda, o paciente é avisado com o NOVO horário (foto atualizada do booking).',
    event: 'booking.rescheduled',
    tags: ['Agenda', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Avisar nova data',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Seu agendamento foi atualizado: {{service.name}} agora em {{booking.date}} às {{booking.time}}. Se algo não servir, é só responder.',
          },
        },
      },
    ],
  },
  {
    id: 'booking_no_show_recovery',
    name: 'Faltou → recuperar',
    description: 'Marca falta na agenda e cria tarefa para a equipe reagendar. Também manda um toque educado (sem cobrança clínica).',
    event: 'booking.no_show',
    tags: ['Agenda', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Criar tarefa de reagendamento',
        action: {
          type: 'create_task',
          params: {
            title: 'Reagendar com {{booking.customerName}}',
            note: 'Não compareceu em {{booking.date}} às {{booking.time}} ({{service.name}}). Entrar em contato para novo horário.',
            dueInMinutes: 120,
          },
        },
      },
      {
        kind: 'action',
        label: 'Toque no WhatsApp',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            forceSendOnNoShow: 'true',
            message: 'Olá! Não conseguimos realizarmos seu horário de hoje. Se quiser remarcar, é só responder por aqui que a gente organiza.',
          },
        },
      },
    ],
  },
  {
    id: 'booking_completed_thanks',
    name: 'Pós-atendimento → agradecer',
    description: 'Duas horas depois de concluir, um agradecimento operacional (SEM orientação clínica nem diagnóstico).',
    event: 'booking.completed',
    tags: ['Continuidade', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      { kind: 'wait', label: 'Esperar 2 horas', wait: { mode: 'duration', minutes: 120 } },
      {
        kind: 'action',
        label: 'Enviar agradecimento',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Obrigado pela visita! Se precisar de qualquer coisa da equipe, é só chamar por aqui.',
          },
        },
      },
    ],
  },
  {
    id: 'booking_review_request',
    name: 'Pós-atendimento → pedir avaliação',
    description: 'Um dia depois, pede a opinião sobre o ATENDIMENTO (nunca resultado clínico). Só com consentimento de mensagens quando aplicável.',
    event: 'booking.completed',
    tags: ['Continuidade', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      { kind: 'wait', label: 'Esperar 1 dia', wait: { mode: 'duration', minutes: 1440 } },
      {
        kind: 'action',
        label: 'Pedir avaliação',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Como foi seu atendimento conosco? Sua opinião ajuda a equipe a melhorar — pode responder por aqui.',
          },
        },
      },
    ],
  },
  {
    id: 'followup_return_msg',
    name: 'Lembrar retornos',
    description: 'Entra em contato quando chegar a data de retorno definida pelo profissional.',
    event: 'followup.due',
    tags: ['Retorno', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Tarefa de retorno',
        action: {
          type: 'create_task',
          params: {
            title: 'Retorno vencendo: {{booking.customerName}}',
            note: 'Follow-up de {{booking.date}} venceu. Confirmar retorno com o paciente.',
            dueInMinutes: 240,
          },
        },
      },
      {
        kind: 'action',
        label: 'Avisar paciente',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Olá. Está chegando o momento do seu retorno. Gostaria de agendar?',
          },
        },
      },
    ],
  },
  {
    id: 'patient_inactive_reengage',
    name: 'Reativar pacientes',
    description: 'Fala com pacientes que não voltam há algum tempo (só com consentimento de marketing).',
    event: 'patient.inactive',
    tags: ['Relacionamento', 'Receita'],
    requires: 'automation.advanced',
    condition: { field: 'customer.marketingOptIn', operator: 'equals', value: 'true' },
    steps: [
      {
        kind: 'action',
        label: 'Tarefa de recontato',
        action: {
          type: 'create_task',
          params: {
            title: 'Reativar paciente inativo',
            note: 'Paciente sem atendimento recente e com consentimento de marketing. Retomar contato.',
            dueInMinutes: 1440,
          },
        },
      },
      {
        kind: 'action',
        label: 'Mensagem de reativação',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Olá. Faz um tempo que você não passa por aqui. Se quiser, posso verificar horários.',
          },
        },
      },
    ],
  },
  {
    id: 'lead_created_welcome',
    name: 'Lead novo → boas-vindas',
    description: 'Quem pediu contato recebe um recorde imediato no WhatsApp (sem promessa de preço ou prazo inventado).',
    event: 'lead.created',
    tags: ['Esteira', 'Receita'],
    requires: 'automation.advanced',
    steps: [
      {
        kind: 'action',
        label: 'Enviar boas-vindas',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            message: 'Olá! Recebemos seu contato. Em breve a equipe responde por aqui.',
          },
        },
      },
    ],
  },
  {
    id: 'booking_cancelled_msg',
    name: 'Cancelamento → avisar paciente',
    description: 'Confirma por mensagem que o cancelamento foi registrado (usa o fluxo oficial da agenda).',
    event: 'booking.cancelled',
    tags: ['Agenda', 'Receita'],
    requires: 'automation.advanced',
    needsBookings: true,
    steps: [
      {
        kind: 'action',
        label: 'Confirmar cancelamento',
        action: {
          type: 'send_channel_message',
          params: {
            channel: 'whatsapp',
            // Aviso do PRÓPRIO cancelamento: única mensagem permitida com status cancelled.
            forceSendOnCancelled: 'true',
            message: 'Seu agendamento foi cancelado conforme solicitado. Se quiser um novo horário, é só responder por aqui.',
          },
        },
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
    // F3: receita/modelo NUNCA auto-ativa — nasce como rascunho.
    active: false,
    status: 'draft' as const,
    source: 'template' as const,
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
  if (step.kind === 'wait') {
    const w = step.wait;
    if (w?.mode === 'booking_offset') {
      const off = Math.abs(Number(w.offsetMinutes || 0));
      const dir = Number(w.offsetMinutes) < 0 ? 'antes' : 'depois';
      return `Esperar ${humanDuration(off)} ${dir} do agendamento`;
    }
    if (w?.mode === 'until' && w.at) return `Esperar até ${String(w.at).replace('T', ' ')}`;
    return `Esperar ${humanDuration(Number(step.wait?.minutes || 0)) || '(tempo)'}`;
  }
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
  // Só ativa se o chamador pedir explicitamente (active === true).
  if (opts.active === true) {
    draft.active = true;
    (draft as any).status = 'active';
  } else {
    draft.active = false;
    (draft as any).status = 'draft';
  }
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
