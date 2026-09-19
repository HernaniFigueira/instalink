import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { ingestLead } from '@/lib/pipeline';
import { enqueueWebhookTx, deliverWebhookIds } from '@/lib/webhooks';
import type { DB, LeadPriority } from '@/lib/types';

const PRIORITIES: LeadPriority[] = ['low', 'medium', 'high', 'urgent'];

function error(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * POST administrativo: cria uma oportunidade a partir do painel.
 *
 * Esta rota é deliberadamente separada de POST /api/leads: a rota antiga é
 * captura pública e continua protegida pelo módulo `quote`; aqui a autoridade
 * é a sessão do lojista + a permissão `leads`. A deduplicação, o contato e a
 * PipelineStage seguem a porta oficial `ingestLead`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '').trim();
    const guard = await requireBusiness(req, businessId, 'leads');
    if (!guard.ok) return guard.res;

    const name = String(body.name || '').trim().slice(0, 80);
    const phone = String(body.phone || '').trim().slice(0, 25);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
    const interest = String(body.interest || '').trim().slice(0, 500);
    const priority = PRIORITIES.includes(body.priority) ? body.priority as LeadPriority : 'medium';
    const assignedUserId = String(body.assignedUserId ?? body.responsibleUserId ?? '').trim();
    const message = String(body.message || body.note || '').trim().slice(0, 1000);

    if (!name && !phone && !email) {
      return NextResponse.json({ error: 'Informe ao menos nome, telefone ou e-mail.' }, { status: 400 });
    }

    let result!: ReturnType<typeof ingestLead>;
    const webhookDeliveryIds: string[] = [];
    await updateDB((db: DB) => {
      result = ingestLead(db, {
        businessId,
        name,
        phone,
        email,
        interest,
        message,
        // Não aceita a origem enviada pelo navegador: esta porta sempre é
        // manual, enquanto a captura pública preserva sua própria origem.
        source: 'manual',
        channel: 'manual',
        priority,
        assignedUserId,
        actor: {
          id: guard.ctx.user.id,
          name: guard.ctx.user.name || 'Equipe',
          role: guard.ctx.role,
          type: 'user',
        },
      });
      pushAudit(db, {
        action: result.isNew ? 'lead.created' : 'lead.updated',
        actor: { ...guard.ctx.user, role: guard.ctx.role },
        businessId,
        supportSessionId: guard.ctx.support?.id,
        meta: {
          leadId: result.lead.id,
          contactId: result.contact?.id || '',
          source: 'manual',
          isNew: result.isNew,
          stageId: result.lead.stageId || 'new',
        },
      });

      // Outbox e alteração de negócio no mesmo commit; nenhum HTTP aqui.
      webhookDeliveryIds.push(...enqueueWebhookTx(db, result.isNew ? 'lead.created' : 'lead.updated', businessId, {
        lead: result.lead,
        isNew: result.isNew,
        source: 'manual',
      }).map((delivery) => delivery.id));
    });

    // O webhook é posterior à transação, como na captura pública. Falha de
    // entrega não desfaz o lead já criado e não muda a semântica da rota.
    try {
      await deliverWebhookIds(webhookDeliveryIds);
    } catch { /* a operação manual já foi persistida */ }

    return NextResponse.json({
      ok: true,
      created: result.isNew,
      lead: result.lead,
      contact: result.contact,
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({
      error: status === 500 ? 'Não foi possível criar a oportunidade.' : e.message,
    }, { status });
  }
}
