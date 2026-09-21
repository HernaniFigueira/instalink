import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireBusiness } from '@/lib/access';
import { integrationEventsOf, summarizeIntegrationEvents } from '@/lib/integrations/logs';
import type { IntegrationEventStatus } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// P6 — LOG DE ENTREGAS EXTERNAS (por unidade)
// ═══════════════════════════════════════════════════════════════
// Somente LEITURA e sempre escopado pela unidade autenticada. O log já é
// gravado sanitizado (sem token, sem segredo, sem corpo integral) — esta rota
// não devolve nada além do que foi registrado, e o registro não pertence a
// outra unidade por construção (todo filtro é por `businessId`).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Integrações · eventos');
  if (blocked) return blocked;

  const businessId = String(req.nextUrl.searchParams.get('businessId') || '').trim();
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;

  const integrationId = String(req.nextUrl.searchParams.get('integrationId') || '').trim();
  const status = String(req.nextUrl.searchParams.get('status') || '').trim() as IntegrationEventStatus | '';
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 50;

  return NextResponse.json({
    ok: true,
    businessId,
    events: integrationEventsOf(guard.db, businessId, {
      integrationId: integrationId || undefined,
      status: status || undefined,
      limit,
    }),
    summary: summarizeIntegrationEvents(guard.db, businessId),
  });
}
