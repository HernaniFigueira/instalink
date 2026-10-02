// Auth do MVD: sessão por cookie httpOnly + hash scrypt.
// Interface pronta para troca por Supabase Auth (ver ARQUITETURA.md).
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { readDB, updateDB } from './db';
import type { DB, User } from './types';

export const COOKIE_NAME = 'il_session';
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

/** True when this request carries either supported app-session credential. */
export function hasRequestCredentials(req: UserRequest): boolean {
  return !!req.cookies.get(COOKIE_NAME)?.value || !!getBearerToken(req);
}

/**
 * Pure request authentication against a caller-owned DB snapshot. Cookie
 * precedence is preserved: a valid cookie wins, and only an invalid/missing
 * cookie falls back to Bearer, using the same snapshot in either case.
 */
export function userFromRequestFromDB(req: UserRequest, db: Pick<DB, 'sessions' | 'users'>): User | null {
  const viaCookie = getUserBySessionFromDB(db, req.cookies.get(COOKIE_NAME)?.value);
  if (viaCookie) return viaCookie;
  return getUserBySessionFromDB(db, getBearerToken(req));
}

/**
 * Auth unificada para API routes: tenta cookie httpOnly primeiro e,
 * se ausente/inválido, testa o Bearer token no MESMO snapshot. Requests sem
 * credenciais não consultam o documento.
 */
export async function userFromRequest(req: UserRequest): Promise<User | null> {
  if (!hasRequestCredentials(req)) return null;
  const db = await readDB();
  return userFromRequestFromDB(req, db);
}

export async function currentUser(snapshot?: Pick<DB, 'sessions' | 'users'>): Promise<User | null> {
  const sessionId = cookies().get(COOKIE_NAME)?.value;
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
}

export function clearSessionOn(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', { ...sessionCookieAttrs(), maxAge: 0 });
}
