// Multi-tenancy: NUNCA consultar entidade de negócio sem passar por aqui.
// Toda query é escopada por businessId + verificação de dono.
import { redirect } from 'next/navigation';
import { readDB } from './db';
import { currentUser } from './auth';
import type { Business, User } from './types';

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

/** Todos os negócios do usuário logado. */
export async function myBusinesses(): Promise<Business[]> {
  const user = await requireUser();
  const db = await readDB();
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
