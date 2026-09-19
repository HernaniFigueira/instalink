// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 8 — ONBOARDING DO WHATSAPP (troca do código da Meta)
// ═══════════════════════════════════════════════════════════════
// GET  → o plano em duas camadas (plataforma × unidade) + o estado assinado do
//        popup. Nada de segredo: só se cada requisito EXISTE.
// POST → action 'exchange': recebe o código do Embedded Signup e faz, no
//        servidor, o que a unidade não pode fazer sozinha:
//
//          1. troca o código pelo token da conta (oauth/access_token);
//          2. descobre o WABA e o número (o popup pode não mandar o número);
//          3. assina o webhook na WABA (sem isso não chega mensagem);
//          4. registra o número quando o PIN de verificação vem junto;
//          5. criptografa o token e grava na unidade.
//
// O token NUNCA volta na resposta. O código do Embedded Signup é de uso único e
// vive 30 segundos: se a troca falhar, a unidade recomeça o popup — a rota
// diz isso em vez de tentar de novo com um código morto.
//
// Sem app da Meta configurado, a resposta é 503 com `code:
// 'platform_not_configured'` e a lista do que falta: é o BLOCKED_EXTERNAL do
// relatório, dito na cara — nunca um "conectado" de mentira.
import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { effectiveTimezone, todayISO } from '@/lib/tz';
import { defaultWhatsappIntegration } from '@/lib/whatsapp';
import { encryptSecret, getMetaGraphVersion } from '@/lib/whatsapp-cloud-api';
import {
  debugTokenUrl, exchangeCodeUrl, firstPhoneNumberId, graphBase, metaErrorMessage,
  onboardingPlan, parseSignupMessage, phoneNumberFieldsUrl, platformLayer, registerNumberUrl,
  subscribeAppUrl, wabaIdFromDebugToken, wabaPhoneNumbersUrl,
} from '@/lib/whatsapp-onboarding';
import { appsecretProof, issueSignupState, verifySignupState } from '@/lib/whatsapp-onboarding-server';

function planFor(business: any) {
  const env = process.env;
  return onboardingPlan({
    env,
    business,
    todayISO: todayISO(new Date(), effectiveTimezone(business.businessTimezone)),
  });
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

  const plan = planFor(guard.ctx.business);
  const credentialsKey = String(process.env.WHATSAPP_CREDENTIALS_KEY || '');
  return NextResponse.json({
    plan,
    // Estado assinado que volta junto com o código do popup (anti-CSRF da troca).
    signupState: plan.clientConfig ? issueSignupState(credentialsKey) : '',
    // Caminho assistido continua valendo (o Master cadastra as credenciais).
    masterRouteAvailable: true,
    webhookPath: '/api/whatsapp/webhook',
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

  const action = String(body.action || 'exchange');
  if (action !== 'exchange') {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  }

  // ── 0. A plataforma está pronta? ───────────────────────────────
  const platform = platformLayer(process.env);
  const plan = planFor(business);
  if (!platform.ready) {
    await updateDB((db) => {
      pushAudit(db, {
        action: 'whatsapp.onboarding_blocked',
        actor: user,
        businessId,
        meta: { missing: platform.missing, reason: 'platform_not_configured' },
      });
    });
    return NextResponse.json({
      error: 'O onboarding oficial do WhatsApp ainda não está habilitado nesta instalação — falta configurar a plataforma. Nada foi alterado na sua unidade.',
      code: 'platform_not_configured',
      external: 'BLOCKED_EXTERNAL',
      missing: platform.missing,
      plan,
      masterRouteAvailable: true,
    }, { status: 503 });
  }

  const appId = String(process.env.META_APP_ID || '');
  const appSecret = String(process.env.META_APP_SECRET || '');
  const secretKey = String(process.env.WHATSAPP_CREDENTIALS_KEY || '');
  const base = graphBase(getMetaGraphVersion());

  // ── 1. O retorno é do NOSSO popup? ─────────────────────────────
  const stateCheck = verifySignupState(String(body.state || ''), secretKey);
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

  // O popup manda o WABA e (às vezes) o número; aceitamos também do corpo.
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
      error: reason, code: 'onboarding_failed', plan: planFor(business), ...extra,
    }, { status: 400 });
  }

  // ── 2. Troca do código pelo token (server-to-server) ───────────
  const exchanged = await graphJson(exchangeCodeUrl(base, appId, appSecret, code));
  const token = String(exchanged.data?.access_token || '');
  if (!exchanged.ok || !token) {
    return fail(
      `Não consegui autorizar a conta junto à Meta: ${metaErrorMessage(exchanged.data, 'código recusado (ele vale 30 segundos e só pode ser usado uma vez).')} Recomece a conexão.`,
    );
  }
  const proof = appsecretProof(token, appSecret);

  // ── 3. Descobrir o WABA quando o popup não mandou ──────────────
  if (!wabaId) {
    const debug = await graphJson(debugTokenUrl(base, token), {
      headers: { authorization: `Bearer ${appId}|${appSecret}` },
    });
    wabaId = wabaIdFromDebugToken(debug.data);
  }

  // ── 4. Descobrir o número quando o popup não mandou ────────────
  if (wabaId && !phoneNumberId) {
    const phones = await graphJson(`${wabaPhoneNumbersUrl(base, wabaId)}?access_token=${encodeURIComponent(token)}&appsecret_proof=${proof}`);
    phoneNumberId = firstPhoneNumberId(phones.data);
  }
  if (!wabaId) {
    return fail('A conta autorizada não trouxe nenhuma WhatsApp Business Account (WABA). Confira se você escolheu a conta certa no popup da Meta.');
  }

  // ── 5. Assinar o webhook na WABA ───────────────────────────────
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
    await updateDB((db) => {
      const b = db.businesses.find((x) => x.id === businessId);
      if (b) {
        b.whatsappIntegration = {
          ...(b.whatsappIntegration || defaultWhatsappIntegration()),
          status: 'pending',
          wabaId,
          phoneNumberId: phoneNumberId || b.whatsappIntegration?.phoneNumberId || '',
          encryptedAccessToken: encrypted,
          requestedAt: new Date().toISOString(),
          lastError: `Assinatura do webhook recusada pela Meta: ${why}`,
          lastErrorAt: new Date().toISOString(),
          source: 'embedded_signup',
        };
      }
      pushAudit(db, {
        action: 'whatsapp.onboarding_failed', actor: user, businessId,
        meta: { reason: 'subscribe_failed', wabaId: 'presente', phoneNumberId: phoneNumberId ? 'presente' : 'ausente' },
      });
    });
    return NextResponse.json({
      error: `Conectei a conta, mas a Meta recusou a assinatura do webhook: ${why}. As mensagens ainda não chegam — tente de novo pelo painel do Master ou refaça o popup.`,
      code: 'subscribe_failed',
      plan: planFor(business),
    }, { status: 400 });
  }

  // ── 6. Número: nome, número exibido e qualidade (dados reais) ──
  let displayPhone = String(business.whatsappIntegration?.displayPhone || '');
  let verifiedName = String(business.whatsappIntegration?.verifiedName || '');
  let qualityRating = '';
  if (phoneNumberId) {
    const fields = await graphJson(`${phoneNumberFieldsUrl(base, phoneNumberId)}&access_token=${encodeURIComponent(token)}&appsecret_proof=${proof}`);
    displayPhone = String(fields.data?.display_phone_number || displayPhone);
    verifiedName = String(fields.data?.verified_name || verifiedName);
    qualityRating = String(fields.data?.quality_rating || '');
  }

  // ── 7. Registro do número (opcional, com o PIN de 2 etapas) ────
  let registration: { attempted: boolean; ok: boolean; detail: string } = { attempted: false, ok: false, detail: '' };
  const pin = String(body.pin || '').replace(/\D/g, '');
  if (pin && phoneNumberId) {
    if (pin.length !== 6) {
      return fail('O PIN de verificação em duas etapas tem 6 dígitos.');
    }
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

  // ── 8. Guardar (token criptografado, nunca em claro) ───────────
  const encrypted = encryptSecret(token);
  const now = new Date().toISOString();
  const connected = !!phoneNumberId && (registration.attempted ? registration.ok : true);
  await updateDB((db) => {
    const b = db.businesses.find((x) => x.id === businessId);
    if (b) {
      b.whatsappIntegration = {
        ...(b.whatsappIntegration || defaultWhatsappIntegration()),
        status: connected ? 'connected' : 'pending',
        phoneNumberId: phoneNumberId || '',
        wabaId,
        displayPhone,
        verifiedName,
        encryptedAccessToken: encrypted,
        connectedAt: connected ? now : b.whatsappIntegration?.connectedAt || '',
        requestedAt: now,
        lastError: registration.attempted && !registration.ok ? `Registro do número: ${registration.detail}` : undefined,
        lastErrorAt: registration.attempted && !registration.ok ? now : undefined,
        source: 'embedded_signup',
        tokenIssuedAt: now,
      } as any;
    }
    pushAudit(db, {
      action: 'whatsapp.connected',
      actor: user,
      businessId,
      meta: {
        via: 'embedded_signup',
        graphVersion: getMetaGraphVersion(),
        wabaId: 'presente',
        phoneNumberId: phoneNumberId ? 'presente' : 'ausente',
        registered: registration.attempted ? registration.ok : null,
      },
    });
  });

  return NextResponse.json({
    ok: true,
    message: connected
      ? 'Conta oficial conectada. Mande uma mensagem para o número para confirmar a entrega.'
      : 'Conta autorizada, mas falta terminar a configuração do número — confira o diagnóstico.',
    integration: {
      status: connected ? 'connected' : 'pending',
      displayPhone,
      verifiedName,
      qualityRating,
    },
    checks: {
      tokenStored: true,
      webhookSubscribed: true,
      phoneResolved: !!phoneNumberId,
      registration,
    },
    registration,
    plan: planFor(business),
  });
}
