// Auth do MVD: sessão por cookie httpOnly + hash scrypt.
// Interface pronta para troca por Supabase Auth (ver ARQUITETURA.md).
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { readDB, updateDB } from './db';
import type { User } from './types';
import { relationalActive } from './relational/config';
import {
  relUserBySession, relUserByEmail, relCreateSession, relDestroySession,
} from './relational/auth-store';

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
  // MODO RELACIONAL: sessão vive no Postgres (mesmo cookie, mesmo TTL).
  if (relationalActive()) return relCreateSession(userId);
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 3600 * 1000);
  await updateDB((db) => {
    db.sessions.push({ id, userId, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  });
  return id;
}

export async function destroySession(sessionId: string): Promise<void> {
  if (relationalActive()) return relDestroySession(sessionId);
  await updateDB((db) => {
    db.sessions = db.sessions.filter((s) => s.id !== sessionId);
  });
}

export async function getUserBySession(sessionId: string | undefined): Promise<User | null> {
  if (!sessionId) return null;
  // MODO RELACIONAL: JOIN sessions×users no SQL — sem tocar o documento legado.
  if (relationalActive()) return relUserBySession(sessionId);
  const db = await readDB();
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

/** Extrai token "Authorization: Bearer <session>" (fallback sem-cookie). */
export function getBearerToken(req: { headers: { get(n: string): string | null } }): string | undefined {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  return token || undefined;
}

/**
 * Auth unificada para API routes: tenta cookie httpOnly primeiro e,
 * se ausente, o Bearer token (app funciona mesmo com cookies bloqueados).
 */
export async function userFromRequest(req: {
  cookies: { get(n: string): { value: string } | undefined };
  headers: { get(n: string): string | null };
}): Promise<User | null> {
  const viaCookie = await getUserBySession(req.cookies.get(COOKIE_NAME)?.value);
  if (viaCookie) return viaCookie;
  return getUserBySession(getBearerToken(req));
}

export async function currentUser(): Promise<User | null> {
  const sessionId = cookies().get(COOKIE_NAME)?.value;
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
