import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireMaster } from '@/lib/access';
import { listOrganizationsForMaster, safeUserView } from '@/lib/master';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = blockIfRelational('Master · organização');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db } = guard;
  const org = db.organizations.find((o) => o.id === params.id);
  if (!org) return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 });

  const row = listOrganizationsForMaster(db).find((o) => o.id === org.id)!;
  const unitIds = new Set(row.unitSummaries.map((u) => u.id));
  const memberUserIds = new Set<string>();
  if (org.ownerId) memberUserIds.add(org.ownerId);
  for (const m of db.organizationMembers) {
    if (m.organizationId === org.id && m.active !== false) memberUserIds.add(m.userId);
  }
  for (const m of db.members) {
    if (unitIds.has(m.businessId) && m.active !== false) memberUserIds.add(m.userId);
  }
  for (const b of db.businesses) {
    if (b.organizationId === org.id) memberUserIds.add(b.ownerId);
  }

  const users = [...memberUserIds]
    .map((id) => db.users.find((u) => u.id === id))
    .filter(Boolean)
    .map((u) => safeUserView(db, u!));

  return NextResponse.json({
    organization: row,
    users,
  });
}
