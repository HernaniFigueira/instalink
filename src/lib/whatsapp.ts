// ═══════════════════════════════════════════════════════════════
// WHATSAPP — estrutura de integração (sem credenciais no banco)
// ═══════════════════════════════════════════════════════════════
// Hoje o produto abre o WhatsApp externamente (link wa.me). Isso continua
// valendo como FALLBACK. Este módulo prepara a integração OFICIAL:
//
//   • identificadores públicos da conta (phone number id / WABA id)
//   • status de conexão por empresa
//   • conversas, mensagens e associação com contato/lead do CRM
//   • webhook (verificação por token de ambiente)
//
// REGRA DE HONESTIDADE: nada aqui finge estar conectado. `integrationStatus`
// só devolve 'connected' quando o servidor tem credenciais configuradas E a
// empresa tem uma conta registrada. Tokens vivem em variáveis de ambiente
// (WHATSAPP_*), nunca no banco, nunca no frontend.
import type { Business, WhatsappIntegration } from './types';

export function defaultWhatsappIntegration(): WhatsappIntegration {
  return {
    status: 'not_connected',
    displayPhone: '',
    phoneNumberId: '',
    wabaId: '',
    connectedAt: '',
    lastWebhookAt: '',
    requestedAt: '',
  };
}

/** Credenciais existem no SERVIDOR? (nunca expostas ao cliente) */
export function serverCredentialsConfigured(): boolean {
  return !!(
    process.env.WHATSAPP_API_TOKEN &&
    (process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_WABA_ID)
  );
}

export function webhookVerifyToken(): string {
  return process.env.WHATSAPP_VERIFY_TOKEN || '';
}

/**
 * Status real da integração de uma empresa. O status persistido é elevado a
 * 'connected' apenas quando: (a) a empresa registrou a conta e (b) o servidor
 * tem credenciais. Caso contrário o produto mostra "não conectado".
 * `serverConfigured` é injetado por quem chama (evita ler env no cliente).
 */
export function integrationStatus(
  business: Pick<Business, 'whatsappIntegration'>,
  serverConfigured = true,
): WhatsappIntegration {
  const cfg = { ...defaultWhatsappIntegration(), ...(business.whatsappIntegration || {}) };
  if (cfg.status === 'connected' && !serverConfigured) {
    // Credenciais removidas do servidor → não mentimos: volta a pendente.
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
  state: 'not_connected' | 'pending' | 'connected' | 'link_only';
  label: string;
  detail: string;
} {
  const cfg = integrationStatus(business, serverConfigured);
  if (cfg.status === 'connected') {
    return { state: 'connected', label: 'WhatsApp conectado', detail: cfg.displayPhone || 'Conta oficial conectada' };
  }
  if (cfg.status === 'pending') {
    return {
      state: 'pending',
      label: 'Conexão em andamento',
      detail: serverConfigured
        ? 'Aguardando a conclusão do cadastro da conta oficial.'
        : 'O servidor ainda não tem as credenciais oficiais configuradas.',
    };
  }
  return business.whatsapp
    ? { state: 'link_only', label: 'Abre o WhatsApp (link)', detail: 'Converse pelo app, sem integração oficial ainda.' }
    : { state: 'not_connected', label: 'Não conectado', detail: 'Cadastre um número para receber conversas.' };
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
