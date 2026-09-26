// ═══════════════════════════════════════════════════════════════
// URL DE SAÍDA — validação de destino (SSRF) · P6
// ═══════════════════════════════════════════════════════════════
// Toda URL que o SERVIDOR vai chamar (webhook de saída, conector de canal,
// nó do n8n) passa por aqui antes de virar configuração. Sem isso, um destino
// `http://127.0.0.1:5432` ou `http://169.254.169.254/...` transforma o
// GoDoutor em proxy para a rede interna do host.
//
// Escopo desta função (PURA, sem I/O):
//   • só http/https;
//   • host obrigatório, sem credenciais embutidas (`https://user@host`);
//   • bloqueia loopback, redes privadas (RFC 1918), link-local
//     (incl. metadados de nuvem 169.254.169.254), ULA/link-local IPv6 e
//     hosts internos óbvios (`localhost`, `*.internal`, `*.local`).
//
// ESCAPE HATCH (documentado, para dev/on-prem): em desenvolvimento/teste o
// alvo privado é permitido (os smokes usam receptor em 127.0.0.1); em produção
// é preciso `ALLOW_PRIVATE_OUTBOUND_URLS=1` para liberar. Nada é liberado por
// engano: o padrão em produção é RECUSAR.
//
// LIMITE HONESTO: a checagem é por NOME/IP literal. Um domínio público que
// resolva para IP privado (DNS rebinding) só é bloqueado se a resolução for
// conferida no momento da conexão — fica registrado como resíduo (P6.1).

/** Resultado da inspeção de uma URL de saída — sempre com motivo legível. */
export interface OutboundUrlInspection {
  ok: boolean;
  /** URL normalizada (trim) quando válida. */
  url: string;
  host: string;
  /** O host é privado/reservado? (verdadeiro mesmo quando permitido) */
  private: boolean;
  reason: string;
}

/** Hosts internos por NOME (sem resolução DNS). */
const INTERNAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan'];

export function privateUrlsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.ALLOW_PRIVATE_OUTBOUND_URLS || '').trim() === '1') return true;
  return env.NODE_ENV !== 'production';
}

function ipv4Parts(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return parts;
}

/**
 * O host é privado/reservado? Cobre IPv4 (loopback, 10/8, 172.16/12, 192.168/16,
 * 169.254/16, 0.0.0.0), IPv6 (::1, fc00::/7, fe80::/10) e nomes internos.
 * Função pura — é a única regra de rede do produto.
 */
export function isPrivateOrReservedHost(rawHost: string): boolean {
  const host = String(rawHost || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (host === 'metadata.google.internal' || host === 'metadata') return true;

  const v4 = ipv4Parts(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadados de nuvem
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 privado/reservado (forma expandida ou comprimida).
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true; // fc00::/7 (ULA)
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return true; // fe80::/10 (link-local)
    // IPv4 mapeado (::ffff:10.0.0.1)
    const mapped = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateOrReservedHost(mapped[1]);
    return false;
  }
  return false;
}

/**
 * Inspeciona a URL de destino. Nunca lança: devolve `ok:false` + motivo para
 * quem chama decidir (400 legível na API, log seguro no motor).
 */
export function inspectOutboundUrl(
  raw: string,
  options: { allowPrivate?: boolean } = {},
): OutboundUrlInspection {
  const url = String(raw || '').trim();
  const allowPrivate = options.allowPrivate ?? privateUrlsAllowed();
  const fail = (reason: string, host = ''): OutboundUrlInspection => ({ ok: false, url, host, private: false, reason });
  if (!url) return fail('URL de destino vazia.');
  if (url.length > 2000) return fail('URL de destino muito longa.');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail('URL de destino inválida.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail('A URL de destino precisa ser http:// ou https://.');
  }
  if (!parsed.hostname) return fail('URL de destino sem host.');
  if (parsed.username || parsed.password) {
    return fail('A URL de destino não pode conter usuário/senha embutidos.');
  }

  const host = parsed.hostname.toLowerCase();
  const priv = isPrivateOrReservedHost(host);
  if (priv && !allowPrivate) {
    return {
      ok: false, url, host, private: true,
      reason: 'Destino interno/privado bloqueado por segurança (SSRF).',
    };
  }
  return { ok: true, url, host, private: priv, reason: '' };
}

/** Mesma checagem, mas lançando erro 400 (uso nas rotas de configuração). */
export function assertOutboundUrlAllowed(raw: string, options: { allowPrivate?: boolean } = {}): string {
  const result = inspectOutboundUrl(raw, options);
  if (!result.ok) {
    throw Object.assign(new Error(result.reason), { status: 400 });
  }
  return result.url;
}
