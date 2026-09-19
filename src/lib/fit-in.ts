// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — ENCAIXE (fit-in): dizer a VERDADE antes de forçar
// ═══════════════════════════════════════════════════════════════
// Encaixe é o caso real do balcão: "não tem horário livre, mas eu quero
// atender mesmo assim". A regra do produto NÃO é proibir — é NUNCA esconder o
// conflito: quem encaixa vê com quem está batendo (nome e horário) e confirma
// ciente. O agendamento nasce marcado como `fit_in` para que agenda,
// histórico e relatórios possam distinguir o que respeitou a grade do que
// foi decisão humana.
//
// Este módulo é PURO: recebe os agendamentos do dia e devolve os conflitos.
// Ele não cria nada — quem cria é `createBookingTx` (caminho único).
import type { Booking, Service } from './types';
import { bookingDuration } from './booking-ops';
import { timeToMin } from './utils';

/** Estados que ocupam a grade. Terminal (concluído/faltou/cancelado) não ocupa. */
export function occupiesGrid(status: Booking['status']): boolean {
  return status === 'pending' || status === 'confirmed';
}

export interface FitInConflict {
  id: string;
  customerName: string;
  time: string;
  endTime: string;
  professionalId: string;
  professionalName: string;
  /** 'mesmo profissional' = conflito direto; 'equipe' = a pessoa já tem agenda. */
  kind: 'professional' | 'team';
}

/** Agendamento com a duração já resolvida (o tipo Booking não guarda duração). */
export type BookingWithDuration = Booking & { durationMin: number };

export interface FitInQuery {
  date: string;
  time: string;
  /** Duração do serviço que está sendo encaixado (min). */
  durationMin: number;
  /** Profissional escolhido ('' = qualquer um da equipe). */
  professionalId: string;
  /** Profissionais elegíveis para o serviço (ids). Vazio = toda a equipe. */
  eligibleProIds?: string[];
}

function hhmm(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Conflitos do encaixe num dia: agendamentos ATIVOS que se sobrepõem à janela
 * pretendida. Com profissional escolhido, só interessam os dele. Sem escolha,
 * devolvemos os da EQUIPE (o encaixe é possível, mas alguém vai ficar sem
 * sala/pessoa no mesmo horário — e isso precisa aparecer).
 */
export function fitInConflicts(
  bookings: Array<Booking | BookingWithDuration>,
  professionals: Array<{ id: string; name: string }>,
  q: FitInQuery,
): FitInConflict[] {
  const start = timeToMin(q.time);
  if (!Number.isFinite(start)) return [];
  const end = start + Math.max(1, q.durationMin);
  const nameOf = (id: string) => professionals.find((p) => p.id === id)?.name || 'Sem profissional';
  const eligible = q.eligibleProIds && q.eligibleProIds.length > 0 ? q.eligibleProIds : null;

  const out: FitInConflict[] = [];
  for (const b of bookings) {
    if (b.date !== q.date || !occupiesGrid(b.status)) continue;
    if (q.professionalId) {
      if ((b.professionalId || '') !== q.professionalId) continue;
    } else if (eligible && b.professionalId && !eligible.includes(b.professionalId)) {
      continue;
    }
    const bStart = timeToMin(b.time);
    if (!Number.isFinite(bStart)) continue;
    // Duração do agendamento existente: a do serviço dele quando disponível.
    const bEnd = bStart + Math.max(1, (b as BookingWithDuration).durationMin || 0);
    if (bEnd <= start || bStart >= end) continue;
    out.push({
      id: b.id,
      customerName: b.customerName,
      time: b.time,
      endTime: hhmm(bEnd),
      professionalId: b.professionalId || '',
      professionalName: b.professionalId ? nameOf(b.professionalId) : 'Sem profissional',
      kind: q.professionalId ? 'professional' : 'team',
    });
  }
  return out.sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
}

/**
 * Conflitos a partir do BANCO: junta a duração real de cada agendamento
 * (pelo serviço dele) e a lista de profissionais da unidade.
 */
export function fitInConflictsFromDB(
  input: {
    bookings: Booking[];
    services: Service[];
    professionals: Array<{ id: string; name: string }>;
  },
  q: FitInQuery,
): FitInConflict[] {
  const durationOf = (b: Booking) =>
    bookingDuration(input.services.find((s) => s.id === b.serviceId), 30);
  const enriched: BookingWithDuration[] = input.bookings.map((b) => ({ ...b, durationMin: durationOf(b) }));
  return fitInConflicts(enriched, input.professionals, q);
}

/** Mensagem única (servidor + tela falam a MESMA frase). */
export function fitInWarning(conflicts: FitInConflict[]): string {
  if (conflicts.length === 0) return '';
  const first = conflicts[0];
  const extra = conflicts.length > 1 ? ` e mais ${conflicts.length - 1}` : '';
  const who = first.professionalId ? ` de ${first.professionalName}` : '';
  return `Este horário já tem ${first.customerName}${who} às ${first.time}${extra}.`;
}
