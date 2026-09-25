import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import {
  REQUIRED_ENV_VARS, defaultWhatsappIntegration, integrationStatus, maskTechnicalId,
  missingEnvVars, serverCredentialsConfigured, whatsappStateLabel,
} from '@/lib/whatsapp';
import { computeConnectionStatus, type UnitIntegrationView } from '@/lib/whatsapp-onboarding';
import { appsecretProof } from '@/lib/whatsapp-onboarding-server';
import { decryptSecret, getWhatsappCredentials, testMetaConnection } from '@/lib/whatsapp-cloud-api';
import { onlyDigits } from '@/lib/utils';

// Diagnóstico temporário, fixado aos ativos de teste da Andrioni.
// Os IDs são públicos; o token e a prova HMAC ficam exclusivamente no servidor.
const WABA_DIAGNOSTIC_APP_ID = '1631409148434073';
const WABA_DIAGNOSTIC_WABA_ID = '1802366907680005';
const WABA_DIAGNOSTIC_PHONE_ID = '1311304095400435';
const WABA_DIAGNOSTIC_GRAPH_BASE = 'https://graph.facebook.com/v26.0';

type GraphDiagnosticResult = { ok: boolean; status: number; data: any; error: string };

function sanitizedGraphError(status: number, data: any, operation: string): string {
  if (status === 0) return `Não foi possível alcançar a Graph API para ${operation}.`;
  const rawCode = Number(data?.error?.code);
  const code = Number.isFinite(rawCode) ? ` Código Meta ${rawCode}.` : '';
  if (status === 401 || status === 403) return `A Meta recusou a credencial ou a permissão para ${operation}.${code}`;
  if (status === 404) return `A Meta não encontrou o recurso consultado para ${operation}.${code}`;
  if (status === 429) return `A Meta limitou temporariamente a consulta de ${operation}.${code}`;
  if (status >= 500) return `A Graph API apresentou indisponibilidade ao executar ${operation}.${code}`;
  return `A Meta recusou a operação ${operation}.${code}`;
}

async function graphDiagnosticRequest(
  resource: string,
  token: string,
  proof: string,
  operation: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<GraphDiagnosticResult> {
  try {
    const separator = resource.includes('?') ? '&' : '?';
    const url = `${WABA_DIAGNOSTIC_GRAPH_BASE}/${resource}${separator}appsecret_proof=${encodeURIComponent(proof)}`;
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ appsecret_proof: proof }) } : {}),
    });
    let data: any = null;
    try { data = await response.json(); } catch { data = null; }
    const ok = response.ok && !data?.error;
    return { ok, status: response.status, data, error: ok ? '' : sanitizedGraphError(response.status, data, operation) };
  } catch {
    return { ok: false, status: 0, data: null, error: sanitizedGraphError(0, null, operation) };
  }
}

function subscribedAppsResult(result: GraphDiagnosticResult) {
  const valid = Array.isArray(result.data?.data);
  const apps = valid ? result.data.data : [];
  const appIdFound = apps.some((app: any) => String(app?.id || app?.app_id || app?.appId || '') === WABA_DIAGNOSTIC_APP_ID);
  return {
    wabaSubscribed: apps.length > 0,
    appIdFound,
    httpStatus: result.status,
    error: result.error || (result.ok && !valid ? 'A Graph API retornou uma resposta inválida para a assinatura da WABA.' : ''),
  };
}

function safePhoneResult(result: GraphDiagnosticResult) {
  const value = result.data && typeof result.data === 'object' ? result.data : {};
  const webhook = value.webhook_configuration && typeof value.webhook_configuration === 'object'
    ? value.webhook_configuration : {};
  return {
    httpStatus: result.status,
    status: typeof value.status === 'string' ? value.status : '',
    accountMode: typeof value.account_mode === 'string' ? value.account_mode : '',
    platformType: typeof value.platform_type === 'string' ? value.platform_type : '',
    webhookApplication: typeof webhook.application === 'string' ? webhook.application : '',
    error: result.error,
  };
}

async function runWabaSubscriptionDiagnostic(
  business: any,
  resubscribe: boolean,
) {
  const integration = business.whatsappIntegration;
  const encryptedToken = String(integration?.encryptedAccessToken || '');
  const token = decryptSecret(encryptedToken);
  const appSecret = String(process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '').trim();
  const configuredAppId = String(process.env.META_APP_ID || '').trim();

  if (String(integration?.wabaId || '') !== WABA_DIAGNOSTIC_WABA_ID || String(integration?.phoneNumberId || '') !== WABA_DIAGNOSTIC_PHONE_ID) {
    return { ok: false, error: 'A unidade ativa não possui os identificadores do diagnóstico da Andrioni.', subscription: null, phone: null, reassigned: false };
  }
  if (!token) {
    return { ok: false, error: 'A credencial criptografada da unidade não pôde ser aberta no servidor.', subscription: null, phone: null, reassigned: false };
  }
  if (!appSecret) {
    return { ok: false, error: 'O segredo do aplicativo não está configurado no servidor.', subscription: null, phone: null, reassigned: false };
  }
  if (configuredAppId !== WABA_DIAGNOSTIC_APP_ID) {
    return { ok: false, error: 'O App ID configurado no servidor não corresponde ao app deste diagnóstico.', subscription: null, phone: null, reassigned: false };
  }

  const proof = appsecretProof(token, appSecret);
  const subscribedAppsResource = `${WABA_DIAGNOSTIC_WABA_ID}/subscribed_apps`;
  const initialGet = await graphDiagnosticRequest(
    subscribedAppsResource, token, proof, 'consultar a assinatura da WABA', 'GET',
  );
  const initialSubscription = subscribedAppsResult(initialGet);

  // O POST nunca é o primeiro contato: mesmo uma chamada direta à API precisa
  // provar, no servidor, que o App ID ainda não está inscrito.
  const initialPayloadValid = Array.isArray(initialGet.data?.data);
  if (resubscribe && (!initialGet.ok || !initialPayloadValid || initialSubscription.appIdFound)) {
    const phone = initialSubscription.appIdFound
      ? safePhoneResult(await graphDiagnosticRequest(
        `${WABA_DIAGNOSTIC_PHONE_ID}?fields=status,account_mode,platform_type,webhook_configuration`,
        token,
        proof,
        'consultar o Phone Number ID',
        'GET',
      ))
      : null;
    return {
      ok: initialGet.ok && initialPayloadValid,
      error: initialSubscription.error,
      subscription: initialSubscription,
      phone,
      reassigned: false,
      postHttpStatus: undefined,
    };
  }

  let post: GraphDiagnosticResult | null = null;
  if (resubscribe) {
    post = await graphDiagnosticRequest(
      subscribedAppsResource, token, proof, 'reassinar o webhook da WABA', 'POST',
    );
  }

  // Depois do POST, confirmar o estado real com um novo GET.
  const finalGet = resubscribe
    ? await graphDiagnosticRequest(subscribedAppsResource, token, proof, 'confirmar a assinatura da WABA', 'GET')
    : initialGet;
  const subscription = subscribedAppsResult(finalGet);
  const postError = post && !post.ok ? post.error : '';
  const error = postError || subscription.error;
  const phone = subscription.appIdFound
    ? safePhoneResult(await graphDiagnosticRequest(
      `${WABA_DIAGNOSTIC_PHONE_ID}?fields=status,account_mode,platform_type,webhook_configuration`,
      token,
      proof,
      'consultar o Phone Number ID',
      'GET',
    ))
    : null;

  return {
    ok: finalGet.ok && Array.isArray(finalGet.data?.data),
    error,
    subscription,
    phone,
    reassigned: !!post?.ok,
    postHttpStatus: post?.status,
  };
}

// WHATSAPP — estado REAL da integração (nada de fingir conexão).
//
// GET  → status + diagnósticos + resumo do inbox (zero segredos expostos)
// POST { action: 'connect', displayPhone } → valida e conecta junto à Meta API.
// POST { action: 'test' }                  → executa diagnóstico em tempo real.
// POST { action: 'disconnect' }            → desvincula a integração da unidade.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = guard.ctx.business;
  const serverConfigured = serverCredentialsConfigured();
  const integration = integrationStatus(business, serverConfigured);
  const label = whatsappStateLabel(business, serverConfigured);
  const credentials = getWhatsappCredentials(business);
  const conversations = db.conversations.filter((c) => c.businessId === businessId);
  const messages = db.messages.filter((m) => m.businessId === businessId);

  const canViewDiagnostics = guard.ctx.isMaster || guard.ctx.isOwner || guard.ctx.role === 'ADMIN';
  const canRunWabaDiagnostic = guard.ctx.isMaster || guard.ctx.role === 'ADMIN';

  return NextResponse.json({
    status: integration.status,
    label,
    integration: {
      displayPhone: integration.displayPhone,
      phoneNumberId: maskTechnicalId(integration.phoneNumberId),
      wabaId: maskTechnicalId(integration.wabaId),
      connectedAt: integration.connectedAt,
      lastWebhookAt: integration.lastWebhookAt,
      lastInboundAt: integration.lastInboundAt || '',
      lastOutboundAt: integration.lastOutboundAt || '',
      lastError: integration.lastError || '',
      requestedAt: integration.requestedAt,
      onboardingType: integration.onboardingType,
      registrationRequired: integration.registrationRequired,
    },
    // Diagnósticos técnicos reservados para Master/Admin
    canViewDiagnostics,
    canRunWabaDiagnostic,
    diagnostics: canViewDiagnostics ? {
      credentialsConfigured: !!credentials,
      credentialSource: credentials?.source || 'none',
      hasPhoneNumberId: !!integration.phoneNumberId,
      hasWabaId: !!integration.wabaId,
      webhookReceived: !!integration.lastWebhookAt,
      lastInboundAt: integration.lastInboundAt || '',
      lastOutboundAt: integration.lastOutboundAt || '',
      recentError: integration.lastError || '',
    } : undefined,
    server: canViewDiagnostics ? {
      configured: serverConfigured,
      missingEnv: missingEnvVars(),
      envVars: REQUIRED_ENV_VARS,
    } : undefined,
    inbox: {
      conversations: conversations.length,
      open: conversations.filter((c) => c.status === 'open').length,
      unread: conversations.reduce((s, c) => s + (c.unread || 0), 0),
      messages: messages.length,
      pending: messages.filter((m) => m.status === 'pending').length,
    },
    // Fallback wa.me
    linkFallback: business.whatsapp
      ? `https://wa.me/55${onlyDigits(business.whatsapp).replace(/^55/, '')}`
      : '',
    webhookPath: canViewDiagnostics ? '/api/whatsapp/webhook' : undefined,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'whatsapp');
    if (!guard.ok) return guard.res;
    const { user, business } = guard.ctx;
    const action = String(body.action || 'connect');

    // ── DIAGNÓSTICO TEMPORÁRIO DA ASSINATURA WABA ───────────────
    // Somente Master/Admin. É leitura até o usuário clicar explicitamente em
    // reassinar; nenhum token, prova, payload ou resposta bruta é devolvido.
    if (action === 'verify_waba_subscription' || action === 'resubscribe_waba') {
      const canRun = guard.ctx.isMaster || guard.ctx.role === 'ADMIN';
      if (!canRun) return NextResponse.json({ error: 'Diagnóstico técnico restrito a Master/Admin.' }, { status: 403 });
      const result = await runWabaSubscriptionDiagnostic(business, action === 'resubscribe_waba');
      console.info(
        `[WA-WABA-DIAG] action=${action} graph_status=${String(result.subscription?.httpStatus ?? result.postHttpStatus ?? 0)} `
        + `app_found=${result.subscription?.appIdFound ? 'true' : 'false'} reassigned=${result.reassigned ? 'true' : 'false'}`,
      );
      if (result.error) {
        console.warn(`[WA-WABA-DIAG] action=${action} error=redacted`);
      }
      return NextResponse.json(result);
    }

    // ── DESCONECTAR ──────────────────────────────────────────────
    if (action === 'disconnect') {
      await updateDB((db) => {
        const b = db.businesses.find((x) => x.id === businessId);
        if (b) {
          b.whatsappIntegration = {
            ...defaultWhatsappIntegration(),
            status: 'not_connected',
          };
        }
        pushAudit(db, {
          action: 'whatsapp.disconnected',
          actor: user,
          businessId,
          meta: { via: 'dashboard' },
        });
      });
      return NextResponse.json({ ok: true, status: 'not_connected', message: 'WhatsApp desconectado.' });
    }

    // ── TESTAR CONEXÃO ───────────────────────────────────────────
    if (action === 'test') {
      const creds = getWhatsappCredentials(business);
      if (!creds) {
        return NextResponse.json({
          ok: false,
          error: 'Credenciais do WhatsApp não configuradas para esta unidade.',
          code: 'missing_credentials',
        }, { status: 409 });
      }

      // Validação real com a Graph API fora de lock
      const testResult = await testMetaConnection(creds.phoneNumberId, creds.accessToken);
      const now = new Date().toISOString();

      await updateDB((db) => {
        const b = db.businesses.find((x) => x.id === businessId);
        if (b && b.whatsappIntegration) {
          if (testResult.ok) {
            // Apenas atualiza metadados informativos e limpa erros se ok.
            // NUNCA modifica o status contratual: computeConnectionStatus é a autoridade.
            const currentWi = b.whatsappIntegration;
            b.whatsappIntegration.lastError = undefined;
            if (testResult.displayPhoneNumber) b.whatsappIntegration.displayPhone = testResult.displayPhoneNumber;
            if (testResult.verifiedName) b.whatsappIntegration.verifiedName = testResult.verifiedName;

            const computed = computeConnectionStatus(currentWi as any);
            b.whatsappIntegration.status = computed.status;
          } else {
            b.whatsappIntegration.lastError = testResult.error;
            b.whatsappIntegration.lastErrorAt = now;
            b.whatsappIntegration.status = 'error';
          }
        }
      });

      if (!testResult.ok) {
        return NextResponse.json({
          ok: false,
          error: testResult.error,
          code: 'meta_test_failed',
        }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        verifiedName: testResult.verifiedName,
        displayPhoneNumber: testResult.displayPhoneNumber,
        qualityRating: testResult.qualityRating,
        message: 'Conexão com a Meta Cloud API validada com sucesso.',
      });
    }

    // ── CONECTAR ─────────────────────────────────────────────────
    if (action !== 'connect') {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }

    const displayPhone = onlyDigits(String(body.displayPhone || ''));
    if (!displayPhone || displayPhone.length < 10) {
      return NextResponse.json({ error: 'Informe o número da conta oficial (com DDD).' }, { status: 400 });
    }

    const serverConfigured = serverCredentialsConfigured();
    const existingCreds = getWhatsappCredentials(business);

    // Sem credenciais no servidor e sem credenciais no business: não mente
    if (!serverConfigured && !existingCreds) {
      const missing = missingEnvVars();
      await updateDB((db) => {
        const b = db.businesses.find((x) => x.id === businessId);
        if (b) {
          b.whatsappIntegration = {
            ...(b.whatsappIntegration || defaultWhatsappIntegration()),
            status: 'pending',
            displayPhone,
            requestedAt: new Date().toISOString(),
          };
        }
        pushAudit(db, {
          action: 'whatsapp.connect_requested', actor: user, businessId,
          supportSessionId: guard.ctx.support?.id, meta: { missingEnv: missing },
        });
      });
      return NextResponse.json({
        error: 'A integração oficial do WhatsApp ainda não está configurada no servidor. Solicite a ativação pelo suporte Master.',
        code: 'not_configured',
        missingEnv: missing,
        envVars: REQUIRED_ENV_VARS,
        webhookPath: '/api/whatsapp/webhook',
      }, { status: 409 });
    }

    // Com credenciais disponíveis: valida de verdade junto à API da Meta
    const phoneIdToValidate = business.whatsappIntegration?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const tokenToValidate = existingCreds?.accessToken || process.env.WHATSAPP_API_TOKEN || '';

    const testRes = await testMetaConnection(phoneIdToValidate, tokenToValidate);
    const now = new Date().toISOString();

    if (!testRes.ok) {
      await updateDB((db) => {
        const b = db.businesses.find((x) => x.id === businessId);
        if (b) {
          b.whatsappIntegration = {
            ...(b.whatsappIntegration || defaultWhatsappIntegration()),
            status: 'error',
            displayPhone,
            lastError: testRes.error,
            lastErrorAt: now,
            requestedAt: now,
          };
        }
      });
      return NextResponse.json({
        error: `Não foi possível validar a conta junto à Meta: ${testRes.error}`,
        code: 'meta_verification_failed',
      }, { status: 400 });
    }

    // REGRA CENTRALIZADA: computeConnectionStatus é a autoridade absoluta.
    // Nenhum bypass legado (!isEmbeddedSignup ou credencial global) pode conectar silenciosamente
    // uma unidade sem comprovação completa (token criptografado na unidade, wabaId, phoneId, webhookSubscribedAt e registro/coexistência).
    const currentWi = business.whatsappIntegration || defaultWhatsappIntegration();
    const candidateWi = {
      ...currentWi,
      displayPhone: testRes.displayPhoneNumber || displayPhone,
      phoneNumberId: phoneIdToValidate,
      wabaId: currentWi.wabaId || process.env.WHATSAPP_WABA_ID || '',
      verifiedName: testRes.verifiedName,
    };

    const computed = computeConnectionStatus(candidateWi as any);

    await updateDB((db) => {
      const b = db.businesses.find((x) => x.id === businessId);
      if (b) {
        b.whatsappIntegration = {
          ...candidateWi,
          status: computed.status,
          registrationRequired: computed.registrationRequired,
          connectedAt: computed.connected ? (currentWi.connectedAt || now) : '',
          lastError: computed.connected ? undefined : (computed.reason || 'Integração incompleta junto à Meta.'),
        };
      }
      pushAudit(db, {
        action: 'whatsapp.connect_requested', actor: user, businessId,
        meta: { displayPhone, connected: computed.connected, status: computed.status, verifiedName: testRes.verifiedName },
      });
    });

    if (!computed.connected) {
      return NextResponse.json({
        ok: false,
        pending: true,
        status: computed.status,
        message: computed.reason || 'Conta validada na Meta, mas ainda não atende a todos os requisitos contratuais de conexão (webhook assinado, registro com PIN ou confirmação de Coexistência).',
        verifiedName: testRes.verifiedName,
        displayPhone: testRes.displayPhoneNumber || displayPhone,
        webhookPath: '/api/whatsapp/webhook',
      }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      status: 'connected',
      message: 'WhatsApp oficial conectado com sucesso!',
      verifiedName: testRes.verifiedName,
      displayPhone: testRes.displayPhoneNumber || displayPhone,
      webhookPath: '/api/whatsapp/webhook',
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível processar a solicitação.' }, { status: 500 });
  }
}
