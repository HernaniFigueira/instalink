import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { canManageOrganization } from '@/lib/organization';
import { updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite } from '@/lib/relational/slice';
import { getPool } from '@/lib/relational/pool';
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
  const slugTaken = async (candidate: string) => {
    if (db.businesses.some((x: any) => x.slug === candidate)) return true;
    if (relationalActive()) {
      // Slug é ÚNICO entre TODAS as unidades (constraint do banco) — a checagem
      // global sai de consulta pontual, não da fatia (que só tem a unidade).
      const dup = await getPool().query('SELECT 1 FROM app.businesses WHERE slug = $1', [candidate]);
      return dup.rows.length > 0;
    }
    return false;
  };
  if (await slugTaken(slug)) slug = `${slug}${Math.floor(Math.random() * 90 + 10)}`;

  const id = randomUUID();
  const now = new Date().toISOString();
  const organization = db.organizations.find((x) => x.id === organizationId)!;
  const target = duplicatedBusiness(ctx.business, { id, name, slug, address, ownerId: organization.ownerId, now });

  /** Mutação PURA (DOIS MOTORES): cria a unidade nova + estrutura whitelist
   * (serviços/categorias/página) + vínculo de admin da organização. No modo
   * relacional o diff grava businesses/members/services/categories/pages;
   * a unicidade global de slug fica garantida pela constraint do banco. */
  const duplicateTx = (fresh: any) => {
    const source = (fresh.businesses || []).find((x: any) => x.id === ctx.business.id && x.organizationId === organizationId);
    if (!source) throw new Error('source_changed');
    if ((fresh.businesses || []).some((x: any) => x.id === id || x.slug === slug)) throw new Error('duplicate_target');
    fresh.businesses.push(target);
    duplicateUnitStructure(fresh, source, target);
    if (target.ownerId !== ctx.user.id) {
      fresh.members.push({ id: randomUUID(), businessId: id, userId: ctx.user.id, role: 'ADMIN', permissions: {}, active: true, note: 'Administrador da organização', invitedBy: target.ownerId, createdAt: now, updatedAt: now });
    }
    pushAudit(fresh, { action: 'unit.created', actor: ctx.user, businessId: id, supportSessionId: ctx.support?.id, meta: { organizationId, duplicatedFrom: source.id } });
    return true;
  };
  if (relationalActive()) {
    await runRelationalWrite(ctx.business.id, duplicateTx, {
      load: { services: {}, categories: {}, pages: {} },
    });
  } else {
    await updateDB(duplicateTx);
  }
  return NextResponse.json({ ok: true, businessId: id, organizationId, slug }, { status: 201 });
}
