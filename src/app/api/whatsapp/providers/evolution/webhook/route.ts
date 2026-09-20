import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { processWhatsappInbound } from '@/lib/whatsapp-inbound';
import { evolutionConfigured, normalizeEvolutionMessage, validEvolutionWebhook } from '@/lib/whatsapp-providers/evolution';
import { experimentalLifecycle } from '@/lib/whatsapp-providers/lifecycle';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!evolutionConfigured()) return NextResponse.json({ error: 'Provider indisponível.' }, { status: 503 });
  try {
    // Bound body size even for chunked requests; don't retain/log vendor payloads.
    const reader = req.body?.getReader();
    if (!reader) return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 256_000) { await reader.cancel(); return NextResponse.json({ error: 'Payload muito grande.' }, { status: 413 }); }
      chunks.push(value);
    }
    let payload: any;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 }); }
    const instance = typeof payload?.instance === 'string' ? payload.instance : '';
    if (!/^il_[a-f0-9]{32}$/.test(instance) || !validEvolutionWebhook(instance, req.headers.get('x-instalink-webhook-secret'))) {
      return NextResponse.json({ error: 'Webhook inválido.' }, { status: 403 });
    }
    const db = await readDB();
    const matches = db.businesses.filter((b) => b.whatsappIntegration?.provider === 'whatsapp_web' && b.whatsappIntegration.instanceName === instance);
    if (matches.length !== 1) {
      console.info(JSON.stringify({ provider: 'whatsapp_web', event: 'unmapped_instance', direction: 'in', status: 'ignored', timestamp: new Date().toISOString() }));
      return NextResponse.json({ ok: true, received: 0 });
    }
    const businessId = matches[0].id;
    await updateDB((d) => {
      const i = d.businesses.find((b) => b.id === businessId)?.whatsappIntegration;
      if (i?.provider === 'whatsapp_web' && i.instanceName === instance) i.lastWebhookAt = new Date().toISOString();
    });
    const event = String(payload.event || '').toLowerCase().replace(/_/g, '.');
    if (event === 'connection.update') {
      // Query authoritative current state: a delayed "open" webhook cannot undo logout.
      try { await experimentalLifecycle(businessId, 'status', { id: 'system', email: 'webhook@instalink.app' }); }
      catch (err) { if ((err as any)?.status !== 409) throw err; } // active lifecycle will reconcile
      return NextResponse.json({ ok: true });
    }
    if (event !== 'messages.upsert') return NextResponse.json({ ok: true, received: 0 });
    // The first message can race the connection event/UI poll. Reconcile before
    // acknowledging it; a busy lifecycle returns 503 so the provider may redeliver.
    if (['qr_pending', 'connecting', 'error'].includes(matches[0].whatsappIntegration!.status)) {
      await experimentalLifecycle(businessId, 'status', { id: 'system', email: 'webhook@instalink.app' });
    }
    const messages = Array.isArray(payload.data) ? payload.data : [payload.data];
    let received = 0;
    const deadline = Date.now() + 40_000;
    for (const data of messages) {
      if (Date.now() > deadline) return NextResponse.json({ error: 'Reentregue o lote para continuar.' }, { status: 503 });
      const normalized = normalizeEvolutionMessage(data);
      if (!normalized) continue;
      await processWhatsappInbound({ ...normalized, businessId, provider: 'whatsapp_web', instance });
      received++;
    }
    return NextResponse.json({ ok: true, received });
  } catch {
    console.warn(JSON.stringify({ provider: 'whatsapp_web', direction: 'in', event: 'webhook_failed', status: 'error', timestamp: new Date().toISOString() }));
    return NextResponse.json({ error: 'Falha ao processar webhook.' }, { status: 500 });
  }
}
