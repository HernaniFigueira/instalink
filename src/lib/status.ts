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
  cancelled: { consumer: 'Cancelado', panel: 'Cancelado', desc: 'Cancelado.', tone: 'red' },
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
  lost: { consumer: 'Perdido', panel: 'Perdido', desc: 'Não converteu.', tone: 'red' },
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
/**
 * Selo de status em apresentação SUAVE (A3.3 — convergência visual, ponto 5).
 *
 * Antes isto devolvia blocos sólidos (`bg-emerald-600 text-white`), que numa
 * lista de 30 atendimentos viravam uma parede de cor saturada. O estado agora é
 * reconhecido por **fundo tonalizado + texto na cor + borda levíssima** — a
 * mesma lógica que a grade da Agenda já usava em `BOOKING_BLOCK`.
 *
 * Duas regras que não mudam:
 *   • a cor NUNCA é o único indicador (o rótulo vai sempre impresso);
 *   • o texto continua nítido — suave não é apagado.
 *
 * Tudo vem dos tokens do design system: nenhum hex novo por status.
 */
export function toneCls(tone: Tone): string {
  switch (tone) {
    // Pendente / aguardando → âmbar claro, texto âmbar escuro.
    case 'amber':
    case 'orange':
      return 'bg-[var(--warning-bg)] text-[var(--warning-fg)] border-[var(--warning-border)]';
    // Alerta quente (atenção de fechamento) → um degrau acima do âmbar.
    case 'yellow':
      return 'bg-[var(--attention-bg)] text-[var(--attention-fg)] border-[var(--attention-border)]';
    // Confirmado / ativo / conectado → verde-mint claro.
    case 'emerald':
      return 'bg-[var(--success-bg)] text-[var(--success-fg)] border-[var(--success-border)]';
    // Concluído / informativo → azul claro.
    case 'blue':
      return 'bg-[var(--info-bg)] text-[var(--info-fg)] border-[var(--info-border)]';
    // Cancelado → vermelho/rosa claro, texto vermelho moderado.
    case 'red':
      return 'bg-[var(--danger-bg)] text-[var(--danger-fg)] border-[var(--danger-border)]';
    // Estados históricos purple convergem para o azul informativo.
    case 'purple':
      return 'bg-[var(--info-bg)] text-[var(--info-fg)] border-[var(--info-border)]';
    // Faltou / neutro → cinza frio muito claro.
    default:
      return 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border-2)]';
  }
}

// ── Agenda: bloco do appointment (P1.1 — apresentação suave) ──
// Mesma semântica de cor do resto do produto, sem o peso do preenchimento
// sólido: fundo tonalizado + borda leve + acento forte na lateral esquerda
// (a página usa `border-l-4`). O estado nunca depende SÓ da cor — cada
// bloco também exibe o rótulo do status, agora na própria tonalidade.
export const BOOKING_BLOCK: Record<BookingStatus, string> = {
  pending: 'border-[var(--warning-border)] border-l-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]',
  confirmed: 'border-[var(--success-border)] border-l-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]',
  completed: 'border-[var(--info-border)] border-l-[var(--info)] bg-[var(--info-bg)] text-[var(--info-fg)]',
  cancelled: 'border-[var(--danger-border)] border-l-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]',
  no_show: 'border-[var(--border)] border-l-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-muted)]',
};

// ── Agenda (visão mês): ponto de cor por estado ──
export const BOOKING_DOT: Record<BookingStatus, string> = {
  pending: 'bg-[var(--warning)]',
  confirmed: 'bg-[var(--success)]',
  completed: 'bg-[var(--info)]',
  cancelled: 'bg-[var(--danger)]',
  no_show: 'bg-[var(--text-faint)]',
};

// ── Robustez de apresentação (B4) ─────────────────────────────────────────
// A Agenda pode receber etapas do WORKFLOW canônico (scheduled|arrived|in_care|
// finalized|cancelled|no_show) no campo `status` — ex.: QA de Clinical Access com
// `status='arrived'`. Isso NÃO é um estado de domínio novo: são as mesmas etapas
// derivadas já declaradas em `types.ts` (`workflow.state`). Aqui só mapeamos a
// APRESENTAÇÃO delas, com fallback neutro, para que status desconhecido/legado
// NUNCA derrube a grade (`BOOKING_STATUS[x].tone` sem guarda era o crash).
export const WORKFLOW_STAGE_DEF: Record<string, StatusDef> = {
  scheduled: { consumer: 'Agendado', panel: 'Agendado', desc: 'Agendado — está na agenda.', tone: 'emerald' },
  arrived: { consumer: 'Chegou', panel: 'Chegou', desc: 'Cliente chegou / presente.', tone: 'blue' },
  in_care: { consumer: 'Em atendimento', panel: 'Em atendimento', desc: 'Em atendimento.', tone: 'purple' },
  finalized: { consumer: 'Finalizado', panel: 'Finalizado', desc: 'Atendimento finalizado.', tone: 'blue' },
};

const FALLBACK_DEF: StatusDef = { consumer: '—', panel: '—', desc: 'Status não reconhecido.', tone: 'zinc' };

/** StatusDef seguro para qualquer status de booking (CRM ou etapa de workflow). */
export function bookingStatusDef(status: string): StatusDef {
  return (BOOKING_STATUS as Record<string, StatusDef>)[status]
    || WORKFLOW_STAGE_DEF[status]
    || { ...FALLBACK_DEF, consumer: status || '—', panel: status || '—' };
}

/** Classe de bloco da grade segura (nunca `undefined`). */
export function bookingBlockCls(status: string): string {
  return (BOOKING_BLOCK as Record<string, string>)[status]
    || { scheduled: BOOKING_BLOCK.confirmed, arrived: BOOKING_BLOCK.completed, in_care: BOOKING_BLOCK.completed, finalized: BOOKING_BLOCK.completed }[status]
    || BOOKING_BLOCK.no_show;
}

/** Ponto de cor seguro (nunca `undefined`). */
export function bookingDotCls(status: string): string {
  return (BOOKING_DOT as Record<string, string>)[status]
    || { scheduled: BOOKING_DOT.confirmed, arrived: BOOKING_DOT.completed, in_care: BOOKING_DOT.completed, finalized: BOOKING_DOT.completed }[status]
    || BOOKING_DOT.no_show;
}

// ── Atenção operacional (pendência de fechamento — NÃO é um status) ──
// Atendimento em aberto com horário já passado: o sistema nunca muda o
// status sozinho, então o bloco ganha o marcador de atenção pedindo decisão.
//
// A3.3 (convergência, ponto 6): o contorno grosso `ring-2 ring-amber-400`
// transformava a Semana inteira numa caixa amarela gritante quando havia
// várias pendências. Agora o anel é de 1px na borda de atenção: perceptível de
// perto, discreto de longe. Quem precisa ser notado de longe é o MARCADOR
// (o ponto com "!"), que continua âmbar quente e com contraste real.
export const ATTENTION_RING_CLS = 'ring-1 ring-inset ring-[var(--attention-border)]';
export const ATTENTION_MARK_CLS = 'bg-[var(--attention-mark)] text-[var(--attention-mark-fg)]';

// ── Encaixe (fit-in) — CARACTERÍSTICA, nunca status ──
// A3.4 (teste humano): o encaixe tinha fundo âmbar POR CIMA do bloco verde do
// status — dois fundos somados viram uma cor suja que não é nem o status nem o
// alerta. Agora o encaixe é acento, não preenchimento:
//   • selo ENCAIXE com tokens laranja próprios (fundo suave apenas no selo);
//   • faixa fina no topo do bloco, dentro dos cantos arredondados.
// O status continua sendo a BASE (fundo e borda esquerdos dele não mudam).
export const FIT_IN_MARK_CLS = 'bg-[var(--fit-in-bg)] border border-dashed border-[var(--fit-in)] text-[var(--fit-in-fg)]';
export const FIT_IN_STRIPE_CLS = 'pointer-events-none absolute inset-x-1 top-0 h-[2px] rounded-pill bg-[var(--fit-in)] opacity-80';
