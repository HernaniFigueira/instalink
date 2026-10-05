// Auth do MVD: sessão por cookie httpOnly + hash scrypt.
// Interface pronta para troca por Supabase Auth (ver ARQUITETURA.md).
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { readDB, updateDB } from './db';
import type { DB, User } from './types';

// GODOUTOR Clinical OS — sessão canônica sob `godoutor_session`.
//
// `il_session` (era InstaLink) continua SENDO LIDO como fallback de
// compatibilidade: usuários logados antes da renomeação jamais são
// deslogados por estética. O login grava o canônico e PURGA o legado; o
// logout limpa os dois. Remover o fallback só quando as sessões antigas
// expirarem (30 dias) — é drenagem, não renomeação destrutiva.
export const COOKIE_NAME = 'godoutor_session';
export const LEGACY_COOKIE_NAME = 'il_session';
const SESSION_DAYS = 30;
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, salt, hash] = stored.split(':');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

export async function createSession(userId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 3600 * 1000);
  await updateDB((db) => {
    db.sessions.push({ id, userId, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  });
  return id;
}

export async function destroySession(sessionId: string): Promise<void> {
  await updateDB((db) => {
    db.sessions = db.sessions.filter((s) => s.id !== sessionId);
  });
}

export function getUserBySessionFromDB(
  db: Pick<DB, 'sessions' | 'users'>,
  sessionId: string | undefined,
): User | null {
  if (!sessionId) return null;
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  // Keep the existing boundary: a session expires only when expiresAt is
  // strictly before now (the persisted duration and token format are unchanged).
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

/** Standalone session lookup. Callers already holding a DB snapshot should use
 * getUserBySessionFromDB to avoid an unrelated second read. */
export async function getUserBySession(sessionId: string | undefined): Promise<User | null> {
  if (!sessionId) return null;
  const db = await readDB();
  return getUserBySessionFromDB(db, sessionId);
}

/** Extrai token "Authorization: Bearer <session>" (fallback sem-cookie). */
export function getBearerToken(req: { headers: { get(n: string): string | null } }): string | undefined {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  return token || undefined;
}

export interface UserRequest {
  cookies: { get(n: string): { value: string } | undefined };
  headers: { get(n: string): string | null };
}

type CookieStore = { get(n: string): { value: string } | undefined };

/**
 * Identificador de sessão lido do store de cookies. Precedência: cookie
 * canônico (`godoutor_session`) vence; `il_session` legado é aceito apenas
 * como fallback de leitura (compatibilidade temporária documentada).
 */
export function sessionCookieId(store: CookieStore): string | undefined {
  return store.get(COOKIE_NAME)?.value || store.get(LEGACY_COOKIE_NAME)?.value || undefined;
}

/** True when this request carries either supported app-session credential. */
export function hasRequestCredentials(req: UserRequest): boolean {
  return !!sessionCookieId(req.cookies) || !!getBearerToken(req);
}

/** Linha de sessão VÁLIDA (existe, não expirou) — sem resolver o usuário. */
export interface ValidSessionRow {
  id: string;
  userId: string;
  createdAt?: string;
  expiresAt: string;
}

/**
 * Sessão válida do snapshot (existe e não expirou). `null` quando a
 * credencial é ausente, desconhecida ou expirada — a mesma régua de
 * `getUserBySessionFromDB`, sem resolver o usuário ainda.
 */
export function validSessionFromDB(
  db: Pick<DB, 'sessions'>,
  sessionId: string | undefined,
): ValidSessionRow | null {
  if (!sessionId) return null;
  const session = db.sessions.find((s) => s.id === sessionId) as ValidSessionRow | undefined;
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
}

/** Quando a sessão foi emitida (ISO). Ausente/ilegível = 0 (a mais antiga). */
function sessionIssuedAt(session: ValidSessionRow): number {
  const at = Date.parse(String(session.createdAt || ''));
  return Number.isFinite(at) ? at : 0;
}

/**
 * IDENTIDADE DA REQUISIÇÃO — contrato único de sessão (P0).
 *
 * ── O BUG QUE ESTE CONTRATO FECHA ────────────────────────────────────────
 * O navegador pode carregar DUAS credenciais ao mesmo tempo: o cookie
 * httpOnly da sessão e o Bearer do localStorage (o app injeta o Bearer em
 * toda chamada /api/*). Antes, um cookie válido venceria SEMPRE — mesmo que o
 * Bearer válido pertencesse a outra conta. No Preview isso aconteceu de
 * verdade: um login novo (Bearer novo) com o cookie antigo ainda aceito pelo
 * navegador (cookie particionado/recusado no iframe) devolvia a identidade
 * ANTERIOR — “entrei com a Andrioni e abriu o Orlando / Hamburguer Podrão”.
 *
 * ── REGRA (explícita, determinística, nunca silenciosa) ──────────────────
 *   • nenhuma credencial válida            → null (401);
 *   • só uma válida                        → ela decide;
 *   • as duas válidas para o MESMO usuário → identidade única (sem conflito);
 *   • as duas válidas para usuários DIFERENTES → vence a sessão ESTRITAMENTE
 *     MAIS RECENTE (é a credencial que o humano acabou de criar; a antiga é a
 *     que ficou para trás). Sem evidência de qual é a mais nova (mesmo
 *     instante ou `createdAt` ausente), mantém-se a precedência anterior do
 *     cookie — a mudança de contrato só acontece quando há evidência positiva
 *     de frescor. Em qualquer conflito a credencial perdedora é reconciliada.
 *
 * A credencial perdedora é devolvida em `stale` para o chamador reconciliar o
 * navegador (`/api/auth/me` remove o cookie perdedor) — e o login já revoga a
 * sessão estrangeira apresentada (`revokePresentedForeignSessions`), de modo
 * que a divergência não sobrevive ao próximo request.
 */
export interface RequestIdentity {
  user: User;
  via: 'cookie' | 'bearer' | 'cookie+bearer';
  /** true quando cookie e Bearer apontavam para contas diferentes. */
  conflict: boolean;
  /** Credencial válida que PERDEU e deve ser descartada (null = não houve). */
  stale: { sessionId: string; via: 'cookie' | 'bearer' } | null;
}

/** Identidade da requisição sobre um snapshot que o chamador já detém. */
export function requestIdentityFromDB(
  req: UserRequest,
  db: Pick<DB, 'sessions' | 'users'>,
): RequestIdentity | null {
  const resolve = (session: ValidSessionRow | null): { session: ValidSessionRow; user: User } | null => {
    if (!session) return null;
    const user = db.users.find((u) => u.id === session.userId);
    return user ? { session, user } : null;
  };

  const viaCookie = resolve(validSessionFromDB(db, sessionCookieId(req.cookies)));
  const viaBearer = resolve(validSessionFromDB(db, getBearerToken(req)));

  if (!viaCookie && !viaBearer) return null;
  if (viaCookie && !viaBearer) return { user: viaCookie.user, via: 'cookie', conflict: false, stale: null };
  if (viaBearer && !viaCookie) return { user: viaBearer.user, via: 'bearer', conflict: false, stale: null };

  const cookie = viaCookie!;
  const bearer = viaBearer!;
  // Mesma conta: nada a reconciliar — a identidade é uma só.
  if (cookie.user.id === bearer.user.id) {
    return { user: cookie.user, via: 'cookie+bearer', conflict: false, stale: null };
  }

  // Contas diferentes: vence a sessão ESTRITAMENTE mais recente. Sem evidência
  // (empate/data ilegível) preserva-se a precedência histórica do cookie — o
  // login já revogou a sessão estrangeira apresentada, então a divergência não
  // sobrevive ao próximo login.
  const cookieNewer = sessionIssuedAt(cookie.session) >= sessionIssuedAt(bearer.session);
  const winner = cookieNewer ? cookie : bearer;
  const loser = cookieNewer ? bearer : cookie;
  return {
    user: winner.user,
    via: cookieNewer ? 'cookie' : 'bearer',
    conflict: true,
    stale: { sessionId: loser.session.id, via: cookieNewer ? 'bearer' : 'cookie' },
  };
}

/**
 * Autenticação pura contra o snapshot do chamador. Agora SEMPRE pela
 * identidade resolvida acima: nunca devolve silenciosamente a conta ANTERIOR
 * quando duas credenciais válidas divergem.
 */
export function userFromRequestFromDB(req: UserRequest, db: Pick<DB, 'sessions' | 'users'>): User | null {
  return requestIdentityFromDB(req, db)?.user ?? null;
}

/** Credenciais de sessão APRESENTADAS por esta requisição (cookie e Bearer). */
export function presentedSessionIds(req: UserRequest): string[] {
  const ids = [sessionCookieId(req.cookies), getBearerToken(req)];
  return [...new Set(ids.filter((v): v is string => !!v && v.length > 0))];
}

/**
 * FRONTEIRA DE IDENTIDADE (login): revoga as sessões apresentadas por este
 * navegador que pertençam a OUTRA conta. É o que impede que o cookie da
 * identidade anterior sobreviva — mesmo que o navegador recuse o Set-Cookie
 * novo (iframe/partition) e continue mandando o cookie velho.
 *
 * Só toca o que esta requisição apresentou: sessões de outros dispositivos
 * permanecem intactas. Login do MESMO usuário não revoga nada.
 */
export async function revokePresentedForeignSessions(req: UserRequest, keepUserId: string): Promise<string[]> {
  const ids = new Set(presentedSessionIds(req));
  if (ids.size === 0) return [];
  const revoked = new Set<string>();
  await updateDB((db) => {
    db.sessions = db.sessions.filter((s) => {
      if (ids.has(s.id) && s.userId !== keepUserId) { revoked.add(s.id); return false; }
      return true;
    });
  });
  return [...revoked];
}

/** Encerra sessões por id (logout encerra TODAS as credenciais apresentadas). */
export async function destroySessions(sessionIds: string[]): Promise<void> {
  const ids = new Set(sessionIds.filter((v): v is string => !!v && v.length > 0));
  if (ids.size === 0) return;
  await updateDB((db) => {
    db.sessions = db.sessions.filter((s) => !ids.has(s.id));
  });
}

/**
 * Auth unificada para API routes sobre UM snapshot: aplica o contrato de
 * identidade (`requestIdentityFromDB`) — cookie e Bearer válidos para contas
 * diferentes nunca resolvem silenciosamente para a conta antiga. Requests sem
 * credenciais não consultam o documento.
 */
export async function userFromRequest(req: UserRequest): Promise<User | null> {
  if (!hasRequestCredentials(req)) return null;
  const db = await readDB();
  return userFromRequestFromDB(req, db);
}

export async function currentUser(snapshot?: Pick<DB, 'sessions' | 'users'>): Promise<User | null> {
  const sessionId = sessionCookieId(cookies());
  if (!sessionId) return null;
  if (snapshot) return getUserBySessionFromDB(snapshot, sessionId);
  return getUserBySession(sessionId);
}

// Cookies de sessão: SEMPRE SameSite=None + Secure + Partitioned (CHIPS).
//
// Por quê? O app é acessado via proxy HTTPS (preview) e em produção via
// HTTPS — ambos funcionam com estes atributos, INCLUSIVE dentro de iframe
// cross-origin. Detectar protocolo via X-Forwarded-Proto é frágil (proxies
// podem não enviar o header) e um cookie Lax silenciosamente "morre" no
// iframe, travando login/onboarding. Em localhost HTTP os navegadores
// aceitam cookies Secure (exceção de contexto seguro), então o dev local
// continua funcionando. Único caso não coberto: HTTP puro via IP/rede
// (ex: http://192.168.x.x) — nesse caso acesse via localhost ou HTTPS.
// Gravados DIRETO no objeto Response (nunca via cookies().set()).
export function sessionCookieAttrs() {
  return {
    httpOnly: true,
    sameSite: 'none' as const,
    secure: true,
    partitioned: true,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

export function setSessionOn(res: NextResponse, sessionId: string): void {
  res.cookies.set(COOKIE_NAME, sessionId, sessionCookieAttrs());
  // Higienização: remove o cookie legado ainda válido no login para que a
  // sessão migre para o nome canônico. A leitura do legado segue aceita até o
  // próximo login — nenhum usuário é deslogado por esta mudança.
  res.cookies.set(LEGACY_COOKIE_NAME, '', { ...sessionCookieAttrs(), maxAge: 0 });
}

export function clearSessionOn(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', { ...sessionCookieAttrs(), maxAge: 0 });
  res.cookies.set(LEGACY_COOKIE_NAME, '', { ...sessionCookieAttrs(), maxAge: 0 });
}
