import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { customerFromRequest } from '@/lib/customer-auth';
import { computeSlots } from '@/lib/slots';

// GET ?businessId=&serviceId=&professionalId=&date= — slots livres (público)
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const businessId = q.get('businessId') || '';
  const mode = q.get('mode');
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

  if (mode === 'manage') {
    const user = await userFromRequest(req);
    if (!user || business.ownerId !== user.id) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    return NextResponse.json({ bookings: db.bookings.filter((x) => x.businessId === businessId).reverse() });
  }

  const service = db.services.find((s) => s.id === q.get('serviceId') && s.businessId === businessId);
  if (!service) return NextResponse.json({ slots: [] });

  // ?from=YYYY-MM-DD&to=YYYY-MM-DD — mapa de dias (fechado/livre) p/ a faixa
  const from = q.get('from') || '';
  const to = q.get('to') || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const days: Record<string, { closed: boolean; free: number }> = {};
    const d0 = new Date(from + 'T12:00:00');
    const d1 = new Date(to + 'T12:00:00');
    for (let d = new Date(d0); d <= d1; d = new Date(d.getTime() + 86400000)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (db.exceptions.some((e) => e.businessId === businessId && e.date === iso && e.closed)) {
        days[iso] = { closed: true, free: 0 };
        continue;
      }
      const slots = computeSlots(
        db.availability.filter((a) => a.businessId === businessId),
        db.bookings.filter((b) => b.businessId === businessId),
        iso, d.getDay(), q.get('professionalId') || '', service.durationMin,
      );
      days[iso] = { closed: slots.length === 0, free: slots.length };
    }
    return NextResponse.json({ days });
  }

  const date = q.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ slots: [] });
  if (db.exceptions.some((e) => e.businessId === businessId && e.date === date && e.closed)) {
    return NextResponse.json({ slots: [], closed: true });
  }
  const weekday = new Date(date + 'T12:00:00').getDay();
  const slots = computeSlots(
    db.availability.filter((a) => a.businessId === businessId),
    db.bookings.filter((b) => b.businessId === businessId),
    date, weekday, q.get('professionalId') || '', service.durationMin,
  );
  return NextResponse.json({ slots });
}

// POST público: cria reserva (valida slot no servidor)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para agendar.', code: 'login_required' }, { status: 401 });
    const service = db.services.find((s) => s.id === body.serviceId && s.businessId === business.id && s.bookable && s.active);
    if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
    const name = (body.customerName || '').trim();
    const phone = (body.customerPhone || '').trim();
    if (!name) return NextResponse.json({ error: 'Informe seu nome.' }, { status: 400 });
    if (phone.replace(/\D/g, '').length < 10) return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    const date = body.date || '';
    const time = body.time || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: 'Escolha data e horário.' }, { status: 400 });
    }
    const weekday = new Date(date + 'T12:00:00').getDay();
    const slots = computeSlots(
      db.availability.filter((a) => a.businessId === business.id),
      db.bookings.filter((b) => b.businessId === business.id),
      date, weekday, body.professionalId || '', service.durationMin,
    );
    if (!slots.includes(time)) {
      return NextResponse.json({ error: 'Este horário acabou de ser ocupado. Escolha outro.' }, { status: 409 });
    }
    const now = new Date().toISOString();
    const bookingId = randomUUID();
    await updateDB((d) => {
      d.bookings.push({
        id: bookingId, businessId: business.id, customerId: customer.id, serviceId: service.id,
        professionalId: body.professionalId || '', date, time,
        customerName: name, customerPhone: phone, status: 'pending',
        note: String(body.note || '').slice(0, 300), createdAt: now,
      });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'booking_created', path: '', meta: { serviceId: service.id }, createdAt: now });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'conversion', path: '', meta: { kind: 'booking' }, createdAt: now });
      const lead = d.leads.find((l) => l.businessId === business.id && l.phone === phone);
      if (lead) { lead.name = name; lead.lastInteraction = now; lead.action = 'agendamento'; if (lead.status === 'new') lead.status = 'converted'; }
      else d.leads.push({ id: randomUUID(), businessId: business.id, name, phone, email: '', instagram: '', origin: 'agendamento', interest: service.name, action: 'agendamento', status: 'converted', createdAt: now, lastInteraction: now });
    });
    return NextResponse.json({ ok: true, bookingId });
  } catch {
    return NextResponse.json({ error: 'Não foi possível confirmar. Tente novamente.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const valid = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];
    if (!valid.includes(status)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    const db = await readDB();
    if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
    await updateDB((d) => {
      const b = d.bookings.find((x) => x.id === id && x.businessId === businessId);
      if (b) b.status = status;
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 500 });
  }
}
