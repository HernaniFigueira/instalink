// Sessão no cliente: token em localStorage como fallback sem-cookie.
//
// Como funciona:
// 1. Login/cadastro devolvem { ok, token } — o app salva via saveToken().
// 2. O <AuthBootstrap/> (montado no layout raiz) instala um wrapper no
//    window.fetch que injeta "Authorization: Bearer <token>" em TODA
//    chamada same-origin para /api/* — nenhuma tela precisa mudar.
// 3. O servidor aceita cookie OU Bearer (userFromRequest).
// Resultado: o painel funciona mesmo com cookies E localStorage bloqueados
// (navegação pós-login é SPA para preservar a camada de memória).

import { activePanelPath } from './panel';

const KEY = 'il_token'; // lojista (painel)
const CUST_KEY = 'il_cust'; // consumidor (página pública)

// Camada 1 — MEMÓRIA: funciona sempre dentro da aba, mesmo com cookies,
// localStorage e third-party storage 100% bloqueados. Sobrevive a
// navegações SPA (router.push); um reload integral (F5) limpa esta camada,
// e aí valem as camadas 2 (localStorage) e 3 (cookie httpOnly).
let memoryToken: string | null = null;
let memoryCustToken: string | null = null;

export function saveToken(token: string): void {
  if (token) memoryToken = token;
  try {
    if (token) localStorage.setItem(KEY, token);
  } catch {
    /* localStorage bloqueado: segue com memória + cookie */
  }
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const t = localStorage.getItem(KEY);
    if (t) memoryToken = t;
    return t;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export function saveCustomerToken(token: string): void {
  if (token) memoryCustToken = token;
  try {
    if (token) localStorage.setItem(CUST_KEY, token);
  } catch {
    /* localStorage bloqueado: segue com memória + cookie */
  }
}

export function getCustomerToken(): string | null {
  if (memoryCustToken) return memoryCustToken;
  try {
    const t = localStorage.getItem(CUST_KEY);
    if (t) memoryCustToken = t;
    return t;
  } catch {
    return null;
  }
}

export function clearCustomerToken(): void {
  memoryCustToken = null;
  try {
    localStorage.removeItem(CUST_KEY);
  } catch {
    /* noop */
  }
}

// ── Sessão × permissão (regra definitiva) ─────────────────────
// 401 → sessão inexistente/expirada/inválida: PODE iniciar o fluxo de login.
// 403 → usuário autenticado SEM permissão: NUNCA desloga, NUNCA limpa o
//       token, NUNCA vai para /login. A tela mostra mensagem amigável.
// Ver lib/http.ts (semântica) e lib/panel.ts (áreas/permissões).
export const SESSION_EXPIRED_EVENT = 'instalink:session-expired';
export const FORBIDDEN_EVENT = 'instalink:forbidden';

export interface ForbiddenDetail {
  /** Caminho da API que negou (para log/depuração; nunca exibido cru). */
  path: string;
  /** Mensagem amigável vinda do servidor, quando existe. */
  message: string;
  status: 403;
}

/** Dispara o aviso global de 403 (a UI escuta e mostra a mensagem). */
export function notifyForbidden(detail: ForbiddenDetail): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<ForbiddenDetail>(FORBIDDEN_EVENT, { detail }));
  } catch {
    /* ambiente sem CustomEvent: a tela ainda trata o erro localmente */
  }
}

/** Assina o aviso global de 403. Devolve a função de cancelamento. */
export function onForbidden(handler: (detail: ForbiddenDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<ForbiddenDetail>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(FORBIDDEN_EVENT, listener);
  return () => window.removeEventListener(FORBIDDEN_EVENT, listener);
}

/**
 * Único caminho que encerra a sessão — chamado SOMENTE para 401.
 * (403 nunca passa por aqui.)
 */
export function startLoginFlow(reason: 'expired' | 'invalid' = 'expired'): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (w.__il_session_redirect) return;
  w.__il_session_redirect = true;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { reason } }));
  } catch {
    /* noop */
  }
  window.location.assign(`/login?session=${reason}`);
}

/**
 * Caminhos internos do painel — os únicos em que um 401 pode iniciar o fluxo
 * de login. Rotas públicas (página da empresa, /login, /register, /recuperar)
 * ficam de fora: ali um 401 é do consumidor, não do lojista.
 */
const PANEL_EXTRA_PATHS = ['/onboarding'];

/**
 * Dentro do painel quando o caminho É um destino do catálogo ou DESCENDE de um
 * ('/clientes/123' → '/clientes'), então subrotas futuras já nascem cobertas.
 * A lista continua única: `lib/panel.ts`.
 */
export function inPanelPath(pathname: string): boolean {
  const clean = String(pathname || '').replace(/\/+$/, '') || '/';
  if (PANEL_EXTRA_PATHS.includes(clean)) return true;
  return activePanelPath(clean) !== '';
}

function isSameOriginApi(input: string): boolean {
  if (input.startsWith('/api/')) return true;
  try {
    const url = new URL(input, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export function installFetchWrapper(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (w.__il_fetch_wrapped) return;
  w.__il_fetch_wrapped = true;
  const original = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
    // Roteamento por path: /api/customer/* usa o token do consumidor,
    // demais /api/* usam o token do lojista. Nunca vaza para fora.
    let token: string | null = null;
    if (url && isSameOriginApi(url)) {
      const path = url.startsWith('/') ? url : (() => { try { return new URL(url).pathname; } catch { return ''; } })();
      token = path.startsWith('/api/customer/') ? getCustomerToken() : getToken();
    }
    if (token && url) {
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    const res = await original(input as RequestInfo, init);
    // ── Tratamento central de resposta autenticada (regra definitiva) ──
    // 401 → sessão inexistente/expirada/inválida: redireciona UMA vez ao
    //       login, em vez de deixar cada tela quebrar.
    // 403 → usuário autenticado SEM permissão: NÃO desloga, NÃO limpa token,
    //       NÃO redireciona para /login, NÃO invalida a sessão. Publica um
    //       aviso global para a interface mostrar a mensagem amigável — o
    //       usuário continua exatamente onde estava.
    try {
      if ((res.status === 401 || res.status === 403) && url && isSameOriginApi(url)) {
        const path = url.startsWith('/') ? url : (() => { try { return new URL(url).pathname; } catch { return ''; } })();
        const here = window.location.pathname;
        const isAuthCall = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register') || path.startsWith('/api/customer/');
        if (inPanelPath(here) && !isAuthCall) {
          if (res.status === 401) {
            startLoginFlow('expired');
          } else {
            // Clone: o corpo original continua disponível para a tela.
            let message = '';
            try {
              const data = await res.clone().json();
              message = String(data?.error || '');
            } catch {
              message = '';
            }
            notifyForbidden({ path, message, status: 403 });
          }
        }
      }
    } catch {
      /* noop: o tratamento local de erro da tela continua valendo */
    }
    return res;
  }) as typeof window.fetch;
}
