// Fonte única de status: rótulos do consumidor, rótulos do painel,
// descrições e transições válidas (máquina de estados).
// NENHUM outro arquivo deve definir label de status.
import type { BookingStatus, LeadStatus, OrderStatus } from './types';

export type Tone = 'amber' | 'emerald' | 'blue' | 'zinc' | 'red' | 'purple';

export interface StatusDef {
  consumer: string; // rótulo na página pública / Minha conta
  panel: string; // rótulo no painel do lojista
  desc: string; // explicação curta
  tone: Tone;
}

// ── Agendamentos ──
// Pipeline: pending -> confirmed -> completed (+ no_show, cancelled).
// "Na agenda" = confirmed (apresentação, NÃO status novo).
export const BOOKING_STATUS: Record<BookingStatus, StatusDef> = {
  pending: { consumer: 'Aguardando confirmação', panel: 'Pendente', desc: 'Recebido, aguardando confirmação do negócio.', tone: 'amber' },
  confirmed: { consumer: 'Na agenda', panel: 'Confirmado', desc: 'Confirmado — está na agenda.', tone: 'emerald' },
  completed: { consumer: 'Concluído', panel: 'Concluído', desc: 'Atendimento realizado.', tone: 'blue' },
  cancelled: { consumer: 'Cancelado', panel: 'Cancelado', desc: 'Cancelado.', tone: 'zinc' },
  no_show: { consumer: 'Não compareceu', panel: 'Faltou', desc: 'Cliente não compareceu.', tone: 'red' },
};

export const BOOKING_FLOW: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled', 'pending'],
  completed: [],
  cancelled: ['pending'],
  no_show: ['confirmed'],
};

// ── Pedidos ──
export const ORDER_STATUS: Record<OrderStatus, StatusDef> = {
  new: { consumer: 'Recebido', panel: 'Novo', desc: 'Pedido recebido, aguardando aceite.', tone: 'amber' },
  accepted: { consumer: 'Aceito', panel: 'Aceito', desc: 'Aceito pelo negócio.', tone: 'blue' },
  preparing: { consumer: 'Em preparo', panel: 'Em preparo', desc: 'Sendo preparado.', tone: 'purple' },
  ready: { consumer: 'Pronto', panel: 'Pronto', desc: 'Pronto para entrega/retirada.', tone: 'emerald' },
  completed: { consumer: 'Entregue', panel: 'Entregue', desc: 'Entregue/concluído.', tone: 'emerald' },
  cancelled: { consumer: 'Cancelado', panel: 'Cancelado', desc: 'Cancelado.', tone: 'zinc' },
};

export const ORDER_FLOW: Record<OrderStatus, OrderStatus[]> = {
  new: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// ── Leads / clientes ──
export const LEAD_STATUS: Record<LeadStatus, StatusDef> = {
  new: { consumer: 'Novo', panel: 'Novo', desc: 'Contato novo.', tone: 'blue' },
  contacted: { consumer: 'Contatado', panel: 'Contatado', desc: 'Já houve contato.', tone: 'amber' },
  qualified: { consumer: 'Qualificado', panel: 'Qualificado', desc: 'Interesse qualificado.', tone: 'purple' },
  converted: { consumer: 'Cliente', panel: 'Convertido', desc: 'Virou pedido/agendamento.', tone: 'emerald' },
  lost: { consumer: 'Perdido', panel: 'Perdido', desc: 'Não converteu.', tone: 'zinc' },
};

export const LEAD_FLOW: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'qualified', 'converted', 'lost'],
  contacted: ['qualified', 'converted', 'lost', 'new'],
  qualified: ['converted', 'lost', 'contacted'],
  converted: ['contacted'],
  lost: ['new'],
};

export function canTransition<T extends string>(flow: Record<T, T[]>, from: T, to: T): boolean {
  if (from === to) return true;
  return (flow[from] || []).includes(to);
}

// Classes do painel (Tailwind) por tom.
export function toneCls(tone: Tone): string {
  switch (tone) {
    case 'amber': return 'bg-amber-100 text-amber-800';
    case 'emerald': return 'bg-emerald-100 text-emerald-800';
    case 'blue': return 'bg-blue-100 text-blue-800';
    case 'red': return 'bg-red-100 text-red-700';
    case 'purple': return 'bg-purple-100 text-purple-800';
    default: return 'bg-zinc-100 text-zinc-500';
  }
}
