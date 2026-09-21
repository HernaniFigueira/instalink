import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireMaster } from '@/lib/access';
import { listOrganizationsForMaster } from '@/lib/master';

// Lista GLOBAL de Organizations — somente Master.
// Usuário normal / Owner / Admin NUNCA passam por requireMaster.
export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Master · organizações');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const q = req.nextUrl.searchParams.get('q') || '';
  const organizations = listOrganizationsForMaster(guard.db, q);
  return NextResponse.json({
    total: organizations.length,
    organizations,
  });
}
