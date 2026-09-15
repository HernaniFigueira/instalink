import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { verifyPassword, createSession, setSessionOn } from '@/lib/auth';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { isMasterUser } from '@/lib/access';
import { pushAudit } from '@/lib/audit';

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
      pushAudit(d, {
        action: 'user.login',
        actor: { id: user.id, email: user.email, role: user.role || 'owner' },
        meta: { via: 'password' },
      });
    });
    // Master da plataforma → /master; demais → /dashboard (mesmo endpoint).
    const redirectTo = isMasterUser(user) ? '/master' : '/dashboard';
    const res = NextResponse.json({
      ok: true,
      token: sessionId,
      redirectTo,
      isMaster: isMasterUser(user),
    });
    setSessionOn(res, sessionId);
    return res;
  } catch {
    return NextResponse.json({ error: 'Não foi possível entrar. Tente novamente.' }, { status: 500 });
  }
}
