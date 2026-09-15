import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { canManageOrganization } from '@/lib/organization';
import { updateDB } from '@/lib/db';
import { duplicatedBusiness, duplicateUnitStructure } from '@/lib/unit-duplication';
import { isValidSlug, slugify } from '@/lib/utils';
import { pushAudit } from '@/lib/audit';

// Base segura para a futura UX “Duplicar unidade”. A operação é explícita,
// permanece na mesma Organization e usa whitelist estrutural (nunca JSON cego).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireBusiness(req, params.id, 'config');
  if (!guard.ok) return guard.res;
  const { db, ctx } = guard;
  const organizationId = ctx.business.organizationId || '';
  if (!organizationId || !canManageOrganization(db, ctx.user, organizationId)) {
    return NextResponse.json({ error: 'Você não pode duplicar unidades nesta organização.' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 80);
  const address = String(body.address || '').trim().slice(0, 240);
  let slug = slugify(String(body.slug || name));
  if (!name || !isValidSlug(slug)) return NextResponse.json({ error: 'Informe nome e endereço público válido.' }, { status: 400 });
  if (db.businesses.some((x) => x.slug === slug)) slug = `${slug}${Math.floor(Math.random() * 90 + 10)}`;

  const id = randomUUID();
  const now = new Date().toISOString();
  const organization = db.organizations.find((x) => x.id === organizationId)!;
  const target = duplicatedBusiness(ctx.business, { id, name, slug, address, ownerId: organization.ownerId, now });
  await updateDB((fresh) => {
    const source = fresh.businesses.find((x) => x.id === ctx.business.id && x.organizationId === organizationId);
    if (!source) throw new Error('source_changed');
    if (fresh.businesses.some((x) => x.id === id || x.slug === slug)) throw new Error('duplicate_target');
    fresh.businesses.push(target);
    duplicateUnitStructure(fresh, source, target);
    if (target.ownerId !== ctx.user.id) {
      fresh.members.push({ id: randomUUID(), businessId: id, userId: ctx.user.id, role: 'ADMIN', permissions: {}, active: true, note: 'Administrador da organização', invitedBy: target.ownerId, createdAt: now, updatedAt: now });
    }
    pushAudit(fresh, { action: 'unit.created', actor: ctx.user, businessId: id, supportSessionId: ctx.support?.id, meta: { organizationId, duplicatedFrom: source.id } });
  });
  return NextResponse.json({ ok: true, businessId: id, organizationId, slug }, { status: 201 });
}
