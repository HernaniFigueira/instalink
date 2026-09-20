import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import {
  REQUIRED_ENV_VARS, defaultWhatsappIntegration, integrationStatus, maskTechnicalId,
  missingEnvVars, serverCredentialsConfigured, whatsappStateLabel,
} from '@/lib/whatsapp';
import { getWhatsappCredentials, testMetaConnection } from '@/lib/whatsapp-cloud-api';
import { onlyDigits } from '@/lib/utils';

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

  return NextResponse.json({
    status: integration.status,
    label,
    integration: {
      provider: integration.provider || 'meta_cloud',
      displayPhone: integration.displayPhone,
      phoneNumberId: maskTechnicalId(integration.phoneNumberId),
      wabaId: maskTechnicalId(integration.wabaId),
      connectedAt: integration.connectedAt,
      lastWebhookAt: integration.lastWebhookAt,
      lastInboundAt: integration.lastInboundAt || '',
      lastOutboundAt: integration.lastOutboundAt || '',
      lastError: integration.lastError || '',
      requestedAt: integration.requestedAt,
    },
    diagnostics: {
      credentialsConfigured: !!credentials,
      credentialSource: credentials?.source || 'none',
      hasPhoneNumberId: !!integration.phoneNumberId,
      hasWabaId: !!integration.wabaId,
      webhookReceived: !!integration.lastWebhookAt,
      lastInboundAt: integration.lastInboundAt || '',
      lastOutboundAt: integration.lastOutboundAt || '',
      recentError: integration.lastError || '',
    },
    server: { configured: serverConfigured, missingEnv: missingEnvVars(), envVars: REQUIRED_ENV_VARS },
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
    webhookPath: '/api/whatsapp/webhook',
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'whatsapp');
    if (!guard.ok) return guard.res;
    const { user, business } = guard.ctx;
    if (business.whatsappIntegration?.provider === 'whatsapp_web') return NextResponse.json({ error: 'Remova a conexão experimental antes de configurar a Meta.' }, { status: 409 });
    const action = String(body.action || 'connect');

    // ── DESCONECTAR ──────────────────────────────────────────────
    if (action === 'disconnect') {
      await updateDB((db) => {
        const b = db.businesses.find((x) => x.id === businessId);
        if (b?.whatsappIntegration?.provider === 'whatsapp_web') throw new Error('Provider alterado durante a operação.');
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
        if (b?.whatsappIntegration?.provider === 'whatsapp_web') throw new Error('Provider alterado durante a operação.');
        if (b && b.whatsappIntegration) {
          if (testResult.ok) {
            b.whatsappIntegration.status = 'connected';
            b.whatsappIntegration.lastError = undefined;
            if (testResult.displayPhoneNumber) b.whatsappIntegration.displayPhone = testResult.displayPhoneNumber;
            if (testResult.verifiedName) b.whatsappIntegration.verifiedName = testResult.verifiedName;
          } else {
            b.whatsappIntegration.lastError = testResult.error;
            b.whatsappIntegration.lastErrorAt = now;
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
        if (b?.whatsappIntegration?.provider === 'whatsapp_web') throw new Error('Provider alterado durante a operação.');
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
        if (b?.whatsappIntegration?.provider === 'whatsapp_web') throw new Error('Provider alterado durante a operação.');
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

    // Sucesso confirmado na Meta: marca como connected
    await updateDB((db) => {
      const b = db.businesses.find((x) => x.id === businessId);
      if (b?.whatsappIntegration?.provider === 'whatsapp_web') throw new Error('Provider alterado durante a operação.');
      if (b) {
        b.whatsappIntegration = {
          ...(b.whatsappIntegration || defaultWhatsappIntegration()),
          status: 'connected',
          displayPhone: testRes.displayPhoneNumber || displayPhone,
          phoneNumberId: phoneIdToValidate,
          wabaId: b.whatsappIntegration?.wabaId || process.env.WHATSAPP_WABA_ID || '',
          connectedAt: now,
          lastError: undefined,
          verifiedName: testRes.verifiedName,
        };
      }
      pushAudit(db, {
        action: 'whatsapp.connect_requested', actor: user, businessId,
        meta: { displayPhone, connected: true, verifiedName: testRes.verifiedName },
      });
    });

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
