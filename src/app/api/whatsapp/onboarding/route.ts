// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 8 (+ correção) — ONBOARDING DO WHATSAPP
// ═══════════════════════════════════════════════════════════════
// GET  → o plano em duas camadas (plataforma × unidade), a sequência de etapas
//        e o estado assinado do popup. Nada de segredo: só se cada requisito
//        EXISTE.
// POST → 'exchange': recebe o código do Embedded Signup e faz, no servidor, o
//        que a unidade não pode fazer sozinha:
//
//          1. troca o código pelo token da conta (oauth/access_token);
//          2. **confere o token com a Meta** — válido, do NOSSO app e com as
//             permissões necessárias (debug_token);
//          3. confere que a WABA informada está entre as AUTORIZADAS;
//          4. confere que o número pertence ÀQUELA WABA (a Graph API é a
//             autoridade — o que veio do navegador é pista, não prova);
//          5. assina o webhook na WABA (sem isso não chega mensagem);
//          6. registra o número com o PIN de duas etapas (o registro é o que
//             habilita o número a enviar e receber pela API);
//          7. criptografa o token e grava na unidade.
//        'register': conclui depois o registro do número, com o token guardado.
//
// O token NUNCA volta na resposta. O código do Embedded Signup é de uso único e
// vive 30 segundos: se a troca falhar, a unidade recomeça o popup — a rota diz
// isso em vez de tentar de novo com um código morto.
//
// REGRA DE HONESTIDADE (corrigida nesta rodada): **autorizado ≠ conectado**. O
// número só é registrado com o PIN; sem prova de registro, o estado é
// `registration_pending` — antes, um número não registrado aparecia como
// "conectado" e simplesmente não enviava.
import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { effectiveTimezone, todayISO } from '@/lib/tz';
import { defaultWhatsappIntegration } from '@/lib/whatsapp';
import { decryptSecret, encryptSecret, getMetaGraphVersion } from '@/lib/whatsapp-cloud-api';
import {
  computeConnectionStatus, debugTokenUrl, exchangeCodeUrl, firstPhoneNumberId, graphBase,
  metaErrorMessage, onboardingPlan, parseSignupMessage, phoneNumberFieldsUrl, platformLayer, registerNumberUrl,
  subscribeAppUrl, wabaIdFromDebugToken, wabaPhoneNumbersUrl, whatsappAuthorizeUrl, whatsappRedirectUri,
  type UnitIntegrationView,
} from '@/lib/whatsapp-onboarding';
import { appsecretProof, issueSignupState, verifySignupState } from '@/lib/whatsapp-onboarding-server';

/** Permissões que o token da unidade PRECISA ter para o canal funcionar. */
const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging'];
/** Teto do código do popup (a Meta expira em 30s; isto é só sanidade). */
const MAX_CODE_LEN = 1024;

/** Origem estável do site — mesma base do authorize e do exchange. */
function siteUrl(req: NextRequest): string {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').trim();
  return (configured || req.nextUrl.origin).replace(/\/+$/, '');
}

function planFor(
  business: { businessTimezone?: string; whatsappIntegration?: UnitIntegrationView },
  requestOrigin = '',
) {
  return onboardingPlan({
    env: process.env,
    business,
    todayISO: todayISO(new Date(), effectiveTimezone(business.businessTimezone)),
    requestOrigin,
  });
}

/**
 * O plano DEPOIS da gravação: o objeto lido no começo do request já está
 * velho quando a Meta responde — e a tela precisa ver o estado real (senão
 * ela mostra "pronto para conectar" com a conta já autorizada).
 */
async function freshPlan(businessId: string, fallback: { businessTimezone?: string }, requestOrigin = '') {
  const db = await readDB();
  const fresh = db.businesses.find((b) => b.id === businessId);
  return fresh ? planFor(fresh, requestOrigin) : planFor(fallback, requestOrigin);
}

async function graphJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok && !data?.error, status: res.status, data };
}

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;

  const origin = siteUrl(req);
  const plan = planFor(guard.ctx.business, origin);
  const credentialsKey = String(process.env.WHATSAPP_CREDENTIALS_KEY || '');
  const signupState = plan.clientConfig
    ? issueSignupState(credentialsKey, { businessId: guard.ctx.business.id, userId: guard.ctx.user.id })
    : '';
  // Manual OAuth: URL do diálogo com o MESMO redirect_uri que o exchange usará.
  const authorizeUrl = plan.clientConfig && signupState
    ? whatsappAuthorizeUrl({
      appId: plan.clientConfig.appId,
      configId: plan.clientConfig.configId,
      version: plan.clientConfig.version,
      redirectUri: plan.clientConfig.redirectUri,
      state: signupState,
    })
    : '';
  // Camada da plataforma só é detalhada para Master/Admin
  const canViewDiagnostics = guard.ctx.isMaster || guard.ctx.isOwner || guard.ctx.role === 'ADMIN';

  return NextResponse.json({
    plan: {
      ...plan,
      layers: canViewDiagnostics
        ? plan.layers
        : plan.layers.filter((l) => l.id !== 'platform'),
    },
    // Estado assinado, ligado À UNIDADE e AO USUÁRIO que pediu o popup.
    signupState,
    authorizeUrl,
    // Caminho assistido continua valendo (o Master cadastra as credenciais).
    masterRouteAvailable: canViewDiagnostics,
    webhookPath: canViewDiagnostics ? '/api/whatsapp/webhook' : undefined,
  });
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const businessId = String(body.businessId || '');
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;
  const { user, business } = guard.ctx;
  const requestOrigin = siteUrl(req);

  const action = String(body.action || 'exchange');
  if (action !== 'exchange' && action !== 'register') {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  }

  // ── 0. A plataforma está pronta? ───────────────────────────────
  const platform = platformLayer(process.env);
  if (!platform.ready) {
    await updateDB((db) => {
      pushAudit(db, {
        action: 'whatsapp.onboarding_blocked',
        actor: user,
        businessId,
        meta: { missing: platform.missing, reason: 'platform_not_configured', action },
      });
    });
    return NextResponse.json({
      error: 'O onboarding oficial do WhatsApp ainda não está habilitado nesta instalação — falta configurar a plataforma. Nada foi alterado na sua unidade.',
      code: 'platform_not_configured',
      external: 'BLOCKED_EXTERNAL',
      missing: platform.missing,
      plan: planFor(business, requestOrigin),
      masterRouteAvailable: true,
    }, { status: 503 });
  }

  const appId = String(process.env.META_APP_ID || '');
  const appSecret = String(process.env.META_APP_SECRET || '');
  const secretKey = String(process.env.WHATSAPP_CREDENTIALS_KEY || '');
  const base = graphBase(getMetaGraphVersion());
  /** redirect_uri canônico = authorize (manual dialog) — idêntico no exchange. */
  const expectedRedirectUri = whatsappRedirectUri(requestOrigin);

  // ═════════════════════════════════════════════════════════════
  // action: register — concluir o registro do número depois da autorização
  // ═════════════════════════════════════════════════════════════
  if (action === 'register') {
    const wi = business.whatsappIntegration;
    const isCoexistenceConfirmed = wi?.onboardingType === 'coexistence' &&
      !!wi?.coexistenceConfirmedAt &&
      wi?.isOnBizApp === true &&
      wi?.platformType === 'CLOUD_API';

    if (isCoexistenceConfirmed) {
      return NextResponse.json({
        error: 'Esta conta foi integrada e comprovada no modo Coexistence oficial: o número já é registrado pelo aplicativo WhatsApp Business e não requer PIN.',
        code: 'coexistence_no_register_needed',
        plan: planFor(business, requestOrigin),
      }, { status: 400 });
    }

    // Se o cliente alegou Coexistence mas a verificação server-to-server ainda está pendente ou inconclusiva
    const isCoexistencePending = wi?.onboardingType === 'coexistence' && !isCoexistenceConfirmed;
    if (isCoexistencePending) {
      return NextResponse.json({
        error: 'A conta está com verificação de Coexistência pendente junto à Meta. Não é permitido registrar com PIN enquanto o status no aplicativo WhatsApp Business não for resolvido com segurança. Tente verificar o status novamente ou refaça o Embedded Signup.',
        code: 'coexistence_verification_pending',
        plan: planFor(business, requestOrigin),
      }, { status: 400 });
    }

    const stored = decryptSecret(String(business.whatsappIntegration?.encryptedAccessToken || ''));
    const phoneNumberId = String(business.whatsappIntegration?.phoneNumberId || '');
    if (!stored || !phoneNumberId) {
      return NextResponse.json({
        error: 'Esta unidade ainda não tem conta autorizada para registrar um número. Rode o popup da Meta primeiro.',
        code: 'not_authorized',
        plan: planFor(business, requestOrigin),
      }, { status: 409 });
    }
    const pin = String(body.pin || '').replace(/\D/g, '');
    if (pin.length !== 6) {
      return NextResponse.json({ error: 'O PIN de verificação em duas etapas tem 6 dígitos.', code: 'invalid_pin' }, { status: 400 });
    }
    const reg = await graphJson(registerNumberUrl(base, phoneNumberId), {
      method: 'POST',
      headers: { authorization: `Bearer ${stored}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin, appsecret_proof: appsecretProof(stored, appSecret) }),
    });
    const now = new Date().toISOString();
    if (!reg.ok) {
      const why = metaErrorMessage(reg.data, 'a Meta recusou o registro do número.');
      await updateDB((db) => {
        const b = db.businesses.find((x) => x.id === businessId);
        if (b?.whatsappIntegration) {
          b.whatsappIntegration.status = 'pending';
          b.whatsappIntegration.registrationRequired = true;
          b.whatsappIntegration.lastError = `Registro do número: ${why}`;
          b.whatsappIntegration.lastErrorAt = now;
        }
        pushAudit(db, {
          action: 'whatsapp.onboarding_failed', actor: user, businessId,
          meta: { reason: 'register_failed', step: 'register' },
        });
      });
      return NextResponse.json({
        error: `Não consegui registrar o número: ${why}`,
        code: 'register_failed',
        plan: planFor(business, requestOrigin),
      }, { status: 400 });
    }
    await updateDB((db) => {
      const b = db.businesses.find((x) => x.id === businessId);
      if (b?.whatsappIntegration) {
        const wi = b.whatsappIntegration;
        wi.registeredAt = now;
        wi.registrationRequired = false;
        wi.lastError = undefined;
        wi.lastErrorAt = undefined;
        // Centralização: avalia pelo computeConnectionStatus
        const computed = computeConnectionStatus(wi as UnitIntegrationView);
        wi.status = computed.status;
        if (computed.connected && !wi.connectedAt) wi.connectedAt = now;
      }
      pushAudit(db, {
        action: 'whatsapp.connected', actor: user, businessId,
        meta: { via: 'register_pin', graphVersion: getMetaGraphVersion() },
      });
    });
    return NextResponse.json({
      ok: true,
      message: 'Número registrado. Mande uma mensagem para ele para confirmar a entrega.',
      plan: await freshPlan(businessId, business, requestOrigin),
    });
  }

  // ═════════════════════════════════════════════════════════════
  // action: exchange — trocar o código do popup pelo token e terminar a ligação
  // ═════════════════════════════════════════════════════════════

  // ── 1. O retorno é do NOSSO popup, DESTA unidade e DESTE usuário? ──
  const stateCheck = verifySignupState(String(body.state || ''), secretKey, {
    businessId,
    userId: guard.ctx.user.id,
  });
  if (!stateCheck.ok) {
    return NextResponse.json({ error: stateCheck.reason, code: 'signup_state_invalid' }, { status: 400 });
  }

  const code = String(body.code || '').trim();
  if (!code) {
    return NextResponse.json({
      error: 'O popup não devolveu o código de autorização. Recomece a conexão — o código vale 30 segundos.',
      code: 'missing_code',
    }, { status: 400 });
  }
  if (code.length > MAX_CODE_LEN) {
    return NextResponse.json({ error: 'Código de autorização fora do formato esperado.', code: 'invalid_code' }, { status: 400 });
  }

  // O popup manda o WABA e (às vezes) o número; são PISTAS, não autoridade.
  const msg = parseSignupMessage({ data: body.signup || {} });
  let wabaId = String(body.wabaId || msg.wabaId || '');
  let phoneNumberId = String(body.phoneNumberId || msg.phoneNumberId || '');

  async function fail(reason: string, extra: Record<string, unknown> = {}) {
    await updateDB((db) => {
      pushAudit(db, {
        action: 'whatsapp.onboarding_failed',
        actor: user,
        businessId,
        meta: { reason, wabaId: wabaId ? 'presente' : 'ausente', phoneNumberId: phoneNumberId ? 'presente' : 'ausente' },
      });
    });
    return NextResponse.json({
      error: reason, code: 'onboarding_failed', plan: planFor(business, requestOrigin), ...extra,
    }, { status: 400 });
  }

  // ── 2. Troca do código pelo token (server-to-server) ───────────
  // O redirect_uri do exchange DEVE ser idêntico ao do dialog/oauth (manual-flow).
  // Divergência (vazio, outra URL, trailing slash) = Meta 36008 — recusamos ANTES.
  const bodyRedirectUri = String((body as { redirectUri?: unknown }).redirectUri ?? '').trim();
  if (bodyRedirectUri !== expectedRedirectUri) {
    return fail('redirect_uri divergente do esperado pelo servidor (OAuth). Recomece a conexão.');
  }
  const exchanged = await graphJson(
    exchangeCodeUrl(base, appId, appSecret, code, expectedRedirectUri),
  );
  const token = String(exchanged.data?.access_token || '');
  if (!exchanged.ok || !token) {
    return fail(
      `Não consegui autorizar a conta junto à Meta: ${metaErrorMessage(exchanged.data, 'código recusado (ele vale 30 segundos e só pode ser usado uma vez).')} Recomece a conexão.`,
    );
  }
  const proof = appsecretProof(token, appSecret);

  // ── 3. O TOKEN é válido, é do nosso app e tem as permissões? ───
  // A Graph API é a autoridade: nada de confiar no que o navegador mandou.
  const appToken = `${appId}|${appSecret}`;
  const debug = await graphJson(debugTokenUrl(base, token), {
    headers: { authorization: `Bearer ${appToken}` },
  });
  if (!debug.ok) {
    return fail(`Não consegui conferir a autorização junto à Meta: ${metaErrorMessage(debug.data, 'falha na inspeção do token.')}`);
  }
  const debugData = debug.data?.data || {};
  if (debugData.is_valid !== true) {
    return fail('A autorização recebida não é válida na Meta. Recomece a conexão pelo popup.');
  }
  if (debugData.app_id && String(debugData.app_id) !== appId) {
    return fail('A autorização veio de outro aplicativo da Meta — recomece a conexão por aqui.');
  }
  const scopes: string[] = Array.isArray(debugData.scopes)
    ? debugData.scopes
    : (Array.isArray(debugData.granular_scopes) ? debugData.granular_scopes.map((s: any) => String(s.scope || '')) : []);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    return fail(
      `A autorização não trouxe as permissões necessárias para o canal (${missingScopes.join(', ')}). Refaça o popup escolhendo a conta e o número da clínica.`,
    );
  }

  // ── 4. A WABA informada está entre as AUTORIZADAS? ─────────────
  const allowedWabas = new Set<string>();
  for (const scope of (debugData.granular_scopes || []) as Array<{ scope?: string; target_ids?: string[] }>) {
    if (scope?.scope === 'whatsapp_business_management') {
      for (const id of scope.target_ids || []) allowedWabas.add(String(id));
    }
  }
  if (wabaId && allowedWabas.size > 0 && !allowedWabas.has(wabaId)) {
    return fail('A conta autorizada não inclui a WhatsApp Business Account informada. Refaça o popup escolhendo a conta certa.');
  }
  if (!wabaId) {
    wabaId = wabaIdFromDebugToken(debug.data) || [...allowedWabas][0] || '';
  }
  if (!wabaId) {
    return fail('A conta autorizada não trouxe nenhuma WhatsApp Business Account (WABA). Confira se você escolheu a conta certa no popup da Meta.');
  }
  if (allowedWabas.size > 0 && !allowedWabas.has(wabaId)) {
    return fail('A conta autorizada não inclui essa WhatsApp Business Account. Recomece a conexão escolhendo a conta da clínica.');
  }

  // ── 5. O NÚMERO pertence a ESSA WABA? ──────────────────────────
  const phones = await graphJson(
    `${wabaPhoneNumbersUrl(base, wabaId)}?access_token=${encodeURIComponent(token)}&appsecret_proof=${proof}`,
  );
  if (!phones.ok) {
    return fail(`Não consegui listar os números da conta: ${metaErrorMessage(phones.data, 'falha ao consultar a Meta.')}`);
  }
  const wabaPhoneIds: string[] = (((phones.data?.data || []) as Array<{ id?: string }>).map((p) => String(p.id || ''))).filter(Boolean);
  if (phoneNumberId && !wabaPhoneIds.includes(phoneNumberId)) {
    return fail('O número informado não pertence a essa conta WhatsApp Business. Refaça o popup escolhendo o número da clínica.');
  }
  if (!phoneNumberId) {
    phoneNumberId = firstPhoneNumberId(phones.data);
  }
  if (!phoneNumberId) {
    return fail('A conta escolhida não tem número de telefone pronto para uso. Termine a configuração no WhatsApp Manager e tente de novo.');
  }

  // ── 6. Assinar o webhook na WABA ───────────────────────────────
  // Sem assinatura a Meta não entrega nada — por isso isto é checado aqui, e
  // não depois, quando alguém já estaria esperando mensagem chegar.
  const subscribe = await graphJson(subscribeAppUrl(base, wabaId), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ appsecret_proof: proof }),
  });
  if (!subscribe.ok) {
    const why = metaErrorMessage(subscribe.data, 'a Meta recusou a assinatura do webhook.');
    // Guarda o token (ele é válido) mas deixa a unidade como PENDENTE: falta o
    // webhook para a integração servir para algo.
    const encrypted = encryptSecret(token);
    const now = new Date().toISOString();
    await updateDB((db) => {
      const b = db.businesses.find((x) => x.id === businessId);
      if (b) {
        b.whatsappIntegration = {
          ...(b.whatsappIntegration || defaultWhatsappIntegration()),
          status: 'pending',
          wabaId,
          phoneNumberId,
          encryptedAccessToken: encrypted,
          requestedAt: now,
          lastError: `Assinatura do webhook recusada pela Meta: ${why}`,
          lastErrorAt: now,
          source: 'embedded_signup',
          onboardingType: msg.onboardingType,
          registrationRequired: true,
          tokenIssuedAt: now,
        } as any;
      }
      pushAudit(db, {
        action: 'whatsapp.onboarding_failed', actor: user, businessId,
        meta: { reason: 'subscribe_failed', wabaId: 'presente', phoneNumberId: 'presente' },
      });
    });
    return NextResponse.json({
      error: `Conectei a conta, mas a Meta recusou a assinatura do webhook: ${why}. As mensagens ainda não chegam — tente de novo pelo painel do Master ou refaça o popup.`,
      code: 'subscribe_failed',
      plan: await freshPlan(businessId, business, requestOrigin),
    }, { status: 400 });
  }

  // ── 7. Número: nome, número exibido e qualidade (dados reais) ──
  let displayPhone = String(business.whatsappIntegration?.displayPhone || '');
  let verifiedName = String(business.whatsappIntegration?.verifiedName || '');
  let qualityRating = '';
  const fields = await graphJson(`${phoneNumberFieldsUrl(base, phoneNumberId)}&access_token=${encodeURIComponent(token)}&appsecret_proof=${proof}`);
  displayPhone = String(fields.data?.display_phone_number || displayPhone);
  verifiedName = String(fields.data?.verified_name || verifiedName);
  qualityRating = String(fields.data?.quality_rating || '');

  // ── 8. Registro do número / Tratamento de Coexistence ───────────
  // REGRA OFICIAL DA META (Onboarding WhatsApp Business App Users / Coexistence):
  // Em Coexistence (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING), a Meta instrui
  // explicitamente: "skip the phone number registration step, as the number is already registered".
  // Para confirmar a Coexistência, fazemos validação server-to-server:
  // fields.ok === true && fields.data.is_on_biz_app === true && fields.data.platform_type === 'CLOUD_API'.
  // O evento do navegador (msg.onboardingType === 'coexistence') é apenas uma pista não confiável.
  const clientClaimsCoexistence = msg.onboardingType === 'coexistence';
  const pin = String(body.pin || '').replace(/\D/g, '');
  const now = new Date().toISOString();

  const isOnBizApp = fields.ok && fields.data?.is_on_biz_app === true;
  const platformType = fields.ok && typeof fields.data?.platform_type === 'string' ? fields.data.platform_type : '';
  const isServerVerifiedCoexistence = isOnBizApp && platformType === 'CLOUD_API';

  let effectiveOnboardingType: 'standard' | 'coexistence' | 'unknown' = clientClaimsCoexistence ? 'coexistence' : 'standard';
  let coexistenceConfirmedAt: string | undefined = undefined;

  let registration: { attempted: boolean; ok: boolean; detail: string; skipped?: boolean } = {
    attempted: false,
    ok: false,
    detail: '',
  };

  if (isServerVerifiedCoexistence) {
    // Coexistence comprovada server-to-server direto na Graph API da Meta
    effectiveOnboardingType = 'coexistence';
    coexistenceConfirmedAt = now;
    registration = {
      attempted: false,
      ok: true,
      skipped: true,
      detail: 'Número verificado server-to-server no app WhatsApp Business e Cloud API (Coexistence oficial da Meta).',
    };
  } else if (clientClaimsCoexistence && !isServerVerifiedCoexistence) {
    // REGRA DE SEGURANÇA E HONESTIDADE:
    // O navegador indicou Coexistence e a consulta server-to-server falhou, retornou timeout,
    // resposta inválida, campos omitidos ou rate limit.
    // NUNCA converter automaticamente para Standard e NUNCA instruir o usuário a registrar com PIN!
    // Mantém onboardingType = 'coexistence', com estado pendente e erro acionável.
    effectiveOnboardingType = 'coexistence';
    const reason = !fields.ok
      ? 'A consulta de status do número à Meta falhou ou retornou erro temporário.'
      : !isOnBizApp
        ? 'A Meta não retornou is_on_biz_app=true para este número.'
        : `platform_type retornado pela Meta (${platformType || 'vazio'}) não é CLOUD_API.`;

    registration = {
      attempted: false,
      ok: false,
      detail: `Verificação de Coexistência pendente na Meta (${reason}). Tente novamente ou refaça o Embedded Signup.`,
    };
  } else {
    // Fluxo Standard da Cloud API: exige registro com PIN de duas etapas
    effectiveOnboardingType = 'standard';
    if (pin && pin.length !== 6) {
      return fail('O PIN de verificação em duas etapas tem 6 dígitos.');
    }
    if (pin) {
      const reg = await graphJson(registerNumberUrl(base, phoneNumberId), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin, appsecret_proof: proof }),
      });
      registration = {
        attempted: true,
        ok: reg.ok,
        detail: reg.ok ? '' : metaErrorMessage(reg.data, 'a Meta recusou o registro do número.'),
      };
    }
  }

  // Avaliação centralizada por computeConnectionStatus
  const draftWi: Partial<UnitIntegrationView> = {
    encryptedAccessToken: encryptSecret(token),
    phoneNumberId,
    wabaId,
    webhookSubscribedAt: now,
    onboardingType: effectiveOnboardingType,
    coexistenceConfirmedAt,
    isOnBizApp: fields.ok ? fields.data?.is_on_biz_app : undefined,
    platformType: fields.ok ? fields.data?.platform_type : undefined,
    registeredAt: effectiveOnboardingType === 'standard' && registration.attempted && registration.ok ? now : undefined,
    registrationRequired: effectiveOnboardingType === 'standard' ? !(registration.attempted && registration.ok) : false,
  };
  const computedStatus = computeConnectionStatus(draftWi);
  const connected = computedStatus.connected;

  // ── 9. Guardar (token criptografado, nunca em claro) ───────────
  const encrypted = draftWi.encryptedAccessToken!;
  await updateDB((db) => {
    const b = db.businesses.find((x) => x.id === businessId);
    if (b) {
      b.whatsappIntegration = {
        ...(b.whatsappIntegration || defaultWhatsappIntegration()),
        status: computedStatus.status,
        phoneNumberId,
        wabaId,
        displayPhone,
        verifiedName,
        encryptedAccessToken: encrypted,
        connectedAt: connected ? now : (b.whatsappIntegration?.connectedAt || ''),
        requestedAt: now,
        webhookSubscribedAt: now,
        registeredAt: draftWi.registeredAt || '',
        registrationRequired: computedStatus.registrationRequired,
        onboardingType: effectiveOnboardingType,
        coexistenceConfirmedAt,
        isOnBizApp: fields.ok ? fields.data?.is_on_biz_app : undefined,
        platformType: fields.ok ? fields.data?.platform_type : undefined,
        lastError: registration.attempted && !registration.ok
          ? `Registro do número: ${registration.detail}`
          : (!connected && clientClaimsCoexistence && !isServerVerifiedCoexistence)
            ? registration.detail
            : (connected ? undefined : computedStatus.reason || 'Falta concluir etapas de registro na Meta.'),
        lastErrorAt: !connected ? now : undefined,
        source: 'embedded_signup',
        tokenIssuedAt: now,
      } as any;
    }
    pushAudit(db, {
      action: connected ? 'whatsapp.connected' : 'whatsapp.registration_pending',
      actor: user,
      businessId,
      meta: {
        via: 'embedded_signup',
        graphVersion: getMetaGraphVersion(),
        onboardingType: effectiveOnboardingType,
        coexistenceServerVerified: isServerVerifiedCoexistence,
        wabaId: 'presente',
        phoneNumberId: 'presente',
        registered: connected,
      },
    });
  });

  // Sem registro comprovado NÃO é "conectado": a unidade fica pendente e a
  // resposta diz exatamente o que falta.
  if (!connected) {
    let pendingMessage = 'Conta autorizada e webhook assinado. Falta registrar o número: informe o PIN de verificação em duas etapas (6 dígitos) para o número poder enviar e receber pela API.';
    let pendingReason = 'phone_registration_required';

    if (registration.attempted) {
      pendingMessage = `A conta foi autorizada, mas o registro do número falhou: ${registration.detail} Confira o PIN de duas etapas no WhatsApp Manager.`;
    } else if (clientClaimsCoexistence && !isServerVerifiedCoexistence) {
      pendingReason = 'coexistence_verification_pending';
      pendingMessage = `A conta foi autorizada, mas a Meta ainda não confirmou o status de Coexistência (${registration.detail}). Tente novamente mais tarde ou refaça o Embedded Signup.`;
    }
    return NextResponse.json({
      ok: false,
      pending: true,
      reason: pendingReason,
      message: pendingMessage,
      integration: { status: 'pending', displayPhone, verifiedName, qualityRating },
      checks: { tokenStored: true, webhookSubscribed: true, phoneResolved: true, registration },
      plan: await freshPlan(businessId, business, requestOrigin),
    });
  }

  return NextResponse.json({
    ok: true,
    message: 'Conta oficial conectada. Mande uma mensagem para o número para confirmar a entrega.',
    integration: { status: 'connected', displayPhone, verifiedName, qualityRating },
    checks: {
      tokenStored: true,
      webhookSubscribed: true,
      phoneResolved: true,
      registration,
    },
    registration,
    plan: await freshPlan(businessId, business, requestOrigin),
  });
}
