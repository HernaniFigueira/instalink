// ═══════════════════════════════════════════════════════════════
// FASE 2 · P10/P11 — FOLLOW-UP: FUNDAÇÃO (receitas internas, sem envio)
// ═══════════════════════════════════════════════════════════════
// Estas são RECEITAS (gatilho + atraso + público + ação pretendida).
// NESTA FASE NADA É ENVIADO: o canal pode não estar operacional e a UI
// mostra "Aguardando conexão do WhatsApp" — nunca finge envio. A Fase 3
// conecta o disparo; o modelo/avaliação já funciona com dados reais aqui.
// Módulo PURO (sem I/O, sem relógio global — a data vem de quem chama).
import type {
  Business, Booking, BusinessCustomer as Contact, Encounter, FollowUpRule, FollowUpTrigger, Lead,
} from './types';

/** Chave de identidade do CRM: só dígitos (mesma régua de contacts.ts). */
const digits = (v: string): string => String(v || '').replace(/\D/g, '');

export interface FollowUpRecipe {
  trigger: FollowUpTrigger;
  name: string;
  /** O que a receita faz, na palavra de quem opera. */
  hint: string;
  /** Atraso padrão em relação ao gatilho. */
  delay: { value: number; unit: 'minutes' | 'hours' | 'days' };
  /** Quem entra no público (rótulo humano; a seleção é derivada dos dados). */
  audience: string;
  /** Ação pretendida (hoje: registro interno/preparação; envio vem na Fase 3). */
  action: string;
  defaultActive: boolean;
}

/** As 6 receitas do briefing — catálogo único, criado por unidade. */
export const FOLLOW_UP_RECIPES: FollowUpRecipe[] = [
  {
    trigger: 'lead_no_booking',
    name: 'Lead sem agendamento',
    hint: 'Lead entrou e não marcou atendimento.',
    delay: { value: 24, unit: 'hours' },
    audience: 'Leads novos sem agendamento',
    action: 'Enviar mensagem lembrando do agendamento',
    defaultActive: false,
  },
  {
    trigger: 'before_appointment',
    name: 'Confirmação',
    hint: 'Antes do atendimento, confirmar com o paciente.',
    delay: { value: 24, unit: 'hours' },
    audience: 'Agendamentos confirmados',
    action: 'Enviar confirmação com data/hora e local',
    defaultActive: false,
  },
  {
    trigger: 'no_show',
    name: 'Faltou',
    hint: 'Após não comparecer ao agendamento.',
    delay: { value: 2, unit: 'hours' },
    audience: 'Pacientes com falta recente',
    action: 'Mensagem de reagendamento (sem cobrança)',
    defaultActive: false,
  },
  {
    trigger: 'after_completion',
    name: 'Pós-atendimento',
    hint: 'Depois de concluir o atendimento.',
    delay: { value: 1, unit: 'days' },
    audience: 'Atendimentos concluídos',
    action: 'Agradecer e pedir retorno/avaliação',
    defaultActive: false,
  },
  {
    trigger: 'return_due',
    name: 'Retorno',
    hint: 'Na data/intervalo definido pelo profissional.',
    delay: { value: 0, unit: 'days' },
    audience: 'Pacientes com retorno previsto',
    action: 'Lembrar do retorno agendado/programado',
    defaultActive: false,
  },
  {
    trigger: 'inactive_patient',
    name: 'Paciente inativo',
    hint: 'Sem atendimento há um tempo.',
    delay: { value: 90, unit: 'days' },
    audience: 'Pacientes sem atendimento recente',
    action: 'Mensagem de reativação',
    defaultActive: false,
  },
];

export function recipeFor(trigger: FollowUpTrigger): FollowUpRecipe | undefined {
  return FOLLOW_UP_RECIPES.find((r) => r.trigger === trigger);
}

/** Estado honesto do canal: só 'connected' é operacional de verdade. */
export function followUpChannelState(business: Pick<Business, 'whatsappIntegration'>): {
  ready: boolean;
  label: string;
} {
  const status = business.whatsappIntegration?.status;
  if (status === 'connected') return { ready: true, label: 'WhatsApp conectado' };
  return { ready: false, label: 'Aguardando conexão do WhatsApp' };
}

/** As 6 receitas viram regras da unidade (ids estáveis por trigger). */
export function seedFollowUpRules(businessId: string, now: string): FollowUpRule[] {
  return FOLLOW_UP_RECIPES.map((r) => ({
    id: `fup-${businessId.slice(0, 8)}-${r.trigger}`,
    businessId,
    name: r.name,
    trigger: r.trigger,
    active: r.defaultActive,
    delayValue: r.delay.value,
    delayUnit: r.delay.unit,
    params: {},
    action: r.action,
    channel: 'whatsapp',
    audience: r.audience,
    createdAt: now,
    updatedAt: now,
  }));
}

// ── Prévia de candidatos (DRY-RUN): quem ENTRARIA na próxima varredura ──
// Nada é enviado; serve para a receita mostrar "sobre quem age" com dado real.
export interface FollowUpCandidate {
  ruleId: string;
  trigger: FollowUpTrigger;
  contactId: string;
  leadId?: string;
  bookingId?: string;
  encounterId?: string;
  name: string;
  phone: string;
  /** Quando a ação venceria (YYYY-MM-DD ou ISO curto) — só exibição. */
  dueAt: string;
  context: string;
}

export interface FollowUpInputs {
  rules: FollowUpRule[];
  contacts: Contact[];
  leads: Lead[];
  bookings: Booking[];
  encounters: Encounter[];
  /** YYYY-MM-DD no fuso do produto. */
  today: string;
  /** ISO do momento da varredura. */
  now: string;
}

const daysBetween = (fromISO: string, toISO: string): number => {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.floor((b - a) / 86400000);
};

const addDays = (iso: string, days: number): string => {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
};

/** Avalia UMA regra sobre os dados reais e devolve os candidatos da janela. */
export function evaluateRule(rule: FollowUpRule, input: FollowUpInputs): FollowUpCandidate[] {
  if (!rule.active) return [];
  const { contacts, leads, bookings, encounters, today, now } = input;
  const out: FollowUpCandidate[] = [];
  const contactOf = (id: string) => contacts.find((c) => c.id === id);
  const contactIdByPhone = (phone: string): string => {
    const d = digits(phone);
    if (!d) return '';
    return contacts.find((c) => digits(c.phone) === d)?.id || '';
  };
  // Booking NÃO guarda contactId: o vínculo com o CRM é pelo TELEFONE
  // (mesma chave de identidade do resto do sistema — nunca por nome).
  const futurePhones = new Set(
    bookings
      .filter((b) => b.date >= today && b.status !== 'cancelled' && b.status !== 'no_show')
      .map((b) => digits(b.customerPhone))
      .filter(Boolean),
  );
  const hasFutureBooking = (contactId: string): boolean => {
    const phone = contactId ? contactOf(contactId)?.phone : '';
    return !!phone && futurePhones.has(digits(phone));
  };

  switch (rule.trigger) {
    case 'lead_no_booking': {
      const ageDays = rule.delayUnit === 'days' ? rule.delayValue
        : rule.delayUnit === 'hours' ? Math.max(1, Math.round(rule.delayValue / 24)) : 1;
      for (const l of leads) {
        if (l.bookingId) continue;
        if (l.status === 'converted' || l.status === 'lost') continue;
        const age = daysBetween(l.createdAt, now);
        if (!(Number.isFinite(age) && age >= ageDays)) continue;
        out.push({
          ruleId: rule.id, trigger: rule.trigger, contactId: l.customerId || '', leadId: l.id,
          name: l.name || 'Lead', phone: l.phone || '', dueAt: today,
          context: `Lead de ${l.origin || 'origem desconhecida'} há ${age} dia(s)`,
        });
      }
      break;
    }
    case 'before_appointment': {
      const aheadDays = rule.delayUnit === 'days' ? rule.delayValue
        : rule.delayUnit === 'hours' ? Math.max(0, Math.round(rule.delayValue / 24)) : 0;
      const target = addDays(today, aheadDays);
      for (const b of bookings) {
        if (b.status !== 'confirmed' && b.status !== 'pending') continue;
        if (b.date !== target) continue;
        out.push({
          ruleId: rule.id, trigger: rule.trigger, contactId: contactIdByPhone(b.customerPhone), bookingId: b.id,
          name: b.customerName, phone: b.customerPhone, dueAt: b.date,
          context: `Atendimento em ${b.date} às ${b.time}`,
        });
      }
      break;
    }
    case 'no_show': {
      const windowDays = rule.delayUnit === 'days' ? rule.delayValue
        : rule.delayUnit === 'hours' ? Math.max(0, Math.round(rule.delayValue / 24)) : 0;
      for (const b of bookings) {
        if (b.status !== 'no_show') continue;
        const since = daysBetween(b.date, today);
        if (!(Number.isFinite(since) && since >= 0 && since <= Math.max(windowDays, 0) + 7)) continue;
        // Já reagendou depois da falta (mesmo telefone)? então não há ação pendente.
        if (digits(b.customerPhone) && futurePhones.has(digits(b.customerPhone))) continue;
        out.push({
          ruleId: rule.id, trigger: rule.trigger, contactId: contactIdByPhone(b.customerPhone), bookingId: b.id,
          name: b.customerName, phone: b.customerPhone, dueAt: addDays(b.date, Math.max(windowDays, 0)) || today,
          context: `Falta em ${b.date}`,
        });
      }
      break;
    }
    case 'after_completion': {
      const afterDays = rule.delayUnit === 'days' ? rule.delayValue : 0;
      for (const e of encounters) {
        if (e.status !== 'finalized') continue;
        const due = addDays(e.date, afterDays);
        if (!due || due > today) continue;
        if (daysBetween(due, today) > 30) continue; // janela de varredura
        out.push({
          ruleId: rule.id, trigger: rule.trigger, contactId: e.contactId, encounterId: e.id,
          bookingId: e.bookingId, name: e.customerName, phone: '', dueAt: due,
          context: `Atendimento concluído em ${e.date}`,
        });
      }
      break;
    }
    case 'return_due': {
      for (const e of encounters) {
        if (e.status !== 'finalized') continue;
        if (e.followUpMode !== 'date' && e.followUpMode !== 'interval') continue;
        const base = e.followUpMode === 'date' ? e.followUpDate
          : addDays(e.date, Number(e.followUpDays) || 0);
        if (!base || base > today) continue;
        // Paciente com retorno já reagendado → não perturbar.
        if (e.contactId && hasFutureBooking(e.contactId)) continue;
        out.push({
          ruleId: rule.id, trigger: rule.trigger, contactId: e.contactId, encounterId: e.id,
          name: e.customerName, phone: '', dueAt: base,
          context: e.followUpMode === 'interval' ? `Intervalo de ${e.followUpDays} dias` : 'Data de retorno programada',
        });
      }
      break;
    }
    case 'inactive_patient': {
      const idleDays = rule.delayUnit === 'days' ? rule.delayValue : 90;
      // Última conclusão por TELEFONE (Booking não guarda contactId — o CRM
      // resolve pelo telefone, mesma chave do resto do sistema).
      const lastDone = new Map<string, string>();
      for (const b of bookings) {
        const key = digits(b.customerPhone);
        if (b.status !== 'completed' || !key) continue;
        const prev = lastDone.get(key) || '';
        if (b.date > prev) lastDone.set(key, b.date);
      }
      for (const [phoneKey, last] of lastDone) {
        const idle = daysBetween(last, today);
        if (!(Number.isFinite(idle) && idle >= idleDays)) continue;
        if (futurePhones.has(phoneKey)) continue;
        const c = contacts.find((x) => digits(x.phone) === phoneKey);
        if (!c) continue;
        out.push({
          ruleId: rule.id, trigger: rule.trigger, contactId: c.id,
          name: c.name || 'Paciente', phone: c.phone || '', dueAt: today,
          context: `Sem atendimento desde ${last} (${idle} dias)`,
        });
      }
      break;
    }
  }
  // Teto por regra (prévia; a varredura real da Fase 3 pagina).
  return out.slice(0, 50);
}

/** Prévia de TODAS as regras ativas. */
export function evaluateFollowUps(input: FollowUpInputs): FollowUpCandidate[] {
  return input.rules.flatMap((r) => evaluateRule(r, input));
}
