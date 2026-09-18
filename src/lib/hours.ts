// ═══════════════════════════════════════════════════════════════
// STATUS DE FUNCIONAMENTO — "Aberto agora" honesto (A2-B5/F3)
// ═══════════════════════════════════════════════════════════════
// MESMA FONTE DA AGENDA: Availability (regras por dia, com herança de
// equipe) + exceptions (folga/horário especial), no FUSO DO NEGÓCIO (F9).
// `Business.hours` deixa de ser regra operacional paralela — vira APENAS
// fallback de exibição quando o negócio não tem NENHUMA regra de
// disponibilidade (dados legados), e continua sendo o "horário cadastrado"
// informativo nas respostas do agente.
import { nowHM, todayISO, addDaysISO, weekdayOf, effectiveTimezone } from './tz';
import { timeToMin } from './utils';
import type { Availability, AvailabilityException, Business, DayHours } from './types';

export interface OpenStatus {
  open: boolean;
  /** Rótulo curto exibido na página ("Aberto até 19:00", "Fechado · abre às 08:00"). */
  label: string;
}

function defDay(hours: Record<string, DayHours | null> | undefined, wd: number): DayHours | null {
  const h = hours?.[String(wd)];
  return h && h.open && h.close ? h : null;
}

/** Janela "o lugar está aberto" num dia: união (min–máx) das regras do dia. */
function windowOfRules(
  rules: Array<Pick<Availability, 'weekday' | 'start' | 'end'>>,
  wd: number,
): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (const r of rules) {
    if (r.weekday !== wd) continue;
    const s = timeToMin(r.start);
    const e = timeToMin(r.end);
    if (e <= s) continue;
    if (start < 0 || s < start) start = s;
    if (end < 0 || e > end) end = e;
  }
  return start >= 0 && end > start ? { start, end } : null;
}

function fmtHM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * "Aberto agora" pela MESMA fonte da Agenda: Availability + exceptions no
 * fuso do negócio. `null` = nada configurado (sem regras e sem horário
 * cadastrado) — não mostramos status em cima de achismo.
 */
export function getBusinessOpenStatus(
  business: Pick<Business, 'hours' | 'businessTimezone'>,
  rules: Array<Pick<Availability, 'weekday' | 'start' | 'end'>>,
  exceptions: Array<Pick<AvailabilityException, 'date' | 'closed' | 'start' | 'end'>>,
  now = new Date(),
): OpenStatus | null {
  const tz = effectiveTimezone(business.businessTimezone);
  const today = todayISO(now, tz);
  const hm = nowHM(now, tz);
  const hmMin = timeToMin(hm);
  const wd = weekdayOf(today);
  const hasAnyRule = rules.some((r) => r.weekday >= 0 && r.weekday <= 6 && r.end > r.start);

  if (hasAnyRule) {
    const exc = exceptions.find((e) => e.date === today);

    // Janela efetiva de hoje: regra do dia restringida pela exceção especial.
    let win = windowOfRules(rules, wd);
    if (win && exc && !exc.closed && exc.start && exc.end) {
      const s = timeToMin(exc.start);
      const e = timeToMin(exc.end);
      if (e > s) win = { start: Math.max(win.start, s), end: Math.min(win.end, e) };
      if (win.end <= win.start) win = null;
    }

    // Exceção fechou o dia: folga honesta com a próxima abertura.
    if (exc?.closed) win = null;

    if (win) {
      if (hmMin >= win.start && hmMin < win.end) {
        return { open: true, label: `Aberto agora · até ${fmtHM(win.end)}` };
      }
      if (hmMin < win.start) {
        return { open: false, label: `Fechado · abre hoje às ${fmtHM(win.start)}` };
      }
    }

    // Próximo dia com atendimento (regra do dia + exceção não fechada).
    for (let i = 1; i <= 7; i += 1) {
      const d = addDaysISO(today, i);
      if (exceptions.some((e) => e.date === d && e.closed)) continue;
      const w = windowOfRules(rules, weekdayOf(d));
      if (w) {
        const when = i === 1 ? 'amanhã' : `dia ${d.slice(8, 10)}/${d.slice(5, 7)}`;
        return { open: false, label: `Fechado · abre ${when} às ${fmtHM(w.start)}` };
      }
    }
    return { open: false, label: 'Atendimento sob consulta' };
  }

  // FALLBACK LEGADO (documentado): sem NENHUMA regra de disponibilidade,
  // o Business.hours é a única informação existente — exibição, não regra
  // paralela (a agenda deste negócio está fechada para booking de qualquer
  // forma, pois o motor não tem regras).
  return openStatus(business.hours, now, tz);
}

/**
 * (legado) Status derivado SÓ de Business.hours. Mantido para o fallback
 * acima e para testes existentes — novos consumidores usam
 * getBusinessOpenStatus.
 */
export function openStatus(
  hours: Record<string, DayHours | null> | undefined,
  now = new Date(),
  tz?: string,
): OpenStatus | null {
  if (!hours) return null;
  const anyConfigured = ['0', '1', '2', '3', '4', '5', '6'].some((k) => {
    const h = hours[k];
    return !!(h && h.open && h.close);
  });
  if (!anyConfigured) return null;

  const today = todayISO(now, tz);
  const hm = nowHM(now, tz);
  const wd = weekdayOf(today);
  const todayHours = defDay(hours, wd);

  if (todayHours) {
    if (hm >= todayHours.open && hm < todayHours.close) {
      return { open: true, label: `Aberto agora · até ${todayHours.close}` };
    }
    if (hm < todayHours.open) {
      return { open: false, label: `Fechado · abre hoje às ${todayHours.open}` };
    }
  }
  // Próximo dia com atendimento nos próximos 7 dias (sem prometer o improvável).
  for (let i = 1; i <= 7; i += 1) {
    const d = addDaysISO(today, i);
    const h = defDay(hours, weekdayOf(d));
    if (h) {
      const when = i === 1 ? 'amanhã' : `dia ${d.slice(8, 10)}/${d.slice(5, 7)}`;
      return { open: false, label: `Fechado · abre ${when} às ${h.open}` };
    }
  }
  return { open: false, label: 'Atendimento sob consulta' };
}

// ═══════════════════════════════════════════════════════════════
// A2-B3 (F7.4/F7.5) — EXCEÇÕES COM EFEITO REAL
// ═══════════════════════════════════════════════════════════════
// Uma exceção só é gravada quando pode produzir efeito na disponibilidade:
//   • data no PASSADO não tem efeito algum (nada pode ser agendado lá) —
//     recusada, senão o lojista "salva" e nada acontece;
//   • horário especial (aberto) exige janela válida (fim depois do início) —
//     janela invertida é silenciosamente ignorada pelo motor, logo inválida;
//   • horário especial só tem efeito se intersecta PELO MENOS uma regra de
//     disponibilidade do dia da semana (a exceção RESTRINGE janelas; não cria).
// Exceção de dia FECHADO vale para qualquer data futura (marca folga mesmo
// em dia já sem regra — é informação de calendário com nota).
export interface ExceptionValidationCtx {
  today: string;
  /** Regras de disponibilidade vigentes do negócio (qualquer escopo). */
  rules: Array<Pick<Availability, 'weekday' | 'start' | 'end'>>;
}

export function validateAvailabilityException(
  input: { date: string; closed: boolean; start: string; end: string },
  ctx: ExceptionValidationCtx,
): { ok: true } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) {
    return { ok: false, error: 'Data inválida.' };
  }
  if (input.date < ctx.today) {
    return { ok: false, error: 'Exceção em data passada não tem efeito: a agenda nunca abre o passado.' };
  }
  if (input.closed) return { ok: true };

  const start = input.start || '';
  const end = input.end || '';
  if (!start || !end) {
    return { ok: false, error: 'Indique o horário especial (início e fim) ou marque o dia como fechado.' };
  }
  if (timeToMin(end) <= timeToMin(start)) {
    return { ok: false, error: 'Horário especial inválido: o fim precisa ser depois do início.' };
  }
  const weekday = weekdayOf(input.date);
  const intersects = (ctx.rules || []).some((r) => {
    if (r.weekday !== weekday) return false;
    return timeToMin(r.start) < timeToMin(end) && timeToMin(r.end) > timeToMin(start);
  });
  if (!intersects) {
    return { ok: false, error: 'Este horário especial não afeta a agenda: não há atendimento nesta data para restringir. Marque o dia como fechado ou ajuste o horário de atendimento.' };
  }
  return { ok: true };
}

/** Ordem canônica dos dias (seg→dom) para exibição humana. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * A2-B5 (F3): resumo do HORÁRIO DE ATENDIMENTO pela MESMA fonte da Agenda —
 * união das regras de Availability por dia da semana. Sem NENHUMA regra,
 * cai no Business.hours CADASTRADO (fallback legado de exibição; nada de
 * regra operacional paralela). Usado pelo conhecimento do agente e pelas
 * respostas de "horário de funcionamento" do concierge.
 */
export function scheduleSummary(
  business: Pick<Business, 'hours'>,
  rules: Array<Pick<Availability, 'weekday' | 'start' | 'end'>>,
): string {
  const windows = new Map<number, { start: number; end: number }>();
  for (const r of rules) {
    if (r.weekday < 0 || r.weekday > 6) continue;
    const st = timeToMin(r.start);
    const en = timeToMin(r.end);
    if (en <= st) continue;
    const cur = windows.get(r.weekday);
    if (!cur) windows.set(r.weekday, { start: st, end: en });
    else windows.set(r.weekday, { start: Math.min(cur.start, st), end: Math.max(cur.end, en) });
  }
  const parts: string[] = [];
  if (windows.size > 0) {
    for (const d of DISPLAY_ORDER) {
      const w = windows.get(d);
      if (w) parts.push(`${DAY_ABBR[d]} ${fmtHM(w.start)}–${fmtHM(w.end)}`);
    }
    return parts.join(' • ');
  }
  // Fallback legado (só exibição): horário cadastrado no perfil.
  for (const d of DISPLAY_ORDER) {
    const h = defDay(business.hours, d);
    if (h) parts.push(`${DAY_ABBR[d]} ${h.open}–${h.close}`);
  }
  return parts.join(' • ');
}
