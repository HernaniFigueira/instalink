import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-keys';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { db, business } = auth;
  const booking = db.bookings.find((b) => b.id === params.id && b.businessId === business.id);
  if (!booking) {
    return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
  }

  const service = db.services.find((s) => s.id === booking.serviceId);
  const professional = db.professionals.find((p) => p.id === booking.professionalId);

  await updateDB((d) => {
    pushIntegrationLog(d, {
      businessId: business.id,
      endpoint: `/api/external/bookings/${params.id}`,
      method: 'GET',
      source: 'api',
      status: 200,
    });
  });

  return NextResponse.json({
    ok: true,
    booking: {
      ...booking,
      serviceName: service?.name || '',
      professionalName: professional?.name || '',
    },
  });
}
