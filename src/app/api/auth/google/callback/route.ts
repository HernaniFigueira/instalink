import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { createCustomerSession } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';
import { popupHtml } from '@/lib/google-auth';

// GET ?code=&state= — callback do Google. Localiza/cria o consumidor,
// abre sessão e devolve o token ao popup via postMessage.
export async function GET(req: NextRequest) {
  const html = (title: string, text: string) =>
    new NextResponse(popupHtml(title, text), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const code = req.nextUrl.searchParams.get('code') || '';
    const err = req.nextUrl.searchParams.get('error') || '';
    if (err) return html('Login cancelado', 'Você fechou a janela do Google. Tente de novo.');
    if (!clientId || !clientSecret || !code) {
      return html('Falha no login com Google', 'Configuração incompleta. Entre com e-mail e senha.');
    }

    // 1. Troca o código por tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${req.nextUrl.origin}/api/auth/google/callback`,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return html('Falha no login com Google', 'Tente novamente em instantes.');

    // 2. Dados do perfil
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json();
    if (!info.sub || !info.email) return html('Falha no login com Google', 'Tente novamente em instantes.');

    // 3. Localiza ou cria o consumidor
    const email = String(info.email).toLowerCase();
    const customer = await updateDB((db) => {
      const found = db.customers.find((c) => c.googleId === info.sub || (email && c.email === email));
      if (found) {
        if (!found.googleId) found.googleId = info.sub;
        if (!found.avatar && info.picture) found.avatar = String(info.picture);
        return found;
      }
      const created = {
        id: randomUUID(), name: String(info.name || email.split('@')[0]),
        phone: '', email, passwordHash: '', googleId: String(info.sub),
        avatar: String(info.picture || ''), createdAt: new Date().toISOString(),
      };
      db.customers.push(created);
      return created;
    });

    // 4. Sessão + entrega ao popup (a página-mãe salva o token)
    const sessionId = await createCustomerSession(customer.id);
    const payload = JSON.stringify({ type: 'il-google', token: sessionId, name: customer.name });
    void onlyDigits;
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Entrando…</title></head><body>
<script>
try { window.opener.postMessage(${payload}, window.location.origin); } catch (e) {}
window.close();
</script></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  } catch {
    return html('Falha no login com Google', 'Tente novamente em instantes.');
  }
}
