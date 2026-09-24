// ═══════════════════════════════════════════════════════════════
// F3-G · WhatsAppCloudProvider — Cloud API oficial (Graph)
// ═══════════════════════════════════════════════════════════════
// Encapsula auth, URL, versão (META_GRAPH_VERSION), payload, parse e erros.
// Resultado SEMPRE normalizado — payload Meta bruto NÃO vira UI.
// Credencial: Business.whatsappIntegration.encryptedAccessToken (AES-GCM)
// ou env server-side mono-tenant (PILOT_ONLY_SINGLE_CREDENTIAL).

import {
  getWhatsappCredentials,
  isRetryableMetaStatus,
  sendMetaGraphMessage,
} from '../whatsapp-cloud-api';
import { integrationStatus, serverCredentialsConfigured } from '../whatsapp';
import type { DB } from '../types';
import type {
  ConnectionStatusView, MessagingProvider, MessagingResult,
  SendInteractiveParams, SendTemplateParams, SendTextParams,
} from './types';

export const WHATSAPP_CLOUD_PROVIDER_ID = 'whatsapp_cloud' as const;

/** Erros Meta → mensagem amigável UI (sem token/payload). */
export function friendlyMetaError(errorCode?: number, raw?: string): string {
  // Códigos comuns documentados
  if (errorCode === 10) return 'Número de destino inválido.';
  if (errorCode === 131026 || errorCode === 131047) return 'Mensagem não entregue pelo WhatsApp.';
  if (errorCode === 131056) return 'Número do paciente não está no WhatsApp.';
  if (errorCode === 133010 || errorCode === 470) return 'Conversa fora da janela — use um template aprovado.';
  if (errorCode === 190) return 'Credencial expirada. Atualize a conexão do WhatsApp.';
  return 'Não foi possível enviar a mensagem.';
}

function toResult(
  ok: boolean,
  externalId: string | undefined,
  error: string | undefined,
  retryable: boolean | undefined,
  statusCode: number | undefined,
): MessagingResult {
  if (ok && externalId) {
    return {
      ok: true,
      provider: WHATSAPP_CLOUD_PROVIDER_ID,
      providerMessageId: externalId,
      status: 'accepted', // aceito pela API ≠ delivered (webhook confirma)
    };
  }
  const codeMatch = /\[(\d+)\]/.exec(error || '');
  const code = codeMatch ? Number(codeMatch[1]) : undefined;
  return {
    ok: false,
    provider: WHATSAPP_CLOUD_PROVIDER_ID,
    providerMessageId: '',
    status: 'failed',
    errorCode: code ?? statusCode,
    errorMessage: friendlyMetaError(code, error),
    retryable: retryable ?? isRetryableMetaStatus(statusCode, code),
  };
}

export class WhatsAppCloudProvider implements MessagingProvider {
  id = WHATSAPP_CLOUD_PROVIDER_ID;

  constructor(private readonly deps: {
    getDb?: () => Promise<DB> | DB;
    fetchFn?: typeof fetch;
  } = {}) {}

  private async resolveCreds(businessId: string) {
    const db = this.deps.getDb
      ? await this.deps.getDb()
      : null;
    if (!db) return null;
    const business = db.businesses.find((b) => b.id === businessId);
    if (!business) return null;
    return { business, creds: getWhatsappCredentials(business) };
  }

  getConnectionStatus(businessId: string): ConnectionStatusView | Promise<ConnectionStatusView> {
    return this.resolveStatus(businessId);
  }

  private async resolveStatus(businessId: string): Promise<ConnectionStatusView> {
    const resolved = await this.resolveCreds(businessId);
    if (!resolved) {
      return { provider: this.id, status: 'disconnected', detail: 'Unidade não encontrada.' };
    }
    const st = integrationStatus(resolved.business, serverCredentialsConfigured());
    if (!resolved.creds) {
      return {
        provider: this.id,
        status: 'disconnected',
        detail: 'Credencial WhatsApp ausente (BLOCKED_META_CREDENTIAL se env pilot não configurada).',
        phoneNumberId: resolved.business.whatsappIntegration?.phoneNumberId || '',
        displayPhoneNumber: resolved.business.whatsappIntegration?.displayPhone || '',
      };
    }
    if (st.status === 'connected') {
      return {
        provider: this.id,
        status: 'connected',
        phoneNumberId: resolved.creds.phoneNumberId,
        displayPhoneNumber: resolved.business.whatsappIntegration?.displayPhone || '',
      };
    }
    return {
      provider: this.id,
      status: 'configuring',
      detail: 'Configuração incompleta.',
      phoneNumberId: resolved.creds.phoneNumberId,
      displayPhoneNumber: resolved.business.whatsappIntegration?.displayPhone || '',
    };
  }

  async sendText(params: SendTextParams): Promise<MessagingResult> {
    const resolved = await this.resolveCreds(params.businessId);
    if (!resolved?.creds) {
      return {
        ok: false,
        provider: this.id,
        providerMessageId: '',
        status: 'awaiting_channel',
        errorMessage: 'WhatsApp não conectado.',
        retryable: false,
      };
    }
    const res = await sendMetaGraphMessage({
      phoneNumberId: resolved.creds.phoneNumberId,
      accessToken: resolved.creds.accessToken,
      to: params.to,
      body: params.body,
      fetchFn: this.deps.fetchFn,
    });
    return toResult(res.ok, res.externalId, res.error, res.retryable, res.statusCode);
  }

  async sendTemplate(params: SendTemplateParams): Promise<MessagingResult> {
    if (!params.templateName || !params.templateName.trim()) {
      return {
        ok: false,
        provider: this.id,
        providerMessageId: '',
        status: 'template_not_configured',
        errorMessage: 'Template não configurado.',
        retryable: false,
      };
    }
    const resolved = await this.resolveCreds(params.businessId);
    if (!resolved?.creds) {
      return {
        ok: false,
        provider: this.id,
        providerMessageId: '',
        status: 'awaiting_channel',
        errorMessage: 'WhatsApp não conectado.',
        retryable: false,
      };
    }
    const res = await sendMetaGraphMessage({
      phoneNumberId: resolved.creds.phoneNumberId,
      accessToken: resolved.creds.accessToken,
      to: params.to,
      body: '',
      template: {
        name: params.templateName,
        language: params.language || 'pt_BR',
        components: Array.isArray(params.components)
          ? (params.components as Array<Record<string, any>>)
          : [],
      },
      fetchFn: this.deps.fetchFn,
    });
    return toResult(res.ok, res.externalId, res.error, res.retryable, res.statusCode);
  }

  async sendInteractive(params: SendInteractiveParams): Promise<MessagingResult> {
    const resolved = await this.resolveCreds(params.businessId);
    if (!resolved?.creds) {
      return {
        ok: false,
        provider: this.id,
        providerMessageId: '',
        status: 'awaiting_channel',
        errorMessage: 'WhatsApp não conectado.',
        retryable: false,
      };
    }
    // Payload interactive button — via fetch direto do contrato encapsulado
    // (mesma base/versão/auth de sendMetaGraphMessage).
    const { getMetaGraphBaseUrl } = await import('../whatsapp-cloud-api');
    const to = params.to.replace(/\D/g, '');
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: String(params.body || '').slice(0, 1024) },
        action: {
          buttons: params.buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: String(b.id).slice(0, 64), title: String(b.title).slice(0, 20) },
          })),
        },
      },
    };
    try {
      const doFetch = this.deps.fetchFn || fetch;
      const res = await doFetch(`${getMetaGraphBaseUrl()}/${resolved.creds.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resolved.creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorCode = data?.error?.code;
        return toResult(false, undefined, `[${errorCode}] ${data?.error?.message || res.status}`, isRetryableMetaStatus(res.status, errorCode), res.status);
      }
      const id = data?.messages?.[0]?.id;
      if (typeof id !== 'string' || !id.trim()) {
        return {
          ok: false,
          provider: this.id,
          providerMessageId: '',
          status: 'failed',
          errorMessage: 'Resposta sem identificador de mensagem.',
          retryable: false,
        };
      }
      return { ok: true, provider: this.id, providerMessageId: id.trim(), status: 'accepted' };
    } catch (err: any) {
      return {
        ok: false,
        provider: this.id,
        providerMessageId: '',
        status: 'failed',
        errorMessage: friendlyMetaError(undefined, err?.message),
        retryable: true,
      };
    }
  }
}

export const whatsappCloudProvider = new WhatsAppCloudProvider();
