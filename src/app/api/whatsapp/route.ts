import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import {
  REQUIRED_ENV_VARS, integrationStatus, missingEnvVars, serverCredentialsConfigured,
  whatsappStateLabel,
} from '@/lib/whatsapp';
import { onlyDigits } from '@/lib/utils';

// WHATSAPP — estado REAL da integração (nada de fingir conexão).
//
// GET  → status + o que falta no servidor + resumo do inbox
// POST { action: 'connect', displayPhone } → registra a intenção de conectar.
//      Sem credenciais no servidor devolve 409 `not_configured` explicando
//      exatamente quais variáveis de ambiente faltam. Com credenciais, a
//      conta entra como PENDENTE até o webhook validar — nunca "conectado"
//      por decreto do frontend.
// Nenhum token é persistido no banco nem devolvido para o navegador.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = guard.ctx.business;
  const serverConfigured = serverCredentialsConfigured();
  const integration = integrationStatus(business, serverConfigured);
  const label = whatsappStateLabel(business, serverConfigured);
  const conversations = db.conversations.filter((c) => c.businessId === businessId);
  const messages = db.messages.filter((m) => m.businessId === businessId);

  return NextResponse.json({
    status: integration.status,
    label,
    integration: {
      displayPhone: integration.displayPhone,
      phoneNumberId: integration.phoneNumberId, // identificador público
      wabaId: integration.wabaId,
      connectedAt: integration.connectedAt,
      lastWebhookAt: integration.lastWebhookAt,
      requestedAt: integration.requestedAt,
    },
    server: { configured: serverConfigured, missingEnv: missingEnvVars(), envVars: REQUIRED_ENV_VARS },
    inbox: {
      conversations: conversations.length,
      open: conversations.filter((c) => c.status === 'open').length,
      unread: conversations.reduce((s, c) => s + (c.unread || 0), 0),
      messages: messages.length,
      pending: messages.filter((m) => m.status === 'pending').length,
    },
    // Fallback que nunca sai do ar: o link externo continua disponível.
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
    const { user } = guard.ctx;
    const action = String(body.action || 'connect');
    if (action !== 'connect') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });

    const serverConfigured = serverCredentialsConfigured();
    const displayPhone = onlyDigits(String(body.displayPhone || ''));
    if (!displayPhone || displayPhone.length < 10) {
      return NextResponse.json({ error: 'Informe o número da conta oficial (com DDD).' }, { status: 400 });
    }

    // Sem credenciais no servidor não existe conexão oficial: devolvemos o
    // motivo exato e registramos apenas a SOLICITAÇÃO (intenção), nunca um
    // estado falso de conectado.
    if (!serverConfigured) {
      const missing = missingEnvVars();
      await updateDB((db) => {
        const b = db.businesses.find((x) => x.id === businessId);
        if (b) {
          b.whatsappIntegration = {
            ...(b.whatsappIntegration || { status: 'not_connected', displayPhone: '', phoneNumberId: '', wabaId: '', connectedAt: '', lastWebhookAt: '' }),
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
        error: 'A integração oficial do WhatsApp ainda não está configurada no servidor. O link externo continua funcionando.',
        code: 'not_configured',
        missingEnv: missing,
        envVars: REQUIRED_ENV_VARS,
        webhookPath: '/api/whatsapp/webhook',
      }, { status: 409 });
    }

    await updateDB((db) => {
      const b = db.businesses.find((x) => x.id === businessId);
      if (b) {
        b.whatsappIntegration = {
          ...(b.whatsappIntegration || { status: 'pending', phoneNumberId: '', wabaId: '', connectedAt: '', lastWebhookAt: '', requestedAt: '' }),
          status: 'pending',
          displayPhone,
          requestedAt: new Date().toISOString(),
        };
      }
      pushAudit(db, { action: 'whatsapp.connect_requested', actor: user, businessId, meta: { displayPhone } });
    });
    return NextResponse.json({
      ok: true,
      status: 'pending',
      message: 'Número registrado. A conexão fica pendente até o webhook da Meta validar a conta — depois disso o inbox recebe as conversas automaticamente.',
      webhookPath: '/api/whatsapp/webhook',
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível registrar a conexão.' }, { status: 500 });
  }
}
