import { NextRequest, NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { updateDB } from '@/lib/db';
import { defaultWhatsappIntegration, maskTechnicalId } from '@/lib/whatsapp';
import { computeConnectionStatus, type UnitIntegrationView } from '@/lib/whatsapp-onboarding';
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

  const rawWi = business.whatsappIntegration || defaultWhatsappIntegration();
  const computed = computeConnectionStatus(rawWi as UnitIntegrationView);

  return NextResponse.json({
    status: computed.status,
    connected: computed.connected,
    onboardingType: computed.onboardingType,
    registrationRequired: computed.registrationRequired,
    displayPhone: rawWi.displayPhone || '',
    phoneNumberId: maskTechnicalId(rawWi.phoneNumberId),
    wabaId: maskTechnicalId(rawWi.wabaId),
    verifiedName: rawWi.verifiedName || '',
    connectedAt: computed.connected ? (rawWi.connectedAt || '') : '',
    lastWebhookAt: rawWi.lastWebhookAt || '',
    lastInboundAt: rawWi.lastInboundAt || '',
    lastOutboundAt: rawWi.lastOutboundAt || '',
    lastError: computed.connected ? (rawWi.lastError || '') : (rawWi.lastError || computed.reason || ''),
    hasCredentials: !!rawWi.encryptedAccessToken,
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
    const body = await req.json();
    const action = String(body.action || 'configure');

    // Desconectar pelo Master
    if (action === 'disconnect') {
      await updateDB((d) => {
        const b = d.businesses.find((x) => x.id === id);
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

    // 3. Centralização: passa pela autoridade única de computeConnectionStatus
    // REGRA DE HONESTIDADE: A configuração manual do Master NÃO pode fabricar evidências
    // (webhookSubscribedAt, registeredAt, coexistenceConfirmedAt).
    // Ela valida e guarda o token, número e WABA, mantendo o status honesto ('pending')
    // até que as etapas oficiais da Meta sejam executadas.
    const existingWi = business.whatsappIntegration || defaultWhatsappIntegration();
    const candidateWi: Partial<UnitIntegrationView> = {
      ...existingWi,
      phoneNumberId,
      wabaId: wabaId || existingWi.wabaId || '',
      displayPhone: testResult.displayPhoneNumber || displayPhone || existingWi.displayPhone || '',
      encryptedAccessToken: encryptedToken,
      verifiedName: testResult.verifiedName,
      source: 'master',
      tokenIssuedAt: now,
      // Preserva dados se já comprovados anteriormente, mas NUNCA inventa novas evidências
      webhookSubscribedAt: existingWi.webhookSubscribedAt,
      registeredAt: existingWi.registeredAt,
      registrationRequired: existingWi.registrationRequired ?? true,
      onboardingType: existingWi.onboardingType || 'unknown',
    };

    const computed = computeConnectionStatus(candidateWi);

    // Persiste no Business após validação e computação
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === id);
      if (b) {
        b.whatsappIntegration = {
          ...candidateWi,
          status: computed.status,
          connectedAt: computed.connected ? (b.whatsappIntegration?.connectedAt || now) : '',
          lastError: computed.connected ? undefined : computed.reason,
        } as any;
      }
      pushAudit(d, {
        action: 'business.updated_by_master',
        actor: user,
        businessId: id,
        meta: {
          whatsappAction: 'configured',
          phoneNumberIdMasked: maskTechnicalId(phoneNumberId),
          verifiedName: testResult.verifiedName,
          status: computed.status,
        },
      });
    });

    return NextResponse.json({
      ok: computed.connected,
      status: computed.status,
      verifiedName: testResult.verifiedName,
      displayPhone: testResult.displayPhoneNumber || displayPhone,
      phoneNumberId: maskTechnicalId(phoneNumberId),
      message: computed.connected
        ? 'Conta oficial do WhatsApp conectada com sucesso à unidade.'
        : `Credenciais salvas, mas a integração permanece como ${computed.status}: ${computed.reason}`,
    });
  } catch {
    return NextResponse.json({ error: 'Erro ao configurar credenciais do WhatsApp.' }, { status: 500 });
  }
}
