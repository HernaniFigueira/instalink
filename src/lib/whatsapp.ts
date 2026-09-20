// ═══════════════════════════════════════════════════════════════
// WHATSAPP — estrutura de integração (sem credenciais no banco)
// ═══════════════════════════════════════════════════════════════
// O produto abre o WhatsApp externamente (link wa.me) como FALLBACK.
// Este módulo prepara e gerencia o estado da integração OFICIAL:
//
//   • identificadores públicos da conta (phone number id / WABA id)
//   • status de conexão por empresa
//   • conversas, mensagens e associação com contato/lead do CRM
//   • webhook (verificação por token de ambiente e assinatura Meta)
//
// REGRA DE HONESTIDADE: nada aqui finge estar conectado. `integrationStatus`
// só devolve 'connected' quando a empresa tem credenciais válidas configuradas
// (no próprio Business de forma criptografada ou no servidor).
// Tokens nunca são expostos em plaintext ao frontend.
import type { Business, WhatsappIntegration, WhatsappStatus } from './types';

export function defaultWhatsappIntegration(): WhatsappIntegration {
  return {
    provider: 'meta_cloud',
    status: 'not_connected',
    displayPhone: '',
    phoneNumberId: '',
    wabaId: '',
    connectedAt: '',
    lastWebhookAt: '',
    requestedAt: '',
  };
}

/** Credenciais globais existem no SERVIDOR? (nunca expostas ao cliente) */
export function serverCredentialsConfigured(): boolean {
  return !!(
    process.env.WHATSAPP_API_TOKEN &&
    (process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_WABA_ID)
  );
}

export function webhookVerifyToken(): string {
  return process.env.WHATSAPP_VERIFY_TOKEN || '';
}

/** Máscara para IDs técnicos (exibe apenas os 4 últimos dígitos). */
export function maskTechnicalId(id?: string): string {
  const val = String(id || '').trim();
  if (!val) return '';
  if (val.length <= 4) return val;
  return `••••••••${val.slice(-4)}`;
}

export const maskPhoneNumberId = maskTechnicalId;
export const maskWabaId = maskTechnicalId;

/**
 * Status real da integração de uma empresa.
 * A conta é considerada configurada se possui token próprio criptografado
 * OU se o servidor possui variáveis globais configuradas.
 */
export function integrationStatus(
  business: Pick<Business, 'whatsappIntegration'>,
  serverConfigured = true,
): WhatsappIntegration {
  const cfg = { ...defaultWhatsappIntegration(), ...(business.whatsappIntegration || {}) };
  if (cfg.provider === 'whatsapp_web') return cfg;
  const hasBusinessCredentials = !!(cfg.phoneNumberId && cfg.encryptedAccessToken);
  const isConfigured = hasBusinessCredentials || serverConfigured;

  if (cfg.status === 'connected' && !isConfigured) {
    // Credenciais removidas → volta a pendente
    return { ...cfg, status: 'pending' };
  }
  return cfg;
}

export function isConnected(
  business: Pick<Business, 'whatsappIntegration'>,
  serverConfigured = true,
): boolean {
  return integrationStatus(business, serverConfigured).status === 'connected';
}

/** Rótulos/UX de estado (usado pelo painel e pela página). */
export function whatsappStateLabel(
  business: Pick<Business, 'whatsappIntegration' | 'whatsapp'>,
  serverConfigured = true,
): {
  state: WhatsappStatus | 'link_only';
  label: string;
  detail: string;
} {
  const cfg = integrationStatus(business, serverConfigured);
  if (cfg.status === 'connected') {
    return {
      state: 'connected',
      label: 'Conectado',
      detail: cfg.displayPhone || (cfg.phoneNumberId ? `Conta oficial ${maskTechnicalId(cfg.phoneNumberId)}` : 'Conta oficial conectada'),
    };
  }
  if (cfg.status === 'pending') {
    // "Configurando" deixou de ser genérico: quando falta registrar o número,
    // a unidade precisa saber EXATAMENTE o que falta (senão o número nunca
    // envia, e o painel dizia que estava tudo certo).
    const missingRegistration = (cfg as any).registrationRequired === true && !(cfg as any).registeredAt;
    return {
      state: 'pending',
      label: missingRegistration ? 'Falta registrar o número' : 'Configurando',
      detail: cfg.lastError
        ? `Configuração pendente: ${cfg.lastError}`
        : missingRegistration
          ? 'Conta autorizada — informe o PIN de duas etapas para registrar o número e concluir.'
          : 'Aguardando validação da conta oficial junto à Meta.',
    };
  }
  if (cfg.status === 'error') {
    return {
      state: 'error',
      label: 'Erro',
      detail: cfg.lastError || 'Falha recente na comunicação com a API do WhatsApp.',
    };
  }
  return business.whatsapp
    ? { state: 'link_only', label: 'Não conectado (link apenas)', detail: 'Converse pelo app wa.me, sem integração oficial ainda.' }
    : { state: 'not_connected', label: 'Não conectado', detail: 'Cadastre um número oficial para receber e responder conversas.' };
}

// ── Variáveis de ambiente necessárias (exibidas na configuração) ──
export const REQUIRED_ENV_VARS = [
  'WHATSAPP_API_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
] as const;

export function missingEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
}

// ── Normalização de telefone para casar conversa ↔ contato do CRM ──
export function phoneKey(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.replace(/^55(\d{10,11})$/, '$1');
}
