import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { upsertWebhook, deleteWebhook, sanitizeWebhookForDisplay } from '@/lib/webhooks';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;

  // NUNCA expõe o secret completo no GET
  const rawWebhooks = (guard.db.webhooks || []).filter((w) => w.businessId === businessId);
  const webhooks = rawWebhooks.map(sanitizeWebhookForDisplay);

  const deliveries = (guard.db.webhookDeliveries || [])
    .filter((d) => d.businessId === businessId)
    .slice(-30)
    .reverse();

  return NextResponse.json({ ok: true, webhooks, deliveries });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    const isNew = !body.id;
    let webhook: any = null;

    await updateDB((d) => {
      webhook = upsertWebhook(d, businessId, {
        id: body.id,
        url: body.url,
        events: body.events,
        active: body.active !== false,
        secret: body.secret,
      });

      pushAudit(d, {
        action: isNew ? 'webhook.created' : 'webhook.updated',
        actor: guard.ctx.user,
        businessId,
        meta: { webhookId: webhook.id, url: webhook.url },
      });
    });

    const safeWebhook = sanitizeWebhookForDisplay(webhook);

    // O segredo completo só é devolvido UMA ÚNICA VEZ na criação do webhook
    return NextResponse.json({
      ok: true,
      webhook: isNew
        ? { ...safeWebhook, secret: webhook.secret }
        : safeWebhook,
      secret: isNew ? webhook.secret : undefined,
    }, { status: isNew ? 201 : 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao salvar webhook.' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const webhookId = String(body.webhookId || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    await updateDB((d) => {
      deleteWebhook(d, businessId, webhookId);
      pushAudit(d, {
        action: 'webhook.deleted',
        actor: guard.ctx.user,
        businessId,
        meta: { webhookId },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao remover webhook.' }, { status: 400 });
  }
}
