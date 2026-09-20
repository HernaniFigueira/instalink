// Evolution API 2.3.7 only. Server-side transport; no CRM/business rules here.
// Source contract: github.com/EvolutionAPI/evolution-api/tree/2.3.7/src/api
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { assertOutsideDBTransaction } from '../db-transaction';
import type { WhatsappStatus } from '../types';

export const EVOLUTION_NOT_CONFIGURED = 'Provider experimental ainda não configurado no servidor.';
export class EvolutionError extends Error {
  constructor(public status = 502) {
    // Never interpolate upstream body, URL, headers or exception.message (may contain secrets).
    super(status === 503 ? EVOLUTION_NOT_CONFIGURED : `Falha no provider experimental (HTTP ${status}). Tente novamente ou consulte o suporte.`);
  }
}
function config() {
  const url = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '') || '';
  const key = process.env.EVOLUTION_API_KEY || '';
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  const webhook = process.env.EVOLUTION_WEBHOOK_URL || '';
  try {
    for (const value of [url, webhook]) {
      const u = new URL(value);
      if (u.username || u.password || u.search || u.hash || !['https:', 'http:'].includes(u.protocol)) throw new Error();
      if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') throw new Error();
    }
    if (!key || secret.length < 32) throw new Error();
    return { url, key, secret, webhook };
  } catch { throw new EvolutionError(503); }
}
export function evolutionConfigured() {
  try { config(); return true; } catch { return false; }
}
export function evolutionInstanceName(businessId: string) {
  return `il_${createHash('sha256').update(businessId).digest('hex').slice(0, 32)}`;
}
export function webhookToken(instance: string) {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  if (secret.length < 32) throw new EvolutionError(503);
  return createHmac('sha256', secret).update(instance).digest('hex');
}
export function validEvolutionWebhook(instance: string, supplied: string | null) {
  try {
    const expected = Buffer.from(webhookToken(instance));
    const actual = Buffer.from(supplied || '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
export function evolutionState(state: unknown): WhatsappStatus {
  if (state === 'open') return 'connected';
  if (state === 'connecting') return 'connecting';
  if (state === 'close' || state === 'closed') return 'disconnected';
  return 'error';
}

export class EvolutionClient {
  constructor(private fetchFn: typeof fetch = fetch) {}
  private async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    assertOutsideDBTransaction();
    const c = config();
    try {
      const response = await this.fetchFn(`${c.url}${path}`, {
        method, headers: { apikey: c.key, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12_000), cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) throw new EvolutionError(response.status);
      const data = await response.json();
      if (data?.error) throw new EvolutionError(502);
      return data;
    } catch (err) {
      if (err instanceof EvolutionError) throw err;
      throw new EvolutionError(502);
    }
  }
  private webhook(instance: string) {
    return { enabled: true, url: config().webhook, byEvents: false, base64: false,
      headers: { 'x-instalink-webhook-secret': webhookToken(instance) },
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] };
  }
  async create(instance: string) {
    await this.request('/instance/create', 'POST', {
      instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: false,
      groupsIgnore: true, readMessages: false, readStatus: false, syncFullHistory: false,
      webhook: this.webhook(instance),
    });
  }
  async configureWebhook(instance: string) {
    await this.request(`/webhook/set/${encodeURIComponent(instance)}`, 'POST', { webhook: this.webhook(instance) });
  }
  async find(instance: string): Promise<{ phone: string } | null> {
    const data = await this.request(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    if (!Array.isArray(data)) throw new EvolutionError();
    // Never return the raw instance (contains token and webhook headers).
    const item = data.find((x: any) => x?.name === instance || x?.instance?.instanceName === instance);
    if (!item) return null;
    const jid = String(item.ownerJid || item.instance?.owner || '');
    return { phone: jid.replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '') };
  }
  async status(instance: string) {
    const data = await this.request(`/instance/connectionState/${encodeURIComponent(instance)}`);
    if (data?.instance?.instanceName !== instance) throw new EvolutionError();
    const status = evolutionState(data.instance.state);
    if (status === 'error') throw new EvolutionError();
    return status;
  }
  async qr(instance: string): Promise<string | null> {
    const data = await this.request(`/instance/connect/${encodeURIComponent(instance)}`);
    if (data?.instance?.state === 'open') return null;
    const qr = data?.qrcode || data;
    // Re-encode the raw QR text; never accept a remote image URL or SVG/HTML.
    if (typeof qr.code === 'string' && qr.code.length > 0 && qr.code.length <= 4096) {
      return QRCode.toDataURL(qr.code, { width: 360, margin: 4 });
    }
    if (typeof qr.base64 === 'string' && qr.base64.length < 300_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr.base64)) return qr.base64;
    // QR may not be ready yet; UI offers refresh, never invents one.
    return null;
  }
  async disconnect(instance: string) {
    if (await this.status(instance) !== 'disconnected') await this.request(`/instance/logout/${encodeURIComponent(instance)}`, 'DELETE');
  }
  async remove(instance: string) {
    await this.request(`/instance/delete/${encodeURIComponent(instance)}`, 'DELETE');
  }
  async sendText(instance: string, phone: string, text: string) {
    const data = await this.request(`/message/sendText/${encodeURIComponent(instance)}`, 'POST', { number: phone, text });
    if (typeof data?.key?.id !== 'string' || !data.key.id) throw new EvolutionError();
    return data.key.id as string;
  }
}

/** Only live 1:1 text messages. Ignore history, own echoes, groups, broadcasts and LID-only identities. */
export function normalizeEvolutionMessage(data: any) {
  const key = data?.key;
  if (!key || key.fromMe !== false || typeof key.id !== 'string' || key.id.length > 200) return null;
  const jid = [key.remoteJid, key.remoteJidAlt].find((v) => typeof v === 'string' && /^\d{10,15}@s\.whatsapp\.net$/.test(v));
  // A group sender alt must never turn a group event into a direct message.
  if (typeof key.remoteJid !== 'string' || /@(g\.us|broadcast|newsletter)$/.test(key.remoteJid) || !jid) return null;
  const body = data.message?.conversation || data.message?.extendedTextMessage?.text;
  if (typeof body !== 'string' || !body.trim()) return null;
  return { externalId: key.id, phone: jid.split('@')[0], body: body.slice(0, 4000),
    name: typeof data.pushName === 'string' ? data.pushName.slice(0, 80) : '',
    timestamp: typeof data.messageTimestamp === 'number' ? String(data.messageTimestamp) : undefined };
}
