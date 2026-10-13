// Consulta de CEP para o autopreenchimento do cadastro.
// Provedor principal: ViaCEP. Reserva: BrasilAPI (só quando o principal falha
// por indisponibilidade, nunca quando ele diz "não encontrado").
// Chamadas externas do NAVEGADOR: não passam pelo servidor do GoDoutor.
// O resultado é sempre tratado como sugestão: o formulário deixa os campos editáveis.

export type CepAddress = { street: string; district: string; city: string; state: string };

export type CepLookupResult =
  | { status: 'found'; address: CepAddress; provider: 'viacep' | 'brasilapi' }
  | { status: 'notfound' }
  | { status: 'unavailable' };

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export const CEP_TIMEOUT_MS = 5000;

const VIACEP = (cep: string) => `https://viacep.com.br/ws/${cep}/json/`;
const BRASILAPI = (cep: string) => `https://brasilapi.com.br/api/cep/v1/${cep}`;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Resposta de erro/aborto do usuário é repassada; falha de rede ou 5xx vira `null` (provedor indisponível). */
async function askProvider<T>(
  url: string,
  fetchFn: FetchLike,
  timeoutMs: number,
  userSignal: AbortSignal | undefined,
  parse: (body: unknown) => T | 'notfound' | null,
): Promise<T | 'notfound' | null> {
  // Prazo próprio por provedor: a reserva não herda o tempo gasto pelo principal.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = userSignal ? AbortSignal.any([userSignal, timeout]) : timeout;
  try {
    const res = await fetchFn(url, { signal });
    if (res.status === 404) return 'notfound';
    if (!res.ok) return null;
    return parse(await res.json());
  } catch (err) {
    // Cancelamento do formulário propaga; timeout ou rede = provedor indisponível.
    if (userSignal?.aborted) throw err;
    return null;
  }
}

export async function lookupCep(
  rawCep: string,
  opts: { fetch?: FetchLike; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CepLookupResult> {
  const cep = String(rawCep ?? '').replace(/\D/g, '');
  if (cep.length !== 8) return { status: 'notfound' };
  const fetchFn: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? CEP_TIMEOUT_MS;
  if (opts.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');

  // 1) ViaCEP — responde 200 com { erro: true } quando o CEP não existe.
  const via = await askProvider<CepAddress>(VIACEP(cep), fetchFn, timeoutMs, opts.signal, (body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.erro === true || b.erro === 'true') return 'notfound';
    const address = { street: str(b.logradouro), district: str(b.bairro), city: str(b.localidade), state: str(b.uf).toUpperCase() };
    return address.city || address.state ? address : null;
  });
  if (via === 'notfound') return { status: 'notfound' };
  if (via) return { status: 'found', address: via, provider: 'viacep' };

  // 2) BrasilAPI — reserva quando o ViaCEP não respondeu.
  const bra = await askProvider<CepAddress>(BRASILAPI(cep), fetchFn, timeoutMs, opts.signal, (body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const address = { street: str(b.street), district: str(b.neighborhood), city: str(b.city), state: str(b.state).toUpperCase() };
    return address.city || address.state ? address : null;
  });
  if (bra === 'notfound') return { status: 'notfound' };
  if (bra) return { status: 'found', address: bra, provider: 'brasilapi' };
  return { status: 'unavailable' };
}
