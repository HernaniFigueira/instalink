import { createHash, randomUUID } from 'node:crypto';
import type { DB, Booking } from './types';
import { computeSlots, type SlotQuery } from './slots';
import { createBookingTx, txError, type CreateBookingParams } from './booking-create';
import { bookingMaxDate } from './booking-ops';
import { MAX_SERIES_OCCURRENCES, type BookingOccurrence } from './booking-recurrence';
import { effectiveTimezone, todayISO, nowHM, weekdayOf, isValidDateISO, isValidClockTime } from './tz';
import { applyBookingStatusTx } from './booking-status';

export interface OccurrencePreview extends BookingOccurrence {
  index: number;
  state: 'available' | 'conflict' | 'professional_unavailable' | 'closed' | 'invalid';
  label: string;
  professionalName: string;
}

/** Valida inclusive sobreposição ENTRE ocorrências com o mesmo computeSlots. Sem efeitos colaterais. */
export function previewSeries(d: DB, p: CreateBookingParams, input: unknown, scope = ''): OccurrencePreview[] {
  if (p.actor !== 'owner') throw txError('Recorrência exige permissão de Agenda.', 403);
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_SERIES_OCCURRENCES) {
    throw txError(`A série deve ter de 2 a ${MAX_SERIES_OCCURRENCES} atendimentos.`, 400);
  }
  const business = d.businesses.find((b) => b.id === p.business.id);
  const service = d.services.find((s) => s.id === p.service.id && s.businessId === p.business.id && s.active !== false);
  if (!business || !service) throw txError('Serviço indisponível.', 400);
  const tz = effectiveTimezone(business.businessTimezone);
  const today = todayISO(new Date(), tz);
  const maxDate = bookingMaxDate(today, business.booking, true);
  const professionals = d.professionals.filter((x) => x.businessId === business.id);
  const bookings = d.bookings.filter((b) => b.businessId === business.id).slice();
  return input.map((raw, i) => {
    const date = String(raw?.date || '');
    const time = String(raw?.time || '');
    const requested = String(raw?.professionalId || '');
    if (scope && requested && requested !== scope) throw txError('Você só pode agendar para o seu profissional.', 403);
    const professionalId = scope || requested;
    const row: OccurrencePreview = { date, time, professionalId, index: i + 1, state: 'available', label: 'Disponível', professionalName: '' };
    const fail = (state: OccurrencePreview['state'], label: string) => ({ ...row, state, label });
    if (!isValidDateISO(date) || !isValidClockTime(time) || date < today || date > maxDate) {
      return fail('invalid', `Data/horário inválido: escolha de ${today} até ${maxDate}.`);
    }
    if (professionalId && !professionals.some((x) => x.id === professionalId && x.active !== false && (!service.professionalIds?.length || service.professionalIds.includes(x.id)))) {
      return fail('professional_unavailable', 'Profissional indisponível');
    }
    const query: SlotQuery = {
      rules: d.availability.filter((x) => x.businessId === business.id),
      exceptions: d.exceptions.filter((x) => x.businessId === business.id),
      bookings, services: d.services.filter((x) => x.businessId === business.id), professionals,
      dateISO: date, weekday: weekdayOf(date), serviceId: service.id, durationMin: service.durationMin,
      professionalId, eligibleProIds: service.professionalIds || [],
      nowHM: date === today ? nowHM(new Date(), tz) : '',
      leadMin: business.booking.leadMin || 0, bufferMin: business.booking.bufferMin || 0,
    };
    const r = computeSlots(query);
    if (!r.slots.includes(time)) {
      if (r.closedReason === 'exception') return fail('closed', 'Dia fechado');
      if (r.closedReason === 'no_windows') {
        const wholeDayClosed = !professionalId || computeSlots({ ...query, professionalId: '' }).closedReason === 'no_windows';
        return wholeDayClosed ? fail('closed', 'Dia fechado') : fail('professional_unavailable', 'Profissional indisponível');
      }
      return fail('conflict', 'Conflito');
    }
    row.professionalId = professionalId || r.assign[time] || '';
    row.professionalName = professionals.find((x) => x.id === row.professionalId)?.name || 'Automático';
    bookings.push({ id: `preview-${i}`, businessId: business.id, serviceId: service.id, date, time, professionalId: row.professionalId, status: 'confirmed' } as Booking);
    return row;
  });
}

function seriesSummary(d: DB, bookings: Booking[]) {
  return bookings.sort((a, b) => (a.seriesIndex || 0) - (b.seriesIndex || 0)).map((b) => ({
    id: b.id, date: b.date, time: b.time, professionalId: b.professionalId,
    professionalName: d.professionals.find((p) => p.businessId === b.businessId && p.id === b.professionalId)?.name || 'Automático',
  }));
}

/** Executar dentro de updateDB. A chave é estável entre preview, correção e retry. */
export function createSeriesTx(d: DB, p: CreateBookingParams, occurrences: unknown, requestId: unknown, scope = '') {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw txError('Chave da série inválida.', 400);
  const fingerprint = createHash('sha256').update(JSON.stringify({ serviceId: p.service.id, customer: p.customer, contact: p.linkedContact?.id, note: p.note, occurrences, scope })).digest('hex');
  const existing = d.bookings.filter((b) => b.businessId === p.business.id && b.seriesRequestId === requestId && !b.previousId);
  if (existing.length) {
    if (existing.some((b) => b.seriesFingerprint !== fingerprint || (scope && b.professionalId !== scope))) {
      throw txError('Esta chave já foi usada para outra série. Reabra o formulário para criar uma nova.', 409);
    }
    return { seriesId: existing[0].seriesId, bookingIds: existing.map((b) => b.id), count: existing.length, occurrences: seriesSummary(d, existing), replayed: true };
  }
  const preview = previewSeries(d, p, occurrences, scope);
  if (preview.some((r) => r.state !== 'available')) {
    throw Object.assign(txError('Revise as ocorrências sinalizadas. Nenhum atendimento foi criado.', 409), { occurrences: preview });
  }
  const seriesId = randomUUID();
  const bookingIds = preview.map((row, i) => createBookingTx(d, {
    ...p, ...row, series: { seriesId, seriesIndex: i + 1, seriesCount: preview.length, seriesRequestId: requestId, seriesFingerprint: fingerprint },
  }).bookingId);
  return { seriesId, bookingIds, count: bookingIds.length, occurrences: seriesSummary(d, d.bookings.filter((b) => bookingIds.includes(b.id))), replayed: false };
}

/** Cancela somente futuros abertos, preservando histórico e a máquina oficial de status. */
export function cancelFutureSeriesTx(d: DB, businessId: string, seriesId: string, scope = '') {
  const business = d.businesses.find((b) => b.id === businessId);
  if (!business) throw txError('Negócio não encontrado.', 404);
  const all = d.bookings.filter((b) => b.businessId === businessId && b.seriesId === seriesId);
  if (!all.length) throw txError('Série não encontrada.', 404);
  // Não cancelar parcialmente uma série de outros profissionais em silêncio.
  if (scope && all.some((b) => b.professionalId !== scope)) throw txError('Somente a equipe com acesso à série inteira pode cancelá-la.', 403);
  const tz = effectiveTimezone(business.businessTimezone);
  const clock = new Date();
  const current = todayISO(clock, tz) + nowHM(clock, tz);
  const future = all.filter((b) => b.date + b.time > current && ['pending', 'confirmed'].includes(b.status));
  for (const b of future) {
    const r = applyBookingStatusTx(d, { businessId, bookingId: b.id, to: 'cancelled', by: 'owner', note: 'Cancelamento das ocorrências futuras da série' });
    if (!r.ok) throw txError(r.error || 'Não foi possível cancelar a série.', 409);
  }
  return { cancelled: future.length };
}
