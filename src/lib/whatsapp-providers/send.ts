// Single transport decision for inbox, agent, existing outbox/cron and connector.
import type { Business } from '../types';
import { getWhatsappCredentials, sendMetaGraphMessage } from '../whatsapp-cloud-api';
import { EvolutionClient, EvolutionError, evolutionConfigured } from './evolution';

export function whatsappTransportReady(business: Business) {
  if (business.whatsappIntegration?.provider === 'whatsapp_web') {
    return evolutionConfigured() && business.whatsappIntegration.status === 'connected' && !!business.whatsappIntegration.instanceName;
  }
  return !!getWhatsappCredentials(business);
}
export async function sendWhatsappText(business: Business, input: {
  to: string; body: string; template?: { name: string; language: string; components?: any[] }; fetchFn?: typeof fetch;
}) {
  const i = business.whatsappIntegration;
  if (i?.provider !== 'whatsapp_web') {
    const credentials = getWhatsappCredentials(business);
    if (!credentials) return { ok: false, error: 'WhatsApp não configurado para esta unidade.', retryable: false };
    return sendMetaGraphMessage({ ...credentials, ...input });
  }
  if (!whatsappTransportReady(business)) return { ok: false, error: 'Conexão experimental indisponível.', retryable: false };
  if (input.template) return { ok: false, error: 'Templates Meta não são suportados na conexão experimental.', retryable: false };
  try {
    // Channel JID is preferred by the caller; legacy CRM phones use Brazilian DDD.
    const digits = input.to.replace(/\D/g, '');
    const phone = digits.length <= 11 ? `55${digits}` : digits;
    const externalId = await new EvolutionClient(input.fetchFn).sendText(i.instanceName!, phone, input.body);
    return { ok: true, externalId };
  } catch (err) {
    const e = err instanceof EvolutionError ? err : new EvolutionError();
    // Timeout/unknown network outcome is NOT automatically retried: Evolution sendText
    // has no documented idempotency key. Retrying blindly could duplicate a message.
    return { ok: false, error: e.message, retryable: e.status === 429 };
  }
}
