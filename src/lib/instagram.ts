// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 9 — INSTAGRAM DIRECT (PARTE PURA: PODE IR AO NAVEGADOR)
// ═══════════════════════════════════════════════════════════════
// Só o que a tela e o servidor podem compartilhar: URLs oficiais, escopos,
// política de janela de mensagem, estados honestos do onboarding e a LEITURA do
// webhook. Nada de segredo, nada de `node:crypto`, nada de rede.
//
// Fonte: documentação oficial da Meta para a plataforma do Instagram
// ("Instagram API with Instagram Login" / Business Login for Instagram):
//   • autorização  → https://www.instagram.com/oauth/authorize
//   • token curto  → POST https://api.instagram.com/oauth/access_token
//   • token longo  → GET  https://graph.instagram.com/access_token (ig_exchange_token)
//   • renovar      → GET  https://graph.instagram.com/refresh_access_token (ig_refresh_token)
//   • assinar hook → POST https://graph.instagram.com/{ig-user-id}/subscribed_apps
//   • enviar       → POST https://graph.instagram.com/{ig-user-id}/messages
//   • perfil       → GET  https://graph.instagram.com/{ig-user-id}?fields=name,username,profile_pic
//
// O caminho escolhido NÃO usa Página do Facebook (Instagram Login), diferente
// do Embedded Signup do WhatsApp — por isso nada aqui toca o fluxo do B8.
import type { OnboardingItem, OnboardingLayer } from './whatsapp-onboarding';
import { LATEST_VERIFIED_GRAPH_VERSION } from './whatsapp-onboarding';
import type { InstagramIntegration } from './types';


export type EnvLike = Record<string, string | undefined>;

export const INSTAGRAM_GRAPH_HOST = 'graph.instagram.com';
export const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const INSTAGRAM_CODE_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
export const INSTAGRAM_LONG_LIVED_URL = 'https://graph.instagram.com/access_token';
export const INSTAGRAM_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';

export const INSTAGRAM_CALLBACK_PATH = '/api/instagram/onboarding/callback';
export const INSTAGRAM_WEBHOOK_PATH = '/api/instagram/webhook';

/**
 * Escopos que o produto usa. `instagram_business_basic` é a base (perfil) e
 * `instagram_business_manage_messages` é o que permite ler e responder Direct.
 * NÃO pedimos permissão de comentários/feed: fora do escopo desta entrega.
 */
export const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'] as const;

/** Campos de webhook assinados na conta (mensagens diretas). */
export const INSTAGRAM_WEBHOOK_FIELDS = ['messages'] as const;

export const INSTAGRAM_REQUIRED_ENV = [
  'INSTAGRAM_APP_ID',
  'INSTAGRAM_APP_SECRET',
  'INSTAGRAM_VERIFY_TOKEN',
] as const;

/** Janela de resposta livre da Meta: 24 h desde a última mensagem DO contato. */
export const INSTAGRAM_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Etiqueta HUMAN_AGENT: até 7 dias, para atendimento humano. */
export const INSTAGRAM_HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Texto de uma mensagem: até 1000 bytes (UTF-8), regra da própria API. */
export const INSTAGRAM_TEXT_MAX_BYTES = 1000;

export function instagramGraphBase(version: string): string {
  const v = String(version || LATEST_VERIFIED_GRAPH_VERSION).trim() || LATEST_VERIFIED_GRAPH_VERSION;
  return `https://${INSTAGRAM_GRAPH_HOST}/${v}`;
}

/** URL oficial de autorização (Business Login for Instagram). */
export function instagramAuthorizeUrl(args: {
  appId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(INSTAGRAM_AUTHORIZE_URL);
  url.searchParams.set('client_id', args.appId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', (args.scopes || INSTAGRAM_SCOPES).join(','));
  if (args.state) url.searchParams.set('state', args.state);
  return url.toString();
}

export function instagramRedirectUri(siteUrl: string): string {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return `${base}${INSTAGRAM_CALLBACK_PATH}`;
}

/**
 * Janela de mensagem (política da Meta), a partir da última mensagem RECEBIDA.
 * Sem mensagem do contato não existe janela: a Meta não permite iniciar.
 */
export function instagramMessagingWindow(args: { lastInboundAt?: string; nowISO: string }): {
  phase: 'open' | 'human_agent' | 'closed' | 'unknown';
  canReply: boolean;
  endsAt: string;
  humanAgentUntil: string;
  reason: string;
} {
  const now = Date.parse(args.nowISO || '') || Date.now();
  const last = Date.parse(String(args.lastInboundAt || ''));
  if (!Number.isFinite(last)) {
    return {
      phase: 'unknown', canReply: false, endsAt: '', humanAgentUntil: '',
      reason: 'Ainda não há mensagem deste contato: o Instagram não permite começar a conversa.',
    };
  }
  const endsAt = new Date(last + INSTAGRAM_MESSAGING_WINDOW_MS).toISOString();
  const humanAgentUntil = new Date(last + INSTAGRAM_HUMAN_AGENT_WINDOW_MS).toISOString();
  if (now <= last + INSTAGRAM_MESSAGING_WINDOW_MS) {
    return { phase: 'open', canReply: true, endsAt, humanAgentUntil, reason: 'Janela aberta (24 h desde a última mensagem do contato).' };
  }
  if (now <= last + INSTAGRAM_HUMAN_AGENT_WINDOW_MS) {
    return {
      phase: 'human_agent', canReply: false, endsAt, humanAgentUntil,
      reason: 'Passou das 24 h: a Meta só aceita resposta HUMANA (etiqueta HUMAN_AGENT) até 7 dias após a última mensagem.',
    };
  }
  return {
    phase: 'closed', canReply: false, endsAt, humanAgentUntil,
    reason: 'A janela do Instagram fechou (7 dias). Só é possível responder depois que o contato escrever de novo.',
  };
}

/** Rótulo do estado da integração para o painel e para o inbox. */
export function instagramIntegrationStatus(status: string | undefined): {
  status: 'not_connected' | 'pending' | 'connected' | 'error';
  /** Mesmo vocabulário do painel do WhatsApp (`tone`). */
  tone: 'ok' | 'pending' | 'error' | 'off';
  state: string;
  label: string;
  detail: string;
} {
  switch (status) {
    case 'connected':
      return {
        status: 'connected', tone: 'ok', state: 'connected', label: 'Conectado',
        detail: 'Mensagens diretas chegam em Conversas e podem ser respondidas por lá.',
      };
    case 'waiting_first_event':
      return {
        status: 'pending', tone: 'pending', state: 'waiting_first_event', label: 'Aguardando a primeira mensagem',
        detail: 'A conta está autorizada e o webhook assinado; falta a Meta entregar o primeiro evento.',
      };
    case 'webhook_pending':
      return {
        status: 'pending', tone: 'pending', state: 'webhook_pending', label: 'Falta ativar o webhook',
        detail: 'A conta foi autorizada, mas a Meta ainda não confirmou a assinatura dos eventos.',
      };
    case 'authorization_pending':
      return {
        status: 'pending', tone: 'pending', state: 'authorization_pending', label: 'Autorização em andamento',
        detail: 'A autorização no Instagram começou e não foi concluída.',
      };
    case 'error':
      return {
        status: 'error', tone: 'error', state: 'error', label: 'Erro na conexão',
        detail: 'A última tentativa falhou — veja o motivo e reconecte se precisar.',
      };
    default:
      return {
        status: 'not_connected', tone: 'off', state: 'not_connected', label: 'Não conectado',
        detail: 'Nenhuma conta profissional do Instagram conectada nesta unidade.',
      };
  }
}

// ── Camada da PLATAFORMA ────────────────────────────────────────
/**
 * O que só o dono do Instalink configura. O App ID e o token de verificação
 * são públicos na prática (aparecem no app da Meta), mas o App Secret NUNCA
 * aparece: a tela só sabe se existe.
 */
export function instagramPlatformLayer(env: EnvLike): OnboardingLayer {
  const items: OnboardingItem[] = [
    {
      key: 'INSTAGRAM_APP_ID',
      label: 'App do Instagram (App ID)',
      why: 'Identifica o Instalink na tela oficial de autorização do Instagram.',
      ok: !!env.INSTAGRAM_APP_ID, secret: false, required: true,
    },
    {
      key: 'INSTAGRAM_APP_SECRET',
      label: 'Segredo do app (App Secret)',
      why: 'Troca o código autorizado pelo token da conta e valida a assinatura dos webhooks.',
      ok: !!env.INSTAGRAM_APP_SECRET, secret: true, required: true,
    },
    {
      key: 'INSTAGRAM_VERIFY_TOKEN',
      label: 'Token de verificação do webhook',
      why: 'É o valor que a Meta manda no handshake do webhook desta instalação.',
      ok: !!env.INSTAGRAM_VERIFY_TOKEN
        || !!(env.META_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN), secret: true, required: true,
    },
    {
      key: 'WHATSAPP_CREDENTIALS_KEY',
      label: 'Chave do cofre de credenciais',
      why: 'Criptografa o token da conta em repouso (mesmo cofre do WhatsApp).',
      ok: !!env.WHATSAPP_CREDENTIALS_KEY, secret: true, required: true,
    },
  ];
  const missing = items.filter((i) => i.required && !i.ok).map((i) => i.key);
  return {
    id: 'platform',
    title: 'Plataforma',
    owner: 'Responsável pelo Instalink (não é a sua unidade)',
    items,
    ready: missing.length === 0,
    missing,
  };
}

/** O que a unidade resolve — e o que ela já provou ter. */
export function instagramUnitLayer(business: { instagramIntegration?: InstagramView }): OnboardingLayer {
  const ig = business.instagramIntegration || {};
  const items: OnboardingItem[] = [
    {
      key: 'authorized',
      label: 'Conta autorizada',
      why: 'Alguém da unidade autorizou o Instalink na tela oficial do Instagram.',
      ok: !!ig.encryptedAccessToken && !!ig.igUserId, secret: false, required: true,
    },
    {
      key: 'webhook_subscribed',
      label: 'Webhook assinado',
      why: 'Sem a assinatura desta conta a Meta não entrega as mensagens diretas.',
      ok: !!ig.webhookSubscribedAt, secret: false, required: true,
    },
    {
      key: 'first_event',
      label: 'Primeira mensagem recebida',
      why: 'É a prova de ponta a ponta de que a entrega funciona.',
      ok: !!ig.lastWebhookAt, secret: false, required: false,
    },
  ];
  const missing = items.filter((i) => i.required && !i.ok).map((i) => i.key);
  return {
    id: 'unit',
    title: 'Unidade',
    owner: 'Quem administra esta unidade',
    items,
    ready: missing.length === 0,
    missing,
  };
}

// ── Plano do onboarding ─────────────────────────────────────────
export type InstagramOnboardingState =
  | 'platform_blocked'
  | 'not_connected'
  | 'authorization_pending'
  | 'webhook_pending'
  | 'waiting_first_event'
  | 'connected'
  | 'failed';

export interface InstagramOnboardingStep {
  id: 'authorized' | 'webhook_subscribed' | 'first_event' | 'connected';
  label: string;
  ok: boolean;
  current: boolean;
  detail: string;
}

export function instagramOnboardingSteps(business: { instagramIntegration?: InstagramView }): InstagramOnboardingStep[] {
  const ig = business.instagramIntegration || {};
  const authorized = !!ig.encryptedAccessToken && !!ig.igUserId;
  const subscribed = !!ig.webhookSubscribedAt;
  const firstEvent = !!ig.lastWebhookAt;
  const connected = authorized && subscribed && firstEvent && ig.status === 'connected';
  const steps: InstagramOnboardingStep[] = [
    { id: 'authorized', label: 'Conta autorizada', ok: authorized, current: false, detail: 'A unidade autorizou o Instalink na tela oficial do Instagram.' },
    { id: 'webhook_subscribed', label: 'Webhook assinado', ok: subscribed, current: false, detail: subscribed ? 'A Meta confirmou a entrega dos eventos desta conta.' : 'Falta a Meta confirmar a assinatura dos eventos desta conta.' },
    { id: 'first_event', label: 'Primeira mensagem recebida', ok: firstEvent, current: false, detail: firstEvent ? 'A entrega já foi provada com uma mensagem real.' : 'Peça para alguém enviar um Direct para a conta conectada.' },
    { id: 'connected', label: 'Conectado', ok: connected, current: false, detail: connected ? 'Tudo pronto: conversar e responder pelo inbox.' : 'Falta concluir as etapas anteriores.' },
  ];
  const pending = steps.find((s) => !s.ok);
  if (pending) pending.current = true;
  return steps;
}

/**
 * Visão PARCIAL da integração: a tela pode receber um registro antigo (sem
 * todos os campos) e o planejamento continua valendo.
 */
export type InstagramView = Partial<InstagramIntegration>;

export interface InstagramPlan {
  state: InstagramOnboardingState;
  code: 'OK' | 'BLOCKED_EXTERNAL' | 'UNIT_PENDING' | 'DEGRADED';
  headline: string;
  detail: string;
  layers: OnboardingLayer[];
  steps: InstagramOnboardingStep[];
  nextAction: {
    kind: 'authorize' | 'retry_subscribe' | 'wait_first_event' | 'fix_platform' | 'reconnect' | 'none';
    label: string;
    detail: string;
  };
  /** Só o que o navegador PODE ver (sem segredo). */
  clientConfig: { appId: string; scopes: string[]; redirectUri: string; webhookFields: string[] } | null;
  webhookPath: string;
  statusLabel: ReturnType<typeof instagramIntegrationStatus>;
}

export function instagramPlan(args: {
  env: EnvLike;
  business: { instagramIntegration?: InstagramView };
  siteUrl: string;
}): InstagramPlan {
  const { env, business, siteUrl } = args;
  const platform = instagramPlatformLayer(env);
  const unit = instagramUnitLayer(business);
  const layers = [platform, unit];
  const steps = instagramOnboardingSteps(business);
  const ig = business.instagramIntegration || {};
  const statusLabel = instagramIntegrationStatus(ig.status);
  const webhookPath = INSTAGRAM_WEBHOOK_PATH;
  const clientConfig = platform.ready
    ? {
      appId: String(env.INSTAGRAM_APP_ID || ''),
      scopes: [...INSTAGRAM_SCOPES],
      redirectUri: instagramRedirectUri(siteUrl),
      webhookFields: [...INSTAGRAM_WEBHOOK_FIELDS],
    }
    : null;

  const base = { layers, steps, clientConfig, webhookPath, statusLabel };

  if (!platform.ready) {
    return {
      ...base,
      state: 'platform_blocked',
      code: 'BLOCKED_EXTERNAL',
      headline: 'Conexão do Instagram indisponível nesta instalação',
      detail: `Falta configurar a plataforma: ${platform.missing.join(', ')}. É um bloqueio técnico do Instalink (não é erro da sua unidade) e nenhuma conta pode ser conectada enquanto isso.`,
      nextAction: {
        kind: 'fix_platform',
        label: 'Aguardando a plataforma',
        detail: 'Sem o app do Instagram e o segredo configurados, a autorização oficial não pode começar.',
      },
    };
  }

  if (ig.lastError && ig.status === 'error') {
    return {
      ...base,
      state: 'failed',
      code: 'DEGRADED',
      headline: 'A conexão do Instagram precisa de atenção',
      detail: ig.lastError,
      nextAction: {
        kind: 'reconnect',
        label: 'Reconectar a conta',
        detail: 'A última operação falhou; refaça a autorização oficial para renovar a credencial.',
      },
    };
  }

  if (!ig.encryptedAccessToken || !ig.igUserId) {
    const pending = ig.status === 'authorization_pending';
    return {
      ...base,
      state: pending ? 'authorization_pending' : 'not_connected',
      code: 'UNIT_PENDING',
      headline: pending ? 'Autorização começou e não terminou' : 'Instagram não conectado',
      detail: pending
        ? 'A volta do Instagram não concluiu a troca do código. Refaça a autorização.'
        : 'Conecte a conta profissional do Instagram desta unidade na tela oficial da Meta.',
      nextAction: {
        kind: 'authorize',
        label: pending ? 'Refazer a autorização' : 'Conectar Instagram',
        detail: 'Abre a tela oficial do Instagram para autorizar o Instalink.',
      },
    };
  }

  if (!ig.webhookSubscribedAt) {
    return {
      ...base,
      state: 'webhook_pending',
      code: 'UNIT_PENDING',
      headline: 'Conta autorizada, webhook ainda não ativo',
      detail: 'A credencial já está guardada, mas a Meta ainda não confirmou a entrega dos eventos desta conta.',
      nextAction: {
        kind: 'retry_subscribe',
        label: 'Ativar o webhook agora',
        detail: 'Repete a assinatura oficial da conta (nada é recriado).',
      },
    };
  }

  if (!ig.lastWebhookAt) {
    return {
      ...base,
      state: 'waiting_first_event',
      code: 'UNIT_PENDING',
      headline: 'Tudo pronto — aguardando a primeira mensagem',
      detail: 'Peça para alguém enviar um Direct para a conta conectada: a primeira entrega confirma a conexão.',
      nextAction: {
        kind: 'wait_first_event',
        label: 'Enviar uma mensagem de teste',
        detail: 'A conexão só é declarada quando a Meta entrega a primeira mensagem.',
      },
    };
  }

  return {
    ...base,
    state: 'connected',
    code: 'OK',
    headline: 'Instagram conectado',
    detail: 'As mensagens diretas chegam em Conversas e podem ser respondidas por lá.',
    nextAction: { kind: 'none', label: 'Nada a fazer', detail: 'Use Conversas para responder pelo Instagram.' },
  };
}

// ── Leitura do webhook (formato OFICIAL) ────────────────────────
export type InstagramNotificationKind =
  | 'text' | 'media' | 'unsupported' | 'echo' | 'deleted' | 'self' | 'unknown';

export interface InstagramNotification {
  /** Conta profissional do Instagram (`entry.id`) — identifica o tenant. */
  accountId: string;
  /** Quem escreveu (`sender.id`): o IGSID do contato. */
  participantId: string;
  /** Id oficial da mensagem (`message.mid`) — usado para deduplicar. */
  messageId: string;
  /** Momento informado pela Meta (segundos → ISO). */
  at: string;
  kind: InstagramNotificationKind;
  text: string;
  attachmentTypes: string[];
  /** `true` quando a mensagem é NOSSA (echo) e não deve virar entrada. */
  isEcho: boolean;
  replyToMid: string;
}

export interface InstagramParseResult {
  /** `false` só quando o corpo não é do Instagram (ignorar sem erro). */
  isInstagram: boolean;
  notifications: InstagramNotification[];
  skipped: number;
  error: string;
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'Imagem recebida',
  video: 'Vídeo recebido',
  audio: 'Áudio recebido',
  file: 'Arquivo recebido',
  ig_post: 'Publicação do Instagram compartilhada',
  story: 'Story compartilhado',
  share: 'Publicação compartilhada',
};

/**
 * Lê o corpo do webhook do Instagram. Estrutura (doc oficial):
 * `{ object: "instagram", entry: [{ id, time, messaging: [{ sender, recipient, timestamp, message }] }] }`.
 *
 * Nada de `change`/`changes` aqui: mensagens diretas chegam em `messaging`.
 * Mensagens de ECHO (as nossas) e apagadas são MARCADAS e não viram entrada.
 */
export function parseInstagramWebhook(payload: unknown): InstagramParseResult {
  const body = payload as any;
  if (!body || typeof body !== 'object') {
    return { isInstagram: false, notifications: [], skipped: 0, error: 'Corpo do webhook inválido.' };
  }
  if (String(body.object || '') !== 'instagram') {
    return { isInstagram: false, notifications: [], skipped: 0, error: '' };
  }
  const notifications: InstagramNotification[] = [];
  let skipped = 0;
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const accountId = String(entry?.id || '');
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const event of messaging) {
      const message = event?.message;
      if (!message) { skipped += 1; continue; }
      const senderId = String(event?.sender?.id || '');
      const recipientId = String(event?.recipient?.id || '');
      const isEcho = message.is_echo === true;
      const isDeleted = message.is_deleted === true;
      const isUnsupported = message.is_unsupported === true;
      const attachments = Array.isArray(message.attachments)
        ? message.attachments.map((a: any) => String(a?.type || '')).filter(Boolean)
        : [];
      const text = typeof message.text === 'string' ? message.text : '';
      let kind: InstagramNotificationKind = 'unknown';
      if (isDeleted) kind = 'deleted';
      else if (isEcho) kind = 'echo';
      else if (senderId && accountId && senderId === accountId) kind = 'self';
      else if (isUnsupported) kind = 'unsupported';
      else if (attachments.length > 0) kind = 'media';
      else if (text) kind = 'text';

      // O participante é sempre o OUTRO lado da conversa.
      const participantId = senderId && senderId !== accountId ? senderId : recipientId;
      const ts = Number(event?.timestamp);
      notifications.push({
        accountId,
        participantId,
        messageId: String(message.mid || ''),
        at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : '',
        kind,
        text: text.slice(0, 4000),
        attachmentTypes: attachments,
        isEcho,
        replyToMid: String(message.reply_to?.mid || ''),
      });
    }
  }
  return { isInstagram: true, notifications, skipped, error: '' };
}

/** Corpo HONESTO da mensagem de entrada (nunca finge ter lido o que não veio). */
export function instagramInboundBody(notification: InstagramNotification): string {
  if (notification.kind === 'text') return notification.text;
  if (notification.kind === 'unsupported') {
    return 'Mensagem não suportada pelo canal (o Instagram não enviou o conteúdo).';
  }
  if (notification.kind === 'media') {
    const labels = notification.attachmentTypes.map((t) => MEDIA_LABEL[t] || `Anexo recebido (${t})`);
    const unique = [...new Set(labels)];
    return unique.length > 0 ? unique.join(' · ') : 'Anexo recebido';
  }
  if (notification.kind === 'deleted') return 'Mensagem apagada pelo contato.';
  return 'Mensagem recebida';
}

/** Chave de deduplicação: id oficial quando existe; senão conta+contato+hora. */
export function instagramDedupeKey(notification: InstagramNotification): string {
  if (notification.messageId) return `ig:${notification.messageId}`;
  return `ig:${notification.accountId}:${notification.participantId}:${notification.at}`;
}

/** Chave da conversa do Instagram: conta + participante (nunca nome/telefone). */
export function instagramConversationKey(accountId: string, participantId: string): string {
  return `ig:${accountId}:${participantId}`;
}

/** Corte por BYTES (a API limita o texto a 1000 bytes), sem quebrar caractere. */
export function clipInstagramText(text: string, maxBytes = INSTAGRAM_TEXT_MAX_BYTES): string {
  const value = String(text || '');
  if (new TextEncoder().encode(value).length <= maxBytes) return value;
  let out = '';
  for (const char of value) {
    if (new TextEncoder().encode(out + char).length > maxBytes) break;
    out += char;
  }
  return out;
}
