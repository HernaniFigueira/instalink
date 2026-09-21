import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireMaster } from '@/lib/access';
import { platformOverview } from '@/lib/master';

// Visão geral da plataforma — somente Master.
// Receita = receita do GoDoutor (zero enquanto não houver billing real).
export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Master · visão geral');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  return NextResponse.json(platformOverview(guard.db, 25));
}
