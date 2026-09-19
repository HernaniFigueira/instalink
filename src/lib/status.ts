// Fonte única de status: rótulos do consumidor, rótulos do painel,
// descrições e transições válidas (máquina de estados).
// NENHUM outro arquivo deve definir label de status.
//
// COR = ESTADO — apresentação por camada:
//  • toneCls (selos/StatusBadge e chips da Dashboard) → cor SÓLIDA,
//    presença forte: o estado precisa ser reconhecido de longe.
//  • BOOKING_BLOCK (blocos da grade da Agenda) → apresentação SUAVE
//    (fundo tonalizado + borda/acento na cor do estado): a Semana com
//    muitos blocos não vira "carnaval", mas o estado continua óbvio
//    pela tonalidade + rótulo impresso no bloco.
// As classes de cor dos estados vivem SOMENTE aqui. Páginas e componentes
// importam destes exports — nunca redefinem mapas locais de cor por status.
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

// ── Agenda: bloco do appointment (P1.1 — apresentação suave) ──
// Mesma semântica de cor do resto do produto, sem o peso do preenchimento
// sólido: fundo tonalizado + borda leve + acento forte na lateral esquerda
// (a página usa `border-l-4`). O estado nunca depende SÓ da cor — cada
// bloco também exibe o rótulo do status, agora na própria tonalidade.
export const BOOKING_BLOCK: Record<BookingStatus, string> = {
  pending: 'border-orange-200 border-l-orange-500 bg-orange-50 text-orange-950',
  confirmed: 'border-emerald-200 border-l-emerald-500 bg-emerald-50 text-emerald-950',
  completed: 'border-blue-200 border-l-blue-500 bg-blue-50 text-blue-950',
  cancelled: 'border-red-200 border-l-red-400 bg-red-50 text-red-900',
  no_show: 'border-zinc-200 border-l-zinc-400 bg-zinc-100 text-zinc-600',
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
// status sozinho, então o bloco ganha o marcador de atenção pedindo decisão.
// A3.3: o amarelo apagado (yellow-300) virou âmbar quente com contraste
// real — alerta precisa ser perceptível sem ser gritante.
export const ATTENTION_RING_CLS = 'ring-2 ring-inset ring-amber-400';
export const ATTENTION_MARK_CLS = 'bg-[var(--attention-mark)] text-[#5c3800]';
