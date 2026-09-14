// ═══════════════════════════════════════════════════════════════
// SEMÂNTICA HTTP DO PAINEL — 401 ≠ 403 (REGRA DEFINITIVA)
// ═══════════════════════════════════════════════════════════════
//
//   401 → sessão inexistente, expirada ou inválida.
//         ÚNICO caso em que o fluxo de login pode ser iniciado.
//
//   403 → usuário AUTENTICADO, porém sem permissão.
//         NÃO desloga. NÃO limpa token. NÃO redireciona para /login.
//         NÃO invalida a sessão. Mostra mensagem amigável na interface.
//
// Nenhum erro cru de API chega ao usuário: todo status vira uma frase em
// português escrita para o lojista (nunca "Forbidden", nunca stack trace).
//
// Este módulo é PURO (sem I/O e sem DOM): pode ser usado no cliente, em
// helpers de servidor e coberto por testes unitários.

export const STATUS_UNAUTHORIZED = 401;
export const STATUS_FORBIDDEN = 403;

/** O que a aplicação faz com a sessão diante de um status. */
export type SessionFlow = 'login' | 'stay';

/**
 * SOMENTE 401 inicia fluxo de login. 403 (e qualquer outro status) mantém o
 * usuário logado — a resposta é tratada na própria tela.
 */
export function sessionFlowFor(status: number): SessionFlow {
  return status === STATUS_UNAUTHORIZED ? 'login' : 'stay';
}

export function isSessionExpired(status: number): boolean {
  return status === STATUS_UNAUTHORIZED;
}

export function isPermissionDenied(status: number): boolean {
  return status === STATUS_FORBIDDEN;
}

/** `true` apenas quando a aplicação PODE mandar o usuário para o login. */
export function startsLoginFlow(status: number): boolean {
  return sessionFlowFor(status) === 'login';
}

// ── Mensagens canônicas de permissão ─────────────────────────
export const PERMISSION_MESSAGES = {
  action: 'Você não tem permissão para realizar esta ação.',
  area: 'Seu perfil não possui acesso a esta área.',
  adminOnly: 'Esta ação está disponível apenas para administradores.',
  readOnly: 'Você está em modo somente leitura: alterações bloqueadas.',
} as const;

export const SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Entre novamente para continuar.';
export const NETWORK_MESSAGE = 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
export const GENERIC_ERROR_MESSAGE = 'Não foi possível concluir esta ação. Tente novamente.';

/** Escopo da negativa: uma AÇÃO pontual ou uma ÁREA inteira do painel. */
export type DeniedScope = 'action' | 'area';

export interface DeniedContext {
  /** 'action' (botão/mutação) ou 'area' (rota/painel inteiro). */
  scope?: DeniedScope;
  /** Rótulo humano da área (ex.: 'Agenda') — usado apenas como detalhe. */
  area?: string;
  /** A ação exige proprietário/administrador. */
  adminOnly?: boolean;
  /** Sessão de suporte/visualizador em modo somente leitura. */
  readOnly?: boolean;
}

export interface DeniedInfo {
  status: 403;
  /** Frase principal exibida ao usuário (sempre canônica, nunca crua). */
  title: string;
  /** Detalhe opcional (área, ou a explicação amigável vinda do servidor). */
  hint: string;
  /** 403 NUNCA encerra a sessão. */
  keepsSession: true;
}

/**
 * Transforma um 403 em mensagem amigável. A frase principal é SEMPRE uma das
 * mensagens canônicas; o texto vindo do servidor (quando existe e é diferente)
 * entra apenas como detalhe — assim nada cru aparece, mas o lojista ainda
 * entende o motivo específico.
 */
export function deniedInfo(ctx: DeniedContext = {}, serverMessage?: string): DeniedInfo {
  const scope = ctx.scope || 'action';
  let title: string = scope === 'area' ? PERMISSION_MESSAGES.area : PERMISSION_MESSAGES.action;
  if (ctx.readOnly) title = PERMISSION_MESSAGES.readOnly;
  else if (ctx.adminOnly) title = PERMISSION_MESSAGES.adminOnly;

  const detail = String(serverMessage || '').trim();
  const hint = detail && detail !== title
    ? (ctx.area ? `${ctx.area} · ${detail}` : detail)
    : (ctx.area ? `Área: ${ctx.area}` : '');

  return { status: STATUS_FORBIDDEN, title, hint, keepsSession: true };
}

/**
 * Mensagem final para qualquer resposta de API autenticada.
 * `status` 0 representa falha de rede (fetch rejeitado).
 */
export function describeApiError(
  status: number,
  serverMessage?: string,
  ctx: DeniedContext = {},
): string {
  if (status === STATUS_FORBIDDEN) return deniedInfo(ctx, serverMessage).title;
  if (status === STATUS_UNAUTHORIZED) return SESSION_EXPIRED_MESSAGE;
  if (status === 0) return NETWORK_MESSAGE;
  const detail = String(serverMessage || '').trim();
  if (detail) return detail;
  if (status === 429) return 'Muitas tentativas seguidas. Aguarde um instante.';
  if (status === 404) return 'Não encontramos o que você procurava.';
  if (status >= 500) return 'O servidor não respondeu. Tente novamente em instantes.';
  return GENERIC_ERROR_MESSAGE;
}

/**
 * Helper central de resposta autenticada: decide, para QUALQUER chamada do
 * painel, (a) o que a sessão faz e (b) qual mensagem aparece na tela.
 *
 * Regra de ouro: apenas 401 produz `flow: 'login'`.
 */
export interface AuthedResponseDecision {
  ok: boolean;
  status: number;
  flow: SessionFlow;
  /** Preenchido somente em 403. */
  denied: DeniedInfo | null;
  /** Mensagem amigável (vazia quando ok). */
  message: string;
}

export function decideAuthedResponse(
  status: number,
  serverMessage?: string,
  ctx: DeniedContext = {},
): AuthedResponseDecision {
  const ok = status >= 200 && status < 300;
  const denied = status === STATUS_FORBIDDEN ? deniedInfo(ctx, serverMessage) : null;
  return {
    ok,
    status,
    flow: sessionFlowFor(status),
    denied,
    message: ok ? '' : describeApiError(status, serverMessage, ctx),
  };
}

/**
 * Áreas do painel usadas para dar contexto à mensagem de permissão.
 * Mantido aqui (e não em panel.ts) para que o servidor também possa rotular.
 */
export const AREA_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  agenda: 'Agenda',
  clientes: 'Clientes',
  leads: 'Leads',
  pedidos: 'Pedidos',
  catalogo: 'Catálogo',
  servicos: 'Serviços',
  pagina: 'Página',
  agente: 'Agente',
  whatsapp: 'WhatsApp',
  campanhas: 'Campanhas',
  equipe: 'Equipe',
  config: 'Configurações',
  recursos: 'Recursos',
  resultados: 'Resultados',
  financeiro: 'Financeiro',
  admin: 'Administração',
};

export function areaLabel(area?: string): string {
  if (!area) return '';
  return AREA_LABELS[area] || area;
}
