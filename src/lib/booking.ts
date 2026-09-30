// Atribuição de profissional — política interna da agenda.
// O payload público nunca escolhe profissional (segurança: servidor resolve).
// Política atual: menor carga no dia (slots/assign). Futuros modos de
// distribuição (opcional por clínica/canal) plugam aqui. Não há promessa
// de balanceamento automático universal na experiência clínica padrão.
import type { Professional, Service } from './types';

export type ServiceProfessionalMode = 'all' | 'selected';

/** Modo canônico: 'all' = todos os ativos; 'selected' = somente professionalIds. Backcompat: sem professionalMode, []→all, [ids]→selected */
export function serviceProfessionalMode(service: Pick<Service, 'professionalMode' | 'professionalIds'> | null | undefined): ServiceProfessionalMode {
  if (service?.professionalMode === 'all' || service?.professionalMode === 'selected') return service.professionalMode;
  return (service?.professionalIds || []).length ? 'selected' : 'all';
}

/** Profissionais ativos e elegíveis para o serviço (usa professionalMode). */
export function eligibleProfessionalIds(service: Service, professionals: Professional[]): string[] {
  const active = professionals.filter((p) => p.active !== false);
  const mode = serviceProfessionalMode(service);
  if (mode === 'all') return active.map((p) => p.id);
  const ids = service.professionalIds || [];
  if (!ids.length) return [];
  return active.filter((p) => ids.includes(p.id)).map((p) => p.id);
}

/**
 * Helper canônico para disponibilidade/slots.
 * Diferencia legacy solo (sem professionalMode e sem profissionais) de explicit.
 * - legacy solo: service.professionalMode===undefined && service.professionalIds.length===0 && professionals.length===0 → undefined (permite fallback solo)
 * - explicit all com zero ativos → [] (ninguém)
 * - explicit selected [] → [] (ninguém)
 * - all com ativos → [ids]
 * - selected [A] → [A]
 */
export function slotEligibleProfessionalIds(service: Service | null | undefined, professionals: Professional[]): string[] | undefined {
  const hasExplicitMode = service?.professionalMode === 'all' || service?.professionalMode === 'selected';
  if (!hasExplicitMode) {
    const ids = (service as any)?.professionalIds as string[] | undefined;
    const isLegacyEmpty = !ids || ids.length === 0;
    const noProfessionals = !professionals || professionals.length === 0 || professionals.filter(p => p.active !== false).length === 0;
    if (isLegacyEmpty && noProfessionals) {
      return undefined; // compatibilidade solo legado
    }
  }
  // Para todos os demais casos, usa a regra canônica (inclui explicit all com 0 → [])
  const list = service ? eligibleProfessionalIds(service as Service, professionals as Professional[]) : [];
  return list;
}

/**
 * A3.4 (teste humano) — ELEGIBILIDADE SERVIÇO × PROFISSIONAL (regra única).
 *
 * O serviço pode exigir profissionais específicos (`Service.professionalIds`).
 * Quando exige, ninguém fora daquela lista pode ASSUMIR o atendimento — nem no
 * balcão, nem pela fila, nem abrindo o registro. Quando NÃO exige (lista
 * vazia), a política atual continua: qualquer profissional ativo atende.
 *
 * Isto vivia só na UI da agenda. Passa a viver aqui porque três superfícies
 * precisam da MESMA resposta: a tela (que só oferece elegíveis), a fila (que
 * recusa iniciar com inelegível) e o registro do atendimento (que revalida).
 */
export const PROFESSIONAL_NOT_ELIGIBLE_ERROR = 'Este serviço não é atendido por este profissional.';

/** O serviço exige profissionais específicos? (all = não, selected = sim). */
export function serviceRequiresProfessional(service: Pick<Service, 'professionalMode' | 'professionalIds'> | null | undefined): boolean {
  return serviceProfessionalMode(service) === 'selected';
}

/**
 * O profissional atende ESTE serviço? all = qualquer ativo; selected = só lista
 * (`` nunca atende). Usa a mesma regra de eligibleProfessionalIds.
 */
export function professionalServesService(
  service: Pick<Service, 'professionalMode' | 'professionalIds'> | null | undefined,
  professionalId: string,
  professionals: Professional[],
): boolean {
  if (!professionalId) return false;
  const mode = serviceProfessionalMode(service);
  if (mode === 'all') {
    return professionals.some((p) => p.id === professionalId && p.active !== false);
  }
  return eligibleProfessionalIds(service as Service, professionals).includes(professionalId);
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
