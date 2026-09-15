import { NextRequest, NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { listPlatformUsers } from '@/lib/master';

// Lista GLOBAL de usuários — somente Master.
// Nunca expõe passwordHash, tokens ou segredos.
export async function GET(req: NextRequest) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const kind = (req.nextUrl.searchParams.get('kind') || '').trim().toLowerCase();
  let users = listPlatformUsers(guard.db);
  if (kind === 'master' || kind === 'owner' || kind === 'admin' || kind === 'member') {
    users = users.filter((u) => u.kind === kind);
  }
  if (q) {
    users = users.filter((u) =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.organizationNames.some((n) => n.toLowerCase().includes(q)) ||
      u.unitNames.some((n) => n.toLowerCase().includes(q)));
  }
  // Garantia: nenhum campo sensível vaza (DTO já é seguro).
  return NextResponse.json({
    total: users.length,
    counts: {
      master: listPlatformUsers(guard.db).filter((u) => u.kind === 'master').length,
      owner: listPlatformUsers(guard.db).filter((u) => u.kind === 'owner').length,
      admin: listPlatformUsers(guard.db).filter((u) => u.kind === 'admin').length,
      member: listPlatformUsers(guard.db).filter((u) => u.kind === 'member').length,
    },
    users,
  });
}
