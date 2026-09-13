// Regra central de atribuição de profissional.
// O cliente NUNCA escolhe; o servidor resolve. Política atual: "equilibrar
// equipe" (menor carga no dia) — implementada pelo motor de slots (assign).
// Arquitetado para futuros modos de distribuição plugarem aqui.
import type { Professional, Service } from './types';

/** Profissionais ativos e elegíveis para o serviço ([] = todos). */
export function eligibleProfessionalIds(service: Service, professionals: Professional[]): string[] {
  const active = professionals.filter((p) => p.active !== false);
  if (!(service.professionalIds || []).length) return active.map((p) => p.id);
  return active.filter((p) => (service.professionalIds || []).includes(p.id)).map((p) => p.id);
}

export type BookingActor = 'owner' | 'customer';

/**
 * Decide se uma requisição de agendamento opera como DONO ou como CLIENTE.
 *
 * Regra absoluta: o modo proprietário SÓ existe com intenção explícita
 * (`asOwner === true`) E sessão válida de dono do próprio negócio. A mera
 * existência de uma sessão de lojista NUNCA transforma uma requisição
 * pública em operação interna — um dono logado visitando a própria página
 * pública continua no fluxo de CLIENTE.
 */
export function bookingMode(opts: {
  asOwner?: unknown;
  ownerLogged: boolean;
  ownerMatches: boolean;
}): BookingActor {
  if (opts.asOwner === true && opts.ownerLogged && opts.ownerMatches) return 'owner';
  return 'customer';
}

/**
 * Resolve o profissional de um horário.
 * - `requested` (do payload) é SEMPRE ignorado para cliente; só o dono pode
 *   indicar, e apenas se o profissional for ativo e elegível para o serviço.
 * - Sem indicação válida, usa o assign (menor carga no dia).
 */
export function resolveProfessional(opts: {
  service: Service;
  professionals: Professional[];
  assign: Record<string, string>;
  time: string;
  requested?: string;
  allowRequested?: boolean;
}): string {
  const eligible = new Set(eligibleProfessionalIds(opts.service, opts.professionals));
  if (opts.allowRequested && opts.requested && eligible.has(opts.requested)) return opts.requested;
  return opts.assign[opts.time] || '';
}
