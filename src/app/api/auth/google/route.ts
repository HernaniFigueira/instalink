import { NextRequest, NextResponse } from 'next/server';
import { popupHtml } from '@/lib/google-auth';

// GET ?slug= — inicia o login com Google (conta do consumidor).
//
// ATIVAÇÃO: crie credenciais OAuth em console.cloud.google.com
// (cliente Web) e defina GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
// Redirect autorizado: {ORIGEM}/api/auth/google/callback
// Sem as variáveis, o popup informa que o Google ainda não foi ativado
// e o consumidor usa e-mail/senha normalmente.
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const slug = req.nextUrl.searchParams.get('slug') || '';
  if (!clientId) {
    return new NextResponse(
      popupHtml('Login com Google ainda não ativado', 'Avise o lojista ou entre com e-mail e senha.'),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  const origin = req.nextUrl.origin;
  const state = Buffer.from(JSON.stringify({ slug })).toString('base64url');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

