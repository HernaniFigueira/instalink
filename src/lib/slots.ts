// Motor universal de disponibilidade (serve barbearia, clínica, pet, etc).
// Considera simultaneamente: regras (dia/profissional/serviço), exceções
// (dia fechado ou horário especial), duração real do serviço, buffers,
// bookings existentes (com a duração real de cada um), dia atual (corta o
// passado + antecedência mínima) e vínculo serviço↔profissional.
//
// HORÁRIOS (lib/schedule.ts): cada profissional ou HERDA o horário geral da
// clínica (regras com professionalId '') ou usa o PRÓPRIO horário (regras com
// professionalId = id). Nunca os dois — é isso que faz o horário geral valer
// para toda a equipe sem duplicar configuração, e que garante que um horário
// personalizado não seja alterado quando o geral muda.
import type { Availability, AvailabilityException, Booking, Professional, Service } from './types';
import { timeToMin, minToTime } from './utils';
import { followsBusinessHours } from './schedule';

export interface SlotQuery {
  rules: Availability[];
  exceptions: AvailabilityException[];
  bookings: Booking[];
  services: Service[];
  professionals: Professional[];
  dateISO: string;
  weekday: number;
  serviceId: string;
  durationMin: number;
  professionalId: string; // escolhido ('') = qualquer um
  eligibleProIds: string[]; // vínculo do serviço ([] = todos)
  nowHM: string; // HH:MM atual quando dateISO é hoje ('' = outro dia)
  leadMin: number; // antecedência mínima (min)
  bufferMin: number; // intervalo entre atendimentos (min)
}

export interface SlotResult {
  slots: string[];
  // grade completa − livres: exibidos desabilitados (ocupado visível, não some)
  occupied: string[];
  closed: boolean;
  /**
   * A2-B3 (F4): POR QUE o dia não tem horários — a UI distingue "fechado por
   * regra/exceção" de "aberto e lotado". `undefined` quando há horários.
   *   exception   → exceção fechou o dia;
   *   no_windows  → nenhuma regra/janela de atendimento p/ o dia/serviço/pro;
   *   ended       → havia janela, mas todos os horários já passaram (hoje);
   *   none        → havia janelas, mas nenhuma vaga sobrou (lotado/curta).
   */
  closedReason?: 'exception' | 'no_windows' | 'ended' | 'no_fit' | 'none';
  // auto mode: melhor profissional por horário (menor carga no dia)
  assign: Record<string, string>;
  // Livres por profissional ('' em modo solo). Usado pelo drag-and-drop da
  // agenda para destacar a célula destino correta de cada coluna.
  byProfessional: Record<string, string[]>;
}

interface Window { proId: string; start: number; end: number; step: number }

export function computeSlots(q: SlotQuery): SlotResult {
  const empty: SlotResult = { slots: [], occupied: [], closed: false, assign: {}, byProfessional: {} };

  const exc = q.exceptions.find((e) => e.date === q.dateISO);
  if (exc?.closed) return { slots: [], occupied: [], closed: true, closedReason: 'exception', assign: {}, byProfessional: {} };

  const activePros = q.professionals.filter((p) => p.active !== false);
  const eligible = new Set(
    q.eligibleProIds.length > 0
      ? activePros.filter((p) => q.eligibleProIds.includes(p.id)).map((p) => p.id)
      : activePros.map((p) => p.id),
  );
  // Negócio sem equipe: opera como "profissional único" (id '').
  const soloMode = activePros.length === 0;
  if (q.professionalId && !soloMode && !eligible.has(q.professionalId)) return { ...empty, closed: true, closedReason: 'no_windows' };

  // Herança de horário: quem segue o horário da clínica usa as regras gerais;
  // quem personalizou usa SOMENTE as próprias (dados legados sem o flag são
  // derivados — ver followsBusinessHours em lib/schedule.ts).
  const follows = (pid: string): boolean => {
    const pro = activePros.find((p) => p.id === pid);
    return followsBusinessHours(pro, q.rules);
  };

  // Janelas aplicáveis (regra do dia + serviço + profissional).
  const windows: Window[] = [];
  for (const r of q.rules) {
    if (r.weekday !== q.weekday) continue;
    if (r.serviceId && r.serviceId !== q.serviceId) continue;
    const start = timeToMin(r.start);
    const end = timeToMin(r.end);
    if (!(end > start)) continue;
    // Passo da grade: configurado no período ou, por padrão, a duração
    // do próprio serviço (45min → 09:00, 09:45, 10:30…).
    const step = Math.max(10, r.slotMin || q.durationMin || 30);
    if (q.professionalId) {
      // Escopo de UM profissional: herda o geral OU usa o próprio.
      if (follows(q.professionalId)) {
        if (r.professionalId) continue;
      } else if (r.professionalId !== q.professionalId) {
        continue;
      }
      windows.push({ proId: q.professionalId, start, end, step });
    } else if (soloMode) {
      if (r.professionalId) continue;
      windows.push({ proId: '', start, end, step });
    } else if (r.professionalId) {
      if (!eligible.has(r.professionalId)) continue;
      // Regra própria só vale para quem NÃO segue o horário da clínica.
      if (follows(r.professionalId)) continue;
      windows.push({ proId: r.professionalId, start, end, step });
    } else {
      // Regra geral vale para cada profissional elegível que herda o horário.
      for (const pid of eligible) {
        if (!follows(pid)) continue;
        windows.push({ proId: pid, start, end, step });
      }
    }
  }
  if (windows.length === 0) return { ...empty, closed: true, closedReason: 'no_windows' };

  // Horário especial da exceção restringe as janelas.
  if (exc && !exc.closed && exc.start && exc.end) {
    const s = timeToMin(exc.start);
    const e = timeToMin(exc.end);
    if (e > s) {
      for (const w of windows) {
        w.start = Math.max(w.start, s);
        w.end = Math.min(w.end, e);
      }
    }
  }

  // Ocupação por profissional (duração REAL de cada booking + buffer).
  const durOf = (b: Booking): number => {
    const s = q.services.find((x) => x.id === b.serviceId);
    return Math.max(5, s?.durationMin || q.durationMin);
  };
  const busy = new Map<string, Array<{ start: number; end: number }>>();
  const load = new Map<string, number>(); // carga no dia (p/ auto)
  const pushBusy = (pid: string, s: number, e: number) => {
    const list = busy.get(pid) || [];
    list.push({ start: s, end: e });
    busy.set(pid, list);
  };
  for (const b of q.bookings) {
    if (b.date !== q.dateISO || b.status === 'cancelled') continue;
    const s = timeToMin(b.time);
    const e = s + durOf(b) + Math.max(0, q.bufferMin);
    load.set(b.professionalId || '', (load.get(b.professionalId || '') || 0) + 1);
    if (soloMode || !b.professionalId) {
      // sem dono definido: bloqueia todos (seguro)
      for (const pid of eligible) pushBusy(pid, s, e);
      pushBusy('', s, e);
    } else {
      pushBusy(b.professionalId, s, e);
    }
  }

  // Corte do passado + antecedência mínima.
  let minStart = -1;
  if (q.nowHM) {
    minStart = timeToMin(q.nowHM) + Math.max(0, q.leadMin);
  }

  const freeByPro = new Map<string, Set<string>>();
  const candidates = new Set<string>();
  // A2-B3 (F4): distingue "dia sem horário de atendimento" de "horários já
  // encerraram" — a UI não pode chamar de fechado um dia que ESTEVA aberto.
  let dayHadSlots = false; // existia horário de atendimento (antes do corte)
  let pastOnly = true;     // tudo que havia já passou/está no lead time
  for (const w of windows) {
    if (w.end <= w.start) continue;
    const occ = busy.get(w.proId) || [];
    const set = freeByPro.get(w.proId) || new Set<string>();
    for (let t = w.start; t + q.durationMin <= w.end; t += w.step) {
      dayHadSlots = true;
      if (t < minStart) continue;
      pastOnly = false;
      candidates.add(minToTime(t));
      const endT = t + q.durationMin + Math.max(0, q.bufferMin);
      const clash = occ.some((o) => t < o.end && endT > o.start);
      if (!clash) set.add(minToTime(t));
    }
    freeByPro.set(w.proId, set);
  }
  if (!dayHadSlots) {
    // Janela existe, mas é curta demais para a duração deste serviço.
    return { ...empty, closed: true, closedReason: 'no_fit' };
  }
  if (pastOnly) {
    // O dia ESTEVA aberto; todos os horários já passaram (só ocorre hoje,
    // com/sem lead time). Não é "fechado por regra".
    return { ...empty, closed: true, closedReason: 'ended' };
  }

  const union = new Set<string>();
  for (const set of freeByPro.values()) for (const t of set) union.add(t);
  const slots = [...union].sort();
  // Ocupado = passou da grade mas sem profissional livre (visível, desabilitado).
  const occupied = [...candidates].filter((t) => !union.has(t)).sort();

  // Livres por profissional (ordem estável) — o drag-and-drop usa para saber
  // em QUAL coluna o horário realmente cabe.
  const byProfessional: Record<string, string[]> = {};
  for (const [pid, set] of freeByPro) byProfessional[pid] = [...set].sort();

  // Auto: para cada horário, o elegível livre com menor carga no dia.
  const assign: Record<string, string> = {};
  if (!q.professionalId && !soloMode && slots.length > 0) {
    const order = activePros.filter((p) => eligible.has(p.id)).map((p) => p.id);
    for (const t of slots) {
      let best = '';
      let bestLoad = Infinity;
      for (const pid of order) {
        if (!freeByPro.get(pid)?.has(t)) continue;
        const l = load.get(pid) || 0;
        if (l < bestLoad) { best = pid; bestLoad = l; }
      }
      if (best) assign[t] = best;
    }
  }

  return {
    slots, occupied,
    closed: slots.length === 0,
    closedReason: slots.length === 0 ? 'none' : undefined,
    assign, byProfessional,
  };
}

// ═══════════════════════════════════════════════════════════════
// A2-B3 (F4) — ESTADO DO DIA: fechado ≠ lotado ≠ disponível
// ═══════════════════════════════════════════════════════════════
// Derivado do RESULTADO REAL de computeSlots (nenhum segundo motor): o
// usuário passa a ver a CAUSA de um dia sem horários, com ação sugerida.
//   past        → dia já passou;
//   closed      → fechado por exceção ou sem regra de atendimento;
//   full        → ABERTO, mas todas as vagas ocupadas (ou o dia de hoje já
//                 encerrou pelo lead time — não é "fechado", é sem vaga);
//   open        → há horários livres.
export type DayAvailabilityState = 'past' | 'closed' | 'full' | 'open';

export interface DayAvailability {
  state: DayAvailabilityState;
  /** Compatibilidade: `closed` true para past/closed (NÃO para full). */
  closed: boolean;
  /** true quando o dia está aberto e sem nenhuma vaga (lotado/encerrado). */
  full: boolean;
  /** Quantidade de horários livres (0 fora de 'open'). */
  free: number;
  /** Causa honesta, para a UI explicar (e sugerir ação). */
  reason?: 'past' | 'exception' | 'no_windows' | 'no_fit' | 'ended' | 'full';
}

export function dayAvailability(q: SlotQuery, opts: { today?: string } = {}): DayAvailability {
  const today = opts.today || '';
  if (today && q.dateISO < today) {
    return { state: 'past', closed: true, full: false, free: 0, reason: 'past' };
  }
  const r = computeSlots(q);
  if (r.slots.length > 0) {
    return { state: 'open', closed: false, full: false, free: r.slots.length };
  }
  if (r.closedReason === 'exception') {
    return { state: 'closed', closed: true, full: false, free: 0, reason: 'exception' };
  }
  if (r.closedReason === 'no_windows') {
    return { state: 'closed', closed: true, full: false, free: 0, reason: 'no_windows' };
  }
  if (r.closedReason === 'ended') {
    return { state: 'closed', closed: true, full: false, free: 0, reason: 'ended' };
  }
  // 'none': havia janelas — ou tudo ocupou (full), ou nada coube (no_fit):
  if (r.occupied.length > 0) {
    return { state: 'full', closed: false, full: true, free: 0, reason: 'full' };
  }
  return { state: 'closed', closed: true, full: false, free: 0, reason: 'no_fit' };
}

/** Texto humano e honesto para o estado do dia (as telas reutilizam). */
export function dayAvailabilityMessage(d: DayAvailability): string {
  switch (d.reason) {
    case 'past': return 'Esta data já passou.';
    case 'exception': return 'Fechado neste dia (exceção na agenda). Escolha outro dia.';
    case 'no_windows': return 'Fechado neste dia. Escolha outro dia.';
    case 'full': return 'Todos os horários deste dia estão ocupados. Escolha outro dia.';
    case 'ended': return 'Os horários deste dia já encerraram. Escolha outro dia.';
    case 'no_fit': return 'Nenhum horário deste dia comporta este serviço. Escolha outro dia.';
    default: return d.state === 'open' ? '' : 'Nenhum horário disponível nesta data.';
  }
}
