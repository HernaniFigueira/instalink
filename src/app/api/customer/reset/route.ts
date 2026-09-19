import { NextRequest, NextResponse } from 'next/server';
import { updateDB, readDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { createCustomerSession, setCustomerSessionOn, publicCustomer } from '@/lib/customer-auth';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { findValidReset } from '@/lib/password-reset';

// POST { token, password } — redefine senha do consumidor e já loga.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`crs:${ipFrom(req)}`, 10, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const { token, password } = await req.json();
    if (!password || password.length < 4) {
      return NextResponse.json({ error: 'A senha precisa de ao menos 4 caracteres.' }, { status: 400 });
    }
    const db = await readDB();
    const reset = findValidReset(db, 'customer', String(token || ''));
    if (!reset) return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 400 });
    const customer = db.customers.find((c) => c.id === reset.accountId);
    if (!customer) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 400 });
    let out = customer;
    await updateDB((d) => {
      const c = d.customers.find((x) => x.id === customer.id);
      const r = d.passwordResets.find((x) => x.id === reset.id);
      if (!c || !r || r.usedAt) throw new Error('Link inválido ou expirado.');
      c.passwordHash = hashPassword(password);
      // A senha temporária/admin já foi substituída por uma senha definitiva.
      // O histórico de criação continua em accessCreatedAt.
      c.mustChangePassword = false;
      r.usedAt = new Date().toISOString();
      out = { ...c };
    });
    const sessionId = await createCustomerSession(customer.id);
    const res = NextResponse.json({ ok: true, token: sessionId, customer: publicCustomer(out) });
    setCustomerSessionOn(res, sessionId);
    return res;
  } catch (e: any) {
    const msg = e?.message || 'Não foi possível redefinir. Tente novamente.';
    const known = msg === 'Link inválido ou expirado.';
    return NextResponse.json({ error: msg }, { status: known ? 400 : 500 });
  }
}
