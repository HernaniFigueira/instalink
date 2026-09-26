// ═══════════════════════════════════════════════════════════════
// HELPER CENTRAL DE RESPOSTA AUTENTICADA (telas do painel)
// ═══════════════════════════════════════════════════════════════
// Toda tela do painel pode usar `apiRequest`/`apiMutation` em vez de lidar
// com `!res.ok` na mão. O que ele garante:
//
//   200 → ação normal (data disponível);
//   401 → fluxo de autenticação (o wrapper de fetch já redireciona UMA vez);
//   403 → usuário continua logado + mensagem amigável (nunca erro cru);
//   rede/500 → mensagem amigável, sem stack trace na tela.
//
// A semântica de status vive em lib/http.ts (pura e testada); aqui só há I/O.
import {
  decideAuthedResponse, describeApiError, type DeniedContext, type DeniedInfo, type SessionFlow,
} from './http';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  /** Payload parseado (pode ser o corpo de erro). */
  data: T | null;
  /** Mensagem amigável para exibir (vazia quando ok). */
  message: string;
  /** Preenchido somente em 403 (título + detalhe, sessão preservada). */
  denied: DeniedInfo | null;
  /** 'login' apenas para 401; 'stay' em qualquer outro caso. */
  flow: SessionFlow;
  /** `true` quando a falha foi de rede (sem resposta do servidor). */
  networkError: boolean;
}

function fail<T>(status: number, message: string, denied: DeniedInfo | null, networkError = false): ApiResult<T> {
  return { ok: false, status, data: null, message, denied, flow: status === 401 ? 'login' : 'stay', networkError };
}

/**
 * Chamada de API com tratamento central. Nunca lança por status HTTP — o
 * resultado diz o que aconteceu e qual mensagem mostrar.
 */
export async function apiRequest<T = any>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ctx: DeniedContext = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input as RequestInfo, init);
  } catch {
    return fail<T>(0, describeApiError(0, '', ctx), null, true);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const serverMessage = data && typeof data === 'object' ? String((data as any).error || '') : '';
  const decision = decideAuthedResponse(res.status, serverMessage, ctx);
  return {
    ok: decision.ok,
    status: res.status,
    data: (data ?? null) as T | null,
    message: decision.message,
    denied: decision.denied,
    flow: decision.flow,
    networkError: false,
  };
}

/** GET JSON com contexto de área (para a mensagem de 403 certa). */
export async function apiGet<T = any>(url: string, ctx: DeniedContext = {}): Promise<ApiResult<T>> {
  return apiRequest<T>(url, { method: 'GET' }, ctx);
}

/**
 * POST/PATCH/DELETE JSON com corpo serializado.
 *
 * §P1.4 — ESCRITA CONCLUÍDA AVISA O SHELL: depois de qualquer mutação bem
 * sucedida, disparamos `il:overview-refresh` na janela. Quem depende do
 * overview (o mini-card de configuração da sidebar, o sino de notificações)
 * revalida na hora — o progresso deixa de ficar preso num número velho
 * ("88%" depois de completar 8/8). O loader compartilhado (lib/overview.ts)
 * coalesce as chamadas: duas revalidações simultâneas = UMA requisição.
 */
export async function apiSend<T = any>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
  ctx: DeniedContext = {},
): Promise<ApiResult<T>> {
  const result = await apiRequest<T>(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, ctx);
  if (result.ok && typeof window !== 'undefined') {
    try { window.dispatchEvent(new Event('il:overview-refresh')); } catch { /* ambiente sem Event */ }
  }
  return result;
}

/** Lança um Error com a mensagem amigável (útil em fluxos try/catch). */
export function apiError<T>(result: ApiResult<T>, fallback?: string): Error {
  return new Error(result.message || fallback || 'Não foi possível concluir esta ação.');
}
