import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { hashPassword, createSession, setSessionOn } from '@/lib/auth';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const rl = rateLimit(`register:${ipFrom(req)}`, 10, 300000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas contas criadas. Aguarde alguns minutos.' }, { status: 429 });
  try {
    const { name, email, password } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Informe seu nome.' }, { status: 400 });
    if (!email?.includes('@')) return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
    if (!password || password.length < 6) return NextResponse.json({ error: 'A senha precisa de ao menos 6 caracteres.' }, { status: 400 });

    const db = await readDB();
    if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: 'Este e-mail já está cadastrado. Tente entrar.' }, { status: 400 });
    }
    // role de plataforma nunca vem do cliente — cadastro público = owner.
    // Master só via bootstrap CLI ou /api/master/masters (requireMaster).
    const user = {
      id: randomUUID(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      role: 'owner' as const,
    };
    await updateDB((d) => { d.users.push(user); });
    const sessionId = await createSession(user.id);
    const res = NextResponse.json({ ok: true, token: sessionId });
    setSessionOn(res, sessionId);
    return res;
  } catch {
    return NextResponse.json({ error: 'Não conseguimos criar sua conta. Tente novamente.' }, { status: 500 });
  }
}
