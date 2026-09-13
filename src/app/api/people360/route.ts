import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { onlyDigits } from '@/lib/utils';

// GET ?businessId=&q=&page= — cliente 360 (contato-centric).
// A base nasce da relação BusinessCustomer/Contact (cadastro/login na página
// do negócio) e reúne pedidos, agendamentos e conversas daquela pessoa.
// Caminho defensivo: interações sem contato ainda aparecem (dedupe por
// telefone), preservando o histórico legado. Dono.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1);
  const limit = 30;
  const guard = await requireBusiness(req, businessId, 'clientes');
  if (!guard.ok) return guard.res;
  const db = guard.db;

  interface P {
    key: string;
    contactId: string;
    note: string;
    customerId: string;
    name: string;
    phone: string;
    email: string;
    registered: boolean;
    customerSince: string;
    source: string;
    marketingOptIn: boolean;
    orders: number;
    spent: number;
    lastOrderAt: string;
    bookings: Array<{ id: string; customerName: string; date: string; time: string; status: string; serviceId: string }>;
    leads: Array<{ id: string; origin: string; status: string; interest: string; action: string; createdAt: string }>;
    lastSeen: string;
  }

  const map = new Map<string, P>();
  const keyOf = (customerId: string, phone: string): string => {
    const digits = onlyDigits(phone || '').replace(/^55(\d{10,11})$/, '$1');
    return customerId ? `c:${customerId}` : digits ? `p:${digits}` : '';
  };
  const get = (customerId: string, rawPhone: string, name: string): P | null => {
    const digits = onlyDigits(rawPhone || '').replace(/^55(\d{10,11})$/, '$1');
    let key = keyOf(customerId, digits);
    if (!key) {
      if (!name) return null;
      key = `nome:${name.toLowerCase()}`;
    }
    let p = map.get(key);
    if (!p) {
      p = {
        key, contactId: '', note: '', customerId, name, phone: digits, email: '', registered: false, customerSince: '',
        source: '', marketingOptIn: false,
        orders: 0, spent: 0, lastOrderAt: '', bookings: [], leads: [], lastSeen: '',
      };
      map.set(key, p);
    }
    if (customerId && !p.customerId) p.customerId = customerId;
    if (name && !p.name) p.name = name;
    if (digits && !p.phone) p.phone = digits;
    return p;
  };

  // 1. Contatos (a fonte primária): o cadastro NA PÁGINA já cria a pessoa.
  for (const c of db.contacts.filter((x) => x.businessId === businessId)) {
    const p = get(c.customerId, c.phone, c.name);
    if (!p) continue;
    p.registered = !!c.customerId;
    p.customerSince = c.createdAt;
    p.contactId = c.id;
    p.note = c.note || '';
    p.source = c.source;
    p.email = c.email || p.email;
    p.marketingOptIn = c.marketingOptIn === true;
    if (!p.lastSeen || c.lastInteraction > p.lastSeen) p.lastSeen = c.lastInteraction;
  }

  // 2. Agregados de interação (pedidos / agendamentos / leads) da pessoa.
  const services = new Map(db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s.name]));
  for (const o of db.orders.filter((x) => x.businessId === businessId)) {
    const p = get(o.customerId, o.customerPhone, o.customerName);
    if (!p) continue;
    p.orders += 1;
    if (o.status !== 'cancelled') p.spent += o.total;
    if (!p.lastOrderAt || o.createdAt > p.lastOrderAt) p.lastOrderAt = o.createdAt;
    if (!p.lastSeen || o.createdAt > p.lastSeen) p.lastSeen = o.createdAt;
  }
  for (const b of db.bookings.filter((x) => x.businessId === businessId)) {
    const p = get(b.customerId, b.customerPhone, b.customerName);
    if (!p) continue;
    p.bookings.push({ id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status, serviceId: b.serviceId });
    const at = `${b.date}T${b.time}:00`;
    if (!p.lastSeen || at > p.lastSeen) p.lastSeen = at;
  }
  for (const l of db.leads.filter((x) => x.businessId === businessId)) {
    const p = get(l.customerId, l.phone, l.name);
    if (!p) continue;
    p.leads.push({ id: l.id, origin: l.origin, status: l.status, interest: l.interest || '', action: l.action || '', createdAt: l.createdAt });
    if (!p.lastSeen || l.createdAt > p.lastSeen) p.lastSeen = l.createdAt;
  }

  let people = [...map.values()];
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
