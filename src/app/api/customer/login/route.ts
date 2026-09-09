import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createCustomerSession, setCustomerSessionOn, publicCustomer } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';

// POST público: login do consumidor (WhatsApp ou e-mail + senha).
export async function POST(req: NextRequest) {
  try {
    const { login, password } = await req.json();
    const digits = onlyDigits(login || '');
    const email = (login || '').trim().toLowerCase();
    const db = await readDB();
    const customer = db.customers.find(
      (c) => (digits && c.phone === digits) || (email && c.email === email),
    );
    if (!customer) {
      return NextResponse.json({ error: 'Conta não encontrada. Crie sua conta grátis.' }, { status: 401 });
    }
    if (!customer.passwordHash) {
      return NextResponse.json({ error: 'Sua conta usa login com Google. Entre com o Google.' }, { status: 401 });
    }
    if (!verifyPassword(password || '', customer.passwordHash)) {
      return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
    }
    const sessionId = await createCustomerSession(customer.id);
    const res = NextResponse.json({ ok: true, token: sessionId, customer: publicCustomer(customer) });
    setCustomerSessionOn(res, sessionId);
    return res;
  } catch {
    return NextResponse.json({ error: 'Não foi possível entrar. Tente novamente.' }, { status: 500 });
  }
}
