// Motor universal de disponibilidade (serve barbearia, clínica, pet, etc).
// Considera simultaneamente: regras (dia/profissional/serviço), exceções
// (dia fechado ou horário especial), duração real do serviço, buffers,
// bookings existentes (com a duração real de cada um), dia atual (corta o
// passado + antecedência mínima) e vínculo serviço↔profissional.
import type { Availability, AvailabilityException, Booking, Professional, Service } from './types';
import { timeToMin, minToTime } from './utils';

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
  closed: boolean;
  // auto mode: melhor profissional por horário (menor carga no dia)
  assign: Record<string, string>;
}

interface Window { proId: string; start: number; end: number; step: number }

export function computeSlots(q: SlotQuery): SlotResult {
  const empty: SlotResult = { slots: [], closed: false, assign: {} };

  const exc = q.exceptions.find((e) => e.date === q.dateISO);
  if (exc?.closed) return { slots: [], closed: true, assign: {} };

  const activePros = q.professionals.filter((p) => p.active !== false);
  const eligible = new Set(
    q.eligibleProIds.length > 0
      ? activePros.filter((p) => q.eligibleProIds.includes(p.id)).map((p) => p.id)
      : activePros.map((p) => p.id),
  );
  // Negócio sem equipe: opera como "profissional único" (id '').
  const soloMode = activePros.length === 0;
  if (q.professionalId && !soloMode && !eligible.has(q.professionalId)) return empty;

  // Janelas aplicáveis (regra do dia + serviço + profissional).
  const windows: Window[] = [];
  for (const r of q.rules) {
    if (r.weekday !== q.weekday) continue;
    if (r.serviceId && r.serviceId !== q.serviceId) continue;
    const start = timeToMin(r.start);
    const end = timeToMin(r.end);
    if (!(end > start)) continue;
    const step = Math.max(10, r.slotMin || 30);
    if (q.professionalId) {
      if (r.professionalId && r.professionalId !== q.professionalId) continue;
      windows.push({ proId: q.professionalId, start, end, step });
    } else if (soloMode) {
      if (r.professionalId) continue;
      windows.push({ proId: '', start, end, step });
    } else if (r.professionalId) {
      if (!eligible.has(r.professionalId)) continue;
      windows.push({ proId: r.professionalId, start, end, step });
    } else {
      // regra genérica vale para cada profissional elegível
      for (const pid of eligible) windows.push({ proId: pid, start, end, step });
    }
  }
  if (windows.length === 0) return empty;

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
  for (const w of windows) {
    if (w.end <= w.start) continue;
    const occ = busy.get(w.proId) || [];
    const set = freeByPro.get(w.proId) || new Set<string>();
    for (let t = w.start; t + q.durationMin <= w.end; t += w.step) {
      if (t < minStart) continue;
      const endT = t + q.durationMin + Math.max(0, q.bufferMin);
      const clash = occ.some((o) => t < o.end && endT > o.start);
      if (!clash) set.add(minToTime(t));
    }
    freeByPro.set(w.proId, set);
  }

  const union = new Set<string>();
  for (const set of freeByPro.values()) for (const t of set) union.add(t);
  const slots = [...union].sort();

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

  return { slots, closed: slots.length === 0, assign };
}
