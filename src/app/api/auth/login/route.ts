import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { verifyPassword, createSession, setSessionOn } from '@/lib/auth';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { isMasterUser } from '@/lib/access';
import { authUnavailable } from '@/lib/auth-failure';
import { pushAudit } from '@/lib/audit';
import { relationalActive } from '@/lib/relational/config';
import { relUserByEmail, relTouchLogin } from '@/lib/relational/auth-store';

export async function POST(req: NextRequest) {
  const rl = rateLimit(`login:${ipFrom(req)}`, 15, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas de login. Aguarde um minuto.' }, { status: 429 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 }); }
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'Confira os campos de e-mail e senha.' }, { status: 400 });
  }
  const { email, password } = body;
  let stage: 'login_read' | 'login_session' | 'login_audit' = 'login_read';
  try {
    // MODO RELACIONAL: usuário/sessão/auditoria de login no SQL.
    if (relationalActive()) {
      const user = await relUserByEmail(email || '');
      if (!user || !verifyPassword(password || '', user.passwordHash)) {
        return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
      }
      stage = 'login_session';
      const sessionId = await createSession(user.id);
      stage = 'login_audit';
      await relTouchLogin(user);
      const redirectTo = isMasterUser(user) ? '/master' : '/dashboard';
      const res = NextResponse.json({
        ok: true, token: sessionId, redirectTo, isMaster: isMasterUser(user),
      }, { headers: { 'Cache-Control': 'no-store' } });
      setSessionOn(res, sessionId);
      return res;
    }
    const db = await readDB();
    const user = db.users.find((u) => u.email.toLowerCase() === (email || '').toLowerCase());
    if (!user || !verifyPassword(password || '', user.passwordHash)) {
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }
    stage = 'login_session';
    const sessionId = await createSession(user.id);
    stage = 'login_audit';
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
    }, { headers: { 'Cache-Control': 'no-store' } });
    setSessionOn(res, sessionId);
    return res;
  } catch {
    return authUnavailable(stage);
  }
}
