import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireMaster } from '@/lib/access';

// AUDITORIA da plataforma (somente master). Ações administrativas
// relevantes: suporte, edição de módulos/configuração, equipe, campanhas.
export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Admin · auditoria');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db } = guard;
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
  const list = db.audit
    .filter((a) => !businessId || a.businessId === businessId)
    .slice(-limit)
    .reverse()
    .map((a) => ({
      ...a,
      businessName: a.businessId ? db.businesses.find((b) => b.id === a.businessId)?.name || '' : '',
    }));
  return NextResponse.json({ audit: list, total: db.audit.length });
}
