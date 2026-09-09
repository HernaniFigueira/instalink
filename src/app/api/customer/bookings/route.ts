import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest } from '@/lib/customer-auth';
import { readDB, updateDB } from '@/lib/db';
import { onlyDigits } from '@/lib/utils';
import { todayISO, nowHM } from '@/lib/tz';
import { timeToMin } from '@/lib/utils';

// GET ?businessId= — agendamentos do consumidor naquele negócio.
export async function GET(req: NextRequest) {
  const customer = await customerFromRequest(req);
  if (!customer) return NextResponse.json({ error: 'Entre para ver seus agendamentos.' }, { status: 401 });
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
  const myPhone = onlyDigits(customer.phone);
  const bookings = db.bookings
    .filter((b) =>
      b.businessId === businessId &&
      (b.customerId === customer.id || (myPhone && onlyDigits(b.customerPhone) === myPhone)),
    )
    .reverse()
    .map((b) => {
      const service = db.services.find((s) => s.id === b.serviceId);
      return {
        id: b.id, serviceId: b.serviceId, date: b.date, time: b.time, status: b.status,
        service: service?.name || 'Serviço',
        durationMin: service?.durationMin || 30,
        professional: db.professionals.find((p) => p.id === b.professionalId)?.name || '',
      };
    });
  return NextResponse.json({ bookings, cancelUntilMin: business.booking?.cancelUntilMin ?? 120 });
}

// PATCH { id } — consumidor cancela o próprio agendamento (dentro da política).
export async function PATCH(req: NextRequest) {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para gerenciar.' }, { status: 401 });
    const { id } = await req.json();
    const db = await readDB();
    const booking = db.bookings.find((b) => b.id === id);
    if (!booking) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
    const mine = booking.customerId === customer.id ||
      (customer.phone && onlyDigits(booking.customerPhone) === onlyDigits(customer.phone));
    if (!mine) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return NextResponse.json({ error: 'Este agendamento não pode mais ser cancelado.' }, { status: 400 });
    }
    const business = db.businesses.find((b) => b.id === booking.businessId);
    const today = todayISO();
    if (booking.date < today) {
      return NextResponse.json({ error: 'Este horário já passou.' }, { status: 400 });
    }
    // Política: só cancela até cancelUntilMin antes do horário (fuso SP).
    if (booking.date === today && business) {
      const until = business.booking?.cancelUntilMin ?? 120;
      const diff = timeToMin(booking.time) - timeToMin(nowHM());
      if (diff < until) {
        return NextResponse.json({ error: `Cancelamento permitido até ${until} min antes do horário. Fale com o negócio.` }, { status: 400 });
      }
    }
    await updateDB((d) => {
      const b = d.bookings.find((x) => x.id === id);
      if (b) {
        const now = new Date().toISOString();
        b.history.push({ at: now, from: b.status, to: 'cancelled', by: 'customer' });
        b.status = 'cancelled';
        b.updatedAt = now;
      }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível cancelar.' }, { status: 500 });
  }
}
