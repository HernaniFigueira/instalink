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

// A decisão "esta rota precisa de unidade ativa?" vem do catálogo único
// (lib/panel.ts) — nunca de uma lista paralela de caminhos.
import { routeRequiresBusiness } from './panel';

export const LAST_BUSINESS_STORAGE_KEY = 'godoutor:last-business';

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
 * Resolve a unidade ativa SEM depender da ordem retornada pelo banco.
 *
 * Prioridade:
 *   1. ?b= explícito e acessível;
 *   2. última unidade lembrada e ainda acessível;
 *   3. única unidade acessível da conta;
 *   4. '' quando há ambiguidade (2+ unidades sem escolha válida).
 *
 * O caso 4 é intencional: o chamador deve abrir a seleção de clínica em vez
 * de escolher silenciosamente `businesses[0]`.
 */
export function resolveActiveBusinessId(
  requested: string | null | undefined,
  list: Array<{ id: string }>,
  remembered?: string | null,
): string {
  const req = String(requested || '').trim();
  if (req && businessIdInList(req, list)) return req;
  const last = String(remembered || '').trim();
  if (last && businessIdInList(last, list)) return last;
  return list.length === 1 ? list[0].id : '';
}

/** Lê a última clínica escolhida no navegador. Nunca concede acesso por si só. */
export function readLastBusinessId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(LAST_BUSINESS_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** Persiste somente o id já validado contra /api/auth/me pelo chamador. */
export function rememberLastBusinessId(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const value = String(id || '').trim();
    if (value) window.localStorage.setItem(LAST_BUSINESS_STORAGE_KEY, value);
    else window.localStorage.removeItem(LAST_BUSINESS_STORAGE_KEY);
  } catch {
    // armazenamento indisponível não pode impedir login/navegação
  }
}


/**
 * Rotas organizacionais não exigem uma unidade ativa no query string.
 *
 * A regra vem do CATÁLOGO (campo `requiresBusiness` em lib/panel.ts), não de um
 * caminho escrito à mão aqui: declarar uma nova visão de organização no
 * catálogo já a torna independente do `?b=` sem tocar neste arquivo — e o
 * reconhecimento é por ancestralidade, então subrotas herdam a decisão.
 *
 * Fora do catálogo (rotas públicas, /master, /onboarding) a resposta continua
 * `true`: quem não declarou, exige unidade (comportamento conservador).
 */
export function requiresActiveBusiness(pathname: string): boolean {
  return routeRequiresBusiness(pathname);
}
