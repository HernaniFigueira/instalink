import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-keys';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';
import { serviceProfessionalMode } from '@/lib/booking';

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { db, business } = auth;
  const services = db.services
    .filter((s) => s.businessId === business.id && s.active !== false)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      price: s.price,
      bookable: s.bookable !== false,
      professionalIds: s.professionalIds || [],
      professionalMode: serviceProfessionalMode(s as any),
    }));

  await updateDB((d) => {
    pushIntegrationLog(d, {
      businessId: business.id,
      endpoint: '/api/external/services',
      method: 'GET',
      source: 'api',
      status: 200,
    });
  });

  return NextResponse.json({ ok: true, businessId: business.id, services });
}
