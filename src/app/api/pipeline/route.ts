import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { getBusinessPipeline, updateBusinessPipeline } from '@/lib/pipeline';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'leads');
  if (!guard.ok) return guard.res;

  const pipeline = getBusinessPipeline(guard.db, businessId);
  // A1.2 · Bloco 2: a leitura é liberada para quem opera o funil ('leads'),
  // mas administrar etapas é ação de configuração — o flag vem da permissão
  // REAL do usuário nesta unidade (a UI só mostra o editor com ele; a
  // autoridade continua no PATCH abaixo, que exige 'config').
  return NextResponse.json({ ok: true, pipeline, canEdit: guard.ctx.permissions.config === true });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    const stages = Array.isArray(body.stages) ? body.stages : [];

    let updatedPipeline: any = null;

    await updateDB((d) => {
      updatedPipeline = updateBusinessPipeline(d, businessId, stages);
      pushAudit(d, {
        action: 'pipeline.updated',
        actor: guard.ctx.user,
        businessId,
        meta: { stagesCount: updatedPipeline.stages.length },
      });
    });

    return NextResponse.json({ ok: true, pipeline: updatedPipeline });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao atualizar esteira.' }, { status: 400 });
  }
}
