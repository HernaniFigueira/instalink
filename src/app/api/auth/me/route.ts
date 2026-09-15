import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/auth';
import { readDB } from '@/lib/db';
import {
  accessibleBusinesses, agendaScopeFor, isMasterUser, permissionsFor, resolveAccess,
  supportFromRequest, membershipsOf,
} from '@/lib/access';
import { organizationsFor } from '@/lib/organization';
import { normalizeFeatures } from '@/lib/features';
import type { BusinessAppearance } from '@/lib/types';

// GET — quem está logado + negócios acessíveis COM papel e permissões.
// É a fonte do menu do painel: cada tela só aparece quando há permissão real
// (e a API revalida a mesma coisa no servidor).
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const db = await readDB();
  // Sessão de suporte é resolvida ANTES da lista: a empresa em suporte
  // precisa aparecer para o painel abrir (e só ela, além das do usuário).
  const support = isMasterUser(user) ? await supportFromRequest(req, user.id) : null;
  const businesses = accessibleBusinesses(db, user, support);

  const list = businesses.map((b) => {
    const ctx = resolveAccess(db, user, b.id, support);
    const member = membershipsOf(db, user.id).find((m) => m.businessId === b.id);
    return {
      id: b.id,
      organizationId: b.organizationId || '',
      slug: b.slug,
      name: b.name,
      logo: b.logo || '',
      cover: b.cover || '',
      modes: b.modes,
      // Identidade visual do Dashboard (P2): a cor acompanha a UNIDADE ativa.
      appearance: b.appearance || ({ navColor: '' } satisfies BusinessAppearance),
      // Acesso do profissional (P2): `agendaScope` diz à interface o que o
      // BACKEND já está aplicando — 'own' (só a própria agenda), 'none'
      // (papel de atendimento ainda sem vínculo) ou 'all'.
      agendaScope: ctx ? agendaScopeFor(ctx) : 'all',
      professionalId: ctx?.professionalScope && ctx.professionalScope !== '__nenhum__'
        ? ctx.professionalScope : '',
      professionalName: ctx?.professional?.name || '',
      features: normalizeFeatures(b, db.pages.find((p) => p.businessId === b.id)?.blocks || []),
      published: b.published,
      role: ctx?.role || (member ? member.role : 'OWNER'),
      isOwner: b.ownerId === user.id,
      permissions: ctx ? ctx.permissions : permissionsFor('OWNER'),
      readOnly: ctx ? ctx.readOnly : false,
    };
  });

  const organizations = organizationsFor(db, user).map((o) => ({
    id: o.id, name: o.name,
    unitIds: businesses.filter((b) => b.organizationId === o.id).map((b) => b.id),
    canManage: o.ownerId === user.id || db.organizationMembers.some((m) => m.organizationId === o.id && m.userId === user.id && m.active && m.role === 'ADMIN'),
  }));
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role || 'owner' },
    isMaster: isMasterUser(user),
    businesses: list,
    organizations,
    support: support
      ? { id: support.id, businessId: support.businessId, mode: support.mode, reason: support.reason, expiresAt: support.expiresAt }
      : null,
  });
}
