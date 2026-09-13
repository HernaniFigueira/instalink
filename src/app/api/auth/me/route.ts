import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/auth';
import { readDB } from '@/lib/db';
import {
  accessibleBusinesses, isMasterUser, permissionsFor, resolveAccess, supportFromRequest,
  membershipsOf,
} from '@/lib/access';
import { normalizeFeatures } from '@/lib/features';

// GET — quem está logado + negócios acessíveis COM papel e permissões.
// É a fonte do menu do painel: cada tela só aparece quando há permissão real
// (e a API revalida a mesma coisa no servidor).
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const db = await readDB();
  // Sessão de suporte é resolvida ANTES da lista: a empresa em suporte
  // precisa aparecer para o painel abrir (e só ela, além das do usuário).
  const support = isMasterUser(user) ? await supportFromRequest(req) : null;
  const businesses = accessibleBusinesses(db, user, support);

  const list = businesses.map((b) => {
    const ctx = resolveAccess(db, user, b.id, support);
    const member = membershipsOf(db, user.id).find((m) => m.businessId === b.id);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      modes: b.modes,
      features: normalizeFeatures(b, db.pages.find((p) => p.businessId === b.id)?.blocks || []),
      published: b.published,
      role: ctx?.role || (member ? member.role : 'OWNER'),
      isOwner: b.ownerId === user.id,
      permissions: ctx ? ctx.permissions : permissionsFor('OWNER'),
      readOnly: ctx ? ctx.readOnly : false,
    };
  });

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role || 'owner' },
    isMaster: isMasterUser(user),
    businesses: list,
    support: support
      ? { id: support.id, businessId: support.businessId, mode: support.mode, reason: support.reason, expiresAt: support.expiresAt }
      : null,
  });
}
