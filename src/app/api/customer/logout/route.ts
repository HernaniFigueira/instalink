import { NextRequest, NextResponse } from 'next/server';
import { CUSTOMER_COOKIE, destroyCustomerSession, clearCustomerSessionOn } from '@/lib/customer-auth';

// POST: encerra a sessão do consumidor.
export async function POST(req: NextRequest) {
  const fromCookie = req.cookies.get(CUSTOMER_COOKIE)?.value;
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const sessionId = fromCookie || (m ? m[1].trim() : '');
  if (sessionId) await destroyCustomerSession(sessionId);
  const res = NextResponse.json({ ok: true });
  clearCustomerSessionOn(res);
  return res;
}
