// ═══════════════════════════════════════════════════════════════
// CRON DE RETENTATIVA DAS MENSAGENS DO INSTAGRAM
// ═══════════════════════════════════════════════════════════════
// Mesmo desenho do cron do WhatsApp: uma passada por todas as unidades com
// mensagem de saída pendente vencida. O claim é o mesmo de
// `deliverInstagramMessage` — nada de fila paralela nem de segundo motor.
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { processPendingInstagramRetries } from '@/lib/instagram-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleCron(req: NextRequest) {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    if (auth.status === 503) {
      console.warn('[cron/instagram] motor desativado: configure CRON_SECRET no ambiente.');
    }
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const startedAt = Date.now();
  try {
    const summary = await processPendingInstagramRetries();
    return NextResponse.json({ ok: true, ...summary, durationMs: Date.now() - startedAt }, { status: 200 });
  } catch {
    console.error('[cron/instagram] falha ao processar as mensagens pendentes do Instagram.');
    return NextResponse.json(
      { ok: false, error: 'Falha ao processar mensagens pendentes do Instagram.' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}
