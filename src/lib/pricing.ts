// ═══════════════════════════════════════════════════════════════
// O QUE É PÚBLICO NUM SERVIÇO — nome, preço e descrição
// ═══════════════════════════════════════════════════════════════
// REGRA DO PRODUTO:
//   • preço É público POR CONFIGURAÇÃO (Service.showPrice, padrão ligado);
//     desligado, o preço continua salvo e disponível internamente — só sai
//     da página pública e do assistente;
//   • descrição É pública (quando existir);
//   • duração NÃO é pública. Ela continua existindo internamente para agenda,
//     disponibilidade, conflitos, buffer e cálculo de horários — apenas deixa
//     de ser informação exibida ao cliente.
//
// Consequência: nenhum rótulo público pode conter "30 min", "45 min", "60 min"
// nem o intervalo "14:00–15:00". O resumo do agendamento passa a ser
// "14/09 · 14:00" e "R$ 180".
//
// Este módulo é a fonte única desses rótulos (página pública, Minha conta e
// componentes de agendamento) e é coberto por testes.
import type { Service } from './types';
import { formatDateShort, humanDay } from './tz';
import { money } from './utils';

export interface PublicServiceInfo {
  name: string;
  /** Centavos. */
  price: number;
  description: string;
  /** `true` quando há descrição para exibir. */
  hasDescription: boolean;
}

/**
 * O preço deste serviço pode aparecer publicamente?
 * `showPrice === false` → NÃO (preço continua salvo/interno).
 * Ausente (legado) ou true → sim (comportamento histórico preservado).
 */
export function priceVisible(service: Pick<Service, 'showPrice'> | null | undefined): boolean {
  return (service as any)?.showPrice !== false;
}

/** Recorte público de um serviço — deliberadamente SEM duração. */
export function publicServiceInfo(
  service: Pick<Service, 'name' | 'price' | 'description'> | null | undefined,
): PublicServiceInfo {
  const description = String(service?.description || '').trim();
  return {
    name: String(service?.name || ''),
    price: Number(service?.price) || 0,
    description,
    hasDescription: description.length > 0,
  };
}

/** "R$ 180" */
export function publicPriceLabel(cents: number): string {
  return money(cents || 0);
}

/**
 * Linha de metadados pública de um serviço.
 * Com descrição → a descrição. Sem descrição → string vazia (a UI não
 * renderiza linha de duração "de mentira" para preencher espaço).
 */
export function publicServiceMeta(service: Pick<Service, 'price' | 'description'>): string {
  const info = publicServiceInfo(service as Pick<Service, 'name' | 'price' | 'description'>);
  return info.hasDescription ? info.description : '';
}

/** Linha secundária pública: descrição quando existe (nunca duração). */
export function publicServiceSecondary(service: Pick<Service, 'description'>): string {
  const description = String(service?.description || '').trim();
  return description;
}

/**
 * Resumo público do agendamento: "14/09 · 14:00" (ou "Hoje · 14:00").
 * O fim do horário NÃO aparece — o sistema continua sabendo a duração.
 */
export function publicBookingSummary(
  dateISO: string,
  time: string,
  opts: { today?: string; useHumanDay?: boolean } = {},
): string {
  const hm = String(time || '').slice(0, 5);
  const day = opts.useHumanDay
    ? humanDay(dateISO, opts.today)
    : formatDateShort(dateISO);
  return hm ? `${day} · ${hm}` : day;
}

/** Preço do resumo público: apenas "R$ 180" (sem "· 60 min"). */
export function publicBookingPrice(cents: number): string {
  return publicPriceLabel(cents);
}

// ── Guardas usados por testes de regressão ───────────────────
/** Texto contém duração explícita ("60 min", "45min")? */
export function hasDurationText(text: string): boolean {
  return /\b\d{1,4}\s*min\b/i.test(String(text || ''));
}

/** Texto contém intervalo de horário ("14:00–15:00", "14:00-15:00")? */
export function hasTimeRangeText(text: string): boolean {
  return /\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}/.test(String(text || ''));
}

/** Um rótulo é seguro para a página pública? */
export function isPublicSafeLabel(text: string): boolean {
  return !hasDurationText(text) && !hasTimeRangeText(text);
}

/**
 * Duração continua sendo usada INTERNAMENTE (agenda, disponibilidade,
 * conflito, buffer). Esta constante documenta a intenção e é usada pelos
 * testes para garantir que a informação não sumiu do domínio.
 */
export const DURATION_IS_INTERNAL_ONLY = true;
