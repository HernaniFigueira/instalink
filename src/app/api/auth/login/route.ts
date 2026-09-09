import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { verifyPassword, createSession, setSessionOn } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const db = await readDB();
    const user = db.users.find((u) => u.email.toLowerCase() === (email || '').toLowerCase());
    if (!user || !verifyPassword(password || '', user.passwordHash)) {
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }
    const sessionId = await createSession(user.id);
    const res = NextResponse.json({ ok: true, token: sessionId });
    setSessionOn(res, sessionId);
    return res;
  } catch {
    return NextResponse.json({ error: 'Não foi possível entrar. Tente novamente.' }, { status: 500 });
  }
}
