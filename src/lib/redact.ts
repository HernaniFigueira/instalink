// ═══════════════════════════════════════════════════════════════
// F3-I · REDACTION central — logs/errors externos sem segredo
// ═══════════════════════════════════════════════════════════════
// Campos proibidos (chave case-insensitive):
// token, secret, authorization, password, cookie, appSecret, accessToken,
// access_token, refresh_token, apiKey, api_key, private_key, session.
//
// Uso: `redactSensitive(err.message)`, `redactSensitive(payload)` antes de
// gravar em log/audit/UI de erro. Telefone/nome podem passar quando o
// contexto operacional exigir — aqui o alvo é SEGREDO, não PII operacional.

const FORBIDDEN_KEY_RE = /^(authorization|auth|token|secret|password|passwd|pwd|cookie|appsecret|accesstoken|access_token|refreshtoken|refresh_token|apikey|api_key|private_key|session|signature|x-hub-signature(?:-256)?)$/i;

const FORBIDDEN_VALUE_HINTS: RegExp[] = [
  /^Bearer\s+/i,
  /^EAAG/i, // Meta access token prefix
  /^EAA/i,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
];

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_RE.test(key) || FORBIDDEN_KEY_RE.test(key.replace(/([a-z])([A-Z])/g, '$1_$2'));
}

function redactString(s: string): string {
  let out = s;
  for (const re of FORBIDDEN_VALUE_HINTS) {
    out = out.replace(re, '[REDACTED]');
  }
  // Padrões clássicos de token embutidos em texto livre
  out = out.replace(/\b(EAA[A-Za-z0-9]{10,})\b/g, '[REDACTED]');
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]');
  out = out.replace(/((?:^|[?&\s])(access_token|token|app_secret|secret|apikey|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
  out = out.replace(/\b(access_token|app_secret)=([^&\s]+)/gi, '$1=[REDACTED]');
  return out;
}

/**
 * Deep-redact de qualquer valor destinado a log/audit/erro externo.
 * • chaves sensíveis → '[REDACTED]'
 * • strings com prefixo de token → sanitizada
 * • profundidade limitada (não explode payload)
 * • arrays/objetos clonados (não muta o original)
 */
export function redactSensitive<T>(value: T, depth = 0): T {
  if (depth > 6) return '[TRUNCATED]' as unknown as T;
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactSensitive(v, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitive(v, depth + 1);
      }
    }
    return out as unknown as T;
  }
  return value;
}

/** Mensagem de erro pronta p/ log externo (nunca vaza Authorization header). */
export function safeErrorMessage(err: unknown, max = 400): string {
  let raw = '';
  if (err instanceof Error) raw = err.message || err.name || 'erro';
  else if (typeof err === 'string') raw = err;
  else if (err && typeof err === 'object') {
    try {
      raw = JSON.stringify(redactSensitive(err));
    } catch {
      raw = 'erro ao serializar';
    }
  } else raw = String(err ?? 'erro');
  return redactString(raw).slice(0, max);
}
