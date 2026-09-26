// ═══════════════════════════════════════════════════════════════
// F3-C — EDIÇÃO CONVERSACIONAL PONTUAL (determinística, sem LLM)
// ═══════════════════════════════════════════════════════════════
// Uma instrução curta em português ajusta o plano EXISTENTE:
//   "mude a etapa para qualificado", "espere 3 horas", "remova a tarefa"…
// Nunca reinterpreta o gatilho do zero (use regenerate para isso).
// Saída = mesmo AiPlan (mutação controlada) + lista do que mudou.
import type { AiPlan, AiPlanStep } from '../types';
import { resolveStageAlias } from '../automation/model';
import { AI_DESCRIPTION_MAX, AI_NAME_MAX, type AiTenantContext } from './contract';

export interface RefineResult {
  ok: boolean;
  plan: AiPlan;
  /** O que a instrução mudou (pt-BR) — vazia se nada reconhecido. */
  changes: string[];
  errors: string[];
  unresolved: string[];
}

function fold(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s: string, max: number): string {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseWaitMinutes(q: string): number {
  const h = q.match(/(\d+(?:[.,]\d+)?)\s*(h|hora|horas)\b/);
  if (h) return Math.round(parseFloat(h[1].replace(',', '.')) * 60);
  const d = q.match(/(\d+)\s*(dia|dias)\b/);
  if (d) return parseInt(d[1], 10) * 1440;
  const m = q.match(/(\d+)\s*(min|minuto|minutos)\b/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

/**
 * Aplica uma instrução pontual sobre o plano. Se nada for reconhecido,
 * `ok=false` e o plano original permanece (nunca destrói sem entender).
 */
export function refinePlan(
  plan: AiPlan,
  instruction: string,
  ctx: AiTenantContext,
): RefineResult {
  const raw = String(instruction || '').trim().slice(0, 500);
  const q = fold(raw);
  const errors: string[] = [];
  const changes: string[] = [];
  const unresolved: string[] = [];
  if (!raw) return { ok: false, plan, changes, errors: ['escreva o que ajustar'], unresolved };
  if (!q) return { ok: false, plan, changes, errors: ['instrução vazia'], unresolved };

  // Recusa injeção — mesma política do planner.
  if (/\beval\s*\(|\bfunction\s*\(|\bdrop\s+table|__proto__|constructor\[/.test(q)) {
    return { ok: false, plan, changes, errors: ['a instrução contém trecho que não pode ser interpretado'], unresolved };
  }

  const next: AiPlan = {
    ...plan,
    steps: plan.steps.map((s) => ({ ...s, action: s.action ? { ...s.action, params: { ...s.action.params } } : undefined })),
    elseSteps: plan.elseSteps.map((s) => ({ ...s, action: s.action ? { ...s.action, params: { ...s.action.params } } : undefined })),
    assumptions: [...(plan.assumptions || [])],
    unresolved: [...(plan.unresolved || [])],
  };

  let matched = false;

  // ── renomear ──
  const rename = raw.match(/(?:mude|renomeie|coloque o nome|nome (?:para|de))\s+(?:o nome\s+)?(?:para|:)\s+(.+)/i);
  if (rename) {
    next.name = clip(rename[1], AI_NAME_MAX);
    changes.push(`Nome → "${next.name}"`);
    matched = true;
  }

  // ── descrição ──
  const desc = raw.match(/(?:descri[cç][aã]o|descreva)\s+(?:para|:)?\s+(.+)/i);
  if (desc) {
    next.description = clip(desc[1], AI_DESCRIPTION_MAX);
    changes.push('Descrição atualizada');
    matched = true;
  }

  // ── remover passos ──
  if (/\b(remov|apag|exclu|tir)\w*\b/.test(q) && /\b(tarefa|espera|esperar|etapa|atribui|mensagem|passo)/.test(q)) {
    if (/\btarefa\b/.test(q)) {
      const before = next.steps.length;
      next.steps = next.steps.filter((s) => s.action?.type !== 'create_task');
      if (next.steps.length !== before) { changes.push('Removi a tarefa'); matched = true; }
    }
    if (/\besper/.test(q)) {
      const before = next.steps.length;
      next.steps = next.steps.filter((s) => s.kind !== 'wait');
      if (next.steps.length !== before) { changes.push('Removi a espera'); matched = true; }
    }
    if (/\bmensagem|whatsapp|avis/.test(q)) {
      const before = next.steps.length;
      next.steps = next.steps.filter((s) => s.action?.type !== 'send_channel_message');
      if (next.steps.length !== before) { changes.push('Removi a mensagem'); matched = true; }
    }
  }

  // ── espera ──
  if (/\besper|depois de|apos|atras|aguarde/.test(q)) {
    const minutes = parseWaitMinutes(q);
    if (minutes > 0 && minutes <= ctx.limits.maxWaitMinutes) {
      const waitStep: AiPlanStep = {
        kind: 'wait',
        label: `Esperar ${minutes >= 1440 ? `${minutes / 1440} dia(s)` : minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}`,
        wait: { mode: 'duration', minutes },
      };
      // Espera no topo (antes das ações) — padrão das receitas.
      const hasWait = next.steps.findIndex((s) => s.kind === 'wait');
      if (hasWait >= 0) {
        next.steps[hasWait] = waitStep;
        changes.push(`Espera ajustada para ${minutes} min no início`);
      } else {
        next.steps.unshift(waitStep);
        changes.push(`Adicionei espera de ${minutes} min antes das ações`);
      }
      matched = true;
    } else if (!minutes) {
      unresolved.push('não entendi o tempo da espera (ex.: "espere 3 horas")');
      matched = true;
    }
  }

  // ── etapa do lead ──
  if (eventIsLead(next) && /\betapa\b|mude (o )?lead para|mova para/.test(q)) {
    const phrase = extractStagePhrase(raw);
    const stageId = resolveStageAlias(phrase, ctx.stages)
      || ctx.stages.find((s) => fold(s.name) === fold(phrase))?.id
      || '';
    if (stageId) {
      const stage = ctx.stages.find((s) => s.id === stageId)!;
      const existing = next.steps.find((s) => s.action?.type === 'change_lead_stage');
      if (existing?.action) {
        existing.action.params.stageId = stageId;
        existing.label = `Mover para "${stage.name}"`;
        changes.push(`Etapa → "${stage.name}"`);
      } else {
        next.steps.unshift({
          kind: 'action',
          label: `Mover para "${stage.name}"`,
          action: { type: 'change_lead_stage', params: { stageId, note: 'Ajustado por edição conversacional' } },
        });
        changes.push(`Adicionei movimento de etapa para "${stage.name}"`);
      }
      matched = true;
    } else if (phrase) {
      unresolved.push(`a etapa "${phrase}" não existe nesta esteira`);
      matched = true;
    }
  }

  // ── criar tarefa se não houver ──
  if (/\b(crie|adicione|coloque)\b.{0,30}\btarefa\b/.test(q) && !next.steps.some((s) => s.action?.type === 'create_task')) {
    const titleM = raw.match(/tarefa(?:\s+para|\s+:|:)\s+(.+)/i);
    const title = clip(titleM?.[1] || 'Contatar cliente', 140);
    next.steps.push({
      kind: 'action',
      label: `Criar tarefa: "${title}"`,
      action: { type: 'create_task', params: { title, note: 'Criado por edição conversacional (simulado até publicar)', dueInMinutes: 1440 } },
    });
    changes.push(`Adicionei tarefa "${title}"`);
    matched = true;
  }

  // ── mensagem se não houver ──
  if (/\b(envie|mande|mandar|enviar|mensagem|whatsapp)\b/.test(q) && !next.steps.some((s) => s.action?.type === 'send_channel_message')) {
    const msgM = raw.match(/mensagem(?:\s+(?:diga|dizendo|com))?[:\s]+(.+)/i);
    const message = clip(
      msgM?.[1] || 'Olá! Passando para avisar que temos novidade no seu agendamento. Responda por aqui se precisar.',
      500,
    );
    next.steps.push({
      kind: 'action',
      label: 'Enviar mensagem',
      action: { type: 'send_channel_message', params: { channel: 'whatsapp', message } },
    });
    changes.push('Adicionei mensagem no WhatsApp (enfileirada só após ativar + canal)');
    matched = true;
  }

  // ── gatilho: pedir para trocar o "quando" ⇒ instrução completa demais ──
  if (/^\s*quando\b/.test(q) && !matched) {
    return {
      ok: false,
      plan,
      changes,
      errors: ['para trocar o gatilho, use "Gerar novamente" com a frase completa (ex.: "Quando uma consulta for cancelada…")'],
      unresolved,
    };
  }

  if (!matched) {
    return {
      ok: false,
      plan,
      changes,
      errors: ['não entendi o ajuste — tente algo pontual como "espere 3 horas", "mude a etapa para qualificado" ou "remova a tarefa"'],
      unresolved,
    };
  }

  next.unresolved = unresolved;
  return { ok: true, plan: next, changes, errors, unresolved };
}

function eventIsLead(plan: AiPlan): boolean {
  return String(plan.event || '').startsWith('lead.');
}

function extractStagePhrase(raw: string): string {
  const m = raw.match(/etapa(?:\s+(?:para|:)|:|)\s+(.+)/i)
    || raw.match(/mova(?:-se)?\s+para\s+(.+)/i)
    || raw.match(/mude(?:-me)?\s+para\s+(.+)/i);
  if (!m) return '';
  return m[1]
    .replace(/[.!?].*$/, '')
    .replace(/\s+e\s+(crie|adicione|mova|atribua|espere).*$/i, '')
    .trim();
}
