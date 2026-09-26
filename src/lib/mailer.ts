// Envio de e-mail transacional (recuperação de senha, etc).
// Provedor: Resend (https://resend.com) quando RESEND_API_KEY + MAIL_FROM
// estiverem configurados. Sem provedor, opera em modo dev: registra o
// link no log do servidor e retorna ok=false,sent=false para que a UI
// informe o caminho alternativo. Nunca expõe o link ao cliente via API.

export interface MailResult {
  ok: boolean; // fluxo concluído (sem erro técnico)
  sent: boolean; // e-mail realmente despachado pelo provedor
}

export async function sendMail(to: string, subject: string, html: string): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.MAIL_FROM || '';
  if (!apiKey || !from) {
    console.log(`[mailer:dev] para=${to} assunto=${subject}`);
    return { ok: true, sent: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      console.error('[mailer] resend falhou:', res.status);
      return { ok: false, sent: false };
    }
    return { ok: true, sent: true };
  } catch (err) {
    console.error('[mailer] erro de rede:', err);
    return { ok: false, sent: false };
  }
}

export function resetEmailHtml(name: string, link: string, kind: 'lojista' | 'consumidor'): string {
  const first = (name || '').split(' ')[0] || 'você';
  return `<!DOCTYPE html><html lang="pt-BR"><body style="font-family:system-ui,sans-serif;color:#18181b;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 8px">Redefinir sua senha</h2>
<p>Olá, ${first}! Recebemos um pedido de nova senha para sua conta de ${kind} no GoDoutor.</p>
<p><a href="${link}" style="display:inline-block;background:#059669;color:#fff;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:12px">Criar nova senha</a></p>
<p style="color:#71717a;font-size:13px">O link expira em 1 hora e só pode ser usado uma vez. Se você não pediu, ignore este e-mail.</p>
</body></html>`;
}
