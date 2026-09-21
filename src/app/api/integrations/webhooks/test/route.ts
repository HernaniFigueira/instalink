import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { signWebhookPayload } from '@/lib/webhooks';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    let url = String(body.url || '').trim();
    let secret = String(body.secret || '').trim();

    if (!url && body.webhookId) {
      const hook = (guard.db.webhooks || []).find(
        (w) => w.id === body.webhookId && w.businessId === businessId,
      );
      if (hook) {
        url = hook.url;
        secret = hook.secret;
      }
    }

    if (!secret) secret = 'whsec_test';

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'URL de webhook inválida.' }, { status: 400 });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const testPayload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      event: 'lead.created',
      businessId,
      createdAt: new Date().toISOString(),
      test: true,
      data: {
        lead: {
          id: 'lead-test-123',
          name: 'Lead Teste GoDoutor',
          phone: '11999999999',
          email: 'teste@instalink.app',
          origin: 'external_site',
          stageId: 'new',
        },
      },
    });

    const signature = signWebhookPayload(secret, testPayload, timestamp);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    const start = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Instalink-Signature': `t=${timestamp},v1=${signature}`,
        'X-Instalink-Timestamp': String(timestamp),
        'User-Agent': 'InstaLink-Webhook-Test/1.0',
      },
      body: testPayload,
      signal: controller.signal,
    }).catch((e) => ({
      ok: false,
      status: 0,
      statusText: e?.message || 'Falha de conexão',
    }));
    clearTimeout(timer);
    const durationMs = Date.now() - start;

    return NextResponse.json({
      ok: res.ok,
      statusCode: res.status,
      durationMs,
      message: res.ok ? 'Webhook entregue com sucesso.' : `Falha no destino: HTTP ${res.status}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao testar webhook.' }, { status: 400 });
  }
}
