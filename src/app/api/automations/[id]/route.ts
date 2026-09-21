// ═══════════════════════════════════════════════════════════════
// P4.8 — DETALHE DA AUTOMAÇÃO + HISTÓRICO DE EXECUÇÕES
// ═══════════════════════════════════════════════════════════════
// GET  → definição + projeção linear + últimas execuções (com histórico de
//        passos, que é a ferramenta de diagnóstico do lojista);
// POST → ações pontuais: `cancel-run` (encerrar uma execução travada) e
//        `drain` (empurrar a fila agora, sem esperar o agendador).
// A posse interna do motor nunca sai na resposta (sanitizeAutomationRunForDisplay).
import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { automationView } from '@/lib/automation/serialize';
import { sanitizeAutomationRunForDisplay, drainAutomations } from '@/lib/automation/executor';
import { automationEventLabel } from '@/lib/automation/model';
import type { AutomationRun } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const blocked = blockIfRelational('Automações (configuração)');
  if (blocked) return blocked;

  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;
  const id = String(params.id || '');
  const automation = guard.db.automations.find((a) => a.id === id && a.businessId === businessId);
  if (!automation) return NextResponse.json({ ok: false, error: 'Automação não encontrada.' }, { status: 404 });

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 30));
  const runs = (guard.db.automationRuns || [])
    .filter((r) => r.businessId === businessId && r.automationId === id)
    .sort((a, b) => ((a.startedAt || '') < (b.startedAt || '') ? 1 : -1))
    .slice(0, limit)
    .map(sanitizeAutomationRunForDisplay);

  return NextResponse.json({
    ok: true,
    automation: automationView(guard.db, automation),
    runs,
    eventLabel: automationEventLabel(automation.trigger?.event),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const blocked = blockIfRelational('Automações (configuração)');
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const id = String(params.id || '');
    const automation = guard.db.automations.find((a) => a.id === id && a.businessId === businessId);
    if (!automation) return NextResponse.json({ ok: false, error: 'Automação não encontrada.' }, { status: 404 });

    const action = String(body.action || '');

    if (action === 'cancel-run') {
      const runId = String(body.runId || '');
      let cancelled = false;
      await updateDB((d) => {
        const run = d.automationRuns.find((r) => r.id === runId && r.businessId === businessId && r.automationId === id);
        if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return;
        const now = new Date().toISOString();
        run.status = 'cancelled';
        run.waitingUntil = '';
        run.updatedAt = now;
        run.finishedAt = now;
        run.claimToken = undefined;
        run.claimExpiresAt = undefined;
        run.history.push({
          at: now, nodeId: run.currentNodeId, nodeType: 'run', outcome: 'cancelled',
          label: 'Encerrada pela equipe', detail: 'cancelada manualmente no painel',
        });
        cancelled = true;
        pushAudit(d, {
          action: 'automation.run_cancelled',
          actor: guard.ctx.user,
          businessId,
          meta: { automationId: id, runId },
        });
      });
      if (!cancelled) return NextResponse.json({ ok: false, error: 'nada a encerrar nesta execução' }, { status: 422 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'drain') {
      // Empurra a fila AGORA para esta unidade (mesmo código do cron).
      const summary = await drainAutomations({ businessId, limit: 20 });
      const db = await readDB();
      const runs: AutomationRun[] = (db.automationRuns || []).filter((r) => r.businessId === businessId && r.automationId === id);
      return NextResponse.json({ ok: true, summary, automation: automationView(db, automation), runs: runs.length });
    }

    return NextResponse.json({ ok: false, error: 'ação desconhecida' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Não foi possível concluir.' }, { status: e?.status || 500 });
  }
}
