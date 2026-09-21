import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest } from '@/lib/customer-auth';
import { readDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalRead } from '@/lib/relational/slice';
import { onlyDigits } from '@/lib/utils';

// GET ?businessId= — pedidos do consumidor naquele negócio.
// Vincula por conta (customerId) ou por WhatsApp (pedidos antigos).
export async function GET(req: NextRequest) {
  const customer = await customerFromRequest(req);
  if (!customer) return NextResponse.json({ error: 'Entre para ver seus pedidos.' }, { status: 401 });
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const myPhone = onlyDigits(customer.phone);
  if (relationalActive()) {
    // Pedidos do PRÓPRIO consumidor na unidade: conta OU WhatsApp antigo —
    // mesma regra do legado, agora por consulta pontual (mais recente primeiro).
    const db = await runRelationalRead(businessId, {
      orders: {
        where: `(customer_id = $2) OR ($3 <> '' AND regexp_replace(customer_phone, '\\D', '', 'g') = $3)`,
        args: [customer.id, myPhone],
        order: 'created_at DESC',
      },
    });
    if (((db.businesses || [])[0]) == null) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const orders = (db.orders || []).map((o: any) => ({
      id: o.id, code: o.code, status: o.status, total: o.total, type: o.type,
      payment: o.payment, createdAt: o.createdAt,
      items: (o.items || []).map((i: any) => ({ name: i.name, qty: i.qty, total: i.total, optionsLabel: i.optionsLabel })),
    }));
    return NextResponse.json({ orders });
  }
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
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
