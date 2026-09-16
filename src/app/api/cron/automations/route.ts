// ═══════════════════════════════════════════════════════════════
// DISPARO AUTOMÁTICO DO MOTOR DE AUTOMAÇÕES (retomada + fila)
// ═══════════════════════════════════════════════════════════════
// Uma execução em espera (`status: 'waiting'`) NÃO pode depender de uma
// requisição HTTP aberta: ela é persistida com `waitingUntil` e retomada por
// quem chegar depois. Esta rota é esse "depois" — e, como no consumidor de
// retry do P3, ela não conhece nem depende de nenhum agendador:

//   scheduler (qualquer um) → GET /api/cron/automations
//        ↓ verifyCronAuth (Authorization: Bearer CRON_SECRET)
//        ↓ drainAutomations()
//        ↓ 1. CAS: reivindica execuções 'queued' + esperas vencidas (lease)
//        ↓ 2. processa nó a nó (ação + estado na MESMA transação)
//        ↓ 3. grava: completed | waiting (nova espera) | failed | devolvido
//
//   - Vercel Cron (painel do projeto; Hobby: diário, Pro: a cada minuto);
//   - `* * * * * curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/automations`;
//   - GitHub Actions / qualquer agendador externo com curl;
//   - botão "Executar fila agora" do painel (mesma função).
//
// O gancho inline do `updateDB` (src/lib/db.ts) já processa a fila no mesmo
// request que produziu o evento; este endpoint é o que garante que nada se
// perde se a função for interrompida, se o ambiente tiver mais de uma
// instância ou se AUTOMATION_INLINE=0. Os dois caminhos usam o MESMO motor.
//
// Sem CRON_SECRET configurado a rota responde 503 (desativada) — nunca fica
// aberta. Nenhum dado sensível sai na resposta: só contadores.
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { drainAutomations } from '@/lib/automation/executor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    if (auth.status === 503) {
      console.warn('[cron/automations] motor desativado: configure CRON_SECRET no ambiente.');
    }
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const startedAt = Date.now();
  try {
    // Sem parâmetros de "agora": quem dispara controla QUANDO (o cron), não o
    // relógio das esperas — retomar uma espera antes da hora é decisão do motor.
    const summary = await drainAutomations();
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      ...summary,
      durationMs: Date.now() - startedAt,
    }, { status: 200 });
  } catch {
    console.error('[cron/automations] falha ao processar a fila de automações.');
    return NextResponse.json(
      { ok: false, error: 'Falha ao processar a fila de automações.' },
      { status: 500 },
    );
  }
}
