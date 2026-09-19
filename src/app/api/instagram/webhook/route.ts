import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { parseInstagramWebhook } from '@/lib/instagram';
import {
  fetchInstagramProfile, getInstagramCredentials, ingestInstagramNotification,
  instagramAppSecret, instagramVerifyToken, resolveBusinessForInstagramAccountId,
  verifyInstagramWebhookSignature,
} from '@/lib/instagram-api';

// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 9 — WEBHOOK DO INSTAGRAM DIRECT
// ═══════════════════════════════════════════════════════════════
// GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → handshake.
// POST → eventos `object: "instagram"` (mensagens diretas).
//
// FAIL-CLOSED: sem App Secret configurado o endpoint responde 503 (nunca
// "aceita tudo"); assinatura inválida responde 403 e NADA é processado.
// A Meta reentrega eventos — a chave `mid` garante idempotência.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const expected = instagramVerifyToken() || String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
  if (!expected) {
    return NextResponse.json({ error: 'Webhook do Instagram não configurado no servidor.' }, { status: 503 });
  }
  if (q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === expected) {
    const challenge = q.get('hub.challenge') || '';
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'Verificação inválida.' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // 1. Falha fechada quando não há segredo para validar assinatura NENHUMA:
    //    servidor incompleto é 503 (não 403 — não é culpa do remetente).
    if (!instagramAppSecret()) {
      return NextResponse.json({ error: 'Webhook do Instagram não configurado no servidor.' }, { status: 503 });
    }
    const signature = req.headers.get('x-hub-signature-256');
    if (!verifyInstagramWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Assinatura do webhook inválida.' }, { status: 403 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      return NextResponse.json({ error: 'Corpo do webhook inválido.' }, { status: 400 });
    }

    const parsed = parseInstagramWebhook(payload);
    if (!parsed.isInstagram) {
      // Outro objeto no mesmo endpoint: não é nosso, e não é erro.
      return NextResponse.json({ ok: true, received: 0, ignored: true });
    }

    const db = await readDB();
    let created = 0;
    let duplicate = 0;
    let ignored = parsed.skipped;
    const unmapped: string[] = [];
    const notReady: string[] = [];
    const profileCache = new Map<string, { username: string; name: string }>();

    for (const notification of parsed.notifications) {
      // Eventos que não viram entrada (echo das nossas mensagens, apagadas).
      if (notification.kind === 'echo' || notification.kind === 'deleted' || notification.kind === 'self') {
        ignored += 1;
        continue;
      }

      // Tenant pela CONTA conectada — nunca por nome/@/telefone.
      const business = resolveBusinessForInstagramAccountId(db, notification.accountId);
      if (!business) {
        unmapped.push(notification.accountId);
        continue;
      }
      if (!business.instagramIntegration?.webhookSubscribedAt) {
        notReady.push(business.id);
        continue;
      }

      // Rótulo público do contato: rede FORA de qualquer lock e best effort.
      let profile: { username: string; name: string } | undefined;
      if (notification.participantId) {
        const cacheKey = `${notification.accountId}:${notification.participantId}`;
        profile = profileCache.get(cacheKey);
        if (!profile) {
          const creds = getInstagramCredentials(business);
          if (creds) {
            const info = await fetchInstagramProfile({
              igUserId: creds.igUserId,
              accessToken: creds.accessToken,
              participantId: notification.participantId,
            });
            profile = info.ok ? { username: info.username, name: info.name } : undefined;
          }
          if (profile) profileCache.set(cacheKey, profile);
        }
      }

      const outcome = await ingestInstagramNotification({ notification, profile });
      if (outcome.status === 'created') created += 1;
      else if (outcome.status === 'duplicate') duplicate += 1;
      else if (outcome.status === 'unmapped') unmapped.push(notification.accountId);
      else if (outcome.status === 'not_ready') notReady.push(business.id);
      else ignored += 1;
    }

    // 200 sempre que a assinatura conferiu: reentrega da Meta não ajuda em nada
    // e o evento já foi classificado (criado, duplicado, ignorado ou sem dono).
    return NextResponse.json({
      ok: true,
      received: parsed.notifications.length,
      created,
      duplicate,
      ignored,
      unmappedAccounts: [...new Set(unmapped)],
      notReady: [...new Set(notReady)],
    });
  } catch {
    return NextResponse.json({ error: 'Falha ao processar o webhook do Instagram.' }, { status: 500 });
  }
}
