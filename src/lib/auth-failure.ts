import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

/** Deliberately never log the error object, request, user, headers or environment. */
export function authUnavailable(stage: 'login_read' | 'login_session' | 'login_audit' | 'session_lookup') {
  const requestId = randomUUID();
  console.error(JSON.stringify({ event: 'auth_unavailable', stage, requestId }));
  return NextResponse.json({
    error: 'O serviço de acesso está temporariamente indisponível. Tente novamente em instantes.',
    code: 'AUTH_UNAVAILABLE', requestId,
  }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'Retry-After': '30' } });
}
