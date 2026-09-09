// Login com Google (conta do consumidor) + HTML simples do popup.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// HTML simples do popup de login com Google.
export function popupHtml(title: string, text: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fafafa;margin:0">
<div style="text-align:center;padding:24px"><h1 style="font-size:18px">${title}</h1><p style="color:#666;font-size:14px">${text}</p>
<button onclick="window.close()" style="margin-top:8px;padding:10px 24px;border-radius:12px;border:0;background:#111827;color:#fff;font-weight:700">Fechar</button>
</div></body></html>`;
}

// ── State anti-CSRF (stateless, HMAC) ──
// state = base64url({ slug, n, e, s }) — s = HMAC(secret, slug.n.e).
// Usa o próprio GOOGLE_CLIENT_SECRET como chave (só existe no servidor).
const STATE_TTL_MS = 10 * 60 * 1000;

function hmacKey(): string {
  return process.env.GOOGLE_CLIENT_SECRET || '';
}

export function signState(slug: string): string {
  const n = randomBytes(16).toString('hex');
  const e = Date.now() + STATE_TTL_MS;
  const payload = `${slug}.${n}.${e}`;
  const s = createHmac('sha256', hmacKey()).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ slug, n, e, s })).toString('base64url');
}

export function verifyState(state: string): { ok: boolean; slug: string } {
  try {
    const d = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
      slug: string; n: string; e: number; s: string;
    };
    if (!d || typeof d.slug !== 'string' || !d.n || !d.e || !d.s) return { ok: false, slug: '' };
    if (Date.now() > d.e) return { ok: false, slug: '' };
    const expect = createHmac('sha256', hmacKey()).update(`${d.slug}.${d.n}.${d.e}`).digest('hex');
    const a = Buffer.from(expect, 'hex');
    const b = Buffer.from(d.s, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, slug: '' };
    return { ok: true, slug: d.slug };
  } catch {
    return { ok: false, slug: '' };
  }
}
