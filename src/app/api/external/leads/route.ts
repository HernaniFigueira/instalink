import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-keys';
import { checkIdempotency, extractIdempotencyKey, saveIdempotency } from '@/lib/idempotency';
import { ingestLead, getBusinessPipeline } from '@/lib/pipeline';
import { dispatchWebhook } from '@/lib/webhooks';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';
import type { DB } from '@/lib/types';

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { db, business } = auth;
  const q = req.nextUrl.searchParams;
  const stageId = q.get('stageId') || '';
  const search = (q.get('search') || '').toLowerCase().trim();
  const page = Math.max(1, Number(q.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 30));

  let leads = db.leads.filter((l) => l.businessId === business.id);

  if (stageId) {
    leads = leads.filter((l) => (l.stageId || l.status) === stageId);
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
  const pipeline = getBusinessPipeline(db, business.id);

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

    await updateDB((d: DB) => {
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
    });

    // 2. Disparo de Webhook (assíncrono e não-bloqueante)
    try {
      const eventName = result!.isNew ? 'lead.created' : 'lead.updated';
      await updateDB(async (d: DB) => {
        await dispatchWebhook(d, eventName, business.id, {
          lead: result!.lead,
          isNew: result!.isNew,
        });
      });
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
