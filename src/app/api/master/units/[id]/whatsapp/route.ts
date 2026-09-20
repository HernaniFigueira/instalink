import { NextRequest, NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { updateDB } from '@/lib/db';
import { defaultWhatsappIntegration, maskTechnicalId } from '@/lib/whatsapp';
import { encryptSecret, testMetaConnection } from '@/lib/whatsapp-cloud-api';
import { onlyDigits } from '@/lib/utils';

// Rota de onboarding e gestão da WhatsApp Cloud API exclusiva para MASTER.
// Permite cadastrar e validar credenciais seguras por unidade.
// Os tokens são criptografados com AES-256-GCM em repouso e NUNCA retornados na API.
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db } = guard;

  const { id } = await Promise.resolve(params);
  const business = db.businesses.find((b) => b.id === id);
  if (!business) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 });

  const wi = business.whatsappIntegration || defaultWhatsappIntegration();

  return NextResponse.json({
    status: wi.status,
    displayPhone: wi.displayPhone || '',
    phoneNumberId: maskTechnicalId(wi.phoneNumberId),
    wabaId: maskTechnicalId(wi.wabaId),
    verifiedName: wi.verifiedName || '',
    connectedAt: wi.connectedAt || '',
    lastWebhookAt: wi.lastWebhookAt || '',
    lastInboundAt: wi.lastInboundAt || '',
    lastOutboundAt: wi.lastOutboundAt || '',
    lastError: wi.lastError || '',
    hasCredentials: !!wi.encryptedAccessToken,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db, user } = guard;

  const { id } = await Promise.resolve(params);
  const business = db.businesses.find((b) => b.id === id);
  if (!business) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 });

  try {
    if (business.whatsappIntegration?.provider === 'whatsapp_web') return NextResponse.json({ error: 'Remova a conexão experimental em Canais antes de configurar a Meta.' }, { status: 409 });
    const body = await req.json();
    const action = String(body.action || 'configure');

    // Desconectar pelo Master
    if (action === 'disconnect') {
      await updateDB((d) => {
        const b = d.businesses.find((x) => x.id === id);
        if (b?.whatsappIntegration?.provider === 'whatsapp_web') throw new Error('Provider alterado durante a operação.');
      if (b) {
          b.whatsappIntegration = {
            ...defaultWhatsappIntegration(),
            status: 'not_connected',
          };
        }
        pushAudit(d, {
          action: 'business.updated_by_master',
          actor: user,
          businessId: id,
          meta: { whatsappAction: 'disconnect' },
        });
      });
      return NextResponse.json({ ok: true, status: 'not_connected', message: 'WhatsApp desconectado da unidade.' });
    }

    const phoneNumberId = String(body.phoneNumberId || '').trim();
    const accessToken = String(body.accessToken || '').trim();
    const wabaId = String(body.wabaId || '').trim();
    const displayPhone = onlyDigits(String(body.displayPhone || ''));

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({
        error: 'Phone Number ID e Access Token da Meta são obrigatórios.',
      }, { status: 400 });
    }

    if (!process.env.WHATSAPP_CREDENTIALS_KEY || process.env.WHATSAPP_CREDENTIALS_KEY.trim().length === 0) {
      return NextResponse.json({
        error: 'WHATSAPP_CREDENTIALS_KEY não está configurada no servidor. Não é possível salvar credenciais com segurança.',
        code: 'missing_credentials_key',
      }, { status: 503 });
    }

    // 1. Validação REAL junto à Graph API da Meta (fora de qualquer lock)
    const testResult = await testMetaConnection(phoneNumberId, accessToken);
    if (!testResult.ok) {
      return NextResponse.json({
        error: `Falha ao validar credenciais na Meta: ${testResult.error}`,
        code: 'meta_verification_failed',
      }, { status: 400 });
    }

    // 2. Criptografa o token de acesso (AES-256-GCM via chave exclusiva de ambiente)
    const encryptedToken = encryptSecret(accessToken);
    const now = new Date().toISOString();

    // 3. Persiste no Business apenas após validação confirmada
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === id);
      if (b?.whatsappIntegration?.provider === 'whatsapp_web') throw new Error('Provider alterado durante a operação.');
      if (b) {
        b.whatsappIntegration = {
          ...(b.whatsappIntegration || defaultWhatsappIntegration()),
          status: 'connected',
          phoneNumberId,
          wabaId,
          displayPhone: testResult.displayPhoneNumber || displayPhone || b.whatsappIntegration?.displayPhone || '',
          encryptedAccessToken: encryptedToken,
          verifiedName: testResult.verifiedName,
          connectedAt: now,
          lastError: undefined,
          // Origem da conexão: cadastro assistido pelo suporte, não o popup.
          // Aqui o suporte valida o token E o número contra a Meta antes de
          // gravar, então o número já é considerado registrado (o painel do
          // WhatsApp Manager é quem registra nesse caminho).
          source: 'master',
          tokenIssuedAt: now,
          webhookSubscribedAt: now,
          registeredAt: now,
          registrationRequired: false,
          onboardingType: 'unknown',
        };
      }
      pushAudit(d, {
        action: 'business.updated_by_master',
        actor: user,
        businessId: id,
        meta: {
          whatsappAction: 'configured',
          phoneNumberIdMasked: maskTechnicalId(phoneNumberId),
          verifiedName: testResult.verifiedName,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      status: 'connected',
      verifiedName: testResult.verifiedName,
      displayPhone: testResult.displayPhoneNumber || displayPhone,
      phoneNumberId: maskTechnicalId(phoneNumberId),
      message: 'Conta oficial do WhatsApp conectada com sucesso à unidade.',
    });
  } catch {
    return NextResponse.json({ error: 'Erro ao configurar credenciais do WhatsApp.' }, { status: 500 });
  }
}
