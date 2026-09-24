import { NextRequest, NextResponse } from 'next/server';
import { readSignupState } from '@/lib/whatsapp-onboarding-server';

// ═══════════════════════════════════════════════════════════════
// RETORNO do dialog/oauth manual (Embedded Signup — manual-flow)
// ═══════════════════════════════════════════════════════════════
// A Meta redireciona o POPUP para cá com ?code=&state= (ou ?error=).
// Este callback NÃO troca o código (a troca continua no POST do painel,
// com a mesma sessão/PIN/WABA já coletados) — ele apenas:
//   1. confere a assinatura/validade do state (HMAC do servidor);
//   2. devolve um tiny HTML que postMessage do code para o opener
//      (mesma origem) e fecha o popup.
// O painel então chama action=exchange com redirectUri = ESTE callback —
// idêntico ao usado no authorize (igualdade exigida pela Meta; 36008 se não).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function html(payload: Record<string, string>, message: string): NextResponse {
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conectando WhatsApp…</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;color:#18181b">
<p>${message}</p>
<script>
(function () {
  var data = ${data};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, window.location.origin);
    }
  } catch (e) { /* popup órfão — o painel trata o timeout */ }
  setTimeout(function () { window.close(); }, 50);
})();
</script>
</body></html>`;
  return new NextResponse(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const code = String(params.get('code') || '').trim();
  const state = String(params.get('state') || '').trim();
  const oauthError = String(params.get('error') || '').trim();

  if (oauthError) {
    return html(
      { type: 'WA_OAUTH_RESULT', ok: '0', reason: oauthError === 'access_denied' ? 'cancelled' : oauthError },
      'A autorização não foi concluída na Meta. Você pode fechar esta janela.',
    );
  }
  if (!code || !state) {
    return html(
      { type: 'WA_OAUTH_RESULT', ok: '0', reason: 'missing_code' },
      'A Meta não devolveu o código de autorização. Feche e tente de novo.',
    );
  }

  // State assinado (unidade + usuário + TTL) — ANTES de repassar o code.
  const secret = String(process.env.WHATSAPP_CREDENTIALS_KEY || '');
  const decoded = readSignupState(state, secret);
  if (!decoded.ok) {
    return html(
      { type: 'WA_OAUTH_RESULT', ok: '0', reason: 'invalid_state' },
      'Estado de conexão inválido ou expirado. Feche e reconecte pela tela.',
    );
  }

  return html(
    { type: 'WA_OAUTH_RESULT', ok: '1', code, state },
    'Autorização recebida. Esta janela vai fechar sozinha…',
  );
}
