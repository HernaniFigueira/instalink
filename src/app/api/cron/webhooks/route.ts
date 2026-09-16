import { NextRequest, NextResponse } from 'next/server';
import { processPendingWebhookDeliveries, summarizeWebhookRetryRun } from '@/lib/webhooks';
import { verifyCronAuth } from '@/lib/cron-auth';

// ═══════════════════════════════════════════════════════════════
// CONSUMIDOR AUTOMÁTICO DA FILA DE RETRY DE WEBHOOKS
// ═══════════════════════════════════════════════════════════════
// Acionado pelo CRON NATIVO da Vercel (ver `crons` em vercel.json, a cada
// minuto), que envia `Authorization: Bearer <CRON_SECRET>`:
//
//   Vercel Cron → GET /api/cron/webhooks → processPendingWebhookDeliveries()
//
// Esta rota NÃO contém regra de retry: ela autentica, chama o processador
// central (src/lib/webhooks.ts) e devolve apenas contadores operacionais.
// Nenhum segredo, URL, payload ou assinatura sai na resposta.
//
// Sem CRON_SECRET configurado a rota responde 503 (desativada) — nunca fica
// aberta. Para disparar manualmente (ops), use o mesmo header:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/webhooks
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    // Sem o segredo configurado o consumidor está desligado: registra o motivo
    // no log do servidor (sem valores sensíveis) para facilitar o diagnóstico.
    if (auth.status === 503) {
      console.warn('[cron/webhooks] consumidor desativado: CRON_SECRET não configurado no ambiente.');
    }
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const startedAt = Date.now();
  try {
    const processed = await processPendingWebhookDeliveries();
    return NextResponse.json(
      {
        ok: true,
        ranAt: new Date().toISOString(),
        ...summarizeWebhookRetryRun(processed, Date.now() - startedAt),
      },
      { status: 200 },
    );
  } catch {
    // Erro cru (banco, rede) NÃO é devolvido: a resposta é genérica e o log
    // interno não inclui segredos.
    console.error('[cron/webhooks] falha ao processar a fila de retry de webhooks.');
    return NextResponse.json(
      { ok: false, error: 'Falha ao processar a fila de retry de webhooks.' },
      { status: 500 },
    );
  }
}
