import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
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
    const mail = await sendMail(customer.email, 'Redefinir sua senha — InstaLink', resetEmailHtml(customer.name, link, 'consumidor'));
    return NextResponse.json({ ok: true, sent: mail.sent });
  } catch {
    return NextResponse.json({ error: 'Não foi possível enviar. Tente novamente.' }, { status: 500 });
  }
}
