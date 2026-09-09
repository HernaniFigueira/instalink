import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';

// GET ?businessId=&manage=1 — todas (dono) | ?businessId=&mine=1 — já avaliados (consumidor)
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const businessId = q.get('businessId') || '';
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

  if (q.get('manage') === '1') {
    const user = await userFromRequest(req);
    if (!user || business.ownerId !== user.id) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    const reviews = (db.reviews || [])
      .filter((r) => r.businessId === businessId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return NextResponse.json({
      reviews,
      counts: {
        pending: reviews.filter((r) => r.status === 'pending').length,
        published: reviews.filter((r) => r.status === 'published').length,
      },
      google: { googleUrl: business.googleUrl || '', googlePlaceId: business.googlePlaceId || '', hasKey: !!(business.googleApiKey || '') },
    });
  }

  if (q.get('mine') === '1') {
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para continuar.' }, { status: 401 });
    const mine = (db.reviews || []).filter((r) => r.businessId === businessId && r.customerId === customer.id);
    return NextResponse.json({
      orderIds: mine.filter((r) => r.orderId).map((r) => r.orderId),
      bookingIds: mine.filter((r) => r.bookingId).map((r) => r.bookingId),
    });
  }

  return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
}

// POST — consumidor avalia um pedido entregue ou agendamento concluído/passado.
export async function POST(req: NextRequest) {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para avaliar.', code: 'login_required' }, { status: 401 });
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const rating = Number(body.rating);
    const text = String(body.text || '').trim().slice(0, 500);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Escolha de 1 a 5 estrelas.' }, { status: 400 });
    }
    const orderId = String(body.orderId || '');
    const bookingId = String(body.bookingId || '');
    if (!orderId && !bookingId) return NextResponse.json({ error: 'Avaliação sem referência.' }, { status: 400 });

    const phone = onlyDigits(customer.phone);
    if (orderId) {
      const order = db.orders.find((o) => o.id === orderId && o.businessId === business.id);
      if (!order) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
      const mine = order.customerId === customer.id || (phone && onlyDigits(order.customerPhone) === phone);
      if (!mine) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
      if (!['ready', 'completed'].includes(order.status)) {
        return NextResponse.json({ error: 'Você poderá avaliar quando o pedido estiver pronto.' }, { status: 400 });
      }
      if ((db.reviews || []).some((r) => r.orderId === orderId)) {
        return NextResponse.json({ error: 'Este pedido já foi avaliado.' }, { status: 400 });
      }
    }
    if (bookingId) {
      const booking = db.bookings.find((b) => b.id === bookingId && b.businessId === business.id);
      if (!booking) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
      const mine = booking.customerId === customer.id || (phone && onlyDigits(booking.customerPhone) === phone);
      if (!mine) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
      const today = new Date().toISOString().slice(0, 10);
      const done = booking.status === 'completed' || booking.date < today;
      if (!done) {
        return NextResponse.json({ error: 'Você poderá avaliar após o atendimento.' }, { status: 400 });
      }
      if ((db.reviews || []).some((r) => r.bookingId === bookingId)) {
        return NextResponse.json({ error: 'Este agendamento já foi avaliado.' }, { status: 400 });
      }
    }

    await updateDB((d) => {
      d.reviews.push({
        id: randomUUID(), businessId: business.id, customerId: customer.id,
        customerName: customer.name, rating, text, source: 'site', status: 'pending',
        orderId, bookingId, externalId: '', createdAt: new Date().toISOString(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível enviar. Tente novamente.' }, { status: 500 });
  }
}

// PATCH { businessId, id, status } — dono publica/oculta.
export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    if (!['pending', 'published', 'hidden'].includes(status)) {
      return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    }
    const db = await readDB();
    if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
    await updateDB((d) => {
      const r = d.reviews.find((x) => x.id === id && x.businessId === businessId);
      if (r) r.status = status;
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 500 });
  }
}

// DELETE ?businessId=&id= — dono exclui.
export async function DELETE(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const businessId = q.get('businessId') || '';
  const id = q.get('id') || '';
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }
  await updateDB((d) => {
    d.reviews = d.reviews.filter((x) => !(x.id === id && x.businessId === businessId));
  });
  return NextResponse.json({ ok: true });
}
