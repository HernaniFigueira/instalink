import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireApiKey } from '@/lib/api-keys';
import { checkIdempotency, extractIdempotencyKey, saveIdempotency } from '@/lib/idempotency';
import { ingestLead, getBusinessPipeline, resolveStageId, normalizeLeadStageId } from '@/lib/pipeline';
import { enqueueWebhookTx, deliverWebhookIds } from '@/lib/webhooks';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';
import type { DB } from '@/lib/types';

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('API externa · leads');
  if (blocked) return blocked;

  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { db, business } = auth;
  const q = req.nextUrl.searchParams;
  const stageId = q.get('stageId') || '';
  const search = (q.get('search') || '').toLowerCase().trim();
  const page = Math.max(1, Number(q.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 30));

  const pipeline = getBusinessPipeline(db, business.id);

  // A1.2 · Bloco 2 (F3): filtro pela etapa NORMALIZADA — entrada legada em
  // LeadStatus ou etapa inválida não quebra nem deixa lead invisível.
  let leads = db.leads.filter((l) => l.businessId === business.id);

  if (stageId) {
    const target = resolveStageId(pipeline, stageId).stageId;
    leads = leads.filter((l) => normalizeLeadStageId(pipeline, l) === target);
  }

  if (search) {
    leads = leads.filter((l) =>
      l.name.toLowerCase().includes(search) ||
      l.phone.includes(search) ||
      l.email.toLowerCase().includes(search) ||
      l.interest.toLowerCase().includes(search),
    );
  }

  // Ordena por data decrescente
  leads.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const total = leads.length;
  const items = leads.slice((page - 1) * limit, page * limit);

  await updateDB((d) => {
    pushIntegrationLog(d, {
      businessId: business.id,
      endpoint: '/api/external/leads',
      method: 'GET',
      source: 'api',
      status: 200,
    });
  });

  return NextResponse.json({
    ok: true,
    businessId: business.id,
    leads: items,
    stages: pipeline.stages,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
  });
}

export async function POST(req: NextRequest) {
  const blocked = blockIfRelational('API externa · leads');
  if (blocked) return blocked;

  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { business, apiKey } = auth;
  const idempotencyKey = extractIdempotencyKey(req.headers);

  // 1. Checagem de Idempotência
  if (idempotencyKey) {
    const cached = checkIdempotency(auth.db, business.id, idempotencyKey, '/api/external/leads');
    if (cached) {
      return NextResponse.json(cached.responseBody, {
        status: cached.statusCode,
        headers: { 'X-Idempotent-Replay': 'true' },
      });
    }
  }

  try {
    const body = await req.json();

    let result: ReturnType<typeof ingestLead>;

    let replay: ReturnType<typeof checkIdempotency> = null;
    const webhookDeliveryIds: string[] = [];
    await updateDB((d: DB) => {
      replay = checkIdempotency(d, business.id, idempotencyKey, '/api/external/leads');
      if (replay) return;
      // Ignora body.businessId e amarra ESTRITAMENTE ao business autenticado
      result = ingestLead(d, {
        businessId: business.id,
        name: body.name,
        phone: body.phone,
        email: body.email,
        instagram: body.instagram,
        message: body.message,
        interest: body.interest,
        source: body.source || 'api',
        channel: body.channel,
        sourceUrl: body.sourceUrl,
        serviceId: body.serviceId,
        professionalId: body.professionalId,
        priority: body.priority,
        assignedUserId: body.assignedUserId,
        stageId: body.stageId,
        metadata: body.metadata,
        actor: {
          id: apiKey.id,
          name: apiKey.name || 'API Externa',
          type: 'api',
        },
      });

      pushIntegrationLog(d, {
        businessId: business.id,
        endpoint: '/api/external/leads',
        method: 'POST',
        source: 'api',
        status: result.isNew ? 201 : 200,
      });

      if (idempotencyKey) {
        saveIdempotency(
          d,
          business.id,
          idempotencyKey,
          '/api/external/leads',
          result.isNew ? 201 : 200,
          { ok: true, lead: result.lead, isNew: result.isNew },
        );
      }

      // Outbox e alteração de negócio no mesmo commit; nenhum HTTP aqui.
      webhookDeliveryIds.push(...enqueueWebhookTx(d, result!.isNew ? 'lead.created' : 'lead.updated', business.id, {
        lead: result!.lead,
        isNew: result!.isNew,
      }).map((delivery) => delivery.id));
    });

    if (replay) {
      const cached = replay as NonNullable<ReturnType<typeof checkIdempotency>>;
      return NextResponse.json(cached.responseBody, { status: cached.statusCode, headers: { 'X-Idempotent-Replay': 'true' } });
    }

    // 2. Entrega pós-commit: aguarda HTTP sem manter o lock do documento.
    try {
      await deliverWebhookIds(webhookDeliveryIds);
    } catch (whErr) {
      console.error('[webhook dispatch error]:', whErr);
    }

    return NextResponse.json(
      { ok: true, lead: result!.lead, isNew: result!.isNew },
      { status: result!.isNew ? 201 : 200 },
    );
  } catch (err: any) {
    const status = err?.status || 400;
    return NextResponse.json(
      { error: err?.message || 'Falha ao processar lead.' },
      { status },
    );
  }
}
