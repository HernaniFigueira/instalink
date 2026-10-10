// ═══════════════════════════════════════════════════════════════
// ENTREGA 2 · TIMER DO ATENDIMENTO (exibição pura)
// ═══════════════════════════════════════════════════════════════
// Regra de honestidade:
//   • a ÚNICA fonte é `startedAt`, o instante PERSISTIDO pelo servidor no
//     início do atendimento — o navegador nunca cria um início;
//   • o relógio é derivado (now − startedAt) a cada render: não há contador
//     próprio que possa zerar em reload, troca de aba ou re-render;
//   • fora da janela plausível (início no futuro além de uma tolerância de
//     relógio, ou mais de 24 h atrás) não conta ao vivo: mostra a data/hora
//     de início gravada;
//   • sem timestamp válido, não há timer.
import { effectiveTimezone, formatDateBR, todayISO } from './tz';

/** Tolerância para relógio do navegador levemente atrás do servidor. */
const CLOCK_SKEW_MS = 2 * 60 * 1000;
/** Acima disto o atendimento não é "ao vivo" (registro esquecido aberto). */
export const ENCOUNTER_LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type EncounterTimer =
  | { kind: 'live'; elapsedMs: number; clock: string; startedHM: string }
  | { kind: 'stale'; label: string };

/** "HH:MM:SS" (horas sem teto de 2 dígitos não acontece: janela de 24 h). */
export function formatElapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function encounterTimer(startedAt: string | undefined | null, now: Date, tz?: string | null): EncounterTimer | null {
  if (!startedAt) return null;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return null;
  const zone = effectiveTimezone(tz);
  const startedHM = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(started);
  const elapsedMs = now.getTime() - started.getTime();
  if (elapsedMs < -CLOCK_SKEW_MS || elapsedMs >= ENCOUNTER_LIVE_WINDOW_MS) {
    return { kind: 'stale', label: `Iniciado em ${formatDateBR(todayISO(started, zone))} às ${startedHM}` };
  }
  const clamped = Math.max(0, elapsedMs);
  return { kind: 'live', elapsedMs: clamped, clock: formatElapsedClock(clamped), startedHM };
}
