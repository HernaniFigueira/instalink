import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';

// GET ?businessId= — todo o catálogo do negócio (dono)
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId && b.ownerId === user.id);
  if (!business) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  const optIds = new Set(db.options.filter((o) => o.businessId === businessId).map((o) => o.id));
  return NextResponse.json({
    business,
    categories: db.categories.filter((c) => c.businessId === businessId),
    products: db.products.filter((p) => p.businessId === businessId),
    options: db.options.filter((o) => o.businessId === businessId),
    optionValues: db.optionValues.filter((v) => optIds.has(v.optionId)),
    services: db.services.filter((s) => s.businessId === businessId),
    professionals: db.professionals.filter((p) => p.businessId === businessId),
    availability: db.availability.filter((a) => a.businessId === businessId),
  });
}
