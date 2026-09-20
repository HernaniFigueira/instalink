// Server facade: application callers don't need to know the transport vendor.
import type { Business } from './types';
import { integrationStatus, serverCredentialsConfigured } from './whatsapp';
import { evolutionConfigured } from './whatsapp-providers/evolution';

export function whatsappServerConfigured(business: Pick<Business, 'whatsappIntegration'>) {
  return business.whatsappIntegration?.provider === 'whatsapp_web'
    ? evolutionConfigured() : serverCredentialsConfigured();
}
export function whatsappChannelStatus(business: Pick<Business, 'whatsappIntegration'>) {
  return integrationStatus(business, whatsappServerConfigured(business));
}
