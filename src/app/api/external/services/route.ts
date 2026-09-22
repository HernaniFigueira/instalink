import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireApiKey } from '@/lib/api-keys';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('API externa · serviços');
  if (blocked) return blocked;

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
