// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 8 — ONBOARDING REAL DO WHATSAPP (Embedded Signup)
// ═══════════════════════════════════════════════════════════════
// Antes: a unidade digitava o número, o servidor respondia "peça ao Master" e
// alguém configurava token na mão. Agora a unidade conecta a PRÓPRIA conta no
// fluxo oficial da Meta (Embedded Signup), sem nunca ver um token.
//
// O desenho parte de uma separação que faltava na tela:
//
//   • PLATAFORMA — o que só o dono do produto configura (app da Meta, segredo,
//     chave de criptografia, token de verificação do webhook). Se falta algo
//     aqui, NENHUMA unidade consegue conectar: é bloqueio de plataforma, não
//     culpa do cliente.
//   • UNIDADE — o que a clínica resolve no popup da Meta: escolher a WABA e o
//     número. Depois disso o servidor troca o código pelo token, assina o
//     webhook da WABA e guarda o token CRIPTOGRAFADO.
//
// Este módulo é PURO (planejamento, validação e construção de URLs). As
// chamadas de rede ficam na rota `/api/whatsapp/onboarding`, que é a única que
// vê o segredo do app.
//
// REGRA DE HONESTIDADE (a mesma do P6): nada aqui diz "conectado" sem token
// válido guardado. Sem app configurado, o retorno é BLOCKED_EXTERNAL explícito
// com a lista do que falta — nunca um botão que finge conectar.
// ── Versão da Graph API (conferida na doc oficial) ──────────────
// Datas de disponibilidade publicadas pela Meta, com a origem de cada uma:
//   • v20.0 — disponível até 24/09/2026 (changelog "Available Until").
//   • v21.0 — disponível até 21/01/2027.
//   • v22.0 — disponível até 20/05/2027.
//   • v25.0 — liberada em 18/02/2026.
//   • v26.0 — liberada em 29/07/2026 (última conferida na doc).
export const GRAPH_RELEASES: ReadonlyArray<{ version: string; released?: string; until?: string }> = [
  { version: 'v20.0', until: '2026-09-24' },
  { version: 'v21.0', until: '2027-01-21' },
  { version: 'v22.0', until: '2027-05-20' },
  { version: 'v25.0', released: '2026-02-18' },
  { version: 'v26.0', released: '2026-07-29' },
];

/** Última versão conferida na documentação oficial. */
export const LATEST_VERIFIED_GRAPH_VERSION = 'v26.0';
/** Abaixo desta, a Meta já anunciou fim de vida — o diagnóstico avisa. */
export const MIN_SUPPORTED_GRAPH_VERSION = 'v21.0';

const versionNumber = (v: string) => Number(String(v).replace(/^v/, '').split('.')[0]) || 0;

/** Semáforo da versão configurada (o operador precisa saber antes de quebrar). */
export function graphVersionAdvice(
  current: string,
  todayISO: string,
): { level: 'ok' | 'update' | 'expired' | 'unknown'; message: string } {
  const version = String(current || '').trim();
  if (!version) {
    return { level: 'unknown', message: 'Nenhuma versão da Graph API configurada — uso a padrão do produto.' };
  }
  if (!/^v\d+\.\d+$/.test(version)) {
    return { level: 'unknown', message: `"${version}" não parece uma versão da Graph API (ex.: v26.0).` };
  }
  const release = GRAPH_RELEASES.find((r) => r.version === version);
  if (release?.until && todayISO >= release.until) {
    return {
      level: 'expired',
      message: `${version} Saiu de linha em ${release.until}: a Meta passa a atender a próxima versão disponível. Atualize a variável META_GRAPH_VERSION.`,
    };
  }
  if (release?.until) {
    return {
      level: versionNumber(version) < versionNumber(MIN_SUPPORTED_GRAPH_VERSION) ? 'update' : 'ok',
      message: `${version} está atendida até ${release.until}. ${versionNumber(version) < versionNumber(MIN_SUPPORTED_GRAPH_VERSION) ? 'Programe a atualização.' : ''}`.trim(),
    };
  }
  if (versionNumber(version) < versionNumber(MIN_SUPPORTED_GRAPH_VERSION)) {
    return {
      level: 'update',
      message: `${version} é mais antiga que a ${MIN_SUPPORTED_GRAPH_VERSION} (mínima conferida). Programe a atualização.`,
    };
  }
  if (versionNumber(version) > versionNumber(LATEST_VERIFIED_GRAPH_VERSION)) {
    return {
      level: 'unknown',
      message: `${version} é mais nova que a última conferida aqui (${LATEST_VERIFIED_GRAPH_VERSION}). Confira o changelog da Meta antes de contar com recursos novos.`,
    };
  }
  return { level: 'ok', message: `${version} está em linha (última conferida: ${LATEST_VERIFIED_GRAPH_VERSION}).` };
}

// ── O que é da PLATAFORMA e o que é da UNIDADE ──────────────────
export type EnvLike = Record<string, string | undefined>;

export interface OnboardingItem {
  /** Chave técnica (variável de ambiente ou dado da unidade). */
  key: string;
  label: string;
  /** Por que isso importa, em uma frase. */
  why: string;
  ok: boolean;
  /** Nunca exibir o VALOR no painel — apenas se existe. */
  secret: boolean;
  /** Quando verdadeiro, sem isto nada conecta. */
  required: boolean;
}

export interface OnboardingLayer {
  id: 'platform' | 'unit';
  title: string;
  /** Quem resolve esta camada. */
  owner: string;
  items: OnboardingItem[];
  ready: boolean;
  missing: string[];
}

/**
 * A camada da PLATAFORMA. `META_APP_ID` e `META_CONFIG_ID` são públicos (vão
 * para o SDK no navegador); `META_APP_SECRET` e `WHATSAPP_CREDENTIALS_KEY`
 * NUNCA saem do servidor — aqui só se informa se existem.
 */
export function platformLayer(env: EnvLike): OnboardingLayer {
  const items: OnboardingItem[] = [
    {
      key: 'META_APP_ID',
      label: 'App da Meta (App ID)',
      why: 'Identifica o Instalink no popup oficial de conexão (Embedded Signup).',
      ok: !!env.META_APP_ID, secret: false, required: true,
    },
    {
      key: 'META_CONFIG_ID',
      label: 'Configuração de Login (Config ID)',
      why: 'Diz à Meta quais dados pedir no popup: WABA, número e as permissões de mensagem.',
      ok: !!env.META_CONFIG_ID, secret: false, required: true,
    },
    {
      key: 'META_APP_SECRET',
      label: 'Segredo do app (App Secret)',
      why: 'Troca o código do popup pelo token definitivo da unidade — só no servidor.',
      ok: !!env.META_APP_SECRET, secret: true, required: true,
    },
    {
      key: 'WHATSAPP_CREDENTIALS_KEY',
      label: 'Chave de criptografia das credenciais',
      why: 'Criptografa o token de cada unidade em repouso (AES-256-GCM). Sem ela, nada é gravado.',
      ok: !!env.WHATSAPP_CREDENTIALS_KEY, secret: true, required: true,
    },
    {
      key: 'WHATSAPP_VERIFY_TOKEN',
      label: 'Token de verificação do webhook',
      why: 'É o que a Meta usa para confirmar que o webhook do Instalink é nosso.',
      ok: !!env.WHATSAPP_VERIFY_TOKEN, secret: true, required: true,
    },
  ];
  const missing = items.filter((i) => i.required && !i.ok).map((i) => i.key);
  return {
    id: 'platform',
    title: 'Plataforma (equipe do Instalink)',
    owner: 'Quem administra o Instalink, uma vez só — vale para todas as unidades.',
    items,
    ready: missing.length === 0,
    missing,
  };
}

/** O que a unidade tem (o formato que o store realmente grava). */
export interface UnitIntegrationView {
  status?: string;
  phoneNumberId?: string;
  wabaId?: string;
  encryptedAccessToken?: string;
  displayPhone?: string;
  verifiedName?: string;
  lastWebhookAt?: string;
  lastInboundAt?: string;
  lastError?: string;
  source?: string;
  tokenIssuedAt?: string;
  /** Quando a Meta confirmou a assinatura do webhook desta WABA. */
  webhookSubscribedAt?: string;
  /** Quando o número foi REGISTRADO na Cloud API (sem isto, ele não envia). */
  registeredAt?: string;
  /** Falta registrar (fluxo padrão Cloud API) — estado explícito, não suposição. */
  registrationRequired?: boolean;
  /** O que a Meta disse que este onboarding é. Nunca presumimos coexistence. */
  onboardingType?: 'standard' | 'coexistence' | 'unknown';
  /** Confirmação oficial server-to-server da Meta para Coexistence. */
  coexistenceConfirmedAt?: string;
  isOnBizApp?: boolean;
  platformType?: string;
}

/** A camada da UNIDADE: o que a clínica escolhe no popup e o que o webhook já provou. */
export function unitLayer(business: { whatsappIntegration?: UnitIntegrationView }): OnboardingLayer {
  const wi = business.whatsappIntegration || {};
  const items: OnboardingItem[] = [
    {
      key: 'phoneNumberId',
      label: 'Número oficial escolhido',
      why: 'A Meta devolve o identificador do número no popup; é ele que recebe e envia.',
      ok: !!wi.phoneNumberId, secret: false, required: true,
    },
    {
      key: 'wabaId',
      label: 'Conta WhatsApp Business (WABA)',
      why: 'É a conta que assina o webhook e guarda os modelos de mensagem.',
      ok: !!wi.wabaId, secret: false, required: true,
    },
    {
      key: 'accessToken',
      label: 'Token da unidade guardado',
      why: 'Criptografado no banco; nunca volta para a tela.',
      ok: !!wi.encryptedAccessToken, secret: true, required: true,
    },
    {
      key: 'registration',
      label: 'Número registrado na Cloud API',
      why: 'Enquanto o número não é registrado, ele não envia nem recebe pela API. O registro usa o PIN de duas etapas.',
      ok: !!wi.registeredAt, secret: false, required: true,
    },
    {
      key: 'webhook',
      label: 'Primeiro evento recebido',
      why: 'Prova que a Meta está entregando as mensagens desta unidade no nosso webhook.',
      ok: !!wi.lastWebhookAt, secret: false, required: false,
    },
  ];
  const missing = items.filter((i) => i.required && !i.ok).map((i) => i.key);
  return {
    id: 'unit',
    title: 'Sua unidade',
    owner: 'Você resolve no popup da Meta, em dois minutos.',
    items,
    ready: missing.length === 0,
    missing,
  };
}

// ── 5. As etapas, uma a uma (o painel mostra ESTA sequência) ───
export type OnboardingStepId =
  | 'authorized' | 'webhook_subscribed' | 'phone_resolved' | 'registration' | 'first_event' | 'connected';

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  ok: boolean;
  /** Etapa que o sistema está esperando agora (só uma). */
  current: boolean;
  detail: string;
}

/**
 * A sequência REAL do onboarding, na ordem em que a Meta exige:
 *
 *   AUTHORIZED → WEBHOOK_SUBSCRIBED → PHONE_RESOLVED → REGISTRATION → CONNECTED
 *
 * "Conectado" só quando TUDO o que é obrigatório está provado. Um número sem
 * registro não envia: chamar isso de conectado seria mentira (e é justamente o
 * falso positivo que este bloco corrige).
 */
export function onboardingSteps(business: { whatsappIntegration?: UnitIntegrationView }): OnboardingStep[] {
  const wi = business.whatsappIntegration || {};
  const authorized = !!wi.encryptedAccessToken;
  // COMPROVAÇÃO ESTRITA: nunca considerar webhook assinado apenas porque existem WABA e token.
  // Exige estritamente !!wi.webhookSubscribedAt proveniente da chamada oficial bem-sucedida.
  const subscribed = !!wi.webhookSubscribedAt;
  const phone = !!wi.phoneNumberId;
  const isCoexistence = wi.onboardingType === 'coexistence';
  // Standard: exige registeredAt comprovado com PIN e registrationRequired !== true.
  // Coexistence: exige coexistenceConfirmedAt (prova server-to-server da Meta: is_on_biz_app=true && platform_type=CLOUD_API).
  const registered = isCoexistence
    ? (!!wi.coexistenceConfirmedAt && wi.isOnBizApp === true && wi.platformType === 'CLOUD_API')
    : (!!wi.registeredAt && wi.registrationRequired !== true);
  const firstEvent = !!wi.lastWebhookAt;
  const computed = computeConnectionStatus(wi);
  const connected = computed.connected;

  const steps: OnboardingStep[] = [
    { id: 'authorized', label: 'Conta autorizada', ok: authorized, current: false, detail: 'A unidade autorizou o Instalink no popup oficial da Meta.' },
    { id: 'webhook_subscribed', label: 'Webhook assinado', ok: subscribed, current: false, detail: 'A Meta está autorizada a entregar os eventos desta conta.' },
    { id: 'phone_resolved', label: 'Número encontrado', ok: phone, current: false, detail: 'O identificador do número veio da própria Meta.' },
    {
      id: 'registration',
      label: isCoexistence ? 'Número verificado na Meta (Coexistence)' : 'Número registrado',
      ok: registered,
      current: false,
      detail: registered
        ? (isCoexistence ? 'Coexistência comprovada e verificada na Meta Cloud API.' : 'Registro confirmado na Cloud API.')
        : (isCoexistence
            ? 'Aguardando confirmação oficial da Meta de que o número está ativo no app WhatsApp Business e na Cloud API.'
            : 'Falta registrar o número com o PIN de duas etapas — sem isso ele não envia nem recebe pela API.'),
    },
    { id: 'connected', label: 'Conectado', ok: connected, current: false, detail: connected ? 'Tudo pronto para enviar e receber.' : (computed.reason || 'Falta concluir as etapas anteriores.') },
    { id: 'first_event', label: 'Primeiro evento recebido', ok: firstEvent, current: false, detail: 'Prova de ponta a ponta: a Meta entregou uma mensagem desta conta.' },
  ];
  const pending = steps.find((s) => !s.ok && s.id !== 'first_event');
  if (pending) pending.current = true;
  else {
    const first = steps.find((s) => s.id === 'first_event')!;
    first.current = !first.ok;
  }
  return steps;
}

// ── Plano de onboarding (o que a tela mostra e o que ela pode fazer) ──
export type OnboardingState =
  | 'connected'
  | 'waiting_first_event'
  | 'registration_pending'
  | 'authorized_only'
  | 'platform_blocked'
  | 'ready_for_signup'
  | 'failed';

export interface OnboardingPlan {
  state: OnboardingState;
  headline: string;
  detail: string;
  layers: OnboardingLayer[];
  /** A sequência real, etapa por etapa (o painel mostra ESTA lista). */
  steps: OnboardingStep[];
  /** Próxima ação concreta — a tela usa isto para decidir o botão. */
  nextAction: {
    kind: 'embedded_signup' | 'register_number' | 'master_route' | 'test_connection' | 'fix_platform' | 'none';
    label: string;
    detail: string;
  };
  version: { current: string; level: string; message: string };
  /** Código estável para automação/relatório (BLOCKED_EXTERNAL quando é o caso). */
  code: 'OK' | 'BLOCKED_EXTERNAL' | 'UNIT_PENDING' | 'DEGRADED';
  /** Config que o navegador PODE ver (sem segredo nenhum). */
  clientConfig: { appId: string; configId: string; version: string; redirectUri: string } | null;
}

export function onboardingPlan(args: {
  env: EnvLike;
  business: { whatsappIntegration?: UnitIntegrationView };
  todayISO: string;
}): OnboardingPlan {
  const { env, business, todayISO } = args;
  const platform = platformLayer(env);
  const unit = unitLayer(business);
  const steps = onboardingSteps(business);
  const currentVersion = String(env.META_GRAPH_VERSION || LATEST_VERIFIED_GRAPH_VERSION).trim();
  const version = { current: currentVersion, ...graphVersionAdvice(currentVersion, todayISO) };
  const wi = business.whatsappIntegration || {};
  const clientConfig = platform.ready
    ? {
      appId: String(env.META_APP_ID),
      configId: String(env.META_CONFIG_ID),
      version: currentVersion,
      // redirect_uri do Embedded Signup via JS SDK = string vazia (idêntica na troca).
      redirectUri: embeddedSignupRedirectUri,
    }
    : null;

  const authorized = !!wi.encryptedAccessToken;
  const connected = steps.find((s) => s.id === 'connected')!.ok;
  const registered = !!wi.registeredAt;
  const firstEvent = !!wi.lastWebhookAt;

  // 1. Tudo pronto: conectado de fato (e, sem evento, ainda avisamos).
  if (connected) {
    return {
      state: firstEvent ? 'connected' : 'waiting_first_event',
      headline: firstEvent ? 'WhatsApp conectado' : 'Tudo pronto — aguardando a primeira mensagem',
      detail: firstEvent
        ? 'A conta oficial está recebendo e enviando por aqui.'
        : 'A conta está autorizada, o webhook assinado e o número registrado. Mande uma mensagem para o número oficial para o primeiro evento chegar.',
      layers: [platform, unit],
      steps,
      nextAction: firstEvent
        ? { kind: 'none', label: 'Tudo pronto', detail: 'Use Conversas para responder.' }
        : { kind: 'test_connection', label: 'Testar conexão', detail: 'Confere o token direto na Meta. Não substitui a chegada de um evento real.' },
      version,
      code: 'OK',
      clientConfig,
    };
  }

  // 1.1 Coexistence com verificação pendente ou inconclusiva junto à Meta
  if (authorized && wi.onboardingType === 'coexistence' && !wi.coexistenceConfirmedAt) {
    return {
      state: 'registration_pending',
      headline: 'Verificação de Coexistência pendente',
      detail: wi.lastError || 'A conta foi autorizada no modo Coexistence, mas a Meta ainda não confirmou o status no app WhatsApp Business. Tente novamente ou refaça o fluxo.',
      layers: [platform, unit],
      steps,
      nextAction: {
        kind: 'test_connection',
        label: 'Verificar status na Meta',
        detail: 'Consulta a Graph API para confirmar o status da Coexistência.',
      },
      version,
      code: 'UNIT_PENDING',
      clientConfig,
    };
  }

  // 2. Autorizado, mas falta registrar o número — o falso positivo que virou
  //    estado explícito: sem registro o número NÃO envia pela API.
  if (authorized && !registered) {
    return {
      state: 'registration_pending',
      headline: 'Conta autorizada — falta registrar o número',
      detail: 'A autorização e o webhook estão prontos, mas o número ainda não foi registrado na Cloud API: sem isso ele não envia nem recebe. Informe o PIN de verificação em duas etapas para concluir.',
      layers: [platform, unit],
      steps,
      nextAction: {
        kind: 'register_number',
        label: 'Registrar o número',
        detail: 'Use o PIN de 6 dígitos configurado no WhatsApp Manager.',
      },
      version,
      code: 'UNIT_PENDING',
      clientConfig,
    };
  }

  // 3. Falhou (erro registrado pela Meta).
  if (wi.status === 'error' && wi.lastError) {
    return {
      state: 'failed',
      headline: 'A conexão falhou',
      detail: wi.lastError,
      layers: [platform, unit],
      steps,
      nextAction: platform.ready
        ? {
          kind: 'embedded_signup', label: 'Conectar de novo',
          detail: 'Rode o popup da Meta novamente — o código de autorização vale 30 segundos e é de uso único.',
        }
        : { kind: 'fix_platform', label: 'Aguardando a plataforma', detail: 'Sem o app da Meta configurado não é possível reconectar.' },
      version,
      code: platform.ready ? 'DEGRADED' : 'BLOCKED_EXTERNAL',
      clientConfig,
    };
  }

  // 4. Bloqueio de PLATAFORMA: nada conecta (nem o popup nem o cadastro Master).
  if (!platform.ready) {
    return {
      state: 'platform_blocked',
      headline: 'Falta configurar a plataforma (não é problema da sua unidade)',
      detail: `Sem ${platform.missing.join(', ')} nenhuma unidade consegue conectar. O caminho assistido segue disponível: o Master desta unidade pode cadastrar as credenciais.`,
      layers: [platform, unit],
      steps,
      nextAction: {
        kind: 'fix_platform',
        label: 'Configuração da plataforma pendente',
        detail: 'Enquanto isso, peça ao suporte Master para conectar a conta oficial desta unidade.',
      },
      version,
      code: 'BLOCKED_EXTERNAL',
      clientConfig,
    };
  }

  // 5. Autorizado mas ainda sem número/webhook (troca interrompida no meio).
  if (authorized) {
    return {
      state: 'authorized_only',
      headline: 'Conexão começou e não terminou',
      detail: 'A conta foi autorizada, mas faltam o número e/ou a assinatura do webhook. Refaça o popup para concluir.',
      layers: [platform, unit],
      steps,
      nextAction: { kind: 'embedded_signup', label: 'Conectar com a Meta', detail: 'Rode o popup de novo para terminar a configuração.' },
      version,
      code: 'UNIT_PENDING',
      clientConfig,
    };
  }

  // 6. Pronto para começar.
  return {
    state: 'ready_for_signup',
    headline: 'Conectar sua conta oficial',
    detail: 'Você entra com o Facebook da clínica, escolhe (ou cria) a conta WhatsApp Business e o número. O Instalink recebe o token pelo servidor — você não copia nada.',
    layers: [platform, unit],
    steps,
    nextAction: {
      kind: 'embedded_signup',
      label: 'Conectar com a Meta',
      detail: 'Abre o popup oficial (Embedded Signup).',
    },
    version,
    code: 'UNIT_PENDING',
    clientConfig,
  };
}

// O estado assinado do popup e o appsecret_proof vivem em
// `whatsapp-onboarding-server.ts` (usam node:crypto e não podem entrar no
// bundle do navegador). Este módulo aqui é seguro para os dois lados.

export function computeConnectionStatus(wi: Partial<UnitIntegrationView> | undefined | null): {
  status: 'connected' | 'not_connected' | 'error' | 'pending';
  connected: boolean;
  registrationRequired: boolean;
  onboardingType: 'standard' | 'coexistence' | 'unknown';
  reason?: string;
} {
  if (!wi) {
    return { status: 'not_connected', connected: false, registrationRequired: false, onboardingType: 'unknown', reason: 'Nenhuma integração configurada.' };
  }

  const hasToken = !!wi.encryptedAccessToken;
  const hasWaba = !!wi.wabaId;
  const hasPhone = !!wi.phoneNumberId;
  const hasWebhook = !!wi.webhookSubscribedAt;
  const onboardingType = wi.onboardingType || (wi.coexistenceConfirmedAt ? 'coexistence' : (wi.registeredAt ? 'standard' : 'unknown'));

  // Requisitos comuns: encryptedAccessToken, wabaId, phoneNumberId, webhookSubscribedAt
  if (!hasToken || !hasWaba || !hasPhone || !hasWebhook) {
    return {
      status: wi.status === 'error' ? 'error' : (hasToken || hasPhone || hasWaba || wi.displayPhone ? 'pending' : 'not_connected'),
      connected: false,
      registrationRequired: onboardingType === 'standard' && !wi.registeredAt,
      onboardingType,
      reason: !hasWebhook && (hasToken && hasWaba && hasPhone)
        ? 'Webhook da WABA ainda não assinado na Meta.'
        : 'Credenciais, identificadores ou assinatura de webhook incompletos.',
    };
  }

  // Coexistence: exige onboardingType === 'coexistence' && coexistenceConfirmedAt && isOnBizApp === true && platformType === 'CLOUD_API'
  if (onboardingType === 'coexistence') {
    const coexistenceOk = !!wi.coexistenceConfirmedAt && wi.isOnBizApp === true && wi.platformType === 'CLOUD_API';
    if (!coexistenceOk) {
      return {
        status: wi.status === 'error' ? 'error' : 'pending',
        connected: false,
        registrationRequired: false,
        onboardingType: 'coexistence',
        reason: 'Coexistência não confirmada server-to-server com a Meta (exige is_on_biz_app=true e platform_type=CLOUD_API).',
      };
    }
    return {
      status: 'connected',
      connected: true,
      registrationRequired: false,
      onboardingType: 'coexistence',
    };
  }

  // Standard: exige estritamente onboardingType === 'standard' && registeredAt && registrationRequired !== true
  if (onboardingType === 'standard') {
    const standardOk = !!wi.registeredAt && wi.registrationRequired !== true;
    if (!standardOk) {
      return {
        status: wi.status === 'error' ? 'error' : 'pending',
        connected: false,
        registrationRequired: true,
        onboardingType: 'standard',
        reason: 'Número não registrado com PIN na Cloud API da Meta.',
      };
    }
    return {
      status: 'connected',
      connected: true,
      registrationRequired: false,
      onboardingType: 'standard',
    };
  }

  // Contrato estrito: unknown NÃO é standard!
  // Registros com onboardingType: 'unknown' permanecem 'pending', mesmo com timestamps antigos,
  // até que sejam explicitamente concluídos ou migrados.
  return {
    status: wi.status === 'error' ? 'error' : 'pending',
    connected: false,
    registrationRequired: false,
    onboardingType: 'unknown',
    reason: 'Tipo de onboarding indefinido (unknown). A integração deve ser concluída pelo Embedded Signup oficial.',
  };
}
export interface SignupMessage {
  event: string;
  wabaId: string;
  phoneNumberId: string;
  businessId: string;
  version: number;
  /**
   * Que tipo de onboarding a META disse que é. O Instalink NÃO presume
   * coexistence: sem essa informação explícita, o fluxo tratado é o padrão da
   * Cloud API (que exige registro do número).
   */
  onboardingType: 'standard' | 'coexistence' | 'unknown';
}

/**
 * Lê o `postMessage` do popup. O `phone_number_id` PODE faltar (fluxo de
 * coexistência) — nesse caso a rota descobre pelo WABA, em vez de desistir.
 */
export function parseSignupMessage(raw: unknown): SignupMessage {
  const data = (raw && typeof raw === 'object' ? (raw as any).data : null) || {};
  const event = String(data.event || '');
  const onboardingType: SignupMessage['onboardingType'] =
    event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ? 'coexistence'
      : event.startsWith('FINISH') ? 'standard'
        : 'unknown';
  return {
    event,
    wabaId: String(data.waba_id || ''),
    phoneNumberId: String(data.phone_number_id || ''),
    businessId: String(data.business_id || ''),
    version: Number(data.version) || 0,
    onboardingType,
  };
}

// ── Chamadas do servidor à Meta (nunca no navegador) ────────────
export function graphBase(version: string): string {
  return `https://graph.facebook.com/${String(version).replace(/^\/+|\/+$/g, '')}`;
}

/** URLs usadas na troca do código. Separadas para poder testar sem rede. */
/**
 * redirect_uri do Embedded Signup via Facebook JS SDK.
 *
 * O SDK associa o `code` do FB.login (sem `redirect_uri` nas options) a
 * `redirect_uri=""` — e a Meta exige o MESMO valor no GET /oauth/access_token
 * (OAuth 100/36008 se faltar/divergir). Passar uma URL explícita no FB.login
 * quebra o popup com 191 ("domain of this URL isn't included in the app's
 * domains"), mesmo com App Domains/Valid OAuth Redirect URIs preenchidos.
 *
 * Por isso este fluxo NÃO usa URL de página nem `META_REDIRECT_URI`: o valor é
 * fixo e vazio nos DOIS lados (autorização e troca). Não é enfraquecimento —
 * a validação de igualdade continua no servidor; apenas o valor canônico é "".
 */
export const embeddedSignupRedirectUri = '';

/**
 * URL da troca do código. `redirect_uri` DEVE ser o mesmo valor associado ao
 * code no diálogo OAuth — no Embedded Signup via JS SDK, a string vazia.
 * O parâmetro é sempre enviado (mesmo vazio) para satisfazer o manual-flow.
 */
export function exchangeCodeUrl(
  base: string,
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string,
): string {
  const qs = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
    redirect_uri: redirectUri,
  });
  return `${base}/oauth/access_token?${qs.toString()}`;
}
export function debugTokenUrl(base: string, token: string): string {
  return `${base}/debug_token?input_token=${encodeURIComponent(token)}`;
}
export function wabaPhoneNumbersUrl(base: string, wabaId: string): string {
  return `${base}/${encodeURIComponent(wabaId)}/phone_numbers`;
}
export function subscribeAppUrl(base: string, wabaId: string): string {
  return `${base}/${encodeURIComponent(wabaId)}/subscribed_apps`;
}
export function phoneNumberFieldsUrl(base: string, phoneNumberId: string): string {
  return `${base}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,is_on_biz_app,platform_type`;
}
export function registerNumberUrl(base: string, phoneNumberId: string): string {
  return `${base}/${encodeURIComponent(phoneNumberId)}/register`;
}

/** O WABA pode vir no `debug_token` (granular_scopes) quando o popup não manda. */
export function wabaIdFromDebugToken(payload: unknown): string {
  const scopes = ((payload as any)?.data?.granular_scopes || []) as Array<{ scope?: string; target_ids?: string[] }>;
  const management = scopes.find((s) => s.scope === 'whatsapp_business_management');
  const ids = management?.target_ids || [];
  return ids.length > 0 ? String(ids[0]) : '';
}

/** Primeiro número da WABA (usado quando o popup não devolve o phone_number_id). */
export function firstPhoneNumberId(payload: unknown): string {
  const list = ((payload as any)?.data || []) as Array<{ id?: string }>;
  return list.length > 0 && list[0]?.id ? String(list[0].id) : '';
}

/** Erro legível vindo da Meta (`{ error: { message, code, error_subcode } }`). */
export function metaErrorMessage(payload: unknown, fallback = 'A Meta recusou a operação.'): string {
  const err = (payload as any)?.error;
  if (!err) return fallback;
  const parts = [err.message || err.error_user_msg, err.code ? `código ${err.code}` : '', err.error_subcode ? `subcódigo ${err.error_subcode}` : '']
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : fallback;
}

// ── SDK no navegador (config pública) ───────────────────────────
export const EMBEDDED_SIGNUP_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
/** Código de autorização do popup: uso único e TTL de 30s (doc da Meta). */
export const SIGNUP_CODE_TTL_SECONDS = 30;
/** Evento que o popup manda com WABA/número — origem conferida pelo painel. */
export const SIGNUP_MESSAGE_TYPE = 'WA_EMBEDDED_SIGNUP';
export const SIGNUP_MESSAGE_ORIGIN = 'https://www.facebook.com';

/** Link de teste humano (QR/wa.me). Só TESTE: não passa pelo sistema. */
export function waMeTestLink(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits.replace(/^0+/, '')}`;
}

export const WA_ME_TEST_DISCLAIMER =
  'Abrir pelo wa.me serve apenas para TESTAR a conversa no celular. Por esse caminho a mensagem não entra nem sai pelo sistema — sem histórico, sem automação e sem CRM.';
