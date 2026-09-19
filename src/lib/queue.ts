// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — FILA DE ESPERA (regras puras)
// ═══════════════════════════════════════════════════════════════
// A fila é o "agora" do balcão: quem chegou, em que ordem, há quanto tempo
// espera e quem já está sendo atendido. Vive SEPARADA da agenda (QueueEntry,
// não Booking): um cliente sem horário marcado não pode virar um agendamento
// falso — isso mentiria sobre disponibilidade e poluiria os relatórios.
//
// Sem I/O e sem relógio global: tudo recebe `now`/`date` de fora, o que torna
// a fila testável e o comportamento determinístico no servidor.
import type { QueueEntry, QueueStatus } from './types';

export interface QueueStatusDef {
  id: QueueStatus;
  label: string;
  /** Tom do design system (Badge). */
  tone: 'zinc' | 'blue' | 'amber' | 'green' | 'red';
  /** Ocupa lugar na fila (a pessoa ainda está no balcão). */
  active: boolean;
}

export const QUEUE_STATUS: Record<QueueStatus, QueueStatusDef> = {
  waiting: { id: 'waiting', label: 'Aguardando', tone: 'amber', active: true },
  called: { id: 'called', label: 'Chamado', tone: 'blue', active: true },
  in_service: { id: 'in_service', label: 'Em atendimento', tone: 'green', active: true },
  done: { id: 'done', label: 'Atendido', tone: 'zinc', active: false },
  left: { id: 'left', label: 'Desistiu', tone: 'red', active: false },
};

export const QUEUE_STATUS_IDS: QueueStatus[] = Object.keys(QUEUE_STATUS) as QueueStatus[];

/** Transições permitidas — a UI não inventa caminho, o servidor recusa o resto. */
export const QUEUE_TRANSITIONS: Record<QueueStatus, QueueStatus[]> = {
  waiting: ['called', 'in_service', 'left', 'done'],
  called: ['in_service', 'waiting', 'left', 'done'],
  in_service: ['done', 'left'],
  done: [],
  left: [],
};

export function isQueueStatus(v: unknown): v is QueueStatus {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(QUEUE_STATUS, v);
}

export function queueTransitionAllowed(from: QueueStatus, to: QueueStatus): boolean {
  return from === to ? false : (QUEUE_TRANSITIONS[from] || []).includes(to);
}

/** Entradas ainda em jogo nesta unidade (qualquer dia). */
export function activeQueue(entries: QueueEntry[], businessId: string): QueueEntry[] {
  return entries.filter((e) => e.businessId === businessId && (QUEUE_STATUS[e.status]?.active ?? false));
}

/**
 * Fila do DIA do negócio, na ordem de atendimento: primeiro quem entrou antes;
 * empate (mesmo minuto) mantém a ordem de criação estável pelo id.
 */
export function queueForDay(entries: QueueEntry[], businessId: string, date: string): QueueEntry[] {
  return entries
    .filter((e) => e.businessId === businessId && e.date === date && (QUEUE_STATUS[e.status]?.active ?? false))
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
}

/** Minutos de espera: entre a chegada e o início do atendimento (congela). */
export function waitMinutes(entry: QueueEntry, now: Date): number {
  const end = entry.startedAt || (entry.status === 'done' || entry.status === 'left' ? entry.endedAt : '');
  const from = Date.parse(entry.createdAt);
  const to = end ? Date.parse(end) : now.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 60000));
}

/** Posição (1-based) na fila do dia; 0 quando a entrada não está na fila. */
export function queuePosition(entries: QueueEntry[], businessId: string, date: string, id: string): number {
  const list = queueForDay(entries, businessId, date);
  const idx = list.findIndex((e) => e.id === id);
  return idx < 0 ? 0 : idx + 1;
}

/** Texto curto de espera para o balcão ("há 12 min" · "há 1h05"). */
export function waitLabel(minutes: number): string {
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Limite a partir do qual a espera vira atenção (não é regra de negócio: é leitura). */
export const QUEUE_LONG_WAIT_MIN = 30;

export interface QueueSummary {
  waiting: number;
  called: number;
  inService: number;
  /** Maior espera entre quem aguarda/chamado (minutos). */
  longestWaitMin: number;
  /** Alguém aguardando mais que o limite confortável. */
  longWait: boolean;
  next: QueueEntry | null;
}

export function queueSummary(entries: QueueEntry[], businessId: string, date: string, now: Date): QueueSummary {
  const list = queueForDay(entries, businessId, date);
  const waiting = list.filter((e) => e.status === 'waiting' || e.status === 'called');
  const longest = waiting.reduce((max, e) => Math.max(max, waitMinutes(e, now)), 0);
  return {
    waiting: list.filter((e) => e.status === 'waiting').length,
    called: list.filter((e) => e.status === 'called').length,
    inService: list.filter((e) => e.status === 'in_service').length,
    longestWaitMin: longest,
    longWait: longest >= QUEUE_LONG_WAIT_MIN,
    next: waiting[0] || null,
  };
}

/**
 * Próxima entrada a chamar: quem está há mais tempo aguardando. `called` nunca
 * é reescolhido (já foi chamado) — a menos que só exista essa pessoa.
 */
export function nextToCall(entries: QueueEntry[], businessId: string, date: string): QueueEntry | null {
  const list = queueForDay(entries, businessId, date);
  return list.find((e) => e.status === 'waiting') || null;
}
