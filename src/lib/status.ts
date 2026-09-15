// Fonte única de status: rótulos do consumidor, rótulos do painel,
// descrições e transições válidas (máquina de estados).
// NENHUM outro arquivo deve definir label de status.
//
// P1 — COR = ESTADO (apresentação sólida, sem transparência apagada):
// as classes de cor dos estados vivem SOMENTE aqui (toneCls para selos,
// BOOKING_BLOCK/BOOKING_DOT para a agenda, ATTENTION_* para pendência de
// fechamento). Páginas e componentes importam destes exports — nunca
// redefinem mapas locais de cor por status.
import type { BookingStatus, LeadStatus, OrderStatus } from './types';

export type Tone = 'amber' | 'orange' | 'yellow' | 'emerald' | 'blue' | 'zinc' | 'red' | 'purple';

export interface StatusDef {
  consumer: string; // rótulo na página pública / Minha conta
  panel: string; // rótulo no painel do lojista
  desc: string; // explicação curta
  tone: Tone;
}

// ── Agendamentos ──
// Pipeline: pending -> confirmed -> completed (+ no_show, cancelled).
// "Na agenda" = confirmed (apresentação, NÃO status novo).
//
// Cores do painel (P1 — significado fixo, mesma cor em todo o produto):
//   pendente   → laranja (aguardando ação)
//   confirmado → verde (na agenda)
//   concluído  → azul (realizado)
//   faltou     → cinza (não aconteceu, sem alarde)
//   cancelado  → vermelho (interrompido)
// Rótulos, descrições e fluxos NÃO mudam — só a apresentação.
export const BOOKING_STATUS: Record<BookingStatus, StatusDef> = {
  pending: { consumer: 'Aguardando confirmação', panel: 'Pendente', desc: 'Recebido, aguardando confirmação do negócio.', tone: 'orange' },
  confirmed: { consumer: 'Na agenda', panel: 'Confirmado', desc: 'Confirmado — está na agenda.', tone: 'emerald' },
  completed: { consumer: 'Concluído', panel: 'Concluído', desc: 'Atendimento realizado.', tone: 'blue' },
  cancelled: { consumer: 'Cancelado', panel: 'Cancelado', desc: 'Cancelado.', tone: 'red' },
  no_show: { consumer: 'Não compareceu', panel: 'Faltou', desc: 'Cliente não compareceu.', tone: 'zinc' },
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

// Classes do painel (Tailwind) por tom — SÓLIDAS e presentes, sem aparência
// de transparência. Incluem a cor da borda para os selos que usam `border`;
// onde não há borda, a cor extra é inócua.
export function toneCls(tone: Tone): string {
  switch (tone) {
    case 'amber': return 'bg-amber-500 text-white border-amber-600';
    case 'orange': return 'bg-orange-600 text-white border-orange-700';
    case 'yellow': return 'bg-yellow-400 text-yellow-950 border-yellow-500';
    case 'emerald': return 'bg-emerald-600 text-white border-emerald-700';
    case 'blue': return 'bg-blue-600 text-white border-blue-700';
    case 'red': return 'bg-red-600 text-white border-red-700';
    case 'purple': return 'bg-violet-600 text-white border-violet-700';
    default: return 'bg-zinc-500 text-white border-zinc-600';
  }
}

// ── Agenda: bloco do appointment (preenchimento sólido por estado) ──
// O texto do bloco é sempre branco semibold sobre o preenchimento; o estado
// nunca depende SÓ da cor — cada bloco também exibe o rótulo do status.
export const BOOKING_BLOCK: Record<BookingStatus, string> = {
  pending: 'border-orange-800 bg-orange-600 text-white',
  confirmed: 'border-emerald-800 bg-emerald-600 text-white',
  completed: 'border-blue-800 bg-blue-600 text-white',
  cancelled: 'border-red-800 bg-red-600 text-white',
  no_show: 'border-zinc-700 bg-zinc-500 text-white',
};

// ── Agenda (visão mês): ponto de cor por estado ──
export const BOOKING_DOT: Record<BookingStatus, string> = {
  pending: 'bg-orange-500',
  confirmed: 'bg-emerald-500',
  completed: 'bg-blue-500',
  cancelled: 'bg-red-500',
  no_show: 'bg-zinc-400',
};

// ── Atenção operacional (pendência de fechamento — NÃO é um status) ──
// Atendimento em aberto com horário já passado: o sistema nunca muda o
// status sozinho, então o bloco ganha o marcador amarelo pedindo decisão.
export const ATTENTION_RING_CLS = 'ring-2 ring-inset ring-yellow-300';
export const ATTENTION_MARK_CLS = 'bg-yellow-300 text-yellow-950';
