import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';
import { LEAD_FLOW, canTransition } from '@/lib/status';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { LeadStatus } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

// POST público: captura lead.
// - Orçamento/formulário pode ser GUEST (cria lead sem conta).
// - Identidade normalizada (dígitos + customerId) para não duplicar pessoa.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`lead:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const customer = await customerFromRequest(req);
    const guest = String(body.origin || '') === 'orcamento' || String(body.action || '') === 'orcamento' || String(body.origin || '') === 'formulario';
    if (!customer && !guest) {
      return NextResponse.json({ error: 'Entre para continuar.', code: 'login_required' }, { status: 401 });
    }
    const name = (body.name || customer?.name || '').trim().slice(0, 80);
    const phone = (body.phone || customer?.phone || '').trim().slice(0, 25);
    const email = (body.email || customer?.email || '').trim().toLowerCase().slice(0, 120);
    if (!name && !phone) return NextResponse.json({ error: 'Informe ao menos nome ou WhatsApp.' }, { status: 400 });
    const now = new Date().toISOString();
    await updateDB((d) => {
      const digits = onlyDigits(phone);
      const existing = d.leads.find((l) =>
        l.businessId === business.id &&
        ((customer && l.customerId && l.customerId === customer.id) ||
          (digits && onlyDigits(l.phone) === digits) ||
          (email && l.email && l.email.toLowerCase() === email)),
      );
      if (existing) {
        existing.name = name || existing.name;
        if (customer) existing.customerId = customer.id;
        existing.interest = String(body.interest || existing.interest).slice(0, 500);
        existing.lastInteraction = now;
      } else {
        d.leads.push({
          id: randomUUID(), businessId: business.id, customerId: customer?.id || '', name, phone,
          email, instagram: String(body.instagram || '').slice(0, 60),
          origin: String(body.origin || 'formulario').slice(0, 40),
          interest: String(body.interest || '').slice(0, 500),
          action: String(body.action || 'contato').slice(0, 40),
          status: 'new', createdAt: now, lastInteraction: now,
        });
      }
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'lead_created', path: '', meta: { origin: body.origin || 'formulario' }, createdAt: now });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'conversion', path: '', meta: { kind: 'lead' }, createdAt: now });
    });
    return NextResponse.json({ ok: true, guest: !customer });
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
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
  const all = db.leads.filter((l) => l.businessId === businessId).reverse();
  return NextResponse.json({ leads: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit });
}

export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const db = await readDB();
    if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
    const current = db.leads.find((x) => x.id === id && x.businessId === businessId);
    if (!current) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    const to = status as LeadStatus;
    if (!LEAD_FLOW[current.status] || !canTransition(LEAD_FLOW, current.status, to)) {
      return NextResponse.json({ error: `Não é possível mudar de "${current.status}" para "${status}".` }, { status: 422 });
    }
    await updateDB((d) => {
      const l = d.leads.find((x) => x.id === id && x.businessId === businessId);
      if (!l) throw err('Cliente não encontrado.', 404);
      l.status = to;
      l.lastInteraction = new Date().toISOString();
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
