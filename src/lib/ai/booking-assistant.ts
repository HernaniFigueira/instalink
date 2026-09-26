// ═══════════════════════════════════════════════════════════════
// F3-E — ASSISTENTE DE AGENDAMENTO (passo-a-passo com confirmação)
// ═══════════════════════════════════════════════════════════════
// Cadeia: Conversa → BookingAssistant → callTool (Tool Registry)
//         → guards → domain service → GoDoutor
//
// Regras:
// - UX de secretária: sem JSON/trigger/webhook na conversa.
// - createBooking SÓ após confirmação explícita do paciente.
// - Conhecimento só da clínica (listServices/getClinicInfo) — nunca internet.
// - Vet: pet é o "paciente" do agendamento (petId), tutor é contato.
// - Guardrails clínicos: sem diagnóstico/orientação médica.
// - Mensagem do paciente = dado NÃO confiável (não concede permissão).
// - Sem AIProvider: fallback determinístico para datas/horários/serviços
//   óbvios; NL ambíguo → pede clarificação (não inventa).
// - Nunca grava chain-of-thought.
// ═══════════════════════════════════════════════════════════════
import { callTool } from '../agent-tools';
import type { ToolCallContext, ToolResult } from '../agent-tools';

export type BookingStep =
  | 'idle'
  | 'need_service'
  | 'need_date'
  | 'need_time'
  | 'need_person'
  | 'need_pet'
  | 'need_new_pet'
  | 'confirm'
  | 'done'
  | 'cancelled';

export interface BookingDraft {
  serviceId: string;
  serviceName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  customerName: string;
  customerPhone: string;
  professionalId?: string;
  petId?: string;
  note?: string;
}

export interface AssistantReply {
  ok: boolean;
  step: BookingStep;
  /** Mensagem amigável para o paciente/secretária (PT-BR). */
  message: string;
  /** Opções de serviço/horário para a UI (chips/botões). */
  options?: Array<{ id: string; label: string }>;
  /** Resumo do rascunho antes da confirmação. */
  draft?: Partial<BookingDraft>;
  /** Booking criado quando ok e step=done. */
  bookingId?: string;
  needsConfirm?: boolean;
  error?: string;
}

export interface BookingSession {
  step: BookingStep;
  draft: Partial<BookingDraft>;
  /** Última lista de slots servida (para validar a escolha de horário). */
  slots: string[];
  /** Pets do tutor (quando houver) para o passo need_pet. */
  pets: Array<{ id: string; name: string; label: string }>;
  /** true quando clinicType === 'veterinaria' (PET = paciente). */
  isVeterinary: boolean;
  /** Rascunho do novo pet (need_new_pet): nome + espécie mínimos. */
  newPet: { name: string; species: string };
  turn: number;
}

const MAX_TURNS = 24;

export function newBookingSession(): BookingSession {
  return {
    step: 'idle', draft: {}, slots: [], pets: [],
    isVeterinary: false, newPet: { name: '', species: '' }, turn: 0,
  };
}

// ── parsing determinístico (fallback sem LLM) ──────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const PHONE_RE = /(\d{10,13})/;

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Extrai data YYYY-MM-DD de texto livre (determinístico). */
export function parseDate(text: string, now: Date): string | null {
  const t = text.trim().toLowerCase();
  const iso = t.match(DATE_RE);
  if (iso) {
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    return null;
  }
  if (/\bhoje\b/.test(t)) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  // ã não é \w — não usar \b no fim de "amanhã"
  if (/\bamanha\b/.test(t) || t.includes('amanhã')) {
    const d = new Date(now.getTime() + 86400000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const slash = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (slash) {
    const day = Number(slash[1]);
    const mon = Number(slash[2]);
    const year = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad(mon)}-${pad(day)}`;
    }
  }
  const named = t.match(/(\d{1,2})\s*(?:de\s+)?([a-zçãéíóúâêôà]+)?/);
  if (named && named[2] && MONTHS[named[2]] !== undefined) {
    const day = Number(named[1]);
    const mon = MONTHS[named[2]];
    const year = now.getFullYear();
    const cand = `${year}-${pad(mon)}-${pad(day)}`;
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (cand < todayStr) {
      return `${year + 1}-${pad(mon)}-${pad(day)}`;
    }
    return cand;
  }
  return null;
}

/** Extrai HH:MM de texto livre. */
export function parseTime(text: string): string | null {
  const t = text.trim();
  const m = t.match(TIME_RE);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${pad(h)}:${pad(min)}`;
    }
    return null;
  }
  const hOnly = t.match(/\b(\d{1,2})\s*h\b/);
  if (hOnly) {
    const h = Number(hOnly[1]);
    if (h >= 0 && h <= 23) return `${pad(h)}:00`;
  }
  return null;
}

export function parsePhone(text: string): string | null {
  const m = text.match(PHONE_RE);
  return m ? m[1] : null;
}

/** Detecta intenção de cancelar. */
export function wantsCancel(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(cancelar|cancela|desistir|desisto|nao quero mais|não quero mais)\b/.test(t);
}

/** Detecta confirmação positiva/negativa. */
export function parseConfirm(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (/^(sim|s|confirmo|confirma|pode sim|pode ser|isso|combinado|fechado|ok|ótimo|otimo|bora)\b/.test(t)) return true;
  if (/^(nao|n|não|nego|cancela|melhor nao|melhor não|nada disso)\b/.test(t)) return false;
  return null;
}

/** Guardrail clínico: bloqueia pedido de diagnóstico/orientação médica. */
export function hitsClinicalGuardrail(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(diagnosticar|diagnóstico|receita|remedio|remédio|medicamento|posso tomar|qual remedio|qual remédio|tratamento para|minha doeu|minha dor)\b/.test(t);
}

// ── helpers sobre o Tool Registry ──────────────────────────────

function listServices(ctx: ToolCallContext): Array<{ id: string; name: string }> {
  const out = callTool('listServices', { activeOnly: true }, ctx);
  if (!out.ok || !Array.isArray(out.data)) return [];
  return out.data as Array<{ id: string; name: string }>;
}

function matchService(ctx: ToolCallContext, text: string): { id: string; name: string } | null {
  const services = listServices(ctx);
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const byId = services.find((s) => s.id === text.trim());
  if (byId) return byId;
  const byName = services.find((s) => s.name.toLowerCase() === t);
  if (byName) return byName;
  const bySub = services.find((s) => s.name.toLowerCase().includes(t) || t.includes(s.name.toLowerCase()));
  if (bySub) return bySub;
  return null;
}

function findSlots(
  ctx: ToolCallContext,
  draft: Partial<BookingDraft>,
  date: string,
): { slots: string[]; closed: boolean; closedReason?: string } {
  const out = callTool('findAvailableSlots', {
    date,
    serviceId: String(draft.serviceId || ''),
    professionalId: draft.professionalId || undefined,
  }, ctx);
  if (!out.ok || !out.data) {
    return { slots: [], closed: true, closedReason: (out as ToolResult).error || 'sem horários' };
  }
  const data = out.data as { slots: string[]; closed: boolean; closedReason?: string };
  return { slots: data.slots || [], closed: !!data.closed, closedReason: data.closedReason };
}

function serviceOptions(ctx: ToolCallContext): Array<{ id: string; label: string }> {
  return listServices(ctx).map((s) => ({ id: s.id, label: s.name }));
}

// ── máquina de estados ─────────────────────────────────────────

function askService(ctx: ToolCallContext): AssistantReply {
  const options = serviceOptions(ctx);
  if (options.length === 0) {
    return {
      ok: false,
      step: 'idle',
      message: 'Não encontrei serviços cadastrados nesta unidade. Posso ajudar com mais alguma coisa?',
      error: 'no_services',
    };
  }
  if (options.length === 1) {
    return {
      ok: true,
      step: 'need_date',
      message: `Certo! Vamos agendar **${options[0].label}**. Qual data você prefere? (ex.: 10/10 ou amanhã)`,
      options,
      draft: { serviceId: options[0].id, serviceName: options[0].label },
    };
  }
  return {
    ok: true,
    step: 'need_service',
    message: 'Olá! Qual serviço você gostaria de agendar?',
    options,
  };
}

function askDate(session: BookingSession): AssistantReply {
  session.step = 'need_date';
  return {
    ok: true,
    step: 'need_date',
    message: `Perfeito${session.draft.serviceName ? ` — ${session.draft.serviceName}` : ''}. Qual data? Pode escrever "amanhã", "10/10" ou "2026-10-10".`,
    draft: session.draft,
  };
}

function askTime(ctx: ToolCallContext, session: BookingSession, date: string): AssistantReply {
  const { slots, closed, closedReason } = findSlots(ctx, session.draft, date);
  session.slots = slots;
  if (closed || slots.length === 0) {
    session.step = 'need_date';
    return {
      ok: false,
      step: 'need_date',
      message: closed && closedReason
        ? `A clínica está fechada nessa data (${closedReason}). Outra data?`
        : 'Não há horários livres nessa data. Qual outra data você prefere?',
      draft: session.draft,
      error: 'no_slots',
    };
  }
  session.step = 'need_time';
  session.draft = { ...session.draft, date };
  const shown = slots.slice(0, 8).map((s) => ({ id: s, label: s }));
  return {
    ok: true,
    step: 'need_time',
    message: `Horários livres em ${date}: ${shown.map((s) => s.label).join(', ')}${slots.length > 8 ? '…' : ''}. Qual fica melhor?`,
    options: shown,
    draft: session.draft,
  };
}

function askPerson(session: BookingSession): AssistantReply {
  session.step = 'need_person';
  return {
    ok: true,
    step: 'need_person',
    message: 'Para quem é o agendamento? Me diga **nome e WhatsApp** (ex.: "Ana 11988887777").',
    draft: session.draft,
  };
}

/** clinicType da unidade via tool (conhecimento só da clínica). */
function detectVeterinary(ctx: ToolCallContext): boolean {
  const out = callTool('getClinicInfo', {}, ctx);
  if (!out.ok || !out.data) return false;
  const type = String((out.data as { clinicType?: string }).clinicType || '').toLowerCase();
  return type === 'veterinaria';
}

/** Resumo de confirmação com pet (quando veterinária). */
function goToConfirm(session: BookingSession): AssistantReply {
  session.step = 'confirm';
  return {
    ok: true,
    step: 'confirm',
    message: confirmationMessage(session.draft, session.pets),
    draft: session.draft,
    needsConfirm: true,
  };
}

/** Entra no cadastro mínimo do paciente (nome → espécie → createPet). */
function askNewPetName(session: BookingSession): AssistantReply {
  session.step = 'need_new_pet';
  session.newPet = { name: '', species: '' };
  const tutor = session.draft.customerName || 'o tutor';
  return {
    ok: true,
    step: 'need_new_pet',
    message: `Ainda não encontrei um pet cadastrado para ${tutor}. Vamos cadastrar o paciente primeiro. Qual é o nome do pet?`,
    draft: session.draft,
  };
}

/**
 * Após coletar o tutor:
 * - veterinária: PET é obrigatório (auto 1 pet · seleção N · cadastro se 0);
 * - demais: segue sem exigir pet.
 */
function afterPerson(ctx: ToolCallContext, session: BookingSession): AssistantReply {
  session.isVeterinary = detectVeterinary(ctx);
  const out = callTool(
    'listTutorPets',
    { phone: String(session.draft.customerPhone || '') },
    ctx,
  );
  const pets = out.ok && Array.isArray(out.data)
    ? (out.data as Array<{ id: string; name: string; label: string }>)
    : [];
  session.pets = pets;

  if (!session.isVeterinary) {
    // Clínica humana/estética/etc: pet não é paciente deste agendamento.
    return goToConfirm(session);
  }

  if (pets.length === 0) {
    return askNewPetName(session);
  }
  if (pets.length === 1) {
    session.draft = { ...session.draft, petId: pets[0].id };
    return goToConfirm(session);
  }
  session.step = 'need_pet';
  return {
    ok: true,
    step: 'need_pet',
    message: `Para qual pet é o atendimento? ${pets.map((p) => p.label || p.name).join(', ')}.`,
    options: pets.map((p) => ({ id: p.id, label: p.label || p.name })),
    draft: session.draft,
  };
}

function confirmationMessage(
  draft: Partial<BookingDraft>,
  pets: Array<{ id: string; name: string; label: string }> = [],
): string {
  const petName = draft.petId
    ? pets.find((p) => p.id === draft.petId)?.label
      || pets.find((p) => p.id === draft.petId)?.name
      || draft.petId
    : '';
  const lines = [
    'Confirme os dados:',
    `• Serviço: ${draft.serviceName || draft.serviceId}`,
    `• Data: ${draft.date}`,
    `• Horário: ${draft.time}`,
    petName ? `• Paciente (pet): ${petName}` : `• Paciente: ${draft.customerName}`,
    `• Tutor/contato: ${draft.customerName} (${draft.customerPhone})`,
  ];
  lines.push('Posso confirmar esse agendamento? (sim/não)');
  return lines.join('\n');
}

/**
 * Avança o assistente com a mensagem do paciente.
 * `ctx` vem sempre da sessão autenticada (businessId/permissions).
 */
export function handleBookingMessage(
  session: BookingSession,
  message: string,
  ctx: ToolCallContext,
): AssistantReply {
  session.turn += 1;
  if (session.turn > MAX_TURNS) {
    session.step = 'cancelled';
    return {
      ok: false,
      step: 'cancelled',
      message: 'Vamos recomeçar quando você quiser — me chame para agendar de novo.',
      error: 'max_turns',
    };
  }

  const text = String(message || '').trim();
  if (!text) {
    return {
      ok: false,
      step: session.step,
      message: 'Não entendi. Pode repetir, por favor?',
      draft: session.draft,
      error: 'empty',
    };
  }

  if (hitsClinicalGuardrail(text)) {
    return {
      ok: false,
      step: session.step,
      message:
        'Posso ajudar com agendamento, horários e serviços da clínica. Para questões de saúde, fale com o profissional na consulta — não dou diagnóstico nem orientação médica.',
      draft: session.draft,
      error: 'clinical_guardrail',
    };
  }

  if (wantsCancel(text)) {
    session.step = 'cancelled';
    return {
      ok: true,
      step: 'cancelled',
      message: 'Tudo bem, cancelei. Se precisar, é só pedir um novo agendamento.',
    };
  }

  if (session.step === 'idle' || session.step === 'done' || session.step === 'cancelled') {
    session.step = 'need_service';
    session.draft = {};
    session.slots = [];
    session.pets = [];
    session.isVeterinary = false;
    session.newPet = { name: '', species: '' };
    const boot = askService(ctx);
    if (boot.step === 'need_service' || boot.step === 'need_date') {
      const svc = matchService(ctx, text);
      if (svc) {
        session.draft = { serviceId: svc.id, serviceName: svc.name };
        return askDate(session);
      }
      if (boot.step === 'need_date' && boot.draft?.serviceId) {
        session.step = 'need_date';
        session.draft = boot.draft;
        const now = ctx.now ? new Date(ctx.now) : new Date();
        const date = parseDate(text, now);
        if (date) {
          const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
          if (date >= today) return askTime(ctx, session, date);
          session.step = 'need_date';
          return {
            ok: false,
            step: 'need_date',
            message: 'Essa data já passou. Qual data a partir de hoje?',
            draft: session.draft,
            error: 'date_past',
          };
        }
        return boot;
      }
      if (boot.step === 'need_date') {
        session.step = 'need_date';
        if (boot.draft) session.draft = boot.draft;
      }
      return boot;
    }
    return boot;
  }

  if (session.step === 'need_service') {
    const svc = matchService(ctx, text);
    if (!svc) {
      return {
        ok: false,
        step: 'need_service',
        message: 'Não encontrei esse serviço. Escolha um destes:',
        options: serviceOptions(ctx),
        error: 'service_not_found',
      };
    }
    session.draft = { ...session.draft, serviceId: svc.id, serviceName: svc.name };
    return askDate(session);
  }

  if (session.step === 'need_date') {
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const date = parseDate(text, now);
    if (!date) {
      return {
        ok: false,
        step: 'need_date',
        message: 'Não entendi a data. Exemplos: "amanhã", "10/10" ou "2026-10-10".',
        draft: session.draft,
        error: 'date_invalid',
      };
    }
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (date < today) {
      return {
        ok: false,
        step: 'need_date',
        message: 'Essa data já passou. Qual data a partir de hoje?',
        draft: session.draft,
        error: 'date_past',
      };
    }
    return askTime(ctx, session, date);
  }

  if (session.step === 'need_time') {
    const time = parseTime(text) || (session.slots.includes(text) ? text : null);
    if (!time) {
      return {
        ok: false,
        step: 'need_time',
        message: `Qual horário entre: ${session.slots.slice(0, 8).join(', ')}?`,
        options: session.slots.slice(0, 8).map((s) => ({ id: s, label: s })),
        draft: session.draft,
        error: 'time_invalid',
      };
    }
    if (!session.slots.includes(time)) {
      return {
        ok: false,
        step: 'need_time',
        message: `Ops, ${time} não está livre. Escolha um destes: ${session.slots.slice(0, 8).join(', ')}`,
        options: session.slots.slice(0, 8).map((s) => ({ id: s, label: s })),
        draft: session.draft,
        error: 'time_not_available',
      };
    }
    session.draft = { ...session.draft, time };
    return askPerson(session);
  }

  if (session.step === 'need_person') {
    const phone = parsePhone(text);
    const name = text.replace(PHONE_RE, '').replace(/[;,]+/g, ' ').trim();
    if (!phone || name.length < 2) {
      return {
        ok: false,
        step: 'need_person',
        message: 'Preciso do nome e do WhatsApp. Ex.: "Ana 11988887777".',
        draft: session.draft,
        error: 'person_invalid',
      };
    }
    session.draft = {
      ...session.draft,
      customerName: name.slice(0, 80),
      customerPhone: phone,
    };
    return afterPerson(ctx, session);
  }

  // ── need_pet: escolha o paciente veterinário ──
  if (session.step === 'need_pet') {
    const t = text.trim().toLowerCase();
    // Veterinária: PET é paciente — "sem pet" não é opção.
    if (session.isVeterinary && /^(sem pet|nenhum|nenhuma|so eu|só eu|nao tem|não tem)\b/.test(t)) {
      return {
        ok: false,
        step: 'need_pet',
        message: 'Numa consulta veterinária o paciente é o pet. Escolha um dos pets abaixo:',
        options: session.pets.map((p) => ({ id: p.id, label: p.label || p.name })),
        draft: session.draft,
        error: 'pet_required',
      };
    }
    if (!session.isVeterinary && /^(sem pet|nenhum|nenhuma|so eu|só eu|nao tem|não tem)\b/.test(t)) {
      delete session.draft.petId;
      return goToConfirm(session);
    }
    const pet =
      session.pets.find((p) => p.id === text.trim())
      || session.pets.find((p) => p.name.toLowerCase() === t)
      || session.pets.find((p) => p.name.toLowerCase().includes(t) && t.length >= 2);
    if (!pet) {
      return {
        ok: false,
        step: 'need_pet',
        message: `Não encontrei esse pet. Escolha: ${session.pets.map((p) => p.label || p.name).join(', ')}.`,
        options: session.pets.map((p) => ({ id: p.id, label: p.label || p.name })),
        draft: session.draft,
        error: 'pet_not_found',
      };
    }
    session.draft = { ...session.draft, petId: pet.id };
    return goToConfirm(session);
  }

  // ── need_new_pet: cadastro mínimo (nome → espécie → createPet) ──
  if (session.step === 'need_new_pet') {
    const t = text.trim();
    if (!session.newPet.name) {
      if (t.length < 1 || t.length > 80) {
        return {
          ok: false,
          step: 'need_new_pet',
          message: 'Qual é o nome do pet? (até 80 caracteres)',
          draft: session.draft,
          error: 'pet_name_invalid',
        };
      }
      session.newPet = { name: t.slice(0, 80), species: '' };
      return {
        ok: true,
        step: 'need_new_pet',
        message: `Certo — **${session.newPet.name}**. Qual a espécie? (cachorro, gato, ave, roedor, réptil, outro)`,
        draft: session.draft,
      };
    }
    // segunda fala = espécie
    const species = t.toLowerCase().replace(/[ãáàâ]/g, 'a').replace(/[éê]/g, 'e').replace(/[í]/g, 'i').replace(/[óô]/g, 'o').replace(/[ú]/g, 'u').replace(/ç/g, 'c');
    const known = ['cachorro', 'gato', 'ave', 'roedor', 'reptil', 'outro'];
    let sp = known.find((k) => species.includes(k) || k.includes(species) || species.startsWith(k.slice(0, 4)));
    if (!sp) {
      // aceita sinônimos comuns
      if (/cach|cao|dog/.test(species)) sp = 'cachorro';
      else if (/gat|cat/.test(species)) sp = 'gato';
      else sp = 'outro';
    }
    // resolve tutorId pelo telefone do draft
    const found = callTool('findClient', { phone: String(session.draft.customerPhone || '') }, ctx);
    let tutorId = '';
    if (found.ok && Array.isArray(found.data) && found.data.length > 0) {
      tutorId = String((found.data as Array<{ id: string }>)[0].id);
    }
    if (!tutorId) {
      const created = callTool('createClient', {
        name: String(session.draft.customerName || 'Tutor'),
        phone: String(session.draft.customerPhone || ''),
      }, ctx);
      if (created.ok && created.data) tutorId = String((created.data as { id: string }).id);
    }
    if (!tutorId) {
      return {
        ok: false,
        step: 'need_new_pet',
        message: 'Não consegui localizar o tutor para cadastrar o pet. Pode repetir o WhatsApp?',
        draft: session.draft,
        error: 'tutor_missing',
      };
    }
    const create = callTool('createPet', {
      tutorId,
      name: session.newPet.name,
      species: sp,
    }, { ...ctx, confirmed: true });
    if (!create.ok || !create.data) {
      return {
        ok: false,
        step: 'need_new_pet',
        message: `Não consegui cadastrar o pet: ${(create as ToolResult).error || 'erro'}. Pode tentar de novo?`,
        draft: session.draft,
        error: (create as ToolResult).code || 'create_pet_failed',
      };
    }
    const pet = create.data as { id: string; name: string };
    session.draft = { ...session.draft, petId: pet.id };
    session.pets = [{ id: pet.id, name: pet.name, label: `${pet.name} · ${sp}` }];
    return goToConfirm(session);
  }

  if (session.step === 'confirm') {
    const decision = parseConfirm(text);
    if (decision === null) {
      return {
        ok: false,
        step: 'confirm',
        message: 'Responda **sim** para confirmar ou **não** para cancelar.',
        draft: session.draft,
        needsConfirm: true,
        error: 'confirm_unclear',
      };
    }
    if (decision === false) {
      session.step = 'cancelled';
      return {
        ok: true,
        step: 'cancelled',
        message: 'Agendamento não realizado. Posso ajudar com mais alguma coisa?',
      };
    }

    const d = session.draft;
    const create = callTool(
      'createBooking',
      {
        serviceId: String(d.serviceId || ''),
        date: String(d.date || ''),
        time: String(d.time || ''),
        customerName: String(d.customerName || ''),
        customerPhone: String(d.customerPhone || ''),
        professionalId: d.professionalId || undefined,
        petId: d.petId || undefined,
        note: d.note || undefined,
      },
      { ...ctx, confirmed: true },
    );

    if (!create.ok) {
      session.step = 'confirm';
      return {
        ok: false,
        step: 'confirm',
        message:
          create.code === 'needs_confirm'
            ? 'Preciso da sua confirmação: posso confirmar esse agendamento? (sim/não)'
            : `Não consegui agendar: ${create.error || 'erro desconhecido'}. Quer tentar de novo?`,
        draft: session.draft,
        needsConfirm: create.code === 'needs_confirm',
        error: create.code || 'create_failed',
      };
    }

    const data = create.data as { bookingId: string; status: string };
    const petName = d.petId
      ? session.pets.find((p) => p.id === d.petId)?.name || ''
      : '';
    session.step = 'done';
    return {
      ok: true,
      step: 'done',
      message: `✅ Agendado! ${d.serviceName || d.serviceId} em ${d.date} às ${d.time} para ${petName || d.customerName}. Protocolo: ${data.bookingId}.`,
      draft: session.draft,
      bookingId: data.bookingId,
    };
  }

  session.step = 'need_service';
  session.draft = {};
  session.slots = [];
  session.pets = [];
  session.isVeterinary = false;
  session.newPet = { name: '', species: '' };
  return askService(ctx);
}
