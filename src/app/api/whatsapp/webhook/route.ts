import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { webhookVerifyToken } from '@/lib/whatsapp';
import { pushAudit } from '@/lib/audit';
import { processWhatsappInbound } from '@/lib/whatsapp-inbound';
import { resolveTenantForChange, verifyMetaWebhookSignature } from '@/lib/whatsapp-cloud-api';

// WEBHOOK do WhatsApp oficial (provedor → InstaLink).
// GET  ?hub.mode=subscribe&hub.verify_token=… → handshake de verificação.
// POST → recebe mensagens e atualizações de status da Meta com fail-closed.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mode = q.get('hub.mode');
  const token = q.get('hub.verify_token') || '';
  const challenge = q.get('hub.challenge') || '';
  const expected = webhookVerifyToken();

  if (!expected) {
    return NextResponse.json({ error: 'Webhook não configurado (WHATSAPP_VERIFY_TOKEN ausente).' }, { status: 503 });
  }
  if (mode === 'subscribe' && token === expected) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'Verificação inválida.' }, { status: 403 });
}

interface IncomingMessage {
  externalId: string;
  phone: string;
  name: string;
  body: string;
}

interface IncomingStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId: string;
  timestamp: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

interface WebhookChangeBatch {
  phoneNumberId: string;
  wabaId: string;
  messages: IncomingMessage[];
  statuses: IncomingStatus[];
}

function parseWebhookBatches(payload: any): WebhookChangeBatch[] {
  const batches: WebhookChangeBatch[] = [];

  for (const entry of payload?.entry || []) {
    const wabaId = String(entry?.id || '');
    for (const change of entry?.changes || []) {
      const val = change?.value;
      const phoneNumberId = String(val?.metadata?.phone_number_id || '');
      const messages: IncomingMessage[] = [];
      const statuses: IncomingStatus[] = [];

      const contactMap = new Map<string, string>();
      if (Array.isArray(val?.contacts)) {
        for (const c of val.contacts) {
          if (c?.wa_id && c?.profile?.name) {
            contactMap.set(String(c.wa_id), String(c.profile.name));
          }
        }
      }

      if (Array.isArray(val?.messages)) {
        for (const m of val.messages) {
          const phone = String(m?.from || m?.phone || '');
          const body = String(m?.text?.body ?? m?.body ?? '').slice(0, 4000);
          const externalId = String(m?.id || m?.externalId || '');
          if (!phone && !externalId) continue;
          const mappedName = contactMap.get(phone) || String(m?.profile?.name || m?.name || '').slice(0, 80);
          messages.push({
            externalId,
            phone,
            name: mappedName,
            body,
          });
        }
      }

      if (Array.isArray(val?.statuses)) {
        for (const s of val.statuses) {
          const id = String(s?.id || '');
          const status = s?.status;
          if (!id || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
          statuses.push({
            id,
            status,
            recipientId: String(s?.recipient_id || ''),
            timestamp: String(s?.timestamp || ''),
            errors: Array.isArray(s?.errors) ? s.errors : undefined,
          });
        }
      }

      if (messages.length > 0 || statuses.length > 0) {
        batches.push({
          phoneNumberId,
          wabaId,
          messages,
          statuses,
        });
      }
    }
  }

  // Suporte a payload plano direto (testes legados / mock)
  if (batches.length === 0 && (Array.isArray(payload?.messages) || Array.isArray(payload?.statuses))) {
    const messages: IncomingMessage[] = [];
    const statuses: IncomingStatus[] = [];
    for (const m of payload.messages || []) {
      const phone = String(m?.from || m?.phone || '');
      const body = String(m?.text?.body ?? m?.body ?? '').slice(0, 4000);
      const externalId = String(m?.id || m?.externalId || '');
      if (phone || externalId) {
        messages.push({ externalId, phone, name: String(m?.name || '').slice(0, 80), body });
      }
    }
    for (const s of payload.statuses || []) {
      const id = String(s?.id || '');
      if (id && ['sent', 'delivered', 'read', 'failed'].includes(s?.status)) {
        statuses.push({ id, status: s.status, recipientId: String(s?.recipient_id || ''), timestamp: String(s?.timestamp || ''), errors: s?.errors });
      }
    }
    if (messages.length > 0 || statuses.length > 0) {
      batches.push({
        phoneNumberId: String(payload?.phoneNumberId || ''),
        wabaId: String(payload?.wabaId || ''),
        messages,
        statuses,
      });
    }
  }

  return batches;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');

    // 1. FAIL-CLOSED: segredo ausente rejeita imediatamente com 503
    const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
    if (!appSecret || appSecret.trim().length === 0) {
      console.warn('[WHATSAPP WEBHOOK] Falha fechada: WHATSAPP_APP_SECRET não configurado.');
      return NextResponse.json({ error: 'Configuração do App Secret ausente no servidor.' }, { status: 503 });
    }

    // 2. Validação criptográfica de assinatura (HMAC SHA-256)
    if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
      return NextResponse.json({ error: 'Assinatura do webhook inválida.' }, { status: 403 });
    }

    const payload = JSON.parse(rawBody || '{}');
    const batches = parseWebhookBatches(payload);

    if (batches.length === 0) {
      return NextResponse.json({ ok: true, received: 0 });
    }

    const db = await readDB();
    let totalProcessed = 0;

    // 3. Processa CADA entry/change isoladamente para o seu respectivo tenant (Item 7)
    for (const batch of batches) {
      const business = resolveTenantForChange(db, batch.phoneNumberId, batch.wabaId);
      if (!business) {
        // Unidade não mapeada: ignora para não vazar dados entre negócios
        continue;
      }

      const businessId = business.id;

      await updateDB((d) => {
        const now = new Date().toISOString();
        const b = d.businesses.find((x) => x.id === businessId)!;
        if (b.whatsappIntegration?.provider === 'whatsapp_web') return;
        if (!b.whatsappIntegration) {
          b.whatsappIntegration = {
            status: 'not_connected', displayPhone: '', phoneNumberId: '', wabaId: '',
            connectedAt: '', lastWebhookAt: '', requestedAt: '',
          };
        }
        b.whatsappIntegration.lastWebhookAt = now;

        // 3.1. Processar atualizações de status da Meta
        for (const st of batch.statuses) {
          const target = d.messages.find((m) => m.externalId === st.id && m.businessId === businessId);
          if (target) {
            target.status = st.status;
            if (st.status === 'failed') {
              const errDetail = st.errors?.[0]?.message || st.errors?.[0]?.title || 'Mensagem rejeitada pela Meta.';
              target.error = errDetail;
              b.whatsappIntegration.lastError = errDetail;
              b.whatsappIntegration.lastErrorAt = now;
            }
          }
        }


        pushAudit(d, {
          action: 'whatsapp.webhook_received',
          actor: { id: 'system', email: 'webhook@instalink.app', role: 'system' },
          businessId,
          meta: { messages: batch.messages.length, statuses: batch.statuses.length },
        });
      });

      totalProcessed += batch.messages.length + batch.statuses.length;
      for (const message of batch.messages) {
        await processWhatsappInbound({ ...message, businessId, provider: 'meta_cloud' });
      }
    }

    return NextResponse.json({
      ok: true,
      received: totalProcessed,
      mapped: totalProcessed > 0,
    });
  } catch (err) {
    console.error('[WHATSAPP WEBHOOK POST ERROR] Processing failed');
    return NextResponse.json({ error: 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
