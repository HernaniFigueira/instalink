// ═══════════════════════════════════════════════════════════════
// F3-C — SIMULAÇÃO de proposta/plano (dry-run, SEM efeito colateral)
// ═══════════════════════════════════════════════════════════════
// Caminha os passos lineares e descreve o que O MOTOR faria.
// NÃO grava run, NÃO envia mensagem, NÃO cria tarefa, NÃO toca agenda.
// O canal é reportado como "enfileiraria" — nunca como "enviado".
import type { AiPlan, AiPlanStep, DB } from '../types';
import {
  automationActionDef, automationEventLabel, humanDuration,
} from '../automation/model';
import { describeCondition } from '../automation/conditions';
import type { AiTenantContext } from './contract';

export interface SimulatedStep {
  index: number;
  kind: 'wait' | 'action' | 'condition';
  label: string;
  /** O que aconteceria (pt-BR, sem jargão de motor). */
  would: string;
  /** Efeito real NO MUNDO (após ativar) — nunca executado na simulação. */
  sideEffect: 'none' | 'team' | 'message_queue' | 'agenda' | 'lead' | 'blocked';
  detail?: string;
  blockedReason?: string;
}

export interface SimulationResult {
  ok: boolean;
  mode: 'simulation';
  eventLabel: string;
  conditionLine: string;
  steps: SimulatedStep[];
  /** Ressalvas honestas (canal, capacidade, limites). */
  notes: string[];
  /** Nunca houve envio real. */
  realSend: false;
  summary: string;
}

function channelNote(db: DB, businessId: string): { connected: boolean; note: string } {
  const b = db.businesses.find((x) => x.id === businessId);
  const wi = b?.whatsappIntegration;
  const ready = !!wi && (wi as any).status === 'connected';
  if (ready) {
    return { connected: true, note: 'WhatsApp conectado: mensagens entrariam na fila oficial (status pendente até a Meta confirmar).' };
  }
  return {
    connected: false,
    note: 'WhatsApp não conectado: a mensagem ficaria na fila como "aguardando conexão" — nada sairia agora.',
  };
}

function describeAction(
  step: AiPlanStep,
  db: DB,
  businessId: string,
  ctx: AiTenantContext | null,
): { would: string; sideEffect: SimulatedStep['sideEffect']; detail?: string; blockedReason?: string } {
  const type = step.action?.type || '';
  const params = step.action?.params || {};
  const def = automationActionDef(type);
  if (!def) {
    return { would: 'Ação desconhecida no catálogo', sideEffect: 'blocked', blockedReason: 'ação fora do catálogo' };
  }
  if (def.requires && ctx?.caps && ctx.caps[def.requires as keyof typeof ctx.caps] === false) {
    return { would: def.short, sideEffect: 'blocked', blockedReason: `recurso ${def.requires} desligado` };
  }
  switch (type) {
    case 'send_channel_message': {
      const ch = String(params.channel || 'whatsapp');
      const msg = String(params.message || params.text || '').slice(0, 120);
      if (ch === 'instagram') {
        return {
          would: `Enfileiraria no Instagram Direct: "${msg}${msg.length >= 120 ? '…' : ''}"`,
          sideEffect: 'message_queue',
          detail: 'Só responde quem já escreveu (janela 24 h da Meta).',
        };
      }
      const { note } = channelNote(db, businessId);
      return {
        would: `Enfileiraria no WhatsApp: "${msg}${msg.length >= 120 ? '…' : ''}"`,
        sideEffect: 'message_queue',
        detail: note,
      };
    }
    case 'create_task':
      return {
        would: `Criaria tarefa para a equipe: "${String(params.title || 'Tarefa')}"`,
        sideEffect: 'team',
        detail: params.dueInMinutes ? `prazo em ${humanDuration(Number(params.dueInMinutes))}` : 'sem prazo',
      };
    case 'change_lead_stage': {
      const name = ctx?.stages.find((s) => s.id === params.stageId)?.name || String(params.stageId || '');
      return { would: `Moveria o lead para "${name}"`, sideEffect: 'lead' };
    }
    case 'assign_lead':
      return {
        would: params.target === 'auto' ? 'Atribuiria em rodízio (menos ocupado)' : `Atribuiria para ${String(params.userId || 'pessoa da equipe')}`,
        sideEffect: 'lead',
      };
    case 'add_lead_note':
      return { would: `Adicionaria observação no lead: "${String(params.text || '').slice(0, 80)}"`, sideEffect: 'lead' };
    case 'update_lead':
      return { would: 'Atualizaria dados do lead (prioridade/interesse/próxima ação)', sideEffect: 'lead' };
    case 'update_customer':
      return { would: 'Atualizaria o contato no CRM', sideEffect: 'lead' };
    case 'create_booking':
      return { would: 'Criaria agendamento pelo motor da agenda (slot e conflitos validados)', sideEffect: 'agenda' };
    case 'cancel_booking':
      return { would: 'Cancelaria o agendamento pelo fluxo oficial', sideEffect: 'agenda' };
    case 'dispatch_webhook':
      return { would: 'Enviaria webhook de saída (HMAC + retry)', sideEffect: 'none', detail: 'sistema externo' };
    default:
      return { would: def.short, sideEffect: 'none' };
  }
}

/**
 * Simula um plano/proposta. Puro: só leitura de tenant + catálogo.
 * `realSend` é sempre false — a simulação jamais marca envio real.
 */
export function simulatePlan(
  db: DB,
  businessId: string,
  plan: AiPlan,
  ctx?: AiTenantContext | null,
): SimulationResult {
  const notes: string[] = ['Simulação apenas: nenhuma mensagem, tarefa ou agendamento foi criado.'];
  const tenant = ctx || null;
  const steps: SimulatedStep[] = [];
  const all = [...(plan.steps || []), ...(plan.elseSteps || [])];
  let blockedAny = false;

  all.forEach((step, i) => {
    const isElse = i >= (plan.steps || []).length;
    const prefix = isElse ? 'Senão: ' : '';
    if (step.kind === 'wait') {
      const w = step.wait;
      let would = 'Esperaria um tempo';
      if (w?.mode === 'booking_offset') {
        const off = Math.abs(Number(w.offsetMinutes || 0));
        would = `Esperaria ${humanDuration(off)} ${Number(w.offsetMinutes) < 0 ? 'antes' : 'depois'} do agendamento (recalculado na retomada)`;
      } else if (w?.mode === 'until' && w.at) {
        would = `Esperaria até ${String(w.at).replace('T', ' ')}`;
      } else if (w?.mode === 'duration') {
        would = `Esperaria ${humanDuration(Number(w.minutes || 0))}`;
      } else if (w?.mode === 'event') {
        would = 'Esperaria por um evento (estrutura preparada — ainda não dispara)';
      }
      steps.push({ index: steps.length + 1, kind: 'wait', label: step.label || 'Esperar', would: prefix + would, sideEffect: 'none' });
      return;
    }
    if (step.kind === 'condition') {
      const line = step.condition ? describeCondition(step.condition, (p) => p) : 'condição';
      steps.push({ index: steps.length + 1, kind: 'condition', label: 'Se', would: `${prefix}Se ${line}`, sideEffect: 'none' });
      return;
    }
    const d = describeAction(step, db, businessId, tenant);
    if (d.sideEffect === 'blocked') blockedAny = true;
    steps.push({
      index: steps.length + 1,
      kind: 'action',
      label: step.label || automationActionDef(step.action?.type)?.short || 'Ação',
      would: prefix + d.would,
      sideEffect: d.sideEffect,
      detail: d.detail,
      blockedReason: d.blockedReason,
    });
  });

  const ch = channelNote(db, businessId);
  if (all.some((s) => s.action?.type === 'send_channel_message')) notes.push(ch.note);
  if (blockedAny) notes.push('Há passos bloqueados por recurso desligado — revise antes de ativar.');
  if (!(plan.steps || []).length) notes.push('Plano sem passos: nada aconteceria no gatilho.');

  const conditionLine = plan.condition ? describeCondition(plan.condition, (p) => p) : '';
  const summary = `${automationEventLabel(plan.event)}${conditionLine ? ` · Se ${conditionLine}` : ''} · ${steps.length} passo(s) simulado(s)`;

  return {
    ok: !blockedAny && (plan.steps || []).length > 0,
    mode: 'simulation',
    eventLabel: automationEventLabel(plan.event),
    conditionLine,
    steps,
    notes,
    realSend: false,
    summary,
  };
}
