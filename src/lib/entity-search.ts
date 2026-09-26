// ═══════════════════════════════════════════════════════════════
// BUSCA GLOBAL DE ENTIDADES — lógica pura (GODOUTOR final · FASE C)
// ═══════════════════════════════════════════════════════════════
// A busca da topbar deixou de ser só NAVEGAÇÃO e passou a achar PEOPLE
// (pelo nome, telefone ou e-mail), PACIENTES (pets), AGENDAMENTOS e
// CONVERSAS — sempre agrupada, sempre com destino que o usuário pode
// abrir. A regra de permissão mora no servidor (/api/search decide quais
// grupos existem); aqui só mora a PUREZA: dobrar texto, casar dígitos,
// ranquear e limitar.
//
// Contrato: nenhum I/O. Testado em src/lib/__tests__/entity-search.test.ts.

/** Grupos canônicos, na ordem em que aparecem na busca. */
export type EntityGroup = 'pessoas' | 'pets' | 'agendamentos' | 'conversas';

export interface EntityHit {
  /** Chave estável (id da entidade). */
  id: string;
  group: EntityGroup;
  /** Linha principal (nome da pessoa, do pet, "Serviço — Nome"...). */
  title: string;
  /** Linha secundária (telefone, tutor, data/hora, última mensagem). */
  subtitle: string;
  /** Ícone do catálogo existente (components/icons). */
  icon: string;
  /** Destino REAL que o usuário pode abrir (já com ?b= quando preciso). */
  href: string;
}

/** Minúsculas e sem acento (mesma dobra da busca de navegação). */
export function foldText(value: string): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Só dígitos — para telefone, a busca ignora pontuação e DDD incompleto casa. */
export function digitsOnly(value: string): string {
  return String(value || '').replace(/\D+/g, '');
}

export interface Matchable {
  name?: string;
  phone?: string;
  email?: string;
  extra?: string;
}

/**
 * A consulta casa com a entidade? Nome/e-mail/extra casam por texto dobrado
 * (prefixo ou palavra); telefone casa por DÍGITOS contidos — digitar
 * "21988" acha "(21) 9889-6646", com ou sem pontuação.
 */
export function entityMatches(query: string, entity: Matchable): boolean {
  const q = foldText(query).trim();
  if (!q) return false;
  const qDigits = digitsOnly(query);
  if (qDigits.length >= 3 && entity.phone && digitsOnly(entity.phone).includes(qDigits)) return true;
  const haystack = foldText([entity.name, entity.email, entity.extra].filter(Boolean).join(' ┃ '));
  if (haystack.includes(q)) return true;
  // "maria clara" casa com "Maria Clara Souza" (todas as palavras presentes).
  const words = q.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((w) => haystack.includes(w));
}

/**
 * Junta os resultados POR GRUPO e limita cada grupo — a busca global é um
 * atalho, não um relatório. Grupos vazios não aparecem.
 */
export function groupEntityHits(hits: EntityHit[], perGroup = 5): Array<{ group: EntityGroup; items: EntityHit[] }> {
  const order: EntityGroup[] = ['pessoas', 'pets', 'agendamentos', 'conversas'];
  const out: Array<{ group: EntityGroup; items: EntityHit[] }> = [];
  for (const group of order) {
    const items = hits.filter((h) => h.group === group).slice(0, perGroup);
    if (items.length > 0) out.push({ group, items });
  }
  return out;
}

export const ENTITY_GROUP_LABELS: Record<EntityGroup, string> = {
  pessoas: 'Pessoas',
  pets: 'Pacientes',
  agendamentos: 'Agendamentos',
  conversas: 'Conversas',
};

/** Debounce da busca de entidades (ms) e tamanho mínimo da consulta. */
export const ENTITY_SEARCH_DEBOUNCE_MS = 250;
export const ENTITY_SEARCH_MIN_CHARS = 2;
