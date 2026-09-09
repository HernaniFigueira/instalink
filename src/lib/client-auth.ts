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
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}
