export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Lê os itens de FAQ salvos nas configurações do bloco.
 *
 * O formato canônico continua sendo `{ q, a }`. Os nomes extensos
 * `{ question, answer }` são aceitos apenas como compatibilidade defensiva
 * para dados legados, sem exigir migração do banco.
 */
export function readFaqItems(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];

    const record = item as Record<string, unknown>;
    const question = typeof record.q === 'string'
      ? record.q
      : (typeof record.question === 'string' ? record.question : '');
    const answer = typeof record.a === 'string'
      ? record.a
      : (typeof record.answer === 'string' ? record.answer : '');

    return [{ q: question, a: answer }];
  });
}

/** Itens que podem aparecer na página pública. */
export function visibleFaqItems(value: unknown): FaqItem[] {
  return readFaqItems(value).filter((item) => item.q.trim().length > 0);
}
