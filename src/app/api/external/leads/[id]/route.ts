import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-keys';
import {
  moveLeadStage, assignLead, addLeadNote, getBusinessPipeline,
  normalizeLeadStageId, STAGE_ALIASES,
} from '@/lib/pipeline';
import { enqueueWebhookTx, deliverWebhookIds } from '@/lib/webhooks';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';
import type { DB } from '@/lib/types';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { db, business } = auth;
  const lead = db.leads.find((l) => l.id === params.id && l.businessId === business.id);
  if (!lead) {
    return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 });
  }

  await updateDB((d) => {
    pushIntegrationLog(d, {
      businessId: business.id,
      endpoint: `/api/external/leads/${params.id}`,
      method: 'GET',
      source: 'api',
      status: 200,
    });
  });

  return NextResponse.json({ ok: true, lead });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { business, apiKey } = auth;

  try {
    const body = await req.json();
    let updatedLead: any = null;
    let stageChanged = false;

    const webhookDeliveryIds: string[] = [];
    await updateDB((d: DB) => {
      const lead = d.leads.find((l) => l.id === params.id && l.businessId === business.id);
      if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });

      const actor = { id: apiKey.id, name: apiKey.name || 'API Externa', role: 'api' };

      // 1. Mudança de etapa na esteira — sempre pelo mecanismo oficial.
      // A1.2 · Bloco 2 (F3): compara pela etapa NORMALIZADA do lead — um
      // registro legado quebrado (ex.: stageId cru "contacted") não gera
      // movimento ruído, e etapa inexistente continua rejeitada com 422
      // pela própria moveLeadStage.
      if (body.stageId) {
        const pipeline = getBusinessPipeline(d, business.id);
        const requested = STAGE_ALIASES[body.stageId] || body.stageId;
        if (requested !== normalizeLeadStageId(pipeline, lead)) {
          moveLeadStage(d, {
            businessId: business.id,
            leadId: lead.id,
            toStageId: requested,
            note: body.stageNote || body.note,
            actor,
          });
          stageChanged = true;
        }
      }

      // 2. Atribuição de responsável
      if (body.assignedUserId !== undefined && body.assignedUserId !== lead.assignedUserId) {
        assignLead(d, {
          businessId: business.id,
          leadId: lead.id,
          assignedUserId: body.assignedUserId,
          actor,
        });
      }

      // 3. Adição de observação
      if (body.noteText || (body.note && !body.stageId)) {
        addLeadNote(d, {
          businessId: business.id,
          leadId: lead.id,
          text: body.noteText || body.note,
          actor,
        });
      }

      // 4. Prioridade ou interesse
      if (body.priority) lead.priority = body.priority;
      if (body.interest) lead.interest = String(body.interest).slice(0, 500);

      lead.lastInteraction = new Date().toISOString();
      updatedLead = lead;

      pushIntegrationLog(d, {
        businessId: business.id,
        endpoint: `/api/external/leads/${params.id}`,
        method: 'PATCH',
        source: 'api',
        status: 200,
      });

      // Outbox e alteração de negócio no mesmo commit; nenhum HTTP aqui.
      if (stageChanged) {
        webhookDeliveryIds.push(...enqueueWebhookTx(d, 'lead.stage_changed', business.id, {
          lead: updatedLead,
          newStageId: updatedLead.stageId,
        }).map((delivery) => delivery.id));
      }
      webhookDeliveryIds.push(...enqueueWebhookTx(d, 'lead.updated', business.id, {
        lead: updatedLead,
      }).map((delivery) => delivery.id));
    });

    // Disparo de Webhook
    try {
      await deliverWebhookIds(webhookDeliveryIds);
    } catch (whErr) {
      console.error('[webhook dispatch error]:', whErr);
    }

    return NextResponse.json({ ok: true, lead: updatedLead });
  } catch (err: any) {
    const status = err?.status || 400;
    return NextResponse.json(
      { error: err?.message || 'Falha ao atualizar lead.' },
      { status },
    );
  }
}
