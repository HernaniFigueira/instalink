import { serviceProfessionalMode } from './booking';

/** Prefill only; availability and booking creation remain in their existing flows. */
export function newBookingSeedFromAgendaCell(
  cell: { date: string; professionalId?: string | null },
  time: string,
): { date: string; time: string; professionalId: string } {
  return {
    date: cell.date,
    time,
    professionalId: cell.professionalId || '',
  };
}

/** Forma mínima do catálogo necessária para raciocínio de elegibilidade. */
export interface BookableServiceLike {
  id: string;
  active?: boolean;
  bookable?: boolean;
  professionalIds?: string[];
  professionalMode?: 'all' | 'selected';
}

/**
 * Elegibilidade pelo VÍNCULO REAL do catálogo (`service.professionalMode` + `professionalIds`) —
 * nunca por nome, cargo ou especialidade textual.
 *
 * Usa a mesma regra canônica de `lib/booking.ts`.
 */
export function serviceAcceptsProfessional(
  service: Pick<BookableServiceLike, 'professionalIds' | 'professionalMode'> | undefined,
  professionalId: string,
): boolean {
  if (!professionalId) return true;
  if (!service) return true;
  const mode = serviceProfessionalMode(service as any);
  if (mode === 'all') return true;
  const ids = (service as any).professionalIds || [];
  if (!ids.length) return false; // selected + [] = ninguém
  return ids.includes(professionalId);
}

/**
 * CONVENIÊNCIA do clique na grade: quando, pelos vínculos reais do catálogo,
 * existe EXATAMENTE UM serviço ativo/agendável elegível para o profissional da
 * coluna clicada, esse serviço pode entrar pré-selecionado — assim data, hora
 * e profissionais deixam de ser intenção invisível e passam a aparecer no
 * fluxo (o bloco de horários só existe com serviço escolhido).
 *
 * Com 0 ou com mais de 1 serviço elegível NÃO há pré-seleção: escolher serviço
 * continua sendo decisão de quem agenda. E sem profissional (ex.: colunas de
 * dia na Semana) nunca se inventa vínculo — devolve ''.
 */
export function uniqueEligibleServiceId(
  services: Array<BookableServiceLike>,
  professionalId: string,
): string {
  if (!professionalId) return '';
  const eligible = services.filter(
    (s) => s.bookable && s.active !== false && serviceAcceptsProfessional(s, professionalId),
  );
  return eligible.length === 1 ? eligible[0].id : '';
}
