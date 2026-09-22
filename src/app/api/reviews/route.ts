import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead } from '@/lib/relational/slice';
import { getPool } from '@/lib/relational/pool';
import { isFeatureEnabled } from '@/lib/features';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';
import { todayISO } from '@/lib/tz';

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

// GET ?businessId=&manage=1 — todas (dono) | ?businessId=&mine=1 — já avaliados (consumidor)
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const businessId = q.get('businessId') || '';

  if (q.get('manage') === '1') {
    const guard = await requireBusiness(req, businessId, 'pagina');
    if (!guard.ok) return guard.res;
    // View PURA (DOIS MOTORES): avaliações da unidade + dados Google da unidade.
    const buildManage = (reviews: any[], business: any) => {
      const sorted = [...reviews].sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1));
      return {
        reviews: sorted,
        counts: {
          pending: sorted.filter((r: any) => r.status === 'pending').length,
          published: sorted.filter((r: any) => r.status === 'published').length,
        },
        google: { googleUrl: business.googleUrl || '', googlePlaceId: business.googlePlaceId || '', hasKey: !!(business.googleApiKey || '') },
      };
    };
    if (relationalActive()) {
      const db = await runRelationalRead(businessId, { reviews: {} });
      const business = (db.businesses || [])[0];
      if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
      return NextResponse.json(buildManage(db.reviews || [], business));
    }
    const db = guard.db;
    const business = db.businesses.find((b: any) => b.id === businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    return NextResponse.json(buildManage(db.reviews || [], business));
  }

  if (q.get('mine') === '1') {
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para continuar.' }, { status: 401 });
    if (relationalActive()) {
      // Negócio precisa existir (mesma checagem do legado) e as avaliações
      // vêm por consulta pontual do cliente logado.
      const pool = getPool();
      const biz = await pool.query('SELECT 1 FROM app.businesses WHERE id = $1', [businessId]);
      if (biz.rows.length === 0) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
      const mine = await pool.query(
        'SELECT order_id, booking_id FROM app.reviews WHERE business_id = $1 AND customer_id = $2',
        [businessId, customer.id],
      );
      return NextResponse.json({
        orderIds: mine.rows.map((r: any) => String(r.order_id || '')).filter(Boolean),
        bookingIds: mine.rows.map((r: any) => String(r.booking_id || '')).filter(Boolean),
      });
    }
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
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
    const rating = Number(body.rating);
    const text = String(body.text || '').trim().slice(0, 500);
    const orderId = String(body.orderId || '');
    const bookingId = String(body.bookingId || '');

    /** Mutação PURA (DOIS motores): regras de elegibilidade + criação pendente.
     * Re-checa TUDO dentro da transação (mensagens/idempotência do legado). */
    const reviewTx = (db: any) => {
      const business = (db.businesses || [])[0];
      if (!business) throw httpError(404, 'Negócio não encontrado.');
      // Módulo de avaliações desativado não recebe avaliação nova.
      if (!isFeatureEnabled(business, 'reviews')) {
        throw httpError(403, 'Este negócio não está coletando avaliações no momento.');
      }
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw httpError(400, 'Escolha de 1 a 5 estrelas.');
      }
      if (!orderId && !bookingId) throw httpError(400, 'Avaliação sem referência.');
      const phone = onlyDigits(customer.phone);
      if (orderId) {
        const order = (db.orders || []).find((o: any) => o.id === orderId && o.businessId === business.id);
        if (!order) throw httpError(404, 'Pedido não encontrado.');
        const mine = order.customerId === customer.id || (phone && onlyDigits(order.customerPhone) === phone);
        if (!mine) throw httpError(401, 'Não autorizado.');
        if (!['ready', 'completed'].includes(order.status)) {
          throw httpError(400, 'Você poderá avaliar quando o pedido estiver pronto.');
        }
        if ((db.reviews || []).some((r: any) => r.orderId === orderId)) {
          throw httpError(400, 'Este pedido já foi avaliado.');
        }
      }
      if (bookingId) {
        const booking = (db.bookings || []).find((b: any) => b.id === bookingId && b.businessId === business.id);
        if (!booking) throw httpError(404, 'Agendamento não encontrado.');
        const mine = booking.customerId === customer.id || (phone && onlyDigits(booking.customerPhone) === phone);
        if (!mine) throw httpError(401, 'Não autorizado.');
        const today = todayISO();
        const done = booking.status === 'completed' || booking.date < today;
        if (!done) {
          throw httpError(400, 'Você poderá avaliar após o atendimento.');
        }
        if ((db.reviews || []).some((r: any) => r.bookingId === bookingId)) {
          throw httpError(400, 'Este agendamento já foi avaliado.');
        }
      }
      db.reviews.push({
        id: randomUUID(), businessId: business.id, customerId: customer.id,
        customerName: customer.name, rating, text, source: 'site', status: 'pending',
        orderId, bookingId, externalId: '', createdAt: new Date().toISOString(),
      });
      return { ok: true };
    };

    if (relationalActive()) {
      // Fatia: a unidade (flag do módulo), a referência citada (pedido OU
      // agendamento) e as avaliações já existentes daquela referência
      // (idempotência: uma avaliação por pedido/agendamento).
      await runRelationalWrite(String(body.businessId || ''), reviewTx, {
        load: {
          orders: orderId ? { where: 'id = $2', args: [orderId] } : { where: 'false' },
          bookings: bookingId ? { where: 'id = $2', args: [bookingId] } : { where: 'false' },
          reviews: { where: `(order_id = $2 AND $2 <> '') OR (booking_id = $3 AND $3 <> '')`, args: [orderId, bookingId] },
        },
      });
      return NextResponse.json({ ok: true });
    }

    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    if (!isFeatureEnabled(business, 'reviews')) {
      return NextResponse.json({ error: 'Este negócio não está coletando avaliações no momento.' }, { status: 403 });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Escolha de 1 a 5 estrelas.' }, { status: 400 });
    }
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
      const today = todayISO();
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
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível enviar. Tente novamente.' : e.message }, { status });
  }
}

// PATCH { businessId, id, status } — dono publica/oculta.
export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    if (!['pending', 'published', 'hidden'].includes(status)) {
      return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    }
    const guard = await requireBusiness(req, businessId, 'pagina');
    if (!guard.ok) return guard.res;

    /** Mutação PURA (DOIS motores): publica/oculta avaliação da unidade. */
    const statusTx = (d: any) => {
      const r = (d.reviews || []).find((x: any) => x.id === id && x.businessId === businessId);
      if (!r) throw httpError(404, 'Avaliação não encontrada.');
      r.status = status;
      return true;
    };
    if (relationalActive()) {
      await runRelationalWrite(businessId, statusTx, { load: { reviews: { where: 'id = $2', args: [id] } } });
    } else {
      const found = (guard.db.reviews || []).find((x: any) => x.id === id && x.businessId === businessId);
      if (!found) return NextResponse.json({ error: 'Avaliação não encontrada.' }, { status: 404 });
      await updateDB(statusTx);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}

// DELETE ?businessId=&id= — dono exclui.
export async function DELETE(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const businessId = q.get('businessId') || '';
  const id = q.get('id') || '';
  const guard = await requireBusiness(req, businessId, 'pagina');
  if (!guard.ok) return guard.res;

  /** Mutação PURA (DOIS motores): exclui avaliação da unidade. */
  const deleteTx = (d: any) => {
    const found = (d.reviews || []).find((x: any) => x.id === id && x.businessId === businessId);
    if (!found) throw httpError(404, 'Avaliação não encontrada.');
    d.reviews = (d.reviews || []).filter((x: any) => !(x.id === id && x.businessId === businessId));
    return true;
  };
  if (relationalActive()) {
    await runRelationalWrite(businessId, deleteTx, { load: { reviews: { where: 'id = $2', args: [id] } } });
    return NextResponse.json({ ok: true });
  }
  const db = guard.db;
  if (!db.reviews.find((x: any) => x.id === id && x.businessId === businessId)) {
    return NextResponse.json({ error: 'Avaliação não encontrada.' }, { status: 404 });
  }
  await updateDB(deleteTx);
  return NextResponse.json({ ok: true });
}
