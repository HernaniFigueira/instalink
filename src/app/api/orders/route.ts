import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { customerFromRequest } from '@/lib/customer-auth';
import type { OrderItem } from '@/lib/types';

// POST público: cria pedido. Preços SEMPRE recalculados no servidor.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId } = body;
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para fazer seu pedido.', code: 'login_required' }, { status: 401 });

    const name = (body.customerName || '').trim();
    const phone = (body.customerPhone || '').trim();
    if (!name) return NextResponse.json({ error: 'Informe seu nome.' }, { status: 400 });
    if (phone.replace(/\D/g, '').length < 10) return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return NextResponse.json({ error: 'Seu carrinho está vazio.' }, { status: 400 });

    const orderItems: OrderItem[] = [];
    for (const it of items) {
      const product = db.products.find((p) => p.id === it.productId && p.businessId === businessId && p.active);
      if (!product) return NextResponse.json({ error: 'Um item do carrinho não está mais disponível.' }, { status: 400 });
      const qty = Math.max(1, Math.min(50, Number(it.qty) || 1));
      const base = product.promoPrice > 0 ? product.promoPrice : product.price;
      let unit = base;
      const labels: string[] = [];
      const opts = Array.isArray(it.options) ? it.options : [];
      const selMap = new Map<string, string[]>(
        opts.map((sel: any) => [String(sel.optionId), Array.isArray(sel.valueIds) ? sel.valueIds.map(String) : []]),
      );
      // Valida TODAS as opções do produto (nunca confia no que o cliente enviou)
      const productOptions = db.options.filter((o) => o.productId === product.id);
      for (const opt of productOptions) {
        const valueIds: string[] = selMap.get(opt.id) || [];
        if (opt.required && valueIds.length === 0) {
          return NextResponse.json({ error: `Escolha: ${opt.name} (${product.name}).` }, { status: 400 });
        }
        if (valueIds.length < opt.min) {
          return NextResponse.json({ error: `Escolha ao menos ${opt.min} em "${opt.name}".` }, { status: 400 });
        }
        if (opt.max > 0 && valueIds.length > opt.max) {
          return NextResponse.json({ error: `Máximo de ${opt.max} em "${opt.name}".` }, { status: 400 });
        }
        const picked = valueIds
          .map((vid: string) => db.optionValues.find((v) => v.id === vid && v.optionId === opt.id && v.active))
          .filter(Boolean) as NonNullable<ReturnType<typeof db.optionValues.find>>[];
        if (!opt.multiple && picked.length > 1) return NextResponse.json({ error: `Opção inválida em ${product.name}.` }, { status: 400 });
        for (const v of picked) { unit += v.priceDelta; labels.push(v.name); }
      }
      orderItems.push({
        productId: product.id, name: product.name, qty, unitPrice: unit,
        total: unit * qty, optionsLabel: labels.join(', '), note: String(it.note || '').slice(0, 200),
      });
    }

    const subtotal = orderItems.reduce((s, i) => s + i.total, 0);
    const type = body.type === 'delivery' ? 'delivery' : 'pickup';
    if (type === 'delivery' && !(body.customerAddress || '').trim()) {
      return NextResponse.json({ error: 'Informe o endereço de entrega.' }, { status: 400 });
    }
    const count = db.orders.filter((o) => o.businessId === businessId).length + 1;
    const now = new Date().toISOString();
    const orderId = randomUUID();

    await updateDB((d) => {
      d.orders.push({
        id: orderId, businessId, customerId: customer.id, code: '#' + String(count).padStart(4, '0'),
        customerName: name, customerPhone: phone, customerAddress: String(body.customerAddress || ''),
        type, payment: String(body.payment || 'pix'), items: orderItems,
        subtotal, total: subtotal, status: 'new', note: String(body.note || '').slice(0, 500), createdAt: now,
      });
      d.events.push({ id: randomUUID(), businessId, type: 'order_created', path: '', meta: { total: subtotal }, createdAt: now });
      d.events.push({ id: randomUUID(), businessId, type: 'conversion', path: '', meta: { kind: 'order' }, createdAt: now });
      const lead = d.leads.find((l) => l.businessId === businessId && l.phone === phone);
      if (lead) { lead.name = name; lead.lastInteraction = now; lead.action = 'pedido'; if (lead.status === 'new') lead.status = 'converted'; }
      else d.leads.push({ id: randomUUID(), businessId, name, phone, email: '', instagram: '', origin: 'pedido', interest: orderItems.map((i) => i.name).join(', ').slice(0, 200), action: 'pedido', status: 'converted', createdAt: now, lastInteraction: now });
    });
    return NextResponse.json({ ok: true, orderId, code: '#' + String(count).padStart(4, '0') });
  } catch {
    return NextResponse.json({ error: 'Não foi possível enviar seu pedido. Tente novamente.' }, { status: 500 });
  }
}

// GET/PATCH autenticados (dono): listar e atualizar status
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }
  return NextResponse.json({ orders: db.orders.filter((o) => o.businessId === businessId).reverse() });
}

export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const valid = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!valid.includes(status)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    const db = await readDB();
    if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
    await updateDB((d) => {
      const o = d.orders.find((x) => x.id === id && x.businessId === businessId);
      if (o) o.status = status;
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 500 });
  }
}
