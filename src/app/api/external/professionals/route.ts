import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-keys';
import { pushIntegrationLog } from '@/lib/integration-logs';
import { updateDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.res;

  const { db, business } = auth;
  const professionals = db.professionals
    .filter((p) => p.businessId === business.id && p.active !== false)
    .map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      photo: p.photo,
      active: p.active,
    }));

  await updateDB((d) => {
    pushIntegrationLog(d, {
      businessId: business.id,
      endpoint: '/api/external/professionals',
      method: 'GET',
      source: 'api',
      status: 200,
    });
  });

  return NextResponse.json({ ok: true, businessId: business.id, professionals });
}
