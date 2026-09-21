import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createCustomerSession, setCustomerSessionOn, publicCustomer } from '@/lib/customer-auth';
import { upsertContact } from '@/lib/contacts';
import { onlyDigits } from '@/lib/utils';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { relationalActive } from '@/lib/relational/config';
import { relCustomerByLogin, relUpsertContactOnLogin } from '@/lib/relational/auth-store';
import { getPool } from '@/lib/relational/pool';

// POST público: login do consumidor (WhatsApp ou e-mail + senha).
// businessId (opcional): associa/atualiza o contato no negócio de origem.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`clogin:${ipFrom(req)}`, 20, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um minuto.' }, { status: 429 });
  try {
    const { login, password, businessId } = await req.json();
    const digits = onlyDigits(login || '');
    const email = (login || '').trim().toLowerCase();
    // MODO RELACIONAL: consumidor/sessão/contato direto no SQL.
    if (relationalActive()) {
      const customer = await relCustomerByLogin(String(login || ''));
      if (!customer) {
        return NextResponse.json({ error: 'Conta não encontrada. Crie sua conta grátis.' }, { status: 401 });
      }
      if (!customer.passwordHash) {
        return NextResponse.json({ error: 'Sua conta usa login com Google. Entre com o Google.' }, { status: 401 });
      }
      if (!verifyPassword(password || '', customer.passwordHash)) {
        return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
      }
      if (businessId) {
        const biz = await getPool().query('SELECT id FROM app.businesses WHERE id = $1', [String(businessId)]);
        if (biz.rows[0]) {
          const client = await getPool().connect();
          try {
            await relUpsertContactOnLogin(client, {
              businessId: String(businessId), customerId: customer.id,
              name: customer.name, phone: customer.phone, email: customer.email,
            });
          } finally { client.release(); }
        }
      }
      const sessionId = await createCustomerSession(customer.id);
      const res = NextResponse.json({ ok: true, token: sessionId, customer: publicCustomer(customer) });
      setCustomerSessionOn(res, sessionId);
      return res;
    }
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
    if (businessId && db.businesses.some((b) => b.id === businessId)) {
      await updateDB((d) => {
        const c = d.customers.find((x) => x.id === customer.id);
        if (!c) return;
        upsertContact(d, { businessId, customerId: c.id, name: c.name, phone: c.phone, email: c.email, source: 'login' });
      });
    }
    const sessionId = await createCustomerSession(customer.id);
    const res = NextResponse.json({ ok: true, token: sessionId, customer: publicCustomer(customer) });
    setCustomerSessionOn(res, sessionId);
    return res;
  } catch {
    return NextResponse.json({ error: 'Não foi possível entrar. Tente novamente.' }, { status: 500 });
  }
}
