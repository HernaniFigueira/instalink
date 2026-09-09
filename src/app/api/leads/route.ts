import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { customerFromRequest } from '@/lib/customer-auth';

// POST público: captura lead (contato / orçamento)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para continuar.', code: 'login_required' }, { status: 401 });
    void customer;
    const name = (body.name || '').trim();
    const phone = (body.phone || '').trim();
    if (!name && !phone) return NextResponse.json({ error: 'Informe ao menos nome ou WhatsApp.' }, { status: 400 });
    const now = new Date().toISOString();
    await updateDB((d) => {
      const existing = phone ? d.leads.find((l) => l.businessId === business.id && l.phone === phone) : undefined;
      if (existing) {
        existing.name = name || existing.name;
        existing.interest = String(body.interest || existing.interest).slice(0, 500);
        existing.lastInteraction = now;
      } else {
        d.leads.push({
          id: randomUUID(), businessId: business.id, name, phone,
          email: String(body.email || ''), instagram: String(body.instagram || ''),
          origin: String(body.origin || 'formulario').slice(0, 40),
          interest: String(body.interest || '').slice(0, 500),
          action: String(body.action || 'contato').slice(0, 40),
          status: 'new', createdAt: now, lastInteraction: now,
        });
      }
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'lead_created', path: '', meta: { origin: body.origin || 'formulario' }, createdAt: now });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'conversion', path: '', meta: { kind: 'lead' }, createdAt: now });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível enviar. Tente novamente.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }
  return NextResponse.json({ leads: db.leads.filter((l) => l.businessId === businessId).reverse() });
}

export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const valid = ['new', 'contacted', 'qualified', 'converted', 'lost'];
    if (!valid.includes(status)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    const db = await readDB();
    if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
    await updateDB((d) => {
      const l = d.leads.find((x) => x.id === id && x.businessId === businessId);
      if (l) { l.status = status; l.lastInteraction = new Date().toISOString(); }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 500 });
  }
}
