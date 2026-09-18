// Timezone do produto: America/Sao_Paulo por padrão, CONFIGURÁVEL POR
// NEGÓCIO (A2-B5/F9 — Business.businessTimezone). TODA comparação de "hoje",
// elegibilidade, cancelamento, séries e filtros por dia deve usar estes
// helpers — nunca toISOString().slice(0, 10), que é UTC e erra o dia perto
// da meia-noite — e sempre com o fuso EFETIVO do negócio
// (effectiveTimezone), jamais o do navegador, para regras.

export const TZ = 'America/Sao_Paulo';
/** Apelido semântico: o default do produto quando o negócio não configura. */
export const DEFAULT_TIMEZONE = TZ;

/** Fuso IANA é válido? ( Intl valida de graça; inválido ⇒ fallback.) */
export function isValidTimezone(tz?: string | null): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fuso EFETIVO do negócio: configurado e válido, senão o default do produto. */
export function effectiveTimezone(tz?: string | null): string {
  return isValidTimezone(tz) ? (tz as string) : DEFAULT_TIMEZONE;
}

const DAY = 86400000;

function parts(d: Date, tz: string = DEFAULT_TIMEZONE): { y: number; m: number; day: number; h: number; min: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: effectiveTimezone(tz), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
  return { y: g('year'), m: g('month'), day: g('day'), h: g('hour'), min: g('minute') };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Hoje (YYYY-MM-DD) no fuso informado (default: fuso do produto).
export function todayISO(now = new Date(), tz?: string): string {
  const p = parts(now, tz);
  return iso(p.y, p.m, p.day);
}

// Hora atual (HH:MM) no fuso informado (default: fuso do produto).
export function nowHM(now = new Date(), tz?: string): string {
  const p = parts(now, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

// Dia da semana (0=dom..6=sab) de um YYYY-MM-DD, sem shift de fuso.
export function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return -1;
  return new Date(y, m - 1, d).getDay();
}

export function addDaysISO(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n);
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function parseISODate(s: string): Date | null {
  if (!isValidDateISO(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isPastDate(dateISO: string, today = todayISO()): boolean {
  if (!isValidDateISO(dateISO)) return false;
  return dateISO < today;
}

/**
 * Hora válida no formato HH:MM (00:00 a 23:59).
 * Só checar /^\d{2}:\d{2}$/ deixaria passar "99:99" — que depois seria
 * recusado como "horário ocupado", com mensagem enganosa.
 */
export function isValidClockTime(t: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(t || '')) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidDateISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// ── Formatação humana (pt-BR) ──

export function formatDateBR(dateISO: string): string {
  if (!isValidDateISO(dateISO)) return dateISO || '';
  const [y, m, d] = dateISO.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateShort(dateISO: string): string {
  if (!isValidDateISO(dateISO)) return dateISO || '';
  const [, m, d] = dateISO.split('-');
  return `${d}/${m}`;
}

// "Hoje" | "Amanhã" | "DD/MM" (ano só se diferente).
export function humanDay(dateISO: string, today = todayISO()): string {
  if (!isValidDateISO(dateISO)) return dateISO || '';
  if (dateISO === today) return 'Hoje';
  if (dateISO === addDaysISO(today, 1)) return 'Amanhã';
  if (dateISO === addDaysISO(today, -1)) return 'Ontem';
  const [y] = dateISO.split('-');
  return y === today.slice(0, 4) ? formatDateShort(dateISO) : formatDateBR(dateISO);
}

// "Hoje às 14:30" | "Amanhã às 09:00" | "12/09 às 18:00".
export function humanDateTime(dateISO: string, hm: string, today = todayISO()): string {
  return `${humanDay(dateISO, today)} às ${(hm || '').slice(0, 5)}`;
}

export const DAY_MS = DAY;
