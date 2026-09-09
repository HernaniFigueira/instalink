// Matemática de analytics — funções puras, sem I/O (cobertas por testes).
// Usadas pelas rotas /api/analytics e /api/overview.

// Taxa part/whole em % com 1 casa. whole<=0 → 0.
export function convRate(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// Variação % cur vs prev. prev<=0 → null (sem base de comparação).
export function pctChange(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// % que abandonou entre a etapa from e a etapa to (0–100).
export function dropOff(from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.round((1 - to / from) * 1000) / 10;
}

export interface CountEvent {
  createdAt: string; // ISO
  type: string;
}

// Série diária: para cada dia de `days` (YYYY-MM-DD), conta eventos por tipo.
export function seriesByDay(
  events: CountEvent[],
  days: string[],
  types: string[],
): Array<{ day: string; counts: Record<string, number> }> {
  const byDay = new Map<string, Record<string, number>>();
  for (const day of days) {
    const counts: Record<string, number> = {};
    for (const t of types) counts[t] = 0;
    byDay.set(day, counts);
  }
  for (const e of events) {
    const day = e.createdAt.slice(0, 10);
    const row = byDay.get(day);
    if (row && e.type in row) row[e.type] += 1;
  }
  return days.map((day) => ({ day, counts: byDay.get(day) || {} }));
}

// Top N de um mapa chave→contagem, ordenado desc.
export function topN(record: Record<string, number>, n: number): Array<{ key: string; value: number }> {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, n))
    .map(([key, value]) => ({ key, value }));
}

// Conversão etapa-a-etapa de um funil (valores absolutos → % vs etapa anterior).
// A primeira etapa sempre retorna 100.
export function funnelRates(values: number[]): number[] {
  return values.map((v, i) => {
    if (i === 0) return 100;
    const prev = values[i - 1];
    if (prev <= 0) return 0;
    return Math.round((v / prev) * 1000) / 10;
  });
}
