import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest } from '@/lib/customer-auth';
import { readDB } from '@/lib/db';
import { onlyDigits } from '@/lib/utils';

// GET ?businessId= — pedidos do consumidor naquele negócio.
// Vincula por conta (customerId) ou por WhatsApp (pedidos antigos).
export async function GET(req: NextRequest) {
  const customer = await customerFromRequest(req);
  if (!customer) return NextResponse.json({ error: 'Entre para ver seus pedidos.' }, { status: 401 });
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
  const myPhone = onlyDigits(customer.phone);
  const orders = db.orders
    .filter((o) =>
      o.businessId === businessId &&
      (o.customerId === customer.id || (myPhone && onlyDigits(o.customerPhone) === myPhone)),
    )
    .reverse()
    .map((o) => ({
      id: o.id, code: o.code, status: o.status, total: o.total, type: o.type,
      payment: o.payment, createdAt: o.createdAt,
      items: o.items.map((i) => ({ name: i.name, qty: i.qty, total: i.total, optionsLabel: i.optionsLabel })),
    }));
  return NextResponse.json({ orders });
}
