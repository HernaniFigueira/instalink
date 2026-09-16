import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { bookLead } from '@/lib/pipeline';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';
import { dispatchWebhook } from '@/lib/webhooks';
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

    const db = guard.db;
    const business = guard.ctx.business;
    const service = db.services.find((s) => s.id === body.serviceId && s.businessId === businessId && s.active !== false);
    if (!service) {
      return NextResponse.json({ error: 'Serviço não encontrado ou indisponível.' }, { status: 400 });
    }

    const lead = db.leads.find((l) => l.id === params.id && l.businessId === businessId);
    if (!lead) {
      return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 });
    }

    const actor = {
      id: guard.ctx.user.id,
      name: guard.ctx.user.name || 'Equipe',
      role: guard.ctx.role,
    };

    let result: ReturnType<typeof bookLead>;

    await updateDB((d: DB) => {
      result = bookLead(d, {
        business,
        service,
        leadId: lead.id,
        date: String(body.date || '').trim(),
        time: String(body.time || '').trim(),
        professionalId: body.professionalId || undefined,
        note: body.note,
        actor,
      });

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
    });

    // Webhook
    try {
      await updateDB(async (d: DB) => {
        await dispatchWebhook(d, 'booking.created', businessId, {
          booking: result!.booking,
          leadId: lead.id,
        });
        await dispatchWebhook(d, 'lead.stage_changed', businessId, {
          lead: result!.lead,
          newStageId: 'scheduled',
        });
      });
    } catch { /* noop */ }

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
