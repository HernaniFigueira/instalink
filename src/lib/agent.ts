// ═══════════════════════════════════════════════════════════════
// AGENTE DE ATENDIMENTO — configuração por empresa (universal)
// ═══════════════════════════════════════════════════════════════
// O agente NÃO é "um botão concierge": é um assistente configurável que usa
// o conhecimento REAL da empresa (nome, descrição, serviços, preços públicos,
// duração, horários, localização, FAQ, "Sobre" e orientações do negócio).
//
// Limites explícitos (regra do produto):
//   • nunca cria, cancela ou remarca agendamento sozinho;
//   • nunca promete condições que não estão nos dados;
//   • quando não sabe, encaminha para atendimento humano (WhatsApp/equipe).
import type {
  AgentObjective, AgentTone, BusinessAgent, Business, DB, Service,
} from './types';
import { VALID_AGENT_OBJECTIVES, VALID_AGENT_TONES } from './types';
import { scheduleSummary } from './hours';

export const TONE_OPTIONS: Array<{ id: AgentTone; label: string; hint: string }> = [
  { id: 'profissional', label: 'Profissional', hint: 'Formal, direto e confiável' },
  { id: 'acolhedor', label: 'Acolhedor', hint: 'Caloroso, próximo e humano' },
  { id: 'objetivo', label: 'Objetivo', hint: 'Curto, sem rodeios' },
  { id: 'comercial', label: 'Comercial', hint: 'Destaca valor e convida a agir' },
];

export const OBJECTIVE_OPTIONS: Array<{ id: AgentObjective; label: string }> = [
  { id: 'duvidas', label: 'Tirar dúvidas' },
  { id: 'servicos', label: 'Apresentar serviços' },
  { id: 'escolher_servico', label: 'Ajudar a escolher um serviço' },
  { id: 'orientar_agendamento', label: 'Orientar sobre agendamento' },
  { id: 'whatsapp', label: 'Direcionar para o WhatsApp' },
  { id: 'interesse', label: 'Captar interesse (lead)' },
];

export function defaultAgent(businessId: string, businessName = ''): BusinessAgent {
  const now = new Date().toISOString();
  return {
    id: `agent-${businessId}`,
    businessId,
    name: businessName ? `Assistente ${businessName}` : 'Assistente virtual',
    enabled: true,
    greeting: 'Olá! Sou o assistente virtual{empresa}. Como posso ajudar?',
    tone: 'acolhedor',
    objectives: ['duvidas', 'servicos', 'orientar_agendamento'],
    instructions: '',
    restrictions: '',
    handoffMessage: 'Vou te encaminhar para a nossa equipe no WhatsApp — eles ajudam você agora mesmo.',
    knowledgeOverride: '',
    channels: { site: true, whatsapp: false },
    createdAt: now,
    updatedAt: now,
  };
}

/** Agente da empresa (cria um padrão em memória quando ainda não existe). */
export function agentFor(db: DB, business: Business): BusinessAgent {
  const found = db.agents.find((a) => a.businessId === business.id);
  const base = defaultAgent(business.id, business.name);
  if (!found) return base;
  return {
    ...base,
    ...found,
    objectives: Array.isArray(found.objectives)
      ? found.objectives.filter((o) => VALID_AGENT_OBJECTIVES.includes(o))
      : base.objectives,
    tone: VALID_AGENT_TONES.includes(found.tone) ? found.tone : base.tone,
    channels: { site: found.channels?.site !== false, whatsapp: found.channels?.whatsapp === true },
  };
}

/** Agente entra em ação na página pública? (módulo + agente ativo + canal site) */
export function agentActive(
  business: Pick<Business, 'id' | 'features' | 'modes'>,
  agent: Pick<BusinessAgent, 'enabled' | 'channels'>,
  channel: 'site' | 'whatsapp' = 'site',
): boolean {
  const moduleOn = business.features?.agent === true;
  return moduleOn && agent.enabled === true && (channel === 'whatsapp' ? agent.channels?.whatsapp === true : agent.channels?.site !== false);
}

// ── Conhecimento real disponível para o agente ───────────────
export interface AgentKnowledge {
  businessName: string;
  description: string;
  services: Array<{ name: string; price: number; durationMin: number; bookable: boolean; pricePublic: boolean }>;
  professionals: Array<{ name: string; role: string }>;
  hours: string;
  address: string;
  faq: Array<{ q: string; a: string }>;
  about: string;
  extra: Array<{ topic: string; answer: string }>;
}

export function parseKnowledgeOverride(text: string): Array<{ topic: string; answer: string }> {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':');
      if (i <= 0) return { topic: line, answer: line };
      return { topic: line.slice(0, i).trim(), answer: line.slice(i + 1).trim() };
    })
    .filter((x) => x.topic.length > 0);
}

export function buildKnowledge(
  db: DB,
  business: Business,
  opts: { faq?: Array<{ q: string; a: string }> } = {},
): AgentKnowledge {
  const services: Service[] = db.services.filter((s) => s.businessId === business.id && s.active !== false);
  // A2-B5 (F3): horário de atendimento pela MESMA fonte da Agenda
  // (Availability; fallback: horário cadastrado) — nada de Business.hours
  // como regra paralela.
  const hoursSummary = scheduleSummary(
    business,
    (db.availability || []).filter((a) => a.businessId === business.id),
  );
  const agent = db.agents.find((a) => a.businessId === business.id);
  const professionals = (db.professionals || []).filter(
    (p) => p.businessId === business.id && p.active !== false,
  );
  return {
    businessName: business.name,
    description: business.description || '',
    services: services.map((s) => ({
      name: s.name,
      price: s.price,
      durationMin: s.durationMin,
      bookable: s.bookable !== false,
      // Preço só é informação pública quando o serviço libera (showPrice).
      pricePublic: s.showPrice !== false,
    })),
    professionals: professionals.map((p) => ({ name: p.name, role: p.role || '' })),
    hours: hoursSummary,
    address: business.address || '',
    faq: (opts.faq || []).filter((f) => (f.q || '').trim()),
    about: [business.about?.title, business.about?.text].filter(Boolean).join(' — '),
    extra: parseKnowledgeOverride(agent?.knowledgeOverride || ''),
  };
}

/**
 * Composição de resposta do agente: aplica tom, saudação configurada e
 * handoff. Função PURA — recebe o texto base do motor de regras.
 */
export function applyAgentVoice(
  agent: BusinessAgent,
  businessName: string,
  reply: string,
  intent: string,
): string {
  const text = reply || '';
  if (intent === 'fallback') return `${agent.handoffMessage || text}`;
  const prefix: Record<AgentTone, string> = {
    profissional: '',
    acolhedor: '',
    objetivo: '',
    comercial: '',
  };
  const suffix: Record<AgentTone, string> = {
    profissional: '',
    acolhedor: '',
    objetivo: '',
    comercial: intent === 'greeting' || intent === 'fallback' ? '' : ' Quer que eu já te mostre como seguir?',
  };
  return `${prefix[agent.tone]}${text}${suffix[agent.tone]}`.trim();
}

/** Saudação do agente ({empresa} vira o nome do negócio; {agente} o nome dele). */
export function renderGreeting(agent: BusinessAgent, businessName: string): string {
  const base = String(agent.greeting || defaultAgent('', businessName).greeting);
  const filled = base
    .replace(/\{empresa\}/gi, businessName ? ` da ${businessName}` : '')
    .replace(/\{agente\}/gi, agent.name || 'assistente')
    .replace(/\s{2,}/g, ' ')
    .replace(/ da \s*,/g, ',')
    .trim();
  return filled || `Olá! Sou ${agent.name || 'o assistente virtual'}. Como posso ajudar?`;
}

/** Ações sugeridas conforme objetivos escolhidos (nunca oferece módulo off). */
export function objectiveActions(
  agent: BusinessAgent,
  ctx: { canBook: boolean; hasProducts: boolean; hasQuote: boolean; hasWhatsapp: boolean },
): Array<{ label: string; target: string }> {
  const out: Array<{ label: string; target: string }> = [];
  const wants = (o: AgentObjective) => (agent.objectives || []).includes(o);
  if (wants('orientar_agendamento') && ctx.canBook) out.push({ label: 'Agendar horário', target: '#agendar' });
  if (wants('servicos')) out.push({ label: 'Ver serviços', target: '#servicos' });
  if ((wants('escolher_servico') || wants('duvidas')) && ctx.hasProducts) out.push({ label: 'Ver produtos', target: '#produtos' });
  if (wants('duvidas') && ctx.hasQuote) out.push({ label: 'Pedir orçamento', target: '#orcamento' });
  if (wants('whatsapp') && ctx.hasWhatsapp) out.push({ label: 'Falar no WhatsApp', target: 'whatsapp' });
  return out;
}

// Normalização do payload de configuração (API PUT /api/agent).
export function sanitizeAgentInput(
  businessId: string,
  input: Record<string, any>,
  current: BusinessAgent,
): BusinessAgent {
  const str = (v: unknown, max: number, fallback: string) =>
    v === undefined ? fallback : String(v || '').slice(0, max);
  const objectives = Array.isArray(input.objectives)
    ? input.objectives.filter((o: unknown) => VALID_AGENT_OBJECTIVES.includes(o as AgentObjective))
    : current.objectives;
  return {
    ...current,
    businessId,
    name: str(input.name, 60, current.name).trim() || current.name,
    enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
    greeting: str(input.greeting, 400, current.greeting),
    tone: VALID_AGENT_TONES.includes(input.tone) ? input.tone : current.tone,
    objectives,
    instructions: str(input.instructions, 1500, current.instructions),
    restrictions: str(input.restrictions, 1500, current.restrictions),
    handoffMessage: str(input.handoffMessage, 400, current.handoffMessage),
    knowledgeOverride: str(input.knowledgeOverride, 3000, current.knowledgeOverride),
    channels: {
      site: input.channels?.site === undefined ? current.channels.site : input.channels.site !== false,
      // Canal WhatsApp só existe quando o módulo/conexão permitir.
      whatsapp: input.channels?.whatsapp === true,
    },
    updatedAt: new Date().toISOString(),
  };
}
