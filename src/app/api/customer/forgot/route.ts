import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { sendMail, resetEmailHtml } from '@/lib/mailer';
import { newResetToken, RESET_TTL_MS } from '@/lib/password-reset';

// POST { email } — inicia recuperação do consumidor (contas com e-mail).
export async function POST(req: NextRequest) {
  const rl = rateLimit(`cfg:${ipFrom(req)}`, 5, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const { email } = await req.json();
    const clean = String(email || '').trim().toLowerCase();
    if (!clean.includes('@')) return NextResponse.json({ ok: true });
    // MODO RELACIONAL: recuperação direto no SQL (conta GLOBAL + tokens).
    if (relationalActive()) {
      const { getPool } = await import('@/lib/relational/pool');
      const pool = getPool();
      const found = await pool.query(
        `SELECT id, name, email FROM app.customers
          WHERE lower(email) = $1 AND password_hash <> '' LIMIT 1`,
        [clean],
      );
      if (!found.rows[0]) return NextResponse.json({ ok: true });
      const customerId = String(found.rows[0].id);
      const customerName = String(found.rows[0].name || '');
      const customerEmail = String(found.rows[0].email || '');
      const { token, hash } = newResetToken();
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE app.password_resets SET used_at = $2
            WHERE kind = 'customer' AND account_id = $1 AND used_at IS NULL`,
          [customerId, now],
        );
        await client.query(
          `INSERT INTO app.password_resets (id, kind, account_id, token_hash, expires_at, used_at, created_at)
           VALUES ($1, 'customer', $2, $3, $4, NULL, $5)`,
          [randomUUID(), customerId, hash, new Date(Date.now() + RESET_TTL_MS).toISOString(), now],
        );
        await client.query('COMMIT');
      } finally { client.release(); }
      const link = `${req.nextUrl.origin}/recuperar?kind=customer&token=${token}`;
      const mail = await sendMail(customerEmail, 'Redefinir sua senha — GoDoutor', resetEmailHtml(customerName, link, 'consumidor'));
      return NextResponse.json({ ok: true, sent: mail.sent });
    }
    const db = await readDB();
    const customer = db.customers.find((c) => (c.email || '').toLowerCase() === clean && c.passwordHash);
    if (!customer) return NextResponse.json({ ok: true });
    const { token, hash } = newResetToken();
    const now = new Date().toISOString();
    await updateDB((d) => {
      for (const r of d.passwordResets) {
        if (r.kind === 'customer' && r.accountId === customer.id && !r.usedAt) r.usedAt = now;
      }
      d.passwordResets.push({
        id: randomUUID(), kind: 'customer', accountId: customer.id, tokenHash: hash,
        expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(), usedAt: '', createdAt: now,
      });
    });
    const link = `${req.nextUrl.origin}/recuperar?kind=customer&token=${token}`;
    const mail = await sendMail(customer.email, 'Redefinir sua senha — GoDoutor', resetEmailHtml(customer.name, link, 'consumidor'));
    return NextResponse.json({ ok: true, sent: mail.sent });
  } catch {
    return NextResponse.json({ error: 'Não foi possível enviar. Tente novamente.' }, { status: 500 });
  }
}
