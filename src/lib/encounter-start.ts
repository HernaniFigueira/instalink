// ═══════════════════════════════════════════════════════════════
// F1A · START OR RESUME ENCOUNTER — operação canônica do atendimento
// ═══════════════════════════════════════════════════════════════
// Uma ÚNICA porta para "abrir o atendimento deste agendamento":
//
//   • SEM registro            → cria (inicia o atendimento);
//   • COM registro em curso   → devolve o existente (RETOMA, não duplica);
//   • COM registro finalizado → devolve o existente para visualização e NÃO
//                               cria outro nem reabre (F1A não reabre).
//
// É PURO em relação a I/O: roda DENTRO de `updateDB` (a escrita do documento é
// serializada por lá, inclusive entre instâncias no Postgres), então a checagem
// de duplicidade e a criação são indivisíveis — duas chamadas concorrentes não
// produzem dois atendimentos para o mesmo agendamento.
//
// Regras que NÃO mudam (domínio existente, homologado em produção):
//   • 1:1 por agendamento e 1:1 por entrada de fila (walk-in);
//   • a ETAPA operacional continua sendo autoridade do workflow
//     (arrived → in_care): iniciar atendimento de quem não chegou é recusado;
//   • escopo do profissional: quem atende registra o que atendeu;
//   • a identidade profissional é o Professional do tenant, nunca o e-mail.
//
// IDs vindos do cliente NÃO concedem acesso: tudo é resolvido dentro do
// `businessId` autenticado, e todo vínculo (paciente, profissional, serviço,
// responsável) é conferido no mesmo tenant antes de virar registro.
import { randomUUID } from 'node:crypto';
import { NO_PROFESSIONAL_SCOPE } from './access-core';
import { pushAudit } from './audit';
import { assertCanStartCare } from './appointment-workflow-tx';
import { PROFESSIONAL_NOT_ELIGIBLE_ERROR, professionalServesService, serviceRequiresProfessional } from './booking';
import {
  cleanTags, cleanText, encounterForBooking, encounterForQueue, encounterInScope,
} from './encounters';
import { emitAutomationEvent } from './automation/events';
import { findContact } from './contacts';
import { nowHM, todayISO } from './tz';
import type { DB, Encounter, User } from './types';

/** Erro com status HTTP — o tradutor da rota converte em resposta. */
function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export interface StartOrResumeBody {
  professionalId?: unknown;
  serviceId?: unknown;
  petId?: unknown;
  customerId?: unknown;
  contactId?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  date?: unknown;
  time?: unknown;
  complaint?: unknown;
  evolution?: unknown;
  guidance?: unknown;
  followUp?: unknown;
  internalNote?: unknown;
  tags?: unknown;
}

export interface StartOrResumeArgs {
  businessId: string;
  /** Agendamento de origem ('' = walk-in pela fila). */
  bookingId: string;
  /** Entrada da fila de origem ('' = veio de agendamento). */
  queueId: string;
  /** Quem está executando (usuário autenticado) — auditado. */
  actor: Pick<User, 'id' | 'email' | 'role'>;
  /** Instante da operação (ISO) — o servidor é o relógio. */
  now: string;
  /** Fuso IANA da unidade (para o horário local de um walk-in). */
  tz: string;
  /**
   * Escopo do profissional do ATOR: '' = sem restrição (dono/admin/recepção
   * com permissão clínica). A sentinela `NO_PROFESSIONAL_SCOPE` (papel
   * PROFISSIONAL sem vínculo) é normalizada aqui para ''.
   */
  professionalScope: string;
  /** Payload do cliente — nenhum campo dele é confiável. */
  body?: StartOrResumeBody;
}

export type StartOrResumeOutcome =
  /** Não havia registro: o atendimento foi INICIADO agora. */
  | 'created'
  /** Já havia registro em curso: RETOMADO (mesmo id). */
  | 'resumed'
  /** Já havia registro FINALIZADO: devolvido para leitura, sem recriar. */
  | 'reused_finalized';

export interface StartOrResumeResult {
  encounter: Encounter;
  outcome: StartOrResumeOutcome;
  created: boolean;
  /** Compatibilidade com a resposta histórica do POST (`reused`). */
  reused: boolean;
}

/** Hora local (HH:MM) do fuso da unidade a partir de um ISO — para a fila. */
function hmOf(iso: string, tz: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? nowHM(d, tz) : '';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/**
 * Opera dentro de `updateDB`. Lança `Error` com `status` para cada recusa —
 * a rota traduz em resposta HTTP sem vazar detalhe técnico.
 */
export function startOrResumeEncounter(d: DB, args: StartOrResumeArgs): StartOrResumeResult {
  const { businessId, now, tz } = args;
  const body = args.body || {};
  const bookingId = str(args.bookingId);
  const queueId = str(args.queueId);
  if (!businessId) throw err('Unidade não informada.', 400);
  if (!bookingId && !queueId) {
    throw err('Abra o atendimento pelo agendamento ou pela fila da unidade.', 400);
  }

  // ── Origem: agendamento SEMPRE dentro do tenant autenticado ──
  const booking = bookingId
    ? d.bookings.find((b) => b.id === bookingId && b.businessId === businessId)
    : undefined;
  if (bookingId && !booking) throw err('Agendamento não encontrado nesta unidade.', 404);

  // Walk-in: a ENTRADA DA FILA é a referência (horário e profissional vêm
  // dela). Nada de fabricar Booking falso — a agenda continua dizendo a verdade.
  const queueEntry = queueId
    ? (d.queue || []).find((q) => q.id === queueId && q.businessId === businessId)
    : undefined;
  if (queueId && !queueEntry) throw err('Entrada da fila não encontrada nesta unidade.', 404);

  // ── F1A · INVARIANTE E — todo vínculo do atendimento é do MESMO tenant ──
  // O agendamento já foi achado pelo `businessId`; aqui conferimos que aquilo
  // que ele APONTA (paciente, profissional, serviço, responsável) também é
  // desta unidade. ID de outra clínica não vira atendimento aqui.
  const petId = str(booking?.petId);
  if (petId && !(d.pets || []).some((p) => p.id === petId && p.businessId === businessId)) {
    throw err('O paciente deste agendamento não pertence a esta unidade.', 409);
  }
  const bookingProfessionalId = str(booking?.professionalId);
  if (bookingProfessionalId
    && !(d.professionals || []).some((p) => p.id === bookingProfessionalId && p.businessId === businessId)) {
    throw err('O profissional deste agendamento não pertence a esta unidade.', 409);
  }
  const bookingServiceId = str(booking?.serviceId);
  if (bookingServiceId
    && !(d.services || []).some((s) => s.id === bookingServiceId && s.businessId === businessId)) {
    throw err('O serviço deste agendamento não pertence a esta unidade.', 409);
  }
  // O RESPONSÁVEL do agendamento não é conferido aqui: o Booking guarda
  // `customerId`/telefone/nome e o contato do CRM é RESOLVIDO mais abaixo por
  // `findContact`, que já é tenant-scoped (nada de vínculo por nome).

  // ── 1:1 — RETOMAR antes de criar (invariante A/B) ──
  // Nunca depende de ordem de array nem de "primeiro item": a busca é por
  // vínculo exato E tenant.
  const existing = encounterForBooking(d.encounters || [], businessId, bookingId)
    || encounterForQueue(d.encounters || [], businessId, queueId);
  if (existing) {
    if (!encounterInScope(existing, professionalScopeOf(args))) {
      throw err('Você só registra os seus próprios atendimentos.', 403);
    }
    // FINALIZADO NÃO VOLTA A FICAR EM ATENDIMENTO POR START/RESUME (F1A · F/G).
    const finalized = existing.status === 'finalized';
    return {
      encounter: existing,
      outcome: finalized ? 'reused_finalized' : 'resumed',
      created: false,
      reused: true,
    };
  }

  // ── Profissional responsável ──
  // O escopo manda; sem escopo, o profissional do agendamento (ou o indicado
  // explicitamente). A sentinela de "PROFISSIONAL sem vínculo" não é pessoa.
  const scopeId = professionalScopeOf(args);
  const requestedProfessionalId = str(body.professionalId);
  const professionalId = scopeId
    || requestedProfessionalId
    || bookingProfessionalId
    || str(queueEntry?.professionalId);
  if (booking && scopeId && bookingProfessionalId && bookingProfessionalId !== scopeId) {
    throw err('Você só registra os seus próprios atendimentos.', 403);
  }
  if (queueEntry && scopeId && queueEntry.professionalId && queueEntry.professionalId !== scopeId) {
    throw err('Você só registra os seus próprios atendimentos.', 403);
  }
  // Profissional CONCRETO é do tenant (não é e-mail, não é palpite).
  if (professionalId
    && !(d.professionals || []).some((p) => p.id === professionalId && p.businessId === businessId)) {
    throw err('Profissional não encontrado nesta unidade.', 409);
  }

  // ── Serviço × profissional (régua existente, revalidada na última porta) ──
  // Só vale quando HÁ profissional a conferir: quem opera o balcão sem vínculo
  // não tem "vínculo inelegível" a fabricar.
  const encounterServiceId = str(body.serviceId) || bookingServiceId || str(queueEntry?.serviceId);
  const encounterService = (d.services || []).find((s) => s.id === encounterServiceId && s.businessId === businessId);
  if (encounterService && serviceRequiresProfessional(encounterService) && professionalId
    && !professionalServesService(encounterService, professionalId, d.professionals || [])) {
    throw err(PROFESSIONAL_NOT_ELIGIBLE_ERROR, 403);
  }

  // ── Responsável/tutor: identidade do CRM, nunca nome ──
  const customerId = str(body.customerId) || str(booking?.customerId);
  const customerPhone = str(body.customerPhone) || str(booking?.customerPhone) || str(queueEntry?.customerPhone);
  const customerName = str(body.customerName) || str(booking?.customerName) || str(queueEntry?.customerName);
  const contactId = str(body.contactId) || str(queueEntry?.contactId)
    || (findContact(d, businessId, customerId, customerPhone, customerName)?.id || '');
  if (contactId && !d.contacts.some((c) => c.id === contactId && c.businessId === businessId)) {
    throw err('O responsável informado não pertence a esta unidade.', 409);
  }

  // ── Paciente informado pelo cliente: só se for DESTA unidade ──
  const requestedPetId = str(body.petId);
  const finalPetId = petId
    || (requestedPetId && (d.pets || []).some((p) => p.id === requestedPetId && p.businessId === businessId)
      ? requestedPetId : '');
  if (requestedPetId && !finalPetId) {
    throw err('Paciente não encontrado nesta unidade.', 404);
  }

  // ── Etapa operacional: arrived → in_care (autoridade do workflow) ──
  // Quem ainda não chegou não inicia atendimento clínico; finalizado/cancelado/
  // falta também não. Revalidação dentro da transação, com o estado REAL.
  if (booking) assertCanStartCare(d, businessId, booking);

  const row: Encounter = {
    id: randomUUID(),
    businessId,
    bookingId: booking?.id || '',
    queueId: queueEntry?.id || '',
    serviceId: encounterServiceId,
    professionalId,
    customerId,
    contactId,
    customerName: customerName.slice(0, 80),
    date: str(body.date) || str(booking?.date) || str(queueEntry?.date) || todayISO(new Date(now), tz),
    // Sem agendamento, o "horário" é a CHEGADA/INÍCIO da fila — o registro diz
    // quando o atendimento aconteceu, não um horário de agenda inventado.
    time: str(body.time) || str(booking?.time)
      || (queueEntry ? (queueEntry.startedAt ? hmOf(queueEntry.startedAt, tz) : hmOf(queueEntry.createdAt, tz)) : ''),
    complaint: cleanText(body.complaint, 'complaint'),
    evolution: cleanText(body.evolution, 'evolution'),
    guidance: cleanText(body.guidance, 'guidance'),
    followUp: cleanText(body.followUp, 'followUp'),
    internalNote: cleanText(body.internalNote, 'internalNote'),
    tags: cleanTags(body.tags),
    // Nasce EM ATENDIMENTO: no contrato F1A, registro existente = atendimento
    // iniciado (o canônico "draft/não iniciado" é a AUSÊNCIA de registro).
    status: 'draft',
    version: 1,
    // F1A — início clínico: o instante em que o atendimento começou.
    startedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: args.actor.id,
    updatedBy: args.actor.id,
    finalizedAt: '',
    finalizedBy: '',
    signedBy: '',
    petId: finalPetId,
  };

  d.encounters.push(row);
  pushAudit(d, {
    action: 'encounter.created', businessId, actor: args.actor as User,
    meta: {
      encounterId: row.id, bookingId: row.bookingId, queueId: row.queueId,
      professionalId: row.professionalId, petId: row.petId, workflow: 'arrived>in_care',
    },
  }, now);
  emitAutomationEvent(d, {
    event: 'encounter.started',
    businessId,
    at: now,
    bookingId: row.bookingId || undefined,
    customerId: row.customerId || undefined,
    data: { encounterId: row.id, professionalId: row.professionalId, serviceId: row.serviceId },
  });
  return { encounter: row, outcome: 'created', created: true, reused: false };
}

/** Escopo efetivo: a sentinela de "sem vínculo profissional" NÃO é escopo. */
function professionalScopeOf(args: StartOrResumeArgs): string {
  const scope = String(args.professionalScope || '');
  return scope && scope !== NO_PROFESSIONAL_SCOPE ? scope : '';
}
