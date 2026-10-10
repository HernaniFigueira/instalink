// ═══════════════════════════════════════════════════════════════
// SESSÃO / UNIDADE ATIVA — UMA leitura de /api/auth/me por navegação
// ═══════════════════════════════════════════════════════════════
// `GET /api/auth/me` responde quem é o usuário, quais unidades ele alcança,
// com que papel e com QUAIS permissões EFETIVAS. Três consumidores do shell
// precisam exatamente disso no primeiro render:
//
//   • DashboardShell  → valida a sessão, monta a navegação e o seletor;
//   • useBusinessId   → confirma que o `?b=` da URL pertence à conta;
//   • usePanelPermissions → projeta permissões para não oferecer porta que o
//     servidor negaria com 403.
//
// Medido no harness de rede (build de produção): cada um buscava por conta
// própria, e o navegador recebia a MESMA resposta duas vezes por navegação
// (agenda, clientes, automações, tarefas, execuções, recursos, canais).
//
// Aqui a régua é a que o shell JÁ usava (`lastContextAt > 5000`):
//   • TTL de 5s — janela em que o contexto não mudou de verdade, então os três
//     consumidores compartilham a MESMA resposta;
//   • `fresh: true` — o sinal explícito de "isto mudou agora" (toggle de
//     módulo/equipe em `godoutor:business-refresh` e o botão Tentar novamente) fura o
//     TTL e busca de novo, como antes;
//   • 401 nunca é cacheado: sessão inválida tem que voltar a bater no servidor;
//   • requisições simultâneas dividem UMA chamada (coalescência em voo);
//   • P0 (fronteira de identidade): o cache é CHAVEADO pela credencial que o
//     cliente apresenta (`getToken()`). Memória do módulo sobrevive a login e
//     logout dentro da SPA — sem esta chave, a resposta da conta A seria
//     servida para a conta B dentro do TTL (foi um dos caminhos do incidente
//     Andrioni → Orlando/Hamburguer Podrão). Login/logout também chamam
//     `resetSessionMeCache()` explicitamente.
//
// SEGURANÇA: isto é APENAS leitura de contexto. A autorização real continua em
// cada rota de API no servidor (`requireBusiness`). Nada aqui concede acesso.
import { STATUS_UNAUTHORIZED } from './http';
import { clearToken, getToken } from './client-auth';

export interface SessionBusiness {
  id: string;
  name?: string;
  slug?: string;
  logo?: string;
  role?: string;
  /** Vínculo clínico da pessoa nesta unidade (projeção, não autorização). */
  professionalId?: string;
  professionalName?: string;
  clinicType?: string;
  permissions?: Record<string, boolean>;
}

export interface SessionMe {
  user?: { id: string; name?: string; email?: string; photo?: string; role?: string };
  businesses?: SessionBusiness[];
  organizations?: Array<{ id: string; name?: string; canManage?: boolean }>;
  isMaster?: boolean;
  support?: { id?: string; businessId?: string; readOnly?: boolean } | null;
  /**
   * Reconciliação P0: quando cookie e Bearer válidos divergiam, diz qual
   * credencial PERDEU ('bearer' = token morto no navegador; 'cookie' = o
   * servidor já o removeu). Campo aditivo, só aparece em conflito.
   */
  staleCredential?: 'bearer' | 'cookie' | null;
  [key: string]: unknown;
}

export interface MeResult {
  ok: boolean;
  /** Status HTTP real (0 = falha de rede) — o shell decide o fluxo por ele. */
  status: number;
  data: SessionMe | null;
}

/** Janela de compartilhamento: a MESMA régua de revalidação do DashboardShell. */
export const ME_TTL_MS = 5000;

let cache: { at: number; key: string; data: SessionMe } | null = null;
let inflight: { key: string; promise: Promise<MeResult>; ticket: object } | null = null;

/**
 * Impressão digital da credencial que o CLIENTE apresenta. É a chave do
 * cache: uma troca de conta (token novo) nunca reaproveita a resposta da
 * conta anterior, nem dentro do TTL. Exportada para o shell/testes.
 */
export function credentialsFingerprint(): string {
  return getToken() || 'no-token';
}

/** Esquece o contexto em cache (usado por testes e pelos fluxos de troca de conta). */
export function resetSessionMeCache(): void {
  cache = null;
  inflight = null;
}

/**
 * Contexto da sessão. `fresh: true` ignora o TTL (mas nunca ignora uma
 * requisição já em voo: dois pedidos simultâneos continuam sendo uma chamada).
 */
export function loadMe(opts: { fresh?: boolean } = {}): Promise<MeResult> {
  const fresh = opts.fresh === true;
  const key = credentialsFingerprint();
  // Cache só vale para a MESMA credencial — troca de conta invalida na hora.
  if (!fresh && cache && cache.key === key && Date.now() - cache.at < ME_TTL_MS) {
    return Promise.resolve({ ok: true, status: 200, data: cache.data });
  }
  // Coalescência apenas da MESMA credencial: uma chamada antiga em voo não
  // pode responder por uma identidade nova.
  if (inflight && inflight.key === key) return inflight.promise;
  const ticket = {};
  const request: Promise<MeResult> = fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(async (r): Promise<MeResult> => {
      if (!r.ok) return { ok: false, status: r.status, data: null };
      const data = (await r.json().catch(() => null)) as SessionMe | null;
      if (!data) return { ok: false, status: r.status, data: null };
      // Reconciliação (P0): o servidor disse que o Bearer PERDEU — o token
      // local é credencial morta e não pode continuar sendo reenviado.
      if (data.staleCredential === 'bearer') clearToken();
      // Só o SUCESSO entra no cache: erro/sessão expirada têm que voltar ao
      // servidor na próxima navegação. O snapshot é gravado com a chave da
      // credencial que o pediu — nunca serve outra conta.
      cache = { at: Date.now(), key, data };
      return { ok: true, status: r.status, data };
    })
    .catch((): MeResult => ({ ok: false, status: 0, data: null }))
    .finally(() => {
      if (inflight && inflight.ticket === ticket) inflight = null;
    });
  inflight = { key, promise: request, ticket };
  return request;
}

/** true quando o status manda o usuário para o login (só 401 — regra do produto). */
export function meNeedsLogin(status: number): boolean {
  return status === STATUS_UNAUTHORIZED;
}
