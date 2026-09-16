// ═══════════════════════════════════════════════════════════════
// P5.1 — AI PLANNER (linguagem natural → plano estruturado)
// ═══════════════════════════════════════════════════════════════
// Motor DETERMINÍSTICO (como o concierge): interpreta intenção em
// português com um vocabulário FECHADO — os mesmos gatilhos, campos e
// ações do P4. Não há LLM, não há eval, não há SQL, não há ferramenta
// arbitrária. A saída é um `AiPlan` validável; NUNCA uma Automation
// publicada.
import type { AiPlan, AiPlanStep, AutomationCondition, AutomationEventId } from '../types';
import { resolveStageAlias } from '../automation/model';
import {
  AI_DESCRIPTION_MAX, AI_NAME_MAX, cleanPrompt, emptyPlan, type AiMemberRef, type AiTenantContext,
} from './contract';

function fold(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s: string, max: number): string {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function titleCase(s: string): string {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const ORIGIN_PATTERNS: Array<{ value: string; tests: RegExp[] }> = [
  { value: 'instagram', tests: [/\binstagram\b/, /\binsta\b/] },
  { value: 'whatsapp', tests: [/\bwhatsapp\b/, /\bwpp\b/, /\bzap\b/] },
  { value: 'formulario', tests: [/\bformulario\b/, /\bformulario\b/, /\bformulario\b/, /\bform\b/] },
  { value: 'agendamento', tests: [/\borigem\s+(de\s+)?agendamento\b/] },
  { value: 'agente', tests: [/\bassistente\b/, /\bagente\b/] },
  { value: 'api', tests: [/\bapi\s+externa\b/, /\bvia\s+api\b/] },
  { value: 'landing_page', tests: [/\blanding\b/] },
];

const TRIGGER_PATTERNS: Array<{ event: AutomationEventId; tests: RegExp[] }> = [
  { event: 'booking.cancelled', tests: [/consulta\s+(foi\s+)?cancel/, /agendamento\s+cancel/, /horario\s+cancel/, /cancelad[ao].*(consulta|agendamento|horario)/, /quando\s+.*(consulta|agendamento).{0,20}cancel/] },
  { event: 'booking.completed', tests: [/atendimento\s+conclu/, /consulta\s+conclu/, /servico\s+finaliz/, /nao voltaram/, /nao voltou/, /recuperar\s+pacientes/, /ha\s+\d+\s+mes/] },
  { event: 'booking.confirmed', tests: [/agendamento\s+confirm/, /consulta\s+confirm/] },
  { event: 'booking.created', tests: [/novo\s+agendamento/, /quando\s+(sair|nascer|criar|criar).{0,20}agendamento/, /quando\s+(um\s+)?agendamento\s+(for\s+)?cri/, /quando\s+(uma\s+)?consulta\s+(for\s+)?(cri|marc)/] },
  { event: 'lead.assigned', tests: [/lead\s+atribu/, /responsavel\s+(defin|atribu)/] },
  { event: 'lead.stage_changed', tests: [/mud(ou|ar)\s+de\s+etapa/, /troc(ou|ar)\s+de\s+etapa/, /esteira/] },
  { event: 'customer.created', tests: [/novo\s+cliente\s+(na\s+base|entrou)/, /cliente\s+entrou\s+na\s+base/] },
  { event: 'customer.updated', tests: [/cliente\s+atualiz/] },
  { event: 'lead.updated', tests: [/lead\s+atualiz/, /dados\s+do\s+lead\s+mud/] },
  { event: 'lead.created', tests: [/novo\s+lead/, /lead\s+(entrar|cheg|criad|novo)/, /cliente\s+entrar/, /quando\s+(um\s+)?(cliente|lead)\s+(entrar|cheg)/, /quando\s+chegar/, /avisar.{0,40}quando\s+chegar/, /quando\s+chegar\s+(um\s+)?lead/, /entrar\s+pelo/] },
];

const STAGE_SYNONYMS: Array<{ keys: string[]; prefer: string }> = [
  { keys: ['interessado', 'interesse', 'qualificando', 'em qualificacao'], prefer: 'qualifying' },
  { keys: ['qualificado'], prefer: 'qualified' },
  { keys: ['novo', 'entrada'], prefer: 'new' },
  { keys: ['em atendimento', 'atendimento', 'contatado'], prefer: 'in_progress' },
  { keys: ['secretaria', 'recepcao', 'aguardando secretaria'], prefer: 'waiting_secretary' },
  { keys: ['agendado', 'marcado'], prefer: 'scheduled' },
  { keys: ['concluido', 'convertido', 'ganho'], prefer: 'converted' },
  { keys: ['perdido', 'lost', 'desistiu'], prefer: 'lost' },
];

function matchTrigger(q: string): AutomationEventId | '' {
  for (const row of TRIGGER_PATTERNS) {
    if (row.tests.some((re) => re.test(q))) return row.event;
  }
  if (/\b(crie|criar|quero|monte|faz|faca)\b.{0,40}\bautomacao\b/.test(q) && !/\bquando\b/.test(q)) return '';
  if (/\blead\b/.test(q)) return 'lead.created';
  if (/\b(consulta|agendamento|horario)\b/.test(q)) return 'booking.created';
  return '';
}

function extractOrigin(q: string): string {
  for (const row of ORIGIN_PATTERNS) {
    if (row.tests.some((re) => re.test(q))) return row.value;
  }
  return '';
}

function extractInterest(raw: string, q: string): string {
  const m = q.match(/interesse(?:s)?\s+(?:em|por|de)\s+(.+)/)
    || q.match(/interessad[ao]\s+(?:em|por|de)\s+(.+)/)
    || q.match(/quer(?:em)?\s+(.+?)(?:\s*,|\s+e\s+(?:coloque|atribua|crie)|$)/);
  if (!m) return '';
  let rest = m[1];
  rest = rest.split(/,|\be\s+(?:coloque|atribua|crie|mova|defina|faca|altere)/)[0];
  rest = rest.replace(/\b(pelo|via|do|de|no)\s+(instagram|whatsapp|formulario)\b/g, '').trim();
  // Recupera a capitalização original a partir do texto cru, se possível.
  const folded = fold(rest);
  const idx = fold(raw).indexOf(folded);
  const original = idx >= 0 ? raw.slice(idx, idx + rest.length) : rest;
  return clip(original, 80);
}

function extractStagePhrase(q: string): string {
  const m = q.match(/(?:coloque|mova|mude|altere|passe)\s+(?:o\s+lead\s+)?(?:como|para|pra|a)\s+(?:a\s+etapa\s+)?["“]?([^"”,.]+)/)
    || q.match(/(?:etapa|para)\s+["“]([^"”]+)["”]/)
    || q.match(/como\s+["“]?([a-z0-9 ]{3,40})/);
  if (!m) return '';
  return clip(m[1].replace(/\be\s+(?:atribua|crie|mova).*/g, ''), 60);
}

function resolveStage(phrase: string, ctx: AiTenantContext): { id: string; assumed?: string } {
  const raw = String(phrase || '').trim();
  if (!raw) return { id: '' };
  const alias = resolveStageAlias(raw, ctx.stages);
  if (alias) return { id: alias };
  const f = fold(raw);
  const byName = ctx.stages.find((s) => fold(s.name) === f || fold(s.name).includes(f) || f.includes(fold(s.name)));
  if (byName) return { id: byName.id };
  for (const syn of STAGE_SYNONYMS) {
    if (syn.keys.some((k) => f.includes(k))) {
      const exists = ctx.stages.find((s) => s.id === syn.prefer);
      if (exists) return { id: exists.id, assumed: `"${raw}" não existe nesta esteira — usei "${exists.name}"` };
    }
  }
  return { id: '' };
}

function extractAssigneePhrase(q: string): string {
  const m = q.match(/(?:atribua|atribuir|responsavel)\s+(?:para|pra|ao|a|o)?\s*(?:a\s+|o\s+)?(.+?)(?=,|\.|$|\be\s+crie|\be\s+mova)/)
    || q.match(/para\s+(?:a\s+|o\s+)?(recepcao|secretaria|equipe)/);
  if (!m) return '';
  return clip(m[1], 60);
}

function resolveMember(phrase: string, ctx: AiTenantContext): { member?: AiMemberRef; assumed?: string; unresolved?: string } {
  const raw = String(phrase || '').trim();
  if (!raw) return {};
  const f = fold(raw).replace(/^(a|o|as|os)\s+/, '');
  if (/\brodizio\b|\bmenos ocupado\b|\bautomatic/.test(f)) return { assumed: 'distribuição em rodízio' };
  const exact = ctx.members.find((m) => fold(m.name) === f || fold(m.note || '') === f);
  if (exact) return { member: exact };
  const partial = ctx.members.find((m) => fold(m.name).includes(f) || f.includes(fold(m.name)) || fold(m.note || '').includes(f));
  if (partial) return { member: partial };
  if (/\brecep|\bsecret/.test(f)) {
    const byRole = ctx.members.find((m) => m.role === 'SECRETARIA')
      || ctx.members.find((m) => /recep|secret/.test(fold(m.name + ' ' + (m.note || ''))));
    if (byRole) return { member: byRole, assumed: `"${raw}" → ${byRole.name}` };
    return { unresolved: `não achei "${raw}" na equipe desta unidade` };
  }
  return { unresolved: `não achei "${raw}" na equipe desta unidade` };
}

function extractTaskTitle(raw: string, q: string, event: AutomationEventId): { title: string; dueInMinutes?: number } {
  let title = '';
  if (/\bligar\b/.test(q)) {
    title = event.startsWith('booking') ? 'Ligar para {{booking.customerName}}' : 'Ligar para o lead';
  } else if (/\bremarcar\b|\breposicion/.test(q)) {
    title = 'Remarcar consulta de {{booking.customerName}}';
  } else if (/\bavisar\b/.test(q) && /\brecep|\bsecret|\bequipe/.test(q)) {
    title = event.startsWith('lead')
      ? 'Avisar a recepção: novo lead {{lead.name}}'
      : 'Avisar a recepção';
  } else if (/\brecuperar\b/.test(q)) {
    title = 'Recuperar {{booking.customerName}}';
  } else {
    const m = q.match(/tarefa(?:s)?\s+(?:para\s+|de\s+)?(.+?)(?:,|\.|$)/);
    if (m) title = titleCase(clip(m[1].replace(/\bamanha\b.*$/, '').replace(/\bprazo\b.*$/, ''), 80));
  }
  if (!title) title = event.startsWith('booking') ? 'Pendência de {{booking.customerName}}' : 'Pendência: {{lead.name}}';

  let dueInMinutes: number | undefined;
  if (/\bamanha\b/.test(q)) dueInMinutes = 1440;
  const hours = q.match(/em\s+(\d+)\s+horas?/);
  if (hours) dueInMinutes = Number(hours[1]) * 60;
  const days = q.match(/em\s+(\d+)\s+dias?/);
  if (days) dueInMinutes = Number(days[1]) * 1440;
  const months = q.match(/ha\s+(\d+)\s+meses?/) || q.match(/em\s+(\d+)\s+meses?/);
  if (months && !/\bamanha\b/.test(q) && !hours && !days) {
    // prazo da tarefa, não espera — só se NÃO for o caso de recuperação (espera)
  }
  return { title: clip(title, 140), dueInMinutes };
}

function extractWait(q: string, limitsMinutes: number): { minutes?: number; assumed?: string; unresolved?: string } {
  const wantsWait = /\b(esperar|espera|aguardar|depois de|apos)\b/.test(q)
    || (/\bnao voltaram\b/.test(q) || /\brecuperar\b/.test(q) && /\bmes/.test(q));
  if (!wantsWait) return {};
  let minutes = 0;
  const months = q.match(/(\d+)\s+meses?/);
  const days = q.match(/(\d+)\s+dias?/);
  const hours = q.match(/(\d+)\s+horas?/);
  const mins = q.match(/(\d+)\s+minutos?/);
  if (months) minutes = Number(months[1]) * 30 * 1440;
  else if (days) minutes = Number(days[1]) * 1440;
  else if (hours) minutes = Number(hours[1]) * 60;
  else if (mins) minutes = Number(mins[1]);
  else if (/\bamanha\b/.test(q) && /\besper/.test(q)) minutes = 1440;
  if (!minutes) return {};
  if (minutes > limitsMinutes) {
    return { unresolved: `espera de ${minutes} min acima do limite (${limitsMinutes} min)` };
  }
  return { minutes, assumed: minutes >= 1440 ? `espera de ${Math.round(minutes / 1440)} dia(s)` : `espera de ${minutes} min` };
}

function wantsAssign(q: string): boolean {
  return /\b(atribua|atribuir|responsavel|recepcao|secretaria)\b/.test(q)
    && !/\bavisar\s+(a\s+)?(recepcao|secretaria)\b/.test(q);
}

function wantsStage(q: string): boolean {
  return /\b(coloque|mova|mude|altere|etapa|interessado|qualific)\b/.test(q);
}

function wantsTask(q: string): boolean {
  return /\b(tarefa|ligar|avisar|remarcar|pendencia|recuperar)\b/.test(q);
}

function wantsNote(q: string): boolean {
  return /\b(observacao|anote|anotar|recado)\b/.test(q);
}

function wantsPriority(q: string): string {
  if (/\bprioridade\s+urgente\b|\burgente\b/.test(q)) return 'urgent';
  if (/\bprioridade\s+alta\b|\balta prioridade\b/.test(q)) return 'high';
  if (/\bprioridade\s+baixa\b/.test(q)) return 'low';
  if (/\bprioridade\s+media\b/.test(q)) return 'medium';
  return '';
}

function buildName(event: AutomationEventId, origin: string, interest: string, steps: AiPlanStep[]): string {
  const when = event === 'lead.created' ? (origin === 'instagram' ? 'Lead do Instagram' : 'Novo lead')
    : event === 'booking.cancelled' ? 'Consulta cancelada'
    : event === 'booking.completed' ? 'Atendimento concluído'
    : event === 'booking.created' ? 'Novo agendamento'
    : event === 'booking.confirmed' ? 'Agendamento confirmado'
    : 'Automação';
  const first = steps.find((s) => s.kind === 'action');
  const then = first?.action?.type === 'change_lead_stage' ? 'qualificar'
    : first?.action?.type === 'assign_lead' ? 'atribuir'
    : first?.action?.type === 'create_task' ? 'tarefa'
    : '';
  const extra = interest ? ` · ${interest}` : '';
  return clip(`${when}${then ? ` → ${then}` : ''}${extra}`, AI_NAME_MAX) || 'Automação';
}

function andCondition(parts: AutomationCondition[]): AutomationCondition | null {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];
  return { logic: 'and', conditions: clean };
}

/**
 * Interpreta o pedido em português e devolve um plano estruturado.
 * Nunca publica, nunca toca o banco, nunca executa o texto.
 */
export function planFromPrompt(prompt: string, ctx: AiTenantContext): AiPlan {
  const raw = cleanPrompt(prompt);
  const plan = emptyPlan(raw);
  if (!raw) {
    plan.unresolved.push('descreva a automação em uma frase (quando acontecer X, faça Z)');
    return plan;
  }
  const q = fold(raw);

  // Recusa explícita de tentativas de injeção: o texto NUNCA vira código.
  if (/\beval\s*\(|\bfunction\s*\(|\bnew\s+function|\bdrop\s+table|\binsert\s+into|\bselect\s+.+\bfrom\b|\b__proto__\b|\bconstructor\s*\[/.test(q)) {
    plan.unresolved.push('o pedido contém trecho que não pode ser interpretado como automação');
    plan.confidence = 0;
    return plan;
  }

  const event = matchTrigger(q);
  if (!event) {
    plan.unresolved.push('não entendi o gatilho — diga quando isso deve acontecer (ex.: “quando um lead entrar”, “quando uma consulta for cancelada”)');
    plan.confidence = 0.15;
    plan.name = clip(raw, AI_NAME_MAX) || 'Automação';
    return plan;
  }
  plan.event = event;

  const assumptions: string[] = [];
  const unresolved: string[] = [];
  const steps: AiPlanStep[] = [];

  const origin = (event.startsWith('lead') || event.startsWith('customer')) ? extractOrigin(q) : '';
  const interest = event.startsWith('lead') ? extractInterest(raw, q) : '';
  const conds: AutomationCondition[] = [];
  if (origin) conds.push({ field: 'lead.origin', operator: 'equals', value: origin });
  if (interest) conds.push({ field: 'lead.interest', operator: 'contains', value: interest });
  plan.condition = andCondition(conds);

  // Espera (recuperação / “depois de”) vem ANTES das ações quando o pedido é temporal.
  const wait = extractWait(q, ctx.limits.maxWaitMinutes);
  const recovery = /\brecuperar\b/.test(q) || /\bnao voltaram\b/.test(q);
  if (wait.minutes && (recovery || /\besper|depois de|apos/.test(q))) {
    steps.push({
      kind: 'wait',
      label: wait.assumed || 'Esperar',
      wait: { mode: 'duration', minutes: wait.minutes },
    });
    if (wait.assumed) assumptions.push(wait.assumed);
  } else if (wait.unresolved) {
    unresolved.push(wait.unresolved);
  }

  if (wantsStage(q) && event.startsWith('lead')) {
    const phrase = extractStagePhrase(q) || (/\binteressado\b/.test(q) ? 'interessado' : '');
    const resolved = resolveStage(phrase, ctx);
    if (resolved.id) {
      const stageName = ctx.stages.find((s) => s.id === resolved.id)?.name || resolved.id;
      steps.push({
        kind: 'action',
        label: `Mover para "${stageName}"`,
        action: { type: 'change_lead_stage', params: { stageId: resolved.id, note: 'Movido pela automação gerada por IA (após aprovação)' } },
      });
      if (resolved.assumed) assumptions.push(resolved.assumed);
    } else if (phrase) {
      unresolved.push(`a etapa "${phrase}" não existe na esteira desta empresa`);
    }
  }

  if (wantsAssign(q) && event.startsWith('lead')) {
    const phrase = extractAssigneePhrase(q);
    const resolved = resolveMember(phrase, ctx);
    if (resolved.member) {
      steps.push({
        kind: 'action',
        label: `Atribuir para "${resolved.member.name}"`,
        action: {
          type: 'assign_lead',
          params: { target: 'member', userId: resolved.member.userId, note: `Atribuído para ${resolved.member.name}` },
        },
      });
      if (resolved.assumed) assumptions.push(resolved.assumed);
    } else if (resolved.assumed && !resolved.unresolved) {
      steps.push({
        kind: 'action',
        label: 'Atribuir em rodízio',
        action: { type: 'assign_lead', params: { target: 'auto', note: 'Distribuído automaticamente' } },
      });
      assumptions.push(resolved.assumed);
    } else if (resolved.unresolved) {
      unresolved.push(resolved.unresolved);
      steps.push({
        kind: 'action',
        label: 'Atribuir em rodízio',
        action: { type: 'assign_lead', params: { target: 'auto', note: 'Pessoa não encontrada — rodízio' } },
      });
      assumptions.push('sem a pessoa pedida, usei o rodízio da unidade');
    } else if (/\brecep|\bsecret/.test(q)) {
      steps.push({
        kind: 'action',
        label: 'Atribuir em rodízio',
        action: { type: 'assign_lead', params: { target: 'auto', note: 'Recepção não cadastrada — rodízio' } },
      });
      assumptions.push('não achei “recepção” na equipe — usei o rodízio');
    }
  }

  const priority = wantsPriority(q);
  if (priority && event.startsWith('lead')) {
    steps.push({
      kind: 'action',
      label: 'Atualizar prioridade',
      action: { type: 'update_lead', params: { priority } },
    });
  }

  if (wantsNote(q) && event.startsWith('lead')) {
    steps.push({
      kind: 'action',
      label: 'Adicionar observação',
      action: { type: 'add_lead_note', params: { text: 'Registrado pela automação (aprovada).' } },
    });
  }

  if (wantsTask(q)) {
    const task = extractTaskTitle(raw, q, event);
    const assignee = extractAssigneePhrase(q);
    const member = assignee ? resolveMember(assignee, ctx).member : undefined;
    const params: Record<string, any> = {
      title: task.title,
      note: clip(raw, 300),
      assignee: member ? 'member' : 'none',
    };
    if (member) params.assignedUserId = member.userId;
    if (task.dueInMinutes && !(wait.minutes && recovery)) params.dueInMinutes = task.dueInMinutes;
    else if (task.dueInMinutes && !wait.minutes) params.dueInMinutes = task.dueInMinutes;
    steps.push({
      kind: 'action',
      label: `Criar tarefa: "${task.title}"`,
      action: { type: 'create_task', params },
    });
  }

  // Pedido vago do tipo “crie uma automação” sem ação.
  if (steps.length === 0) {
    unresolved.push('não entendi o que fazer depois do gatilho — diga a ação (mover etapa, atribuir, criar tarefa…)');
  }

  if (event.startsWith('booking') && !ctx.hasBookings) {
    unresolved.push('esta empresa não tem o módulo de Agendamentos ativo');
  }

  plan.steps = steps;
  plan.assumptions = assumptions;
  plan.unresolved = unresolved;
  plan.name = buildName(event, origin, interest, steps);
  plan.description = clip(raw, AI_DESCRIPTION_MAX);
  plan.settings = { allowReentry: false, stopOnActionError: true };

  let confidence = 0.4;
  if (event) confidence += 0.25;
  if (steps.some((s) => s.kind === 'action')) confidence += 0.25;
  if (plan.condition) confidence += 0.1;
  if (unresolved.length) confidence -= 0.2;
  if (steps.length === 0) confidence = Math.min(confidence, 0.3);
  plan.confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
  return plan;
}

/** Exemplos oficiais da interface (não são templates do P4 — só inspiração). */
export const AI_PROMPT_EXAMPLES: Array<{ label: string; prompt: string }> = [
  {
    label: 'Lead do Instagram',
    prompt: 'Quando um cliente entrar pelo Instagram e demonstrar interesse em limpeza dental, coloque o lead como interessado, atribua para a recepção e crie uma tarefa para ligar amanhã.',
  },
  {
    label: 'Avisar a recepção',
    prompt: 'Quero avisar a recepção quando chegar um lead.',
  },
  {
    label: 'Consulta cancelada',
    prompt: 'Quando uma consulta for cancelada, crie uma tarefa para remarcar.',
  },
  {
    label: 'Recuperar pacientes',
    prompt: 'Quero recuperar pacientes que não voltaram há 6 meses.',
  },
];
