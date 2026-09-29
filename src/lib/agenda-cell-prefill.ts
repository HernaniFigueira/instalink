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
}

/**
 * Elegibilidade pelo VÍNCULO REAL do catálogo (`service.professionalIds`) —
 * nunca por nome, cargo ou especialidade textual.
 *
 * Um serviço sem lista própria aceita qualquer profissional ativo (a mesma
 * régua de `eligiblePros` no NewBookingSheet e de `computeSlots` no servidor).
 */
export function serviceAcceptsProfessional(
  service: Pick<BookableServiceLike, 'professionalIds'> | undefined,
  professionalId: string,
): boolean {
  if (!professionalId) return true;
  const ids = service?.professionalIds;
  if (!ids || ids.length === 0) return true;
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
