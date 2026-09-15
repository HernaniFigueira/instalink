// ═══════════════════════════════════════════════════════════════
// CONTEXTO DA EMPRESA — resolução consistente (cliente E servidor)
// ═══════════════════════════════════════════════════════════════
// O painel conhece a empresa ativa (DashboardShell → /api/auth/me) e a
// carrega na URL como ?b=<id>. O ?b= continua válido (compatibilidade e
// contexto explícito), mas NUNCA pode ser a fonte única e frágil:
//
//   • API: o id vem do PATH (/api/businesses/[id]/...) — a query
//     ?businessId= só existe como fallback de compatibilidade;
//   • CLIENTE: sem ?b= (ou com id inválido), a empresa ativa é resolvida
//     pelo /api/auth/me — a mesma fonte do DashboardShell.
//
// Estados de contexto esperados pelas telas (auditoria §5):
//   company        → há empresa: carrega normalmente;
//   no-company     → conta sem nenhuma empresa (estado próprio, com CTA);
//   network-error  → falha de rede (mensagem de rede, com nova tentativa);
//   permission     → 403 (mensagem de permissão, sessão preservada);
//   not-found      → 404 real (só aqui "não encontrado" faz sentido).
// Nunca etiquetar tudo como "Negócio não encontrado".
/**
 * Id da empresa para uma rota /api/businesses/[id]/...
 * Prioridade: path param (a rota já diz QUAL empresa) → ?businessId= (compat).
 * Puro e determinístico — coberto por teste.
 */
export function businessIdFromRoute(
  params: { id?: string } | undefined | null,
  req?: { nextUrl?: { searchParams?: { get(name: string): string | null } } } | null,
): string {
  const fromPath = String(params?.id || '').trim();
  if (fromPath) return fromPath;
  const fromQuery = String(req?.nextUrl?.searchParams?.get('businessId') || '').trim();
  return fromQuery;
}

/** O id existe na lista de empresas acessíveis da conta? */
export function businessIdInList(id: string, list: Array<{ id: string }>): boolean {
  return !!id && list.some((b) => b.id === id);
}

/**
 * Empresa ativa para o painel: o ?b= quando existe na lista; senão a
 * primeira (mesma regra do DashboardShell). '' quando não há empresa alguma.
 */
export function resolveActiveBusinessId(
  requested: string | null | undefined,
  list: Array<{ id: string }>,
): string {
  const req = String(requested || '').trim();
  if (req && businessIdInList(req, list)) return req;
  return list[0]?.id || '';
}


/** Rotas organizacionais não exigem uma unidade ativa no query string. */
export function requiresActiveBusiness(pathname: string): boolean {
  const clean = String(pathname || '').replace(/\/+$/, '') || '/';
  return clean !== '/organizacao';
}
