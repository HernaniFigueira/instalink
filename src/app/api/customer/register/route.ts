import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { createCustomerSession, setCustomerSessionOn, publicCustomer } from '@/lib/customer-auth';
import { upsertContact } from '@/lib/contacts';
import { onlyDigits } from '@/lib/utils';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { relationalActive } from '@/lib/relational/config';
import { relCustomerByLogin, relUpsertContactOnLogin } from '@/lib/relational/auth-store';
import { getPool } from '@/lib/relational/pool';

// POST público: cria conta do consumidor (nome + whatsapp ou e-mail + senha).
// businessId (opcional): ao criar a conta A PARTIR da página de um negócio,
// o cliente já entra na base de contatos daquele negócio (BusinessCustomer).
export async function POST(req: NextRequest) {
  const rl = rateLimit(`creg:${ipFrom(req)}`, 10, 300000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas contas criadas. Aguarde alguns minutos.' }, { status: 429 });
  try {
    const { name, phone, email, password, businessId } = await req.json();
    const cleanName = (name || '').trim();
    const digits = onlyDigits(phone || '');
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanName) return NextResponse.json({ error: 'Informe seu nome.' }, { status: 400 });
    if (!digits && !cleanEmail.includes('@')) {
      return NextResponse.json({ error: 'Informe WhatsApp ou e-mail.' }, { status: 400 });
    }
    if (!password || password.length < 4) {
      return NextResponse.json({ error: 'Crie uma senha de ao menos 4 caracteres.' }, { status: 400 });
    }
    // MODO RELACIONAL: conta do consumidor criada no SQL (e-mail/telefone).
    if (relationalActive()) {
      if (await relCustomerByLogin(digits || cleanEmail)) {
        return NextResponse.json({ error: 'Você já tem conta. Entre com sua senha.', code: 'exists' }, { status: 400 });
      }
      const pool = getPool();
      const id = randomUUID();
      await pool.query(
        `INSERT INTO app.customers (id, name, phone, email, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [id, cleanName, digits, cleanEmail, hashPassword(password)],
      );
      if (businessId) {
        const biz = await pool.query('SELECT id FROM app.businesses WHERE id = $1', [String(businessId)]);
        if (biz.rows[0]) {
          const client = await pool.connect();
          try {
            await relUpsertContactOnLogin(client, {
              businessId: String(businessId), customerId: id,
              name: cleanName, phone: digits, email: cleanEmail,
            });
          } finally { client.release(); }
        }
      }
      const sessionId = await createCustomerSession(id);
      const res = NextResponse.json({ ok: true, token: sessionId, customer: { id, name: cleanName, phone: digits, email: cleanEmail, avatar: '', mustChangePassword: false } });
      setCustomerSessionOn(res, sessionId);
      return res;
    }
    const db = await readDB();
    const exists = db.customers.find(
      (c) => (digits && c.phone === digits) || (cleanEmail && c.email === cleanEmail),
    );
    if (exists) {
      return NextResponse.json({ error: 'Você já tem conta. Entre com sua senha.', code: 'exists' }, { status: 400 });
    }
    const customer = {
      id: randomUUID(), name: cleanName, phone: digits, email: cleanEmail,
      passwordHash: hashPassword(password), googleId: '', avatar: '',
      createdAt: new Date().toISOString(),
    };
    await updateDB((d) => {
      d.customers.push(customer);
      // Contexto do negócio: associação imediata, sem duplicar Customer.
      if (businessId && d.businesses.some((b) => b.id === businessId)) {
        upsertContact(d, { businessId, customerId: customer.id, name: cleanName, phone: digits, email: cleanEmail, source: 'signup' });
      }
    });
    const sessionId = await createCustomerSession(customer.id);
    const res = NextResponse.json({ ok: true, token: sessionId, customer: publicCustomer(customer) });
    setCustomerSessionOn(res, sessionId);
    return res;
  } catch {
    return NextResponse.json({ error: 'Não foi possível criar sua conta. Tente novamente.' }, { status: 500 });
  }
}
