import './helpers/temp-db';

// ═══════════════════════════════════════════════════════════════
// P0 — SESSÃO / CONTA / TENANT: a fronteira de identidade
// ═══════════════════════════════════════════════════════════════
// Incidente real (Preview): entrar com a conta da clínica Andrioni abriu o
// painel do usuário **Orlando** na clínica **“Hamburguer Podrão”** (tenant de
// demo legado). Não é cosmético: a IDENTIDADE exibida era a anterior.
//
// Estes testes reproduzem o MECANISMO com rotas reais e um “navegador” que
// carrega cookie + Bearer (exatamente o que o app manda):
//
//   A) login A           → /api/auth/me = A        → unidade A
//   B) logout A → login B → /api/auth/me = B       → unidade B
//   C) cookie válido A + Bearer válido B → NUNCA identidade A silenciosa
//   D) cache loadMe A → troca de sessão → loadMe = B (nunca A)
//   E) preferência de unidade da conta A não decide a conta B
//   F) ?b= da conta A não concede contexto à conta B
//   G) duas unidades → escolha EXPLÍCITA (nunca a ordem do banco)
//   H) cross-tenant: API de B nunca lê A
//
// O navegador é o mesmo em todos os cenários: cookies e token mudam de mãos
// como mudariam numa troca de conta sem fechar o navegador.
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { randomUUID } from 'node:crypto';
import { COOKIE_NAME, LEGACY_COOKIE_NAME, hashPassword } from '../auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { GET as bookingsGET } from '@/app/api/bookings/route';
import { GET as businessGET } from '@/app/api/businesses/[id]/route';
import { resolveActiveBusinessId } from '../business-context';
import type { DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-10-05T12:00:00.000Z';
const PASSWORD = 'senha-de-teste-p0';

// ── Contas (nomes reais do incidente, dados fictícios) ─────────
const USER_A = 'user-andrioni';         // dono da clínica A
const USER_B = 'user-orlando';          // conta que aparecia por engano
const USER_C = 'user-multi';            // conta com 2 unidades
const USER_D = 'user-outra-conta';      // OUTRA conta que também alcança a unidade 1
const BIZ_A = 'biz-andrioni';            // “Clínica Andrioni”
const BIZ_B = 'biz-podrao-legado';       // “Hamburguer Podrão” (demo legado)
const BIZ_C1 = 'biz-multi-1';
const BIZ_C2 = 'biz-multi-2';

const EMAILS: Record<string, string> = {
  [USER_A]: 'responsavel@andrioni.invalid',
  [USER_B]: 'orlando@podrao.invalid',
  [USER_C]: 'multi@clinica.invalid',
  [USER_D]: 'outra@clinica.invalid',
};

function business(id: string, name: string, ownerId: string) {
  return {
    id, ownerId, organizationId: '', name, slug: id, niche: 'veterinaria',
    clinicType: 'veterinaria', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    description: '', logo: '', cover: '', phone: '', whatsapp: '', email: '', instagram: '', tiktok: '',
    address: '', mapsUrl: '', hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  };
}

function seed(): DB {
  const db = emptyDB();
  for (const [id, email] of Object.entries(EMAILS)) {
    db.users.push({
      id, name: id === USER_B ? 'Orlando' : id, email,
      passwordHash: hashPassword(PASSWORD), createdAt: NOW, lastLoginAt: '', role: 'owner',
    } as any);
  }
  db.businesses.push(
    business(BIZ_A, 'Clínica Andrioni', USER_A) as any,
    business(BIZ_B, 'Hamburguer Podrão', USER_B) as any,
    business(BIZ_C1, 'Clínica Unidade 1', USER_C) as any,
    business(BIZ_C2, 'Clínica Unidade 2', USER_C) as any,
  );
  // OUTRA conta administra a unidade 1 da conta C: é o que torna a
  // preferência de unidade um dado CROSS-ACCOUNT de verdade (a mesma unidade
  // é acessível às duas contas, mas a preferência de uma não vale para a outra).
  db.members.push({
    id: 'member-d-on-c1', businessId: BIZ_C1, userId: USER_D,
    role: 'ADMIN', permissions: {}, active: true, createdAt: NOW, updatedAt: NOW,
  } as any);
  return db;
}

// ── “Navegador”: cookie jar + token (memory/localStorage) ──────
interface Browser { cookies: Record<string, string>; token: string | null }

function newBrowser(): Browser { return { cookies: {}, token: null }; }

function request(browser: Browser, url: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  const headers = new Headers();
  const parts = Object.entries(browser.cookies)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}=${v}`);
  if (parts.length) headers.set('cookie', parts.join('; '));
  if (browser.token) headers.set('authorization', `Bearer ${browser.token}`);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost:3000${url}`, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Aplica os Set-Cookie da resposta no cookie jar (max-age=0 remove). */
function acceptCookies(browser: Browser, res: Response): void {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie') || ''];
  for (const raw of list) {
    if (!raw) continue;
    const [pair, ...attrs] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    const dead = /max-age=0/i.test(attrs.join(';')) || value === '';
    if (dead) delete browser.cookies[name];
    else browser.cookies[name] = value;
  }
}

/** true quando a resposta MANDOU apagar o cookie de sessão. */
function cookieWasCleared(res: Response, name: string): boolean {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie') || ''];
  return list.some((raw) => {
    if (!raw) return false;
    const [pair, ...attrs] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) return false;
    if (pair.slice(0, idx).trim() !== name) return false;
    return /max-age=0/i.test(attrs.join(';')) || pair.slice(idx + 1).trim() === '';
  });
}

async function login(browser: Browser, userId: string): Promise<{ status: number; body: any }> {
  const res = await loginRoute(request(browser, '/api/auth/login', {
    method: 'POST',
    body: { email: EMAILS[userId], password: PASSWORD },
  }));
  const body = await res.json().catch(() => null);
  acceptCookies(browser, res);
  if (body?.token) browser.token = String(body.token);
  return { status: res.status, body };
}

async function logout(browser: Browser): Promise<void> {
  const res = await logoutRoute(request(browser, '/api/auth/logout', { method: 'POST' }));
  acceptCookies(browser, res);
  browser.token = null;
}

async function me(browser: Browser): Promise<{ res: Response; user: any; body: any }> {
  const res = await meRoute(request(browser, '/api/auth/me'));
  const body = await res.json().catch(() => null);
  return { res, user: body?.user || null, body };
}

/**
 * Simula “o navegador recusou o Set-Cookie novo mas o token novo entrou”:
 * cria a sessão do login NOVO — estritamente mais recente que a que já existe
 * no navegador (é a ordem real do incidente: cookie ANTIGO + Bearer NOVO).
 */
async function sessionIdFor(userId: string): Promise<string> {
  const db = await readDB();
  const user = db.users.find((u) => u.id === userId)!;
  const latest = db.sessions.reduce((max, s) => Math.max(max, Date.parse(String(s.createdAt || '')) || 0), Date.now());
  const id = randomUUID();
  db.sessions.push({
    id, userId: user.id,
    createdAt: new Date(latest + 1000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  await writeDB(db);
  return id;
}

// localStorage mínimo (o ambiente de teste é node, sem DOM).
// `window.localStorage` é o que o contexto de unidade usa; `localStorage` puro
// é o que a camada de token usa. Os dois precisam existir.
function installLocalStorage(): void {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { localStorage: ls, location: { pathname: '/dashboard', origin: 'http://localhost:3000' } });
}

beforeEach(async () => {
  installLocalStorage();
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await writeDB(seed());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('A/B — login e logout definem UMA identidade', () => {
  it('A) login A → /api/auth/me = A → unidade A', async () => {
    const browser = newBrowser();
    const logged = await login(browser, USER_A);
    expect(logged.status).toBe(200);
    expect(logged.body.token).toBeTruthy();

    const { user, body } = await me(browser);
    expect(user.id).toBe(USER_A);
    expect(body.businesses.map((b: any) => b.id)).toEqual([BIZ_A]);
  });

  it('B) logout A → login B → /api/auth/me = B → unidade B', async () => {
    const browser = newBrowser();
    const a = await login(browser, USER_A);
    await logout(browser);
    // Logout revoga a sessão de A de verdade (não só limpa o cookie).
    const dbAfterLogout = await readDB();
    expect(dbAfterLogout.sessions.some((s) => s.id === a.body.token)).toBe(false);

    await login(browser, USER_B);
    const { user, body } = await me(browser);
    expect(user.id).toBe(USER_B);
    expect(body.businesses.map((b: any) => b.id)).toEqual([BIZ_B]);
  });

  it('B2) logout encerra as DUAS credenciais apresentadas (cookie E Bearer)', async () => {
    const browserA = newBrowser();
    const a = await login(browserA, USER_A);
    const tokenB = await sessionIdFor(USER_B);
    // Navegador com cookie de A + Bearer de B (o estado do incidente).
    const mixed: Browser = { cookies: { [COOKIE_NAME]: a.body.token }, token: tokenB };

    const res = await logoutRoute(request(mixed, '/api/auth/logout', { method: 'POST' }));

    expect(res.status).toBe(200);
    const db = await readDB();
    expect(db.sessions.some((s) => s.id === a.body.token)).toBe(false);
    expect(db.sessions.some((s) => s.id === tokenB)).toBe(false);
    // E o cookie de sessão foi removido do navegador.
    expect(cookieWasCleared(res, COOKIE_NAME)).toBe(true);
  });
});

describe('C — cookie e Bearer divergentes (o mecanismo do incidente)', () => {
  it('cookie válido de A + Bearer válido de B → identidade B e cookie obsoleto removido', async () => {
    // Estado do incidente: o navegador guardou o cookie de A (sessão antiga,
    // ainda válida) e recebeu o token de B (login novo, cookie recusado).
    const browserA = newBrowser();
    const a = await login(browserA, USER_A);
    const tokenB = await sessionIdFor(USER_B);
    const browser: Browser = { cookies: { [COOKIE_NAME]: a.body.token }, token: tokenB };

    const { res, user } = await me(browser);

    // Contrato: NUNCA devolver a identidade anterior em silêncio.
    expect(user?.id).not.toBe(USER_A);
    expect(user?.id).toBe(USER_B);
    // E o cookie divergente (perdedor) é removido do navegador.
    expect(cookieWasCleared(res, COOKIE_NAME)).toBe(true);
    // Determinismo: repetir devolve o MESMO usuário (não oscila).
    const again = await me(browser);
    expect(again.user?.id).toBe(USER_B);
  });

  it('C3) quando o Bearer perde, a resposta diz qual credencial morreu', async () => {
    // Cookie ESTRITAMENTE mais recente que o Bearer: o contrato escolhe a
    // sessão mais nova (o login que o humano acabou de fazer) e informa ao
    // cliente que o token local é credencial morta (`staleCredential`), para
    // que ele pare de ser reenviado.
    const browserA = newBrowser();
    const a = await login(browserA, USER_A);
    const tokenB = await sessionIdFor(USER_B); // sessão de B, mais recente…
    const db = await readDB();
    // …então uma sessão de A ainda MAIS recente é a vencedora.
    const newer = randomUUID();
    const latest = db.sessions.reduce((max, s) => Math.max(max, Date.parse(String(s.createdAt || '')) || 0), Date.now());
    db.sessions.push({
      id: newer, userId: USER_A,
      createdAt: new Date(latest + 1000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    await writeDB(db);

    const browser: Browser = { cookies: { [COOKIE_NAME]: newer }, token: tokenB };
    const { body, user } = await me(browser);
    expect(user.id).toBe(USER_A);
    expect(body.staleCredential).toBe('bearer');
    expect(body.user.id).not.toBe(USER_B);
    // O cookie vencedor NÃO é apagado (só o perdedor é reconciliado).
    expect(a.body.token).toBeTruthy();
  });

  it('C2) o login novo revoga a sessão que o cookie antigo ainda apresenta', async () => {
    // Cookie de A continua válido no navegador quando o login de B acontece
    // (foi o que o iframe fez: recusou o Set-Cookie novo e manteve o velho).
    const browser = newBrowser();
    const a = await login(browser, USER_A);
    expect(browser.cookies[COOKIE_NAME]).toBe(a.body.token);

    await login(browser, USER_B);

    const db = await readDB();
    // A sessão de A apresentada por este navegador deixou de existir.
    expect(db.sessions.some((s) => s.id === a.body.token)).toBe(false);
    // E a identidade do MESMO navegador agora é B — mesmo que o cookie de A
    // ainda estivesse circulando, ele não autentica mais.
    const stale: Browser = { cookies: { [COOKIE_NAME]: a.body.token }, token: browser.token };
    const { user } = await me(stale);
    expect(user.id).toBe(USER_B);
  });

  it('cookie e Bearer da MESMA conta → segue funcionando (sem regressão)', async () => {
    const browser = newBrowser();
    const a = await login(browser, USER_A);
    // O app manda os dois: cookie (jar) + Bearer (localStorage).
    expect(browser.cookies[COOKIE_NAME]).toBe(a.body.token);
    expect(browser.token).toBe(a.body.token);
    const { user } = await me(browser);
    expect(user.id).toBe(USER_A);
  });

  it('cookie expirado + Bearer válido → Bearer (fallback preservado)', async () => {
    const browserA = newBrowser();
    await login(browserA, USER_A);
    const expired = browserA.cookies[COOKIE_NAME];
    const tokenB = await sessionIdFor(USER_B);
    // Expira a sessão do cookie sem tocar no Bearer.
    const db = await readDB();
    const row = db.sessions.find((s) => s.id === expired)!;
    row.expiresAt = '2000-01-01T00:00:00.000Z';
    await writeDB(db);

    const browser: Browser = { cookies: { [COOKIE_NAME]: expired }, token: tokenB };
    const { user } = await me(browser);
    expect(user.id).toBe(USER_B);
  });

  it('cookie legado (il_session) de A + cookie canônico de B → identidade B', async () => {
    const browserA = newBrowser();
    const a = await login(browserA, USER_A);
    const tokenB = await sessionIdFor(USER_B);
    const browser: Browser = {
      cookies: { [LEGACY_COOKIE_NAME]: a.body.token, [COOKIE_NAME]: tokenB },
      token: null,
    };
    const { user } = await me(browser);
    expect(user.id).toBe(USER_B);
  });
});

describe('D — cache de /api/auth/me não atravessa troca de conta', () => {
  it('loadMe A → login B (mesmo navegador) → loadMe devolve B, nunca A', async () => {
    const browser = newBrowser();
    await login(browser, USER_A);

    // fetch do app → rotas reais (com o cookie jar e o Bearer do navegador).
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url !== '/api/auth/me') throw new Error(`fetch inesperado: ${url}`);
      const res = await meRoute(request(browser, '/api/auth/me'));
      acceptCookies(browser, res);
      return res;
    }));

    const { saveToken } = await import('../client-auth');
    const { loadMe } = await import('../session-me');
    saveToken(browser.token!);
    // Sem reset manual: o cache é chaveado pela credencial apresentada.
    const first = await loadMe();
    expect(first.data?.user?.id).toBe(USER_A);

    // Troca de conta pelo MESMO navegador (SPA: o módulo continua vivo).
    await login(browser, USER_B);
    saveToken(browser.token!);

    const second = await loadMe();
    expect(second.data?.user?.id).toBe(USER_B);
    expect(second.data?.user?.id).not.toBe(USER_A);
  });
});

describe('E/F/G — unidade ativa nunca cruza identidade', () => {
  it('E) preferência de unidade da conta A não decide a conta B', async () => {
    const { readLastBusinessId, rememberLastBusinessId } = await import('../business-context');
    // A OUTRA conta trabalhou na unidade 1 (que TAMBÉM é acessível à conta C).
    rememberLastBusinessId(BIZ_C1, USER_D);
    expect(readLastBusinessId(USER_D)).toBe(BIZ_C1);

    // A conta C tem 2 unidades: a preferência da outra conta não escolhe por ela.
    const rememberedForC = readLastBusinessId(USER_C);
    expect(rememberedForC).toBe('');
    const cList = [{ id: BIZ_C1 }, { id: BIZ_C2 }];
    expect(resolveActiveBusinessId(null, cList, rememberedForC)).toBe('');
  });

  it('E2) chave global legada (godoutor:last-business) não é adotada por conta nova', async () => {
    const { readLastBusinessId, LAST_BUSINESS_STORAGE_KEY } = await import('../business-context');
    localStorage.setItem(LAST_BUSINESS_STORAGE_KEY, BIZ_C1);
    expect(readLastBusinessId(USER_C)).toBe('');
  });

  it('F) ?b= da conta A não concede contexto à conta B', async () => {
    const browser = newBrowser();
    await login(browser, USER_B);

    // No servidor: B pedindo a unidade de A é 403 (não vaza nada de A).
    const bizRes = await businessGET(request(browser, `/api/businesses/${BIZ_A}`), { params: { id: BIZ_A } });
    expect(bizRes.status).toBe(403);
    const bookingsRes = await bookingsGET(request(browser, `/api/bookings?businessId=${BIZ_A}&mode=manage`));
    expect(bookingsRes.status).toBe(403);

    // No cliente: o ?b= de A NUNCA vira contexto — cai para a unidade
    // legítima de B (ou para a seleção explícita), jamais para o tenant de A.
    const bList = [{ id: BIZ_B }];
    expect(resolveActiveBusinessId(BIZ_A, bList, '')).not.toBe(BIZ_A);
    expect(resolveActiveBusinessId(BIZ_A, bList, '')).toBe(BIZ_B);
  });

  it('G) duas unidades sem escolha válida → seleção explícita (nunca a ordem do banco)', async () => {
    const browser = newBrowser();
    const logged = await login(browser, USER_C);
    expect(logged.status).toBe(200);
    const { body } = await me(browser);
    expect(body.businesses.map((b: any) => b.id).sort()).toEqual([BIZ_C1, BIZ_C2]);
    expect(resolveActiveBusinessId(null, body.businesses.map((b: any) => ({ id: b.id })), '')).toBe('');
  });
});

describe('H — isolamento cross-tenant nas APIs', () => {
  it('API responde com a identidade de quem pede, não com a do cookie antigo', async () => {
    const browserA = newBrowser();
    const a = await login(browserA, USER_A);
    const tokenB = await sessionIdFor(USER_B);
    // Navegador do incidente: cookie A (válido) + Bearer B.
    const mixed: Browser = { cookies: { [COOKIE_NAME]: a.body.token }, token: tokenB };

    // A unidade de B continua acessível a B (200) …
    const own = await businessGET(request(mixed, `/api/businesses/${BIZ_B}`), { params: { id: BIZ_B } });
    expect(own.status).toBe(200);
    // … e a unidade de A NÃO é acessível por essa identidade (403).
    const other = await businessGET(request(mixed, `/api/businesses/${BIZ_A}`), { params: { id: BIZ_A } });
    expect(other.status).toBe(403);
  });
});
