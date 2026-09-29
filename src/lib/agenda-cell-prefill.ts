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
