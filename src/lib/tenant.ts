// Multi-tenancy: NUNCA consultar entidade de negócio sem passar por aqui.
// Toda query é escopada por businessId + verificação de dono.
import { redirect } from 'next/navigation';
import { readDB } from './db';
import { cookies } from 'next/headers';
import { sessionCookieId, currentUser, getUserBySessionFromDB } from './auth';
import type { Business, User } from './types';

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

/** Todos os negócios do usuário logado. */
export async function myBusinesses(): Promise<Business[]> {
  const sessionId = sessionCookieId(cookies());
  if (!sessionId) redirect('/login');
  const db = await readDB();
  const user = getUserBySessionFromDB(db, sessionId);
  if (!user) redirect('/login');
  return db.businesses.filter((b) => b.ownerId === user.id);
}

/** Negócio atual (query ?b= ou o primeiro). Garante posse. */
export async function myBusiness(businessId?: string | null): Promise<Business> {
  const list = await myBusinesses();
  if (list.length === 0) redirect('/onboarding');
  if (businessId) {
    const found = list.find((b) => b.id === businessId);
    if (found) return found;
    redirect('/dashboard'); // tentou acessar tenant alheio
  }
  return list[0];
}
