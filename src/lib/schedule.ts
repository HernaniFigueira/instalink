// ═══════════════════════════════════════════════════════════════
// HORÁRIOS — horário geral da clínica × horário do profissional
// ═══════════════════════════════════════════════════════════════
// Modelo (sem duplicar configuração):
//
//   • "Horário da clínica"  = Availability com professionalId '' (escopo geral)
//   • "Horário personalizado" = Availability com professionalId = id do pro
//   • Professional.followBusinessHours:
//        true  → HERDA o horário da clínica (não tem/ignora regras próprias)
//        false → usa SOMENTE o próprio horário (pode ter folga em dias que a
//                clínica abre)
//        ausente (dado legado) → derivado: quem já tinha regras próprias
//                continua personalizado; quem não tinha, herda.
//
// Consequências exigidas pelo produto:
//   • alterar o horário geral atualiza AUTOMATICAMENTE quem herda
//     (a herança é por referência — nada é copiado, nada é apagado);
//   • quem tem horário personalizado NÃO é afetado;
//   • "Aplicar horário da clínica a todos" toca SOMENTE em quem segue a
//     clínica — personalizações nunca são sobrescritas em silêncio.
//
// Módulo PURO (sem I/O): usado pelo painel, pela API e pelos testes.
import type { Availability, Professional } from './types';
import { WEEKDAYS_LONG, timeToMin } from './utils';

/** Escopo do horário geral da empresa. */
export const BUSINESS_SCOPE = '';

export type HoursOrigin = 'inherited' | 'custom';

export const HOURS_ORIGIN_LABEL: Record<HoursOrigin, string> = {
  inherited: 'Horário herdado da clínica',
  custom: 'Horário personalizado',
};

export const HOURS_ORIGIN_SHORT: Record<HoursOrigin, string> = {
  inherited: 'herdado da clínica',
  custom: 'personalizado',
};

/** Texto de confirmação obrigatório da ação "aplicar a todos". */
export const APPLY_TO_ALL_CONFIRMATION =
  'Isso atualizará o horário padrão dos profissionais que seguem o horário da clínica.';

/** Rótulo padrão do botão de criação de profissional. */
export const FOLLOW_BUSINESS_HOURS_LABEL = 'Seguir horário da clínica';

/** O profissional tem regras próprias gravadas? */
export function hasOwnRules(professionalId: string, rules: Availability[]): boolean {
  if (!professionalId) return false;
  return (rules || []).some((r) => r.professionalId === professionalId);
}

/**
 * O profissional segue o horário da clínica?
 * - `true`/`false` explícitos vencem;
 * - valor ausente (legado) é derivado: regras próprias ⇒ personalizado.
 * Nunca inventamos personalização nem apagamos configuração existente.
 */
export function followsBusinessHours(
  pro: Pick<Professional, 'id' | 'followBusinessHours'> | null | undefined,
  rules: Availability[] = [],
): boolean {
  if (!pro) return true; // sem equipe: a agenda é o horário geral
  if (pro.followBusinessHours === true) return true;
  if (pro.followBusinessHours === false) return false;
  return !hasOwnRules(pro.id, rules);
}

export function hoursOrigin(
  pro: Pick<Professional, 'id' | 'followBusinessHours'> | null | undefined,
  rules: Availability[] = [],
): HoursOrigin {
  return followsBusinessHours(pro, rules) ? 'inherited' : 'custom';
}

/** Regras do horário geral da clínica (escopo ''). */
export function businessRules(rules: Availability[]): Availability[] {
  return (rules || []).filter((r) => !r.professionalId);
}

/** Regras próprias de um profissional. */
export function customRulesFor(professionalId: string, rules: Availability[]): Availability[] {
  if (!professionalId) return [];
  return (rules || []).filter((r) => r.professionalId === professionalId);
}

/**
 * Regras EFETIVAS de um profissional — herança OU personalização, nunca as
 * duas ao mesmo tempo (é isto que impede o horário geral de "vazar" para quem
 * tem agenda própria e vice-versa).
 */
export function rulesForProfessional(
  pro: Pick<Professional, 'id' | 'followBusinessHours'> | null | undefined,
  rules: Availability[],
): Availability[] {
  if (!pro) return businessRules(rules);
  return followsBusinessHours(pro, rules) ? businessRules(rules) : customRulesFor(pro.id, rules);
}

// ── Leitura humana do horário ────────────────────────────────
export interface DayWindow {
  weekday: number;
  start: string;
  end: string;
  slotMin: number;
}

export interface DayHoursRow {
  weekday: number;
  label: string;
  windows: DayWindow[];
  closed: boolean;
}

/** Tabela de horários por dia da semana (0=dom … 6=sáb), ordenada. */
export function hoursTable(rules: Availability[]): DayHoursRow[] {
  const out: DayHoursRow[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const windows = (rules || [])
      .filter((r) => r.weekday === weekday && timeToMin(r.end) > timeToMin(r.start))
      .map((r) => ({ weekday, start: r.start, end: r.end, slotMin: r.slotMin || 0 }))
      .sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
    out.push({ weekday, label: WEEKDAYS_LONG[weekday], windows, closed: windows.length === 0 });
  }
  return out;
}

/** Horário geral da clínica por dia (para a UI enxuta "Segunda 08:00 — 18:00"). */
export function businessHoursTable(rules: Availability[]): DayHoursRow[] {
  return hoursTable(businessRules(rules));
}

/** Horário efetivo de um profissional por dia. */
export function professionalHoursTable(
  pro: Pick<Professional, 'id' | 'followBusinessHours'> | null | undefined,
  rules: Availability[],
): DayHoursRow[] {
  return hoursTable(rulesForProfessional(pro, rules));
}

function formatWindows(windows: DayWindow[]): string {
  return windows.map((w) => `${w.start} — ${w.end}`).join(', ');
}

/** Resumo de uma linha: "Segunda 08:00 — 18:00". */
export function describeDay(row: DayHoursRow): string {
  return `${row.label} ${row.closed ? 'Fechado' : formatWindows(row.windows)}`;
}

/** Resumo multilinha do horário (usado em mensagens e no agente). */
export function describeHours(rules: Availability[]): string {
  return hoursTable(rules).map(describeDay).join('\n');
}

/** Dias em que o profissional NÃO atende (folga), mesmo com a clínica aberta. */
export function professionalDaysOff(
  pro: Pick<Professional, 'id' | 'followBusinessHours'> | null | undefined,
  rules: Availability[],
): number[] {
  const businessOpen = new Set(
    businessHoursTable(rules).filter((r) => !r.closed).map((r) => r.weekday),
  );
  return professionalHoursTable(pro, rules)
    .filter((r) => r.closed && businessOpen.has(r.weekday))
    .map((r) => r.weekday);
}

// ── Personalização (override) ────────────────────────────────
/**
 * Ao DESATIVAR "seguir horário da clínica", o profissional precisa de um
 * horário próprio — e ele começa com uma CÓPIA do horário geral (nunca com a
 * agenda fechada, o que derrubaria todos os horários sem aviso).
 */
export function initialCustomHours(rules: Availability[]): DayWindow[] {
  return businessHoursTable(rules).flatMap((row) => row.windows);
}

export interface ProfessionalHoursPatch {
  followBusinessHours: boolean;
  /** Regras próprias a gravar (somente quando followBusinessHours === false). */
  rules: DayWindow[];
}

/**
 * PATCH de alternância do vínculo com o horário da clínica.
 * - ligar  → sem regras próprias (herda por referência; nada é copiado);
 * - desligar → cria as regras próprias a partir do horário atual.
 *
 * `keepExisting` preserva regras próprias que já existiam (ex.: o lojista
 * desligou a herança, editou, desligou/ligou de novo).
 */
export function followTogglePatch(opts: {
  follow: boolean;
  rules: Availability[];
  professionalId: string;
}): ProfessionalHoursPatch {
  if (opts.follow) return { followBusinessHours: true, rules: [] };
  const existing = customRulesFor(opts.professionalId, opts.rules).map((r) => ({
    weekday: r.weekday, start: r.start, end: r.end, slotMin: r.slotMin || 0,
  }));
  return {
    followBusinessHours: false,
    rules: existing.length > 0 ? existing : initialCustomHours(opts.rules),
  };
}

// ── Impacto de alterar o horário geral ───────────────────────
export interface HoursChangeImpact {
  /** Profissionais que acompanham a mudança automaticamente (herdam). */
  following: string[];
  followingNames: string[];
  /** Profissionais que NÃO mudam (horário personalizado). */
  custom: string[];
  customNames: string[];
}

/**
 * Quem é afetado por uma mudança no horário geral. A herança é por
 * referência: nenhum registro é reescrito, nada é apagado.
 */
export function businessHoursChangeImpact(
  professionals: Professional[],
  rules: Availability[],
): HoursChangeImpact {
  const following: string[] = [];
  const followingNames: string[] = [];
  const custom: string[] = [];
  const customNames: string[] = [];
  for (const p of professionals || []) {
    if (p.active === false) continue;
    if (followsBusinessHours(p, rules)) { following.push(p.id); followingNames.push(p.name); }
    else { custom.push(p.id); customNames.push(p.name); }
  }
  return { following, followingNames, custom, customNames };
}

// ── Aplicar horário da clínica a todos ───────────────────────
export interface ApplyToAllPlan {
  /** Profissionais que seguem a clínica e serão (re)alinhados. */
  update: string[];
  updateNames: string[];
  /** Personalizados — intocáveis (nunca sobrescritos em silêncio). */
  skip: string[];
  skipNames: string[];
  /** Confirmação exibida antes de aplicar. */
  confirmation: string;
}

/**
 * Plano da ação "Aplicar horário da clínica a todos os profissionais".
 * Só toca em quem segue o horário da clínica; personalizações são listadas
 * como ignoradas para o lojista ver exatamente o que NÃO será alterado.
 */
export function planApplyBusinessHoursToAll(
  professionals: Professional[],
  rules: Availability[],
): ApplyToAllPlan {
  const impact = businessHoursChangeImpact(professionals, rules);
  return {
    update: impact.following,
    updateNames: impact.followingNames,
    skip: impact.custom,
    skipNames: impact.customNames,
    confirmation: APPLY_TO_ALL_CONFIRMATION,
  };
}

/** Mensagem de resultado da aplicação (honesta, sem inventar efeito). */
export function applyToAllResultMessage(plan: ApplyToAllPlan): string {
  const parts: string[] = [];
  parts.push(plan.update.length === 1
    ? `1 profissional segue o horário da clínica e foi atualizado.`
    : `${plan.update.length} profissionais seguem o horário da clínica e foram atualizados.`);
  if (plan.skip.length > 0) {
    parts.push(`${plan.skip.length} com horário personalizado não foram alterados (${plan.skipNames.join(', ')}).`);
  }
  return parts.join(' ');
}

/**
 * Validação mínima de uma janela de horário (usada pela API e pela UI):
 * fim depois do início e formato HH:MM.
 */
export function isValidWindow(start: string, end: string): boolean {
  const rx = /^\d{2}:\d{2}$/;
  if (!rx.test(start || '') || !rx.test(end || '')) return false;
  return timeToMin(end) > timeToMin(start);
}

/** Normaliza uma lista de janelas descartando as inválidas. */
export function sanitizeWindows(input: unknown): DayWindow[] {
  if (!Array.isArray(input)) return [];
  const out: DayWindow[] = [];
  for (const raw of input) {
    const r = (raw || {}) as Record<string, unknown>;
    const weekday = Number(r.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    const start = String(r.start || '');
    const end = String(r.end || '');
    if (!isValidWindow(start, end)) continue;
    out.push({ weekday, start, end, slotMin: Math.max(0, Number(r.slotMin) || 0) });
  }
  return out;
}

/** Estado visual de um profissional na lista (herdado × personalizado). */
export interface ProfessionalHoursSummary {
  id: string;
  name: string;
  origin: HoursOrigin;
  label: string;
  shortLabel: string;
  /** Resumo legível do horário efetivo ("Seg 08:00 — 18:00, …"). */
  summary: string;
  daysOff: number[];
  actionLabel: string;
}

export function professionalHoursSummary(
  pro: Professional,
  rules: Availability[],
): ProfessionalHoursSummary {
  const origin = hoursOrigin(pro, rules);
  const table = professionalHoursTable(pro, rules);
  const open = table.filter((r) => !r.closed);
  const summary = open.length === 0
    ? 'Sem horário definido'
    : open.map((r) => `${r.label.slice(0, 3)} ${formatWindows(r.windows)}`).join(' · ');
  return {
    id: pro.id,
    name: pro.name,
    origin,
    label: HOURS_ORIGIN_LABEL[origin],
    shortLabel: HOURS_ORIGIN_SHORT[origin],
    summary,
    daysOff: professionalDaysOff(pro, rules),
    actionLabel: origin === 'inherited' ? 'Personalizar' : 'Editar horário',
  };
}
