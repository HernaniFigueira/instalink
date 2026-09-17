import { NextRequest, NextResponse } from 'next/server';
import { ipFrom, rateLimit } from '@/lib/rate-limit';
import { MAX_INBOUND_BYTES } from '@/lib/integrations/contract';
import { receiveInboundRequest } from '@/lib/integrations/inbound';

// ═══════════════════════════════════════════════════════════════
// P6 — WEBHOOK DE ENTRADA (sistema externo → InstaLink)
// ═══════════════════════════════════════════════════════════════
//   POST /api/integrations/inbound/<integrationId>
//   Authorization: Bearer ilk_live_...   (ou X-Instalink-Token)
//   X-Instalink-Signature: t=...,v1=...  (quando a integração exige)
//
// Esta rota é uma CASCA FINA: limite de tamanho, rate limit e delegação. Toda
// a decisão (autenticar origem → normalizar → idempotência → motor → log) vive
// em `lib/integrations/inbound.ts`, coberta por teste unitário. Nada aqui
// resolve tenant: a unidade vem da integração autenticada.
//
// O corpo é lido como TEXTO (a assinatura HMAC é conferida sobre os bytes
// recebidos) e só depois interpretado como JSON.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const integrationId = String(ctx?.params?.id || '').trim().slice(0, 64);
  if (!integrationId) {
    return NextResponse.json({ ok: false, error: 'Integração não encontrada.', code: 'integration_not_found' }, { status: 404 });
  }

  // Rate limit por origem + integração (best-effort, por instância).
  const limit = rateLimit(`p6-inbound:${integrationId}:${ipFrom(req)}`, 120, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Muitas requisições. Tente novamente em instantes.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, limit.retryAfter)) } },
    );
  }

  const rawBody = await req.text().catch(() => '');
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_INBOUND_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Corpo acima do limite de ${Math.floor(MAX_INBOUND_BYTES / 1024)} KB.`, code: 'payload_too_large' },
      { status: 413 },
    );
  }

  try {
    const outcome = await receiveInboundRequest({
      integrationId,
      headers: req.headers,
      rawBody,
    });
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch {
    // Erro cru (banco/rede) não vira detalhe para o sistema externo.
    console.error('[p6/inbound] falha ao processar entrega externa.');
    return NextResponse.json(
      { ok: false, error: 'Falha ao processar o evento.', code: 'internal_error' },
      { status: 500 },
    );
  }
}

/** GET não é um caminho de dados — responde 405 sem revelar nada. */
export async function GET() {
  return NextResponse.json(
    { ok: false, error: 'Use POST neste endpoint.', code: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
