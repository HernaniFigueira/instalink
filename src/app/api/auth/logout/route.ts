import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, destroySession, clearSessionOn, getBearerToken } from '@/lib/auth';

// POST — encerra a sessão (cookie e/ou Bearer) e limpa o cookie.
// O cliente também apaga o token local e navega ao /login.
export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(COOKIE_NAME)?.value || getBearerToken(req);
  if (sessionId) await destroySession(sessionId);
  const res = NextResponse.json({ ok: true });
  clearSessionOn(res);
  return res;
}
