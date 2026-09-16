import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-keys';
import { computeSlots } from '@/lib/slots';
import { todayISO, nowHM, weekdayOf, isValidDateISO, addDaysISO } from '@/lib/tz';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { db, business } = auth;
  const q = req.nextUrl.searchParams;
  const serviceId = q.get('serviceId') || '';
  const date = q.get('date') || '';
  const professionalId = q.get('professionalId') || '';

  const service = db.services.find((s) => s.id === serviceId && s.businessId === business.id && s.active !== false);
  if (!service) {
    return NextResponse.json({ error: 'Serviço inválido ou indisponível.' }, { status: 400 });
  }

  const today = todayISO();
  const maxDate = addDaysISO(today, Math.max(1, business.booking?.horizonDays || 60));

  if (!isValidDateISO(date) || date < today || date > maxDate) {
    return NextResponse.json({
      ok: true,
      businessId: business.id,
      date,
      serviceId,
      slots: [],
      closed: true,
      reason: date < today ? 'Data no passado' : 'Data fora da janela disponível',
    });
  }

  const r = computeSlots({
    rules: db.availability.filter((a) => a.businessId === business.id),
    exceptions: db.exceptions.filter((e) => e.businessId === business.id),
    bookings: db.bookings.filter((b) => b.businessId === business.id),
    services: db.services.filter((s) => s.businessId === business.id),
    professionals: db.professionals.filter((p) => p.businessId === business.id),
    dateISO: date,
    weekday: weekdayOf(date),
    serviceId: service.id,
    durationMin: service.durationMin,
    professionalId,
    eligibleProIds: service.professionalIds || [],
    nowHM: date === today ? nowHM() : '',
    leadMin: business.booking?.leadMin || 0,
    bufferMin: business.booking?.bufferMin || 0,
  });

  await updateDB((d) => {
    pushIntegrationLog(d, {
      businessId: business.id,
      endpoint: '/api/external/availability',
      method: 'GET',
      source: 'api',
      status: 200,
    });
  });

  return NextResponse.json({
    ok: true,
    businessId: business.id,
    date,
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    slots: r.slots,
    closed: r.closed,
  });
}
