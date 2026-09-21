import { NextRequest, NextResponse } from 'next/server';
import { updateDB, readDB } from '@/lib/db';
import { hashPassword, createSession, setSessionOn } from '@/lib/auth';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { findValidReset } from '@/lib/password-reset';
import { relationalActive } from '@/lib/relational/config';
import { relFindPasswordReset, relConsumePasswordReset, relUserById } from '@/lib/relational/auth-store';

// POST { token, password } — redefine senha do lojista e já loga.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`rs:${ipFrom(req)}`, 10, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const { token, password } = await req.json();
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'A senha precisa de ao menos 6 caracteres.' }, { status: 400 });
    }
    // MODO RELACIONAL: consumo do token no SQL, transacional (uma única vez).
    if (relationalActive()) {
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(String(token || '')).digest('hex');
      const reset = await relFindPasswordReset(tokenHash);
      if (!reset || reset.kind !== 'user') return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 400 });
      const user = await relUserById(reset.accountId);
      if (!user) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 400 });
      await relConsumePasswordReset(reset.id, hashPassword(password));
      const sessionId = await createSession(user.id);
      const res = NextResponse.json({ ok: true, token: sessionId });
      setSessionOn(res, sessionId);
      return res;
    }
    const db = await readDB();
    const reset = findValidReset(db, 'user', String(token || ''));
    if (!reset) return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 400 });
    const user = db.users.find((u) => u.id === reset.accountId);
    if (!user) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 400 });
    await updateDB((d) => {
      const u = d.users.find((x) => x.id === user.id);
      const r = d.passwordResets.find((x) => x.id === reset.id);
      if (!u || !r || r.usedAt) throw new Error('Link inválido ou expirado.');
      u.passwordHash = hashPassword(password);
      r.usedAt = new Date().toISOString();
    });
    const sessionId = await createSession(user.id);
    const res = NextResponse.json({ ok: true, token: sessionId });
    setSessionOn(res, sessionId);
    return res;
  } catch (e: any) {
    const msg = e?.message || 'Não foi possível redefinir. Tente novamente.';
    const known = msg === 'Link inválido ou expirado.';
    return NextResponse.json({ error: msg }, { status: known ? 400 : 500 });
  }
}
