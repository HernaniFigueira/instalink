// ═══════════════════════════════════════════════════════════════
// F1A · POST /api/encounters/start — START OR RESUME (operação canônica)
// ═══════════════════════════════════════════════════════════════
// A porta única de ENTRADA NO ATENDIMENTO a partir de um agendamento (ou de
// uma entrada da fila, no walk-in). A tela não decide "criar ou abrir": pede
// para iniciar e o servidor devolve o atendimento que já existe — ou cria o
// primeiro, uma única vez.
//
// Regras (todas no servidor, todas dentro da transação):
//   • permissão `atendimento` (dado clínico — NÃO vem com "agenda" nem com
//     "clientes", e a Recepção não ganha escrita clínica por enxergar a agenda);
//   • o agendamento/entrada de fila é procurado SEMPRE dentro do `businessId`
//     autenticado (ID de outro tenant não existe aqui);
//   • 1:1 por agendamento e por entrada de fila: não duplica, não depende de
//     ordem de array, não olha "primeiro item";
//   • finalizado NÃO volta a ficar em atendimento — é devolvido para leitura;
//   • a etapa operacional continua sendo autoridade do workflow
//     (arrived → in_care): quem não chegou não inicia atendimento.
//
// A mesma função canônica (`startOrResumeEncounter`) atende este endpoint e o
// POST de /api/encounters: não existe caminho de criação paralelo.
import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { startOrResumeEncounter } from '@/lib/encounter-start';
import { encounterView } from '@/lib/encounters';
import { publishWorkflowEvent } from '@/lib/workflow-events';
import { effectiveTimezone } from '@/lib/tz';
import type { DB } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const businessId = String(body.businessId || '');
    // A permissão CLÍNICA é exigida para INICIAR/RETOMAR e para LER o
    // atendimento (mesma régua do GET/PATCH desta área).
    const guard = await requireBusiness(req, businessId, 'atendimento');
    if (!guard.ok) return guard.res;
    const now = new Date().toISOString();
    const result = await updateDB((d: DB) => startOrResumeEncounter(d, {
      businessId,
      bookingId: String(body.bookingId || ''),
      queueId: String(body.queueId || ''),
      actor: guard.ctx.user,
      now,
      tz: effectiveTimezone(guard.ctx.business.businessTimezone),
      // Escopo do profissional: a sentinela de "sem vínculo" é normalizada
      // dentro da operação canônica (não é uma pessoa).
      professionalScope: guard.ctx.professionalScope || '',
      body,
    }));
    if (result.created) {
      void publishWorkflowEvent({
        businessId, type: 'encounter.started', entityType: 'encounter', entityId: result.encounter.id,
        actor: { id: guard.ctx.user.id, name: guard.ctx.user.name },
        bookingId: result.encounter.bookingId || undefined,
        from: result.encounter.bookingId ? 'arrived' : undefined, to: 'in_care', at: now,
      });
    }
    // Resposta canônica: `outcome` diz o que aconteceu (created | resumed |
    // reused_finalized) para a tela NUNCA precisar inferir estado por status.
    // O modelo de leitura é o MESMO do GET por id (nomes + contexto prontos).
    const db = await readDB();
    const persisted = db.encounters.find((e) => e.id === result.encounter.id && e.businessId === businessId)
      || result.encounter;
    return NextResponse.json({
      ok: true,
      // A leitura também diz o que ESTE ator pode editar (F1B1).
      encounter: encounterView(persisted, db, { id: guard.ctx.user.id, role: String(guard.ctx.role || '') }),
      encounterId: result.encounter.id,
      created: result.created,
      reused: !result.created,
      outcome: result.outcome,
    });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[encounters/start] falhou:', e);
    return NextResponse.json({
      error: status === 500 ? 'Não foi possível abrir o atendimento.' : e.message,
    }, { status });
  }
}
