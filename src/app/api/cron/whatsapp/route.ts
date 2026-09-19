// ═══════════════════════════════════════════════════════════════
// CRON DE RETENTATIVA & PROCESSAMENTO PENDENTE DE WHATSAPP
// ═══════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { processPendingWhatsappRetries } from '@/lib/whatsapp-cloud-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleCron(req: NextRequest) {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    if (auth.status === 503) {
      console.warn('[cron/whatsapp] motor desativado: configure CRON_SECRET no ambiente.');
    }
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const startedAt = Date.now();
  try {
    const summary = await processPendingWhatsappRetries();
    return NextResponse.json({
      ok: true,
      ...summary,
      durationMs: Date.now() - startedAt,
    }, { status: 200 });
  } catch {
    console.error('[cron/whatsapp] falha ao processar as mensagens pendentes do WhatsApp.');
    return NextResponse.json(
      { ok: false, error: 'Falha ao processar mensagens pendentes do WhatsApp.' },
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
