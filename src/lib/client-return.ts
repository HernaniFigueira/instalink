// ═══════════════════════════════════════════════════════════════
// RETORNO LISTA ↔ FICHA DE CLIENTES (§16)
// ═══════════════════════════════════════════════════════════════
// O estado da lista de clientes (busca, filtro, página, aba, unidade) VIAJA
// na URL da ficha e volta inteiro no "Voltar para clientes". Duas regras:
//
//   buildClientListReturnQuery() — a lista grava o estado ao abrir a ficha;
//   clientListReturnHref()      — a ficha reconstrói o destino de volta.
//
// Fallback SEMPRE seguro: sem estado, o destino é `/clientes?b=<unidade>`
// (nunca `/clientes` solto — a unidade ativa não se perde). Se a URL da ficha
// não trouxer o estado (deep-link antigo), o navegador/histórico continua
// sendo o caminho natural do usuário; esta função cobre o link impresso.
//
// Módulo PURO — coberto por teste (m8-cliente360.test.ts).
export interface ClientListReturnParts {
  /** Unidade ativa (obrigatória em uso real; vazio só em teste). */
  b?: string;
  /** Termo de busca da lista. */
  q?: string;
  /** Filtro ativo ('all' = padrão, não viaja). */
  filter?: string;
  /** Página atual (1 = padrão, não viaja). */
  page?: number;
  /** Aba da ficha quando aberta. */
  tab?: string;
}

/** Query string de retorno (sem '?'). Vazio quando só há o padrão. */
export function buildClientListReturnQuery(parts: ClientListReturnParts): string {
  const qs = new URLSearchParams();
  if (parts.b) qs.set('b', parts.b);
  if (parts.q && parts.q.trim()) qs.set('q', parts.q.trim());
  if (parts.filter && parts.filter !== 'all') qs.set('filter', parts.filter);
  if (parts.page && parts.page > 1) qs.set('page', String(parts.page));
  if (parts.tab && parts.tab.trim()) qs.set('tab', parts.tab.trim());
  return qs.toString();
}

/**
 * Destino de volta para a lista a partir da URL atual da ficha.
 * Sempre `/clientes` + estado preservado; `b` é obrigatório no fallback.
 */
export function clientListReturnHref(search: URLSearchParams | string): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const qs = buildClientListReturnQuery({
    b: params.get('b') || '',
    q: params.get('q') || '',
    filter: params.get('filter') || '',
    page: Number(params.get('page') || '') || 1,
    tab: params.get('tab') || '',
  });
  return `/clientes${qs ? `?${qs}` : ''}`;
}
