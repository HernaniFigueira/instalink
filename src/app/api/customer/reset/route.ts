import { NextRequest, NextResponse } from 'next/server';
import { updateDB, readDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
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
    // MODO RELACIONAL: token (hash sha256, uso único) + senha no SQL.
    if (relationalActive()) {
      const { getPool } = await import('@/lib/relational/pool');
      const { hashResetToken } = await import('@/lib/password-reset');
      const pool = getPool();
      const rRes = await pool.query(
        `SELECT id, account_id, used_at, expires_at FROM app.password_resets
          WHERE kind = 'customer' AND token_hash = $1 AND used_at IS NULL AND expires_at > now()
          LIMIT 1`,
        [hashResetToken(String(token || ''))],
      );
      const resetRow = rRes.rows[0];
      if (!resetRow) return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 400 });
      const customerId = String(resetRow.account_id);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`godoutor:customer:${customerId}`]);
        // CAS: o uso é único mesmo em corrida (2ª chamada falha).
        const used = await client.query(
          `UPDATE app.password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`,
          [String(resetRow.id)],
        );
        if (!used.rows[0]) throw new Error('Link inválido ou expirado.');
        const cUpd = await client.query(
          `UPDATE app.customers SET password_hash = $2, must_change_password = false WHERE id = $1 RETURNING *`,
          [customerId, hashPassword(password)],
        );
        await client.query('COMMIT');
        if (!cUpd.rows[0]) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 400 });
        const row = cUpd.rows[0];
        const out: any = {
          id: String(row.id), name: String(row.name || ''), phone: String(row.phone || ''),
          email: String(row.email || ''), passwordHash: '', googleId: '', avatar: '',
          mustChangePassword: false, createdAt: new Date(row.created_at).toISOString(),
        };
        const sessionId = await createCustomerSession(customerId);
        const res = NextResponse.json({ ok: true, token: sessionId, customer: publicCustomer(out) });
        setCustomerSessionOn(res, sessionId);
        return res;
      } catch (e2: any) {
        try { await client.query('ROLLBACK'); } catch { /* conexão já quebrou */ }
        const msg = e2?.message || 'Não foi possível redefinir. Tente novamente.';
        const known = msg === 'Link inválido ou expirado.';
        return NextResponse.json({ error: msg }, { status: known ? 400 : 500 });
      } finally { client.release(); }
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
