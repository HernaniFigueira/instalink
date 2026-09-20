import type { WhatsappProvider } from './types';
/** Operational metadata only. Never accepts payload/body/phone or arbitrary errors. */
export function logWhatsapp(input: {
  provider: WhatsappProvider; businessId: string; instance?: string;
  direction: 'in' | 'out'; event: 'inbound' | 'delivery'; externalId: string;
  status: string; error?: 'provider_error' | 'processing_error';
}) {
  console.info(JSON.stringify({ ...input, timestamp: new Date().toISOString() }));
}
