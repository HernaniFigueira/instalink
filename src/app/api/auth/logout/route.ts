import { NextRequest, NextResponse } from 'next/server';
import { clearSessionOn, destroySessions, presentedSessionIds } from '@/lib/auth';

// POST — encerra a sessão e limpa o cookie.
//
// P0 (fronteira de identidade): o logout encerra TODAS as credenciais que este
// navegador apresentou — cookie httpOnly E Bearer — não apenas a primeira.
// Antes, cookie e Bearer apontando para contas diferentes deixavam uma sessão
// viva no servidor depois do "sair"; se qualquer cookie sobrevivesse ao
// navegador (iframe/partition), a identidade anterior voltava a valer.
// O cliente também apaga o token local e navega ao /login.
export async function POST(req: NextRequest) {
  await destroySessions(presentedSessionIds(req));
  const res = NextResponse.json({ ok: true });
  clearSessionOn(res);
  return res;
}
