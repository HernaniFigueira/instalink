import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { experimentalLifecycle, experimentalView, type ExperimentalAction } from '@/lib/whatsapp-providers/lifecycle';
import { EvolutionError } from '@/lib/whatsapp-providers/evolution';

const headers = { 'Cache-Control': 'no-store' };
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const guard = await requireBusiness(req, req.nextUrl.searchParams.get('businessId') || '', 'whatsapp');
  if (!guard.ok) return guard.res;
  return NextResponse.json(experimentalView(guard.ctx.business), { headers });
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const guard = await requireBusiness(req, String(body.businessId || ''), 'whatsapp');
    if (!guard.ok) return guard.res;
    const action = body.action as ExperimentalAction;
    if (!['connect', 'qr', 'status', 'disconnect', 'remove'].includes(action)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400, headers });
    // Instance is NEVER accepted from the caller. Only the persisted tenant binding.
    const result = await experimentalLifecycle(guard.ctx.business.id, action, guard.ctx.user);
    return NextResponse.json(result, { headers });
  } catch (err) {
    const status = err instanceof EvolutionError ? 502 : Number((err as any)?.status) || 500;
    const error = err instanceof EvolutionError || status === 409 || status === 404
      ? (err as Error).message : 'Não foi possível atualizar a conexão experimental.';
    return NextResponse.json({ error }, { status: err instanceof EvolutionError && err.status === 503 ? 503 : status, headers });
  }
}
