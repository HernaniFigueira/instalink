import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/auth';
import { readDB } from '@/lib/db';
import { onlyDigits } from '@/lib/utils';

// GET ?businessId=&q=&page= — cliente 360: pessoa unificada por telefone
// (pedido + agendamento + lead reunidos), busca e paginação. Dono.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1);
  const limit = 30;
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId && b.ownerId === user.id);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

  interface P {
    key: string; name: string; phone: string;
    orders: number; spent: number; lastOrderAt: string;
    bookings: Array<{ id: string; customerName: string; date: string; time: string; status: string; serviceId: string }>;
    leads: Array<{ id: string; origin: string; status: string; interest: string; action: string; createdAt: string }>;
    lastSeen: string;
  }
  const map = new Map<string, P>();
  const get = (rawPhone: string, name: string): P | null => {
    const digits = onlyDigits(rawPhone || '').replace(/^55(\d{10,11})$/, '$1');
    const phone = digits;
    const key = phone || `nome:${name.toLowerCase()}`;
    if (!phone && !name) return null;
    let p = map.get(key);
    if (!p) {
      p = { key, name, phone, orders: 0, spent: 0, lastOrderAt: '', bookings: [], leads: [], lastSeen: '' };
      map.set(key, p);
    }
    if (name && !p.name) p.name = name;
    return p;
  };

  const services = new Map(db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s.name]));
  for (const o of db.orders.filter((x) => x.businessId === businessId)) {
    const p = get(o.customerPhone, o.customerName);
    if (!p) continue;
    p.orders += 1;
    if (o.status !== 'cancelled') p.spent += o.total;
    if (!p.lastOrderAt || o.createdAt > p.lastOrderAt) p.lastOrderAt = o.createdAt;
    if (!p.lastSeen || o.createdAt > p.lastSeen) p.lastSeen = o.createdAt;
  }
  for (const b of db.bookings.filter((x) => x.businessId === businessId)) {
    const p = get(b.customerPhone, b.customerName);
    if (!p) continue;
    p.bookings.push({ id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status, serviceId: b.serviceId });
    const at = `${b.date}T${b.time}:00`;
    if (!p.lastSeen || at > p.lastSeen) p.lastSeen = at;
  }
  for (const l of db.leads.filter((x) => x.businessId === businessId)) {
    const p = get(l.phone, l.name);
    if (!p) continue;
    p.leads.push({ id: l.id, origin: l.origin, status: l.status, interest: l.interest || '', action: l.action || '', createdAt: l.createdAt });
    if (!p.lastSeen || l.createdAt > p.lastSeen) p.lastSeen = l.createdAt;
  }

  let people = [...map.values()];
  // Orçamento solto virou lead — conta conversa iniciada no perfil.
  people.forEach((p) => p.leads.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  people.forEach((p) => p.bookings.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)));
  people.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  if (q) {
    const qd = q.replace(/\D/g, '');
    people = people.filter((p) =>
      p.name.toLowerCase().includes(q) || (qd && p.phone.replace(/\D/g, '').includes(qd)),
    );
  }
  const total = people.length;
  const slice = people.slice((page - 1) * limit, page * limit).map((p) => ({
    ...p,
    bookings: p.bookings.map((b) => ({ ...b, service: services.get(b.serviceId) || 'Serviço' })),
  }));
  return NextResponse.json({ people: slice, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}
