// Auth do CONSUMIDOR (quem compra/agenda na página pública).
// Espelha o padrão da auth do lojista: cookie httpOnly + Bearer,
// sessões revogáveis com expiração. Tabelas separadas: um token de
// consumidor nunca autentica no painel — e vice-versa.
import { randomUUID } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { readDB, updateDB } from './db';
import type { Customer } from './types';

export const CUSTOMER_COOKIE = 'il_cust_session';
const SESSION_DAYS = 90;
export const CUSTOMER_MAX_AGE = SESSION_DAYS * 24 * 3600;

export async function createCustomerSession(customerId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 3600 * 1000);
  await updateDB((db) => {
    db.customerSessions.push({ id, customerId, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  });
  return id;
}

export async function destroyCustomerSession(sessionId: string): Promise<void> {
  await updateDB((db) => {
    db.customerSessions = db.customerSessions.filter((s) => s.id !== sessionId);
  });
}

export async function getCustomerBySession(sessionId: string | undefined): Promise<Customer | null> {
  if (!sessionId) return null;
  const db = await readDB();
  const session = db.customerSessions.find((s) => s.id === sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return db.customers.find((c) => c.id === session.customerId) || null;
}

export async function customerFromRequest(req: {
  cookies: { get(n: string): { value: string } | undefined };
  headers: { get(n: string): string | null };
}): Promise<Customer | null> {
  const viaCookie = await getCustomerBySession(req.cookies.get(CUSTOMER_COOKIE)?.value);
  if (viaCookie) return viaCookie;
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return getCustomerBySession(m ? m[1].trim() : undefined);
}

function attrs() {
  return {
    httpOnly: true,
    sameSite: 'none' as const,
    secure: true,
    partitioned: true,
    path: '/',
    maxAge: CUSTOMER_MAX_AGE,
  };
}

export function setCustomerSessionOn(res: NextResponse, sessionId: string): void {
  res.cookies.set(CUSTOMER_COOKIE, sessionId, attrs());
}

export function clearCustomerSessionOn(res: NextResponse): void {
  res.cookies.set(CUSTOMER_COOKIE, '', { ...attrs(), maxAge: 0 });
}

export function publicCustomer(c: Customer) {
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, avatar: c.avatar };
}
