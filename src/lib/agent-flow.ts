// ═══════════════════════════════════════════════════════════════
// ASSISTENTE × AGENDA — fluxo de agendamento conduzido pelo agente
// ═══════════════════════════════════════════════════════════════
// O assistente vira secretária operacional usando EXATAMENTE as regras da
// Agenda (lib/slots.ts): identifica serviço → identifica data → consulta
// disponibilidade REAL → verifica profissionais elegíveis → oferece horários
// → cliente escolhe → cria Booking (lib/booking-create.ts, o mesmo caminho da
// página/painel) → CRM registra → confirmação. Nenhum mecanismo paralelo.
//
// Cliente pelo WhatsApp (§13): número já existente → recupera o contato e
// NÃO pergunta o nome de novo; número novo → pergunta nome, cria o contato e
// segue o atendimento — sem exigir cadastro completo.
//
// Este módulo é PURO (planeja; quem executa a escrita é a rota/API).
import type { Business, DB, Service } from './types';
import { computeSlots } from './slots';
import { isFeatureEnabled } from './features';
import { priceVisible } from './pricing';
import { addDaysISO, effectiveTimezone, isValidDateISO, nowHM, todayISO, weekdayOf, humanDay } from './tz';
import { onlyDigits } from './utils';
import { effectiveHorizonDays } from './booking-ops';

export type AgentFlowStep = 'idle' | 'pick_service' | 'pick_slot' | 'confirm' | 'identify';

export interface AgentFlowState {
  step: AgentFlowStep;
  serviceId?: string;
  date?: string;
  time?: string;
  name?: string;
  phone?: string;
}

export interface FlowAction {
  label: string;
  target: string; // 'flow' para ações com payload
  payload?: Record<string, any>;
}

export interface FlowReply {
  reply: string;
  actions: FlowAction[];
  intent: string;
  flow: AgentFlowState | null;
  /** Presente quando tudo está pronto para CRIAR o agendamento (rota executa). */
  bookingRequest?: {
    serviceId: string;
    date: string;
    time: string;
    customer: { id: string; name: string; phone: string; email?: string } | null;
    name: string;
    phone: string;
  };
  handoff?: boolean;
}

export interface FlowContext {
  /** Conta do cliente logada no site (quando existir). */
  customer?: { id: string; name: string; phone: string; email?: string } | null;
  /** Telefone do canal (WhatsApp) — o contato é identificado por ele. */
  channelPhone?: string;
  /** Nome já conhecido do contato (WhatsApp profile / CRM). */
  channelName?: string;
}

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ── Data em linguagem natural (pt-BR) ────────────────────────
const WEEKDAYS: Array<[string[], number]> = [
  [['domingo', 'dom'], 0],
  [['segunda', 'seg'], 1], // "segunda-feira" contém "segunda"
  [['terca', 'ter'], 2],
  [['quarta', 'qua'], 3],
  [['quinta', 'qui'], 4],
  [['sexta', 'sex'], 5],
  [['sabado', 'sab'], 6],
];

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Extrai uma data de frase simples: "hoje", "amanhã", "sexta",
 * "sexta-feira", "dia 20", "20/09", "20 de setembro". Sem data → null.
 * Dia da semana refere-se à PRÓXIMA ocorrência (incluindo hoje).
 */
export function parseWhenPhrase(text: string, today = todayISO()): string | null {
  const q = norm(text);
  if (!q.trim()) return null;
  if (/\bhoje\b/.test(q)) return today;
  if (/\bamanha\b/.test(q)) return addDaysISO(today, 1);
  if (/depois de amanha/.test(q)) return addDaysISO(today, 2);

  // "dia 20" / "dia 20 de setembro"
  const dayMonthName = q.match(/dia\s+(\d{1,2})(?:\s+de\s+([a-z]+))?/);
  if (dayMonthName) {
    const day = Number(dayMonthName[1]);
    const monthIdx = dayMonthName[2] ? MONTHS.findIndex((m) => m.startsWith(dayMonthName[2].slice(0, 4))) : -1;
    const year = Number(today.slice(0, 4));
    if (monthIdx >= 0) {
      const iso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isValidDateISO(iso)) return iso >= today ? iso : addDaysISO(iso, 365); // mês passado → ano que vem
    }
    // Só "dia 20": procura nos próximos 60 dias.
    for (let i = 0; i < 60; i++) {
      const iso = addDaysISO(today, i);
      if (Number(iso.slice(8)) === day) return iso;
    }
  }

  // "20/09" (com ano opcional)
  const dm = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    const year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4));
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isValidDateISO(iso)) return iso >= today ? iso : addDaysISO(iso, 365);
  }

  // dia da semana
  for (const [words, dow] of WEEKDAYS) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(q))) {
      for (let i = 0; i < 8; i++) {
        const iso = addDaysISO(today, i);
        if (weekdayOf(iso) === dow) return iso;
      }
    }
  }
  return null;
}

/** Detecta intenção de agendar/marcar horário na mensagem. */
export function wantsToBook(text: string): boolean {
  const q = norm(text);
  return /\b(marcar|agendar|agenda|marcacao|reservar|reserva|horario|vaga|remarcar|fazer|gostaria de|queria|quero)\b/.test(q);
}

/** Serviço mencionado na mensagem (match por palavras do nome). */
export function matchService(services: Service[], text: string): Service | null {
  const q = norm(text);
  let best: Service | null = null;
  let bestLen = 0;
  for (const s of services) {
    const words = norm(s.name).split(/[\s+/]+/).filter((w) => w.length > 3);
    // Qualquer palavra longa do nome citada conta; prefere o serviço com MAIS
    // palavras casadas (limpeza de pele > pele).
    const hits = words.filter((w) => q.includes(w)).length;
    if (hits > 0 && words.length > 0 && hits >= Math.min(1, words.length) && hits > bestLen) {
      best = s;
      bestLen = hits;
    }
  }
  return best;
}

// ── Consulta de disponibilidade (mesmo motor da Agenda) ──────

interface SlotView { date: string; slots: string[]; closed: boolean }

function slotsFor(db: DB, business: Business, service: Service, date: string, today: string): SlotView {
  const cfg = business.booking;
  const r = computeSlots({
    rules: db.availability.filter((a) => a.businessId === business.id),
    exceptions: db.exceptions.filter((e) => e.businessId === business.id),
    bookings: db.bookings.filter((b) => b.businessId === business.id),
    services: db.services.filter((s) => s.businessId === business.id),
    professionals: db.professionals.filter((p) => p.businessId === business.id),
    dateISO: date,
    weekday: weekdayOf(date),
    serviceId: service.id,
    durationMin: service.durationMin,
    professionalId: '',
    eligibleProIds: service.professionalIds || [],
    // A2-B5 (F9): fuso do NEGÓCIO (nunca fixo, nunca o do navegador).
    nowHM: date === today ? nowHM(new Date(), effectiveTimezone(business.businessTimezone)) : '',
    leadMin: cfg?.leadMin || 0,
    bufferMin: cfg?.bufferMin || 0,
  });
  return { date, slots: r.slots, closed: r.closed || r.slots.length === 0 };
}

/** Próximos dias (até 7) com horário livre para o serviço. */
function nextOpenDays(db: DB, business: Business, service: Service, from: string, today: string): Array<{ date: string; free: number }> {
  const out: Array<{ date: string; free: number }> = [];
  // Recorte do chat: mostra no máx. 14 dias, sempre dentro do horizonte real.
  const horizon = Math.min(14, effectiveHorizonDays(business.booking));
  for (let i = 0; i < horizon && out.length < 4; i++) {
    const date = addDaysISO(from, i);
    if (date < today) continue;
    const view = slotsFor(db, business, service, date, today);
    if (view.slots.length > 0) out.push({ date, free: view.slots.length });
  }
  return out;
}

function serviceName(db: DB, id?: string): string {
  if (!id) return '';
  return db.services.find((s) => s.id === id)?.name || '';
}

// ── Ações de fluxo (payload → o chat envia de volta para a API) ──
function slotActions(flow: AgentFlowState, slots: string[]): FlowAction[] {
  return slots.slice(0, 6).map((t) => ({
    label: t,
    target: 'flow',
    payload: { kind: 'slot', time: t, serviceId: flow.serviceId, date: flow.date },
  }));
}

function dayActions(serviceId: string, days: Array<{ date: string }>): FlowAction[] {
  return days.map((d) => ({
    label: humanDay(d.date),
    target: 'flow',
    payload: { kind: 'day', date: d.date, serviceId },
  }));
}

// ── Identidade do cliente (§13 cliente novo × existente) ──────

function findContactByPhone(db: DB, businessId: string, phone: string) {
  const digits = onlyDigits(phone || '');
  if (!digits) return undefined;
  return db.contacts.find((c) => c.businessId === businessId && onlyDigits(c.phone) === digits);
}

/** Nome+telefone a partir de uma mensagem ("Maria Silva 11 98888-7777"). */
function parseNameAndPhone(text: string): { name: string; phone: string } {
  const digits = (text.match(/\d/g) || []).join('');
  const phone = digits.length >= 10 ? digits.slice(-11) : '';
  const name = text
    .replace(/[\d()\-\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return { name, phone };
}

// ── Fluxo principal ──────────────────────────────────────────

function resetFlow(): AgentFlowState | null {
  return null;
}

/**
 * Um passo do fluxo de agendamento. Recebe o estado atual (client/conversa) e
 * a mensagem (ou ação do payload) e devolve a próxima resposta + estado.
 */
export function agentFlowStep(
  db: DB,
  business: Business,
  message: string,
  opts: { flow?: AgentFlowState | null; action?: Record<string, any> | null; ctx?: FlowContext },
): FlowReply {
  const flow: AgentFlowState = opts.flow && opts.flow.step ? { ...opts.flow } : { step: 'idle' };
  const action = opts.action || null;
  // A2-B5 (F9): "hoje" do agente é no fuso do NEGÓCIO.
  const today = todayISO(new Date(), effectiveTimezone(business.businessTimezone));
  const bookingsOn = isFeatureEnabled(business, 'bookings');
  const bookableServices = db.services.filter(
    (s) => s.businessId === business.id && s.active !== false && s.bookable !== false,
  );
  const wa: FlowAction = { label: 'Falar no WhatsApp', target: 'whatsapp' };

  // ── Cancelar/trocar de assunto a qualquer momento ──
  const q = norm(message || '');
  if (!action && /\b(cancelar|esquece|deixa|nao quero|outra coisa|parar)\b/.test(q) && flow.step !== 'idle') {
    return {
      reply: 'Sem problemas! Se quiser agendar depois, é só me pedir. Posso ajudar em algo mais?',
      actions: [], intent: 'flow_cancel', flow: resetFlow(),
    };
  }

  // ── Ação de botão (payload) ──
  if (action) {
    if (action.kind === 'service' && typeof action.serviceId === 'string') {
      const svc = bookableServices.find((s) => s.id === action.serviceId);
      if (!svc) return { reply: 'Esse serviço não está disponível agora.', actions: [], intent: 'flow_invalid', flow: resetFlow() };
      return offerSlots(db, business, svc, today, { step: 'pick_slot', serviceId: svc.id });
    }
    if (action.kind === 'day' && typeof action.date === 'string' && typeof action.serviceId === 'string') {
      const svc = bookableServices.find((s) => s.id === action.serviceId);
      if (!svc) return { reply: 'Esse serviço não está disponível agora.', actions: [], intent: 'flow_invalid', flow: resetFlow() };
      const st: AgentFlowState = { step: 'pick_slot', serviceId: svc.id, date: action.date };
      return offerSlots(db, business, svc, today, st);
    }
    if (action.kind === 'slot' && typeof action.time === 'string') {
      const st: AgentFlowState = {
        step: 'confirm',
        serviceId: String(action.serviceId || flow.serviceId || ''),
        date: String(action.date || flow.date || ''),
        time: String(action.time || ''),
      };
      return askConfirm(db, business, st, opts.ctx || {});
    }
    if (action.kind === 'confirm') {
      return collectIdentity(db, business, { ...flow, step: 'identify' }, opts.ctx || {});
    }
    if (action.kind === 'other_times' && flow.serviceId) {
      const svc = bookableServices.find((s) => s.id === flow.serviceId);
      if (!svc) return { reply: 'Vamos recomeçar: qual serviço você quer?', actions: [], intent: 'flow_invalid', flow: resetFlow() };
      const days = nextOpenDays(db, business, svc, addDaysISO(today, 1), today);
      if (days.length === 0) {
        return {
          reply: `Não achei horários livres em breve para ${svc.name}. Pode me dizer outro dia ou falar com a equipe?`,
          actions: [wa], intent: 'flow_no_slots', flow: resetFlow(), handoff: true,
        };
      }
      return {
        reply: `Claro! Esses dias têm horário livre para ${svc.name}:`,
        actions: dayActions(svc.id, days),
        intent: 'flow_days',
        flow: { step: 'pick_slot', serviceId: svc.id },
      };
    }
  }

  // ── Estados intermediários ──
  if (flow.step === 'identify') {
    return collectIdentity(db, business, flow, opts.ctx || {}, message);
  }

  if (flow.step === 'confirm') {
    const yes = /\b(sim|isso|confirmo|pode|fechar|quero|manda|ok|certo|com certeza|beleza|perfeito|isso mesmo)\b/.test(q);
    const no = /\b(nao|errado|mudar|trocar|outro|outra)\b/.test(q);
    if (yes) return collectIdentity(db, business, { ...flow, step: 'identify' }, opts.ctx || {});
    if (no) {
      const svc = bookableServices.find((s) => s.id === flow.serviceId);
      if (svc) return offerSlots(db, business, svc, today, { step: 'pick_slot', serviceId: svc.id });
    }
  }

  if (flow.step === 'pick_slot' && !action) {
    // O cliente pode digitar um horário ("14:00") ou outro dia ("sexta").
    const timeMatch = (message || '').match(/\b(\d{1,2})[:h](\d{2})\b/);
    const svc = bookableServices.find((s) => s.id === flow.serviceId);
    if (svc && timeMatch) {
      const time = `${String(Number(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`;
      const date = flow.date || nextOpenDays(db, business, svc, today, today)[0]?.date || '';
      if (!date) {
        return { reply: 'Que dia você prefere?', actions: [], intent: 'flow_ask_day', flow };
      }
      if (opts.ctx?.channelPhone) {
        return collectIdentity(db, business, { step: 'confirm', serviceId: svc.id, date, time }, opts.ctx || {});
      }
      return askConfirm(db, business, { step: 'confirm', serviceId: svc.id, date, time }, opts.ctx || {});
    }
    const when = parseWhenPhrase(message || '', today);
    if (svc && when) {
      return offerSlots(db, business, svc, today, { step: 'pick_slot', serviceId: svc.id, date: when });
    }
    // Qualquer outra coisa no meio do fluxo: re-oferece os horários do dia.
    if (svc && flow.date) {
      return offerSlots(db, business, svc, today, { step: 'pick_slot', serviceId: svc.id, date: flow.date });
    }
  }

  if (flow.step === 'pick_service' && !action) {
    const svc = matchService(bookableServices, message || '');
    if (svc) return offerSlots(db, business, svc, today, { step: 'pick_slot', serviceId: svc.id });
  }

  // ── Início do fluxo: intenção de agendar ──
  if (!action && wantsToBook(message || '')) {
    if (!bookingsOn || bookableServices.length === 0) {
      return {
        reply: 'Aqui o atendimento é direto com a equipe — chama no WhatsApp que eles te ajudam agora!',
        actions: [wa], intent: 'booking_unavailable', flow: resetFlow(), handoff: true,
      };
    }
    const mentioned = matchService(bookableServices, message || '');
    const svc = mentioned || (bookableServices.length === 1 ? bookableServices[0] : null);
    if (!svc) {
      return {
        reply: 'Claro! Qual serviço você quer agendar?',
        actions: bookableServices.slice(0, 6).map((s) => ({
          label: s.name,
          target: 'flow',
          payload: { kind: 'service', serviceId: s.id },
        })),
        intent: 'flow_pick_service',
        flow: { step: 'pick_service' },
      };
    }
    const when = parseWhenPhrase(message || '', today);
    if (!when && opts.ctx?.channelPhone) {
      return {
        reply: `Claro! Para qual data ou dia você gostaria de agendar ${svc.name}?`,
        actions: [],
        intent: 'flow_ask_day',
        flow: { step: 'pick_slot', serviceId: svc.id },
      };
    }
    return offerSlots(db, business, svc, today, { step: 'pick_slot', serviceId: svc.id, date: when || undefined });
  }

  // Nenhuma intenção de fluxo — deixa o motor geral responder.
  return { reply: '', actions: [], intent: '', flow: flow.step === 'idle' ? null : flow };
}

// ── Passos internos ──────────────────────────────────────────

function offerSlots(
  db: DB, business: Business, svc: Service, today: string, state: AgentFlowState,
): FlowReply {
  const wa: FlowAction = { label: 'Falar no WhatsApp', target: 'whatsapp' };
  const date = state.date || nextOpenDays(db, business, svc, today, today)[0]?.date || '';
  if (!date) {
    const days = nextOpenDays(db, business, svc, addDaysISO(today, 1), today);
    if (days.length === 0) {
      return {
        reply: `Não encontrei horários livres para ${svc.name} nos próximos dias. Quer falar com a equipe para encontrar um horário?`,
        actions: [wa], intent: 'flow_no_slots', flow: null, handoff: true,
      };
    }
    return {
      reply: `Esses dias têm horário livre para ${svc.name}:`,
      actions: dayActions(svc.id, days),
      intent: 'flow_days',
      flow: { step: 'pick_slot', serviceId: svc.id },
    };
  }
  const view = slotsFor(db, business, svc, date, today);
  if (view.slots.length === 0) {
    const days = nextOpenDays(db, business, svc, addDaysISO(date, 1), today);
    const base = `Não tenho horário livre em ${humanDay(date, today)} para ${svc.name}.`;
    if (days.length === 0) {
      return { reply: `${base} Quer falar com a equipe?`, actions: [wa], intent: 'flow_no_slots', flow: null, handoff: true };
    }
    return {
      reply: `${base} Esses dias estão livres:`,
      actions: dayActions(svc.id, days),
      intent: 'flow_days',
      flow: { step: 'pick_slot', serviceId: svc.id },
    };
  }
  const price = svc.showPrice !== false ? ` (valor ${moneyBRL(svc.price)})` : '';
  const slotList = view.slots.slice(0, 6).join(', ');
  const slotsText = slotList ? `: ${slotList}. Qual horário você prefere?` : '.';
  return {
    reply: `${svc.name}${price} — horários livres em ${humanDay(date, today)}${slotsText}`,
    actions: [
      ...slotActions({ ...state, date }, view.slots),
      { label: 'Outros dias', target: 'flow', payload: { kind: 'other_times', serviceId: svc.id, date } },
    ],
    intent: 'flow_slots',
    flow: { ...state, step: 'pick_slot', date },
  };
}

function moneyBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function askConfirm(db: DB, business: Business, state: AgentFlowState, ctx: FlowContext): FlowReply {
  const svc = serviceName(db, state.serviceId);
  const price = priceNoteFor(db, state.serviceId);
  return {
    reply: `Fechado assim: ${svc}${price} em ${humanDay(state.date || '', todayISO())} às ${state.time}. Confirma?`,
    actions: [
      { label: 'Sim, confirmar', target: 'flow', payload: { kind: 'confirm' } },
      { label: 'Ver outros horários', target: 'flow', payload: { kind: 'other_times', serviceId: state.serviceId, date: state.date } },
    ],
    intent: 'flow_confirm',
    flow: state,
  };
}

function priceNoteFor(db: DB, serviceId?: string): string {
  const svc = db.services.find((s) => s.id === serviceId);
  if (!svc || !priceVisible(svc)) return '';
  return ` (valor ${moneyBRL(svc.price)})`;
}

/**
 * Identidade: quem já é conhecido (conta no site ou telefone no CRM/WhatsApp)
 * vai direto para a criação; cliente novo informa nome (e WhatsApp no site).
 */
function collectIdentity(
  db: DB, business: Business, state: AgentFlowState, ctx: FlowContext, message?: string,
): FlowReply {
  const svc = db.services.find((s) => s.id === state.serviceId);

  // 1) Conta logada (site): dados da conta, nada é perguntado.
  if (ctx.customer?.phone) {
    return bookingReadyReply(state, {
      id: ctx.customer.id, name: ctx.customer.name, phone: ctx.customer.phone, email: ctx.customer.email,
    });
  }

  // 2) Canal WhatsApp: telefone já conhecido. Contato existente com nome →
  //    reutiliza (não pergunta de novo). Sem nome → pergunta UMA vez.
  if (ctx.channelPhone) {
    const contact = findContactByPhone(db, business.id, ctx.channelPhone);
    const known = (contact?.name || ctx.channelName || '').trim();
    if (known) {
      return bookingReadyReply(state, null, known, ctx.channelPhone);
    }
    if (message) {
      const name = (message || '').replace(/\d/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (name.length >= 2) {
        return bookingReadyReply(state, null, name, ctx.channelPhone);
      }
    }
    return {
      reply: 'Perfeito! Só me diz seu nome completo para registrar o agendamento:',
      actions: [], intent: 'flow_ask_name', flow: { ...state, step: 'identify' },
    };
  }

  // 3) Site sem login: precisa de nome + WhatsApp (conta NÃO é obrigatória).
  if (message) {
    const { name, phone } = parseNameAndPhone(message);
    if (name.length >= 2 && onlyDigits(phone).length >= 10) {
      return bookingReadyReply(state, null, name, onlyDigits(phone));
    }
  }
  return {
    reply: 'Quase lá! Me diz seu nome e seu WhatsApp (com DDD) para confirmar o horário — sem precisar criar conta:',
    actions: [], intent: 'flow_ask_identity', flow: { ...state, step: 'identify' },
  };
}

function bookingReadyReply(
  state: AgentFlowState,
  customer: { id: string; name: string; phone: string; email?: string } | null,
  fallbackName = '',
  fallbackPhone = '',
): FlowReply {
  const name = customer?.name || fallbackName;
  const phone = customer?.phone || fallbackPhone;
  return {
    reply: '',
    actions: [],
    intent: 'booking_create',
    flow: null,
    bookingRequest: {
      serviceId: String(state.serviceId || ''),
      date: String(state.date || ''),
      time: String(state.time || ''),
      customer: customer || null,
      name,
      phone,
    },
  };
}

/** Resposta de confirmação pós-criação (a rota chama com o resultado real). */
export function bookingDoneReply(
  businessName: string,
  result: { date: string; time: string; serviceName: string; professionalName: string },
): { reply: string; intent: string } {
  const pro = result.professionalName ? ` com ${result.professionalName}` : '';
  return {
    reply: `Agendado! ${result.serviceName} em ${humanDay(result.date)} às ${result.time}${pro}. A ${businessName} confirma por aqui em instantes — se precisar mudar algo, é só me chamar.`,
    intent: 'booking_created',
  };
}
