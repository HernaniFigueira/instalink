import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/auth';
import { readDB } from '@/lib/db';

// GET — quem está logado + seus negócios (cookie OU Bearer).
// Usado pelos guards (onboarding, painel) e pelo menu dinâmico.
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const db = await readDB();
  const businesses = db.businesses
    .filter((b) => b.ownerId === user.id)
    .map((b) => ({ id: b.id, slug: b.slug, name: b.name, modes: b.modes, published: b.published }));
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email }, businesses });
}
