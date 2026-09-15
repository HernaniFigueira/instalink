import { NextRequest, NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { listUnitsForMaster } from '@/lib/master';

export async function GET(req: NextRequest) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const q = req.nextUrl.searchParams.get('q') || '';
  const units = listUnitsForMaster(guard.db, q);
  return NextResponse.json({ total: units.length, units });
}
