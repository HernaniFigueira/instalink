// ═══════════════════════════════════════════════════════════════
// AGENDAMENTO — validação visual canônica de horário passado
// ═══════════════════════════════════════════════════════════════
// Esta regra é usada pelas superfícies de criação (Quick Create e formulário
// completo) para explicar o mesmo intervalo inválido antes do submit. Ela não
// substitui `createBookingTx`: o servidor continua a autoridade e revalida no
// fuso da unidade no instante da gravação.
import { timeToMin } from "./utils";

export const BOOKING_PAST_TIME_ERROR =
  "Esse intervalo já passou. Escolha um horário futuro.";

/**
 * Devolve a mensagem única quando data/hora já ficaram no passado no fuso que
 * o chamador resolveu; devolve vazio enquanto a intenção for futura ou ainda
 * incompleta. `today` e `now` são recebidos prontos para que toda superfície
 * use a mesma referência de relógio da unidade.
 */
export function bookingPastTimeError(
  dateISO: string,
  time: string,
  todayISO: string,
  now: string,
): string {
  if (!isDateISO(dateISO) || !isDateISO(todayISO) || !isTimeHM(time) || !isTimeHM(now)) return "";
  if (dateISO < todayISO) return BOOKING_PAST_TIME_ERROR;
  if (dateISO !== todayISO) return "";

  return timeToMin(time) < timeToMin(now) ? BOOKING_PAST_TIME_ERROR : "";
}

function isDateISO(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeHM(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
