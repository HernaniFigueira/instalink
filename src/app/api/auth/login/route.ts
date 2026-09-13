import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { verifyPassword, createSession, setSessionOn } from '@/lib/auth';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const rl = rateLimit(`login:${ipFrom(req)}`, 15, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas de login. Aguarde um minuto.' }, { status: 429 });
  try {
    const { email, password } = await req.json();
    const db = await readDB();
    const user = db.users.find((u) => u.email.toLowerCase() === (email || '').toLowerCase());
    if (!user || !verifyPassword(password || '', user.passwordHash)) {
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }
    const sessionId = await createSession(user.id);
    // Último acesso (visível para o próprio usuário e para o suporte master).
    await updateDB((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.lastLoginAt = new Date().toISOString();
    });
    const res = NextResponse.json({ ok: true, token: sessionId });
    setSessionOn(res, sessionId);
    return res;
  } catch {
    return NextResponse.json({ error: 'Não foi possível entrar. Tente novamente.' }, { status: 500 });
  }
}
