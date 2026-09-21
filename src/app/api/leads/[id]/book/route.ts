import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { bookLead } from '@/lib/pipeline';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, bookingOpSpec } from '@/lib/relational/slice';
import { enqueueWebhookTx, deliverWebhookIds } from '@/lib/webhooks';
import type { DB } from '@/lib/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, 'agenda');
    if (!guard.ok) return guard.res;

    const business = guard.ctx.business;

    /** Validações de serviço/lead fora da escrita (mesmas mensagens/status). */
    const resolveInputs = (db: any) => {
      const service = (db.services || []).find((sv: any) => sv.id === body.serviceId && sv.businessId === businessId && sv.active !== false);
      if (!service) throw Object.assign(new Error('Serviço não encontrado ou indisponível.'), { status: 400 });
      const lead = (db.leads || []).find((l: any) => l.id === params.id && l.businessId === businessId);
      if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });
      return { service, lead };
    };

    const actor = {
      id: guard.ctx.user.id,
      name: guard.ctx.user.name || 'Equipe',
      role: guard.ctx.role,
    };

    let result: ReturnType<typeof bookLead>;

    const webhookDeliveryIds: string[] = [];
    /** Mutação PURA (DOIS MOTORES): agenda a partir do lead (portas oficiais). */
    const bookTx = (d: any) => {
      const { service, lead } = resolveInputs(d);
      result = bookLead(d, {
        business,
        service,
        leadId: lead.id,
        date: String(body.date || '').trim(),
        time: String(body.time || '').trim(),
        professionalId: body.professionalId || undefined,
        note: body.note,
        actor,
      } as any);

      pushAudit(d, {
        action: 'lead.booked',
        actor: guard.ctx.user,
        businessId,
        meta: {
          leadId: lead.id,
          bookingId: result.booking.id,
          serviceId: service.id,
          date: body.date,
          time: body.time,
        },
      });

      // Outbox e alteração de negócio no mesmo commit; nenhum HTTP aqui.
      webhookDeliveryIds.push(...enqueueWebhookTx(d, 'booking.created', businessId, {
        booking: result!.booking,
        leadId: lead.id,
      }).map((delivery) => delivery.id));
      webhookDeliveryIds.push(...enqueueWebhookTx(d, 'lead.stage_changed', businessId, {
        lead: result!.lead,
        newStageId: 'scheduled',
      }).map((delivery) => delivery.id));
      return true;
    };

    if (relationalActive()) {
      // Fatia da operação: serviços, lead citado, agenda/profissionais +
      // referências (engine de agenda compartilhada). Webhook segue 'pending'
      // no outbox SQL (matriz §3) — entrega HTTP é rodada própria.
      const date = String(body.date || '').trim();
      await runRelationalWrite(businessId, bookTx, {
        load: bookingOpSpec({
          leadId: params.id,
          ...(date ? { dateFrom: date, dateTo: date } : {}),
        }),
      });
    } else {
      const db = guard.db;
      resolveInputs(db);
      await updateDB(bookTx as (d: DB) => boolean);
      // Webhook
      try {
        await deliverWebhookIds(webhookDeliveryIds);
      } catch { /* noop */ }
    }

    return NextResponse.json({
      ok: true,
      booking: result!.booking,
      lead: result!.lead,
    }, { status: 201 });
  } catch (err: any) {
    const status = err?.status || 400;
    return NextResponse.json({ error: err?.message || 'Erro ao agendar a partir do lead.' }, { status });
  }
}
