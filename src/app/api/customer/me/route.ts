import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest, publicCustomer } from '@/lib/customer-auth';
import { readDB, updateDB } from '@/lib/db';
import { onlyDigits } from '@/lib/utils';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

// GET: consumidor logado (cookie OU Bearer).
export async function GET(req: NextRequest) {
  const customer = await customerFromRequest(req);
  if (!customer) return NextResponse.json({ customer: null }, { status: 401 });
  return NextResponse.json({ customer: publicCustomer(customer) });
}

// PATCH: completa/atualiza perfil (nome/telefone). Telefone é pedido
// uma única vez (onboarding Google) e reutilizado em todos os fluxos.
export async function PATCH(req: NextRequest) {
  const rl = rateLimit(`cme:${ipFrom(req)}`, 20, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para continuar.' }, { status: 401 });
    const body = await req.json();
    const db = await readDB();
    const name = body.name !== undefined ? String(body.name || '').trim().slice(0, 80) : undefined;
    const digits = body.phone !== undefined ? onlyDigits(String(body.phone || '')) : undefined;
    if (name !== undefined && !name) return NextResponse.json({ error: 'Informe seu nome.' }, { status: 400 });
    if (digits !== undefined && digits.length < 10) {
      return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    }
    if (digits && db.customers.some((c) => c.id !== customer.id && c.phone && onlyDigits(c.phone) === digits)) {
      return NextResponse.json({ error: 'Este WhatsApp já está em outra conta.' }, { status: 400 });
    }
    let out = customer;
    await updateDB((d) => {
      const c = d.customers.find((x) => x.id === customer.id);
      if (!c) throw new Error('Conta não encontrada.');
      if (name !== undefined) c.name = name;
      if (digits !== undefined) c.phone = digits;
      out = { ...c };
    });
    return NextResponse.json({ ok: true, customer: publicCustomer(out) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Não foi possível salvar.' }, { status: 400 });
  }
}
