import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireApiKey } from '@/lib/api-keys';
import { checkIdempotency, extractIdempotencyKey, saveIdempotency } from '@/lib/idempotency';
import { createBookingTx } from '@/lib/booking-create';
import { enqueueWebhookTx, deliverWebhookIds } from '@/lib/webhooks';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';
import type { Booking, DB } from '@/lib/types';
import { isValidDateISO, isValidClockTime } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';

export async function POST(req: NextRequest) {
  const blocked = blockIfRelational('API externa · agendamentos');
  if (blocked) return blocked;

  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { business, apiKey } = auth;
  const idempotencyKey = extractIdempotencyKey(req.headers);

  // 1. Checagem de Idempotência
  if (idempotencyKey) {
    const cached = checkIdempotency(auth.db, business.id, idempotencyKey, '/api/external/bookings');
    if (cached) {
      return NextResponse.json(cached.responseBody, {
        status: cached.statusCode,
        headers: { 'X-Idempotent-Replay': 'true' },
      });
    }
  }

  try {
    const body = await req.json();

    const service = auth.db.services.find(
      (s) => s.id === body.serviceId && s.businessId === business.id && s.active !== false,
    );
    if (!service) {
      return NextResponse.json({ error: 'Serviço não encontrado ou indisponível.' }, { status: 400 });
    }

    const date = String(body.date || '').trim();
    const time = String(body.time || '').trim();
    if (!isValidDateISO(date) || !isValidClockTime(time)) {
      return NextResponse.json({ error: 'Data (YYYY-MM-DD) ou horário (HH:MM) inválidos.' }, { status: 400 });
    }

    const name = String(body.customerName || body.name || '').trim().slice(0, 80);
    const phone = String(body.customerPhone || body.phone || '').trim();
    const digits = onlyDigits(phone);
    if (!name || digits.length < 10) {
      return NextResponse.json({ error: 'Nome e WhatsApp válido (ao menos 10 dígitos) são obrigatórios.' }, { status: 400 });
    }

    let createdBooking: Booking | null = null;
    let createdResult: any = null;

    let replay: ReturnType<typeof checkIdempotency> = null;
    const webhookDeliveryIds: string[] = [];
    await updateDB((d: DB) => {
      replay = checkIdempotency(d, business.id, idempotencyKey, '/api/external/bookings');
      if (replay) return;
      createdResult = createBookingTx(d, {
        business,
        service,
        date,
        time,
        actor: 'customer',
        customer: {
          id: body.customerId || '',
          name,
          phone: digits,
          email: body.customerEmail || body.email || '',
        },
        professionalId: body.professionalId || undefined,
        note: body.note || 'Agendamento externo via API',
        answers: body.answers,
        marketingOptIn: body.marketingOptIn === true,
        source: 'api',
        leadId: body.leadId,
      });

      createdBooking = d.bookings.find((b) => b.id === createdResult.bookingId) || null;

      pushIntegrationLog(d, {
        businessId: business.id,
        endpoint: '/api/external/bookings',
        method: 'POST',
        source: 'api',
        status: 201,
      });

      if (idempotencyKey) {
        saveIdempotency(
          d,
          business.id,
          idempotencyKey,
          '/api/external/bookings',
          201,
          { ok: true, booking: createdBooking, ...createdResult },
        );
      }

      // Outbox e alteração de negócio no mesmo commit; nenhum HTTP aqui.
      webhookDeliveryIds.push(...enqueueWebhookTx(d, 'booking.created', business.id, {
        booking: createdBooking,
      }).map((delivery) => delivery.id));
    });

    if (replay) {
      const cached = replay as NonNullable<ReturnType<typeof checkIdempotency>>;
      return NextResponse.json(cached.responseBody, { status: cached.statusCode, headers: { 'X-Idempotent-Replay': 'true' } });
    }

    // 2. Disparo de Webhook
    try {
      await deliverWebhookIds(webhookDeliveryIds);
    } catch (whErr) {
      console.error('[webhook dispatch error]:', whErr);
    }

    return NextResponse.json(
      { ok: true, booking: createdBooking, ...createdResult },
      { status: 201 },
    );
  } catch (err: any) {
    const status = err?.status || 400;
    return NextResponse.json(
      { error: err?.message || 'Falha ao processar agendamento.' },
      { status },
    );
  }
}
