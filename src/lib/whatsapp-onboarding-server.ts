// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 8 — PEÇAS DE SERVIDOR DO ONBOARDING (node:crypto)
// ═══════════════════════════════════════════════════════════════
// Separado de `whatsapp-onboarding.ts` de propósito: aquele módulo é importado
// pelo painel (navegador) e não pode puxar `node:crypto` para o bundle. Aqui
// ficam só o estado assinado do popup e o appsecret_proof — ambos com segredo
// do servidor, jamais no cliente.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ── Estado do popup (CSRF do retorno) ───────────────────────────
// O popup volta para a mesma página; sem isto, um código de outra sessão poderia
// ser trocado no lugar do nosso. O estado é assinado com segredo do servidor.
export const SIGNUP_STATE_TTL_MS = 30 * 60 * 1000; // 30 minutos

export function issueSignupState(secret: string, now: number = Date.now()): string {
  const nonce = randomBytes(12).toString('hex');
  const payload = `${now}.${nonce}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifySignupState(
  state: string,
  secret: string,
  now: number = Date.now(),
  ttlMs: number = SIGNUP_STATE_TTL_MS,
): { ok: boolean; reason: string } {
  const parts = String(state || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Estado do popup ausente ou malformado.' };
  const [ts, nonce, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${ts}.${nonce}`).digest('hex').slice(0, 32);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Estado do popup não confere — recomece a conexão.' };
  }
  const issued = Number(ts);
  if (!Number.isFinite(issued) || now - issued > ttlMs || issued - now > 60_000) {
    return { ok: false, reason: 'O popup ficou aberto tempo demais — recomece a conexão.' };
  }
  return { ok: true, reason: '' };
}

/**
 * HMAC do token com o segredo do app (`appsecret_proof`). A própria Meta
 * recomenda enviar isto em toda chamada com token: um token vazado deixa de
 * ser suficiente por si só.
 */
export function appsecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

