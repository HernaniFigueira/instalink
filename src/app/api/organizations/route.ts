import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/access';
import { readDB, updateDB } from '@/lib/db';
import { organizationsFor, unitsForOrganization } from '@/lib/organization';
import { pushAudit } from '@/lib/audit';

// Contexto consolidado. Só agrega unidades às quais o usuário já tem acesso;
// organizationId enviado pelo cliente nunca amplia o escopo.
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.res;
  const { user } = guard;
  const db = await readDB();
  const organizations = organizationsFor(db, user).map((organization) => {
    const units = unitsForOrganization(db, user, organization.id);
    const ids = new Set(units.map((u) => u.id));
    const bookings = db.bookings.filter((x) => ids.has(x.businessId));
    const servicePrices = new Map(db.services.filter((x) => ids.has(x.businessId)).map((x) => [x.id, x.price]));
    return {
      id: organization.id, name: organization.name,
      canManage: organization.ownerId === user.id || db.organizationMembers.some((m) => m.organizationId === organization.id && m.userId === user.id && m.active && m.role === 'ADMIN'),
      units: units.map((u) => ({ id: u.id, name: u.name, slug: u.slug, address: u.address, published: u.published })),
      totals: {
        units: units.length,
        bookings: bookings.length,
        clients: db.contacts.filter((x) => ids.has(x.businessId)).length,
        predictedRevenue: bookings.filter((x) => !['cancelled', 'no_show'].includes(x.status)).reduce((sum, x) => sum + (servicePrices.get(x.serviceId) || 0), 0),
      },
    };
  });
  return NextResponse.json({ organizations });
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.res;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: 'Informe o nome da organização.' }, { status: 400 });
  const now = new Date().toISOString();
  const organization = { id: randomUUID(), name, ownerId: guard.user.id, metadata: {}, createdAt: now, updatedAt: now };
  await updateDB((db) => {
    db.organizations.push(organization);
    pushAudit(db, { action: 'organization.created', actor: guard.user, businessId: '', meta: { organizationId: organization.id } });
  });
  return NextResponse.json({ ok: true, organization }, { status: 201 });
}

