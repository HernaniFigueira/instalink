import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '../db';
import { defaultWhatsappIntegration } from '../whatsapp';
import { pushAudit } from '../audit';
import type { AuditInput } from '../audit';
import type { Business, WhatsappStatus } from '../types';
import { EvolutionClient, evolutionConfigured, evolutionInstanceName, EvolutionError } from './evolution';

export type ExperimentalAction = 'connect' | 'qr' | 'status' | 'disconnect' | 'remove';
export function experimentalView(business: Business) {
  const i = business.whatsappIntegration;
  const selected = i?.provider === 'whatsapp_web';
  return {
    configured: evolutionConfigured(), selected,
    status: !evolutionConfigured() ? 'not_configured' : selected ? i.status : 'not_connected',
    displayPhone: selected ? i.displayPhone : '', connectedAt: selected ? i.connectedAt : '',
    lastWebhookAt: selected ? i.lastWebhookAt : '', lastInboundAt: selected ? i.lastInboundAt || '' : '',
    lastOutboundAt: selected ? i.lastOutboundAt || '' : '', lastError: selected ? i.lastError || '' : '',
  };
}
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });

/** Serializes lifecycle across server instances using the SAME DB transaction/lease.
 * No network in a transaction. Provider binding is persisted BEFORE remote creation.
 */
export async function experimentalLifecycle(businessId: string, action: ExperimentalAction,
  actor: AuditInput['actor'], client = new EvolutionClient()) {
  if (!evolutionConfigured()) throw new EvolutionError(503);
  const claim = randomUUID();
  const instance = await updateDB((d) => {
    const b = d.businesses.find((x) => x.id === businessId);
    if (!b) throw fail('Unidade não encontrada.', 404);
    const i = b.whatsappIntegration ||= defaultWhatsappIntegration();
    if (i.lifecycleClaim && Date.parse(i.lifecycleExpiresAt || '') > Date.now()) throw fail('Conexão sendo atualizada. Aguarde alguns segundos.');
    if (i.provider !== 'whatsapp_web') {
      if (action !== 'connect') throw fail('A unidade não tem conexão experimental.');
      if (i.status === 'connected' || i.status === 'pending') throw fail('Desconecte o WhatsApp oficial antes de trocar de conexão.');
      i.provider = 'whatsapp_web';
      i.instanceName = evolutionInstanceName(businessId);
      i.status = 'not_connected';
      i.displayPhone = ''; i.connectedAt = ''; i.lastError = '';
      i.lastWebhookAt = ''; i.lastInboundAt = ''; i.lastOutboundAt = '';
      pushAudit(d, { action: 'whatsapp.provider_changed', businessId, actor, meta: { provider: 'whatsapp_web' } });
    }
    if (!i.instanceName) throw fail('Conexão sem vínculo de instância. Consulte o suporte.');
    if (d.businesses.some((x) => x.id !== businessId && x.whatsappIntegration?.instanceName === i.instanceName)) throw fail('Vínculo de instância inválido.');
    i.lifecycleClaim = claim;
    i.lifecycleExpiresAt = new Date(Date.now() + 120_000).toISOString();
    return i.instanceName;
  });
  let qr: string | null = null;
  let created = false;
  try {
    let phone: string | undefined;
    let status: WhatsappStatus;
    if (action === 'connect' || action === 'qr') {
      if (!await client.find(instance)) { await client.create(instance); created = true; }
      await client.configureWebhook(instance);
      status = await client.status(instance);
      if (status !== 'connected') {
        qr = await client.qr(instance);
        status = qr ? 'qr_pending' : await client.status(instance);
      }
      if (status === 'connected') phone = (await client.find(instance))?.phone;
    } else if (action === 'disconnect') {
      await client.disconnect(instance);
      status = 'disconnected';
    } else if (action === 'remove') {
      if (await client.find(instance)) await client.remove(instance);
      status = 'not_connected';
    } else {
      status = await client.status(instance);
      if (status === 'connected') phone = (await client.find(instance))?.phone;
    }
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === businessId)!;
      const i = b.whatsappIntegration!;
      if (i.lifecycleClaim !== claim || i.instanceName !== instance) throw fail('Estado alterado; atualize a conexão.');
      const previous = i.status;
      // Preserve pending QR while the remote socket is still connecting.
      i.status = status === 'connecting' && previous === 'qr_pending' ? 'qr_pending' : status;
      i.lastError = ''; i.lastErrorAt = undefined;
      if (phone !== undefined) i.displayPhone = phone;
      const audit = (action: AuditInput['action']) => pushAudit(d, { action, businessId, actor, meta: { provider: 'whatsapp_web', instance } });
      if (created) audit('whatsapp.experimental_instance_created');
      if (qr) { i.requestedAt = new Date().toISOString(); audit('whatsapp.experimental_qr_generated'); }
      if (status === 'connected' && previous !== 'connected') {
        i.connectedAt = new Date().toISOString(); audit('whatsapp.experimental_connected');
      }
      if (status === 'disconnected' && previous !== 'disconnected') audit('whatsapp.experimental_disconnected');
      if (action === 'remove') {
        audit('whatsapp.experimental_removed');
        audit('whatsapp.provider_changed');
        i.provider = 'meta_cloud'; i.instanceName = undefined; i.displayPhone = ''; i.connectedAt = '';
      }
      i.lifecycleClaim = undefined; i.lifecycleExpiresAt = undefined;
    });
    const b = (await readDB()).businesses.find((x) => x.id === businessId)!;
    return { ...experimentalView(b), qr };
  } catch (err) {
    // Only our own known errors are eligible for persistence/response.
    const safe = err instanceof EvolutionError ? err : new EvolutionError();
    await updateDB((d) => {
      const i = d.businesses.find((x) => x.id === businessId)?.whatsappIntegration;
      if (i?.lifecycleClaim === claim) {
        i.status = 'error'; i.lastError = safe.message; i.lastErrorAt = new Date().toISOString();
        i.lifecycleClaim = undefined; i.lifecycleExpiresAt = undefined;
      }
    });
    throw safe;
  }
}
