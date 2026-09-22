import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest, publicCustomer } from '@/lib/customer-auth';
import { readDB, updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
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
    const name = body.name !== undefined ? String(body.name || '').trim().slice(0, 80) : undefined;
    const digits = body.phone !== undefined ? onlyDigits(String(body.phone || '')) : undefined;
    if (name !== undefined && !name) return NextResponse.json({ error: 'Informe seu nome.' }, { status: 400 });
    if (digits !== undefined && digits.length < 10) {
      return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    }
    // MODO RELACIONAL: perfil do consumidor no SQL (conta GLOBAL — sem
    // documento; lock no id da conta para a checagem de unicidade).
    if (relationalActive()) {
      const { getPool } = await import('@/lib/relational/pool');
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`godoutor:customer:${customer.id}`]);
        if (digits) {
          const dup = await client.query(
            `SELECT 1 FROM app.customers WHERE id <> $1 AND phone <> '' AND regexp_replace(phone, '\D', '', 'g') = $2 LIMIT 1`,
            [customer.id, digits],
          );
          if (dup.rows.length) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Este WhatsApp já está em outra conta.' }, { status: 400 });
          }
        }
        const upd = await client.query(
          `UPDATE app.customers SET
             name = CASE WHEN $2::boolean THEN $3 ELSE name END,
             phone = CASE WHEN $4::boolean THEN $5 ELSE phone END
           WHERE id = $1 RETURNING *`,
          [customer.id, name !== undefined, name ?? '', digits !== undefined, digits ?? ''],
        );
        await client.query('COMMIT');
        if (!upd.rows[0]) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 400 });
        const row = upd.rows[0];
        return NextResponse.json({ ok: true, customer: publicCustomer({
          id: String(row.id), name: String(row.name || ''), phone: String(row.phone || ''),
          email: String(row.email || ''), passwordHash: '', googleId: '', avatar: '',
          mustChangePassword: row.must_change_password === true, createdAt: new Date(row.created_at).toISOString(),
        } as any) });
      } finally { client.release(); }
    }
    const db = await readDB();
    void db;
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
