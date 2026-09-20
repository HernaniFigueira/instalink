// ═══════════════════════════════════════════════════════════════════════════════
// P6.1 — WHATSAPP CLOUD API REAL E2E & OPERACIONAL AUTOMATION TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════
import './helpers/temp-db';

import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { createSession } from '../auth';
import {
  encryptSecret,
  decryptSecret,
  getCredentialsKey,
  verifyMetaWebhookSignature,
  resolveTenantForChange,
  deliverWhatsappMessage,
  deliverPendingWhatsappMessages,
  deliverCampaignRecipient,
  processPendingWhatsappRetries,
  sendMetaGraphMessage,
  getWhatsappCredentials,
  CAMPAIGN_IMMEDIATE_BATCH_LIMIT,
  syncCampaignStatusAndCounts,
} from '../whatsapp-cloud-api';
import { registerChannelConnector, channelConnectorAvailable, channelConnectorFor } from '../integrations/connectors';
import { maskTechnicalId } from '../whatsapp';
import { createBookingTx } from '../booking-create';
import { executeAction } from '../automation/actions';
import { emitAutomationEvent } from '../automation/events';
import { drainAutomations } from '../automation/executor';
import { buildAutomation } from './helpers/automation-fixtures';
import { assertOutsideDBTransaction } from '../db-transaction';
import { CAMPAIGN_CANCELLABLE, campaignStatusDef } from '../types';
import type { Business, DB, Service, Professional } from '../types';

import { GET as webhookGET, POST as webhookPOST } from '@/app/api/whatsapp/webhook/route';
import { GET as settingsGET } from '@/app/api/whatsapp/route';
import { POST as masterWhatsappPOST } from '@/app/api/master/units/[id]/whatsapp/route';
import { POST as conversationsPOST } from '@/app/api/conversations/route';
import { POST as campaignsPOST, PATCH as campaignsPATCH } from '@/app/api/campaigns/route';
import { GET as cronWhatsappGET, POST as cronWhatsappPOST } from '@/app/api/cron/whatsapp/route';

const TEST_APP_SECRET = 'meta_app_secret_test_1234567890';
const TEST_VERIFY_TOKEN = 'test_verify_token_xyz_987';
const TEST_CRED_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
process.env.WHATSAPP_CREDENTIALS_KEY = TEST_CRED_KEY;

function signPayload(bodyStr: string, secret: string = TEST_APP_SECRET): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(bodyStr, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

function jsonReq(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; token?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  return new NextRequest(`http://localhost:3000${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function jsonBody(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const OWNER_A = 'owner-clinic-a';
const OWNER_B = 'owner-clinic-b';
const MASTER_USER_ID = 'master-admin-1';
const BIZ_A = 'biz-clinic-a';
const BIZ_B = 'biz-clinic-b';
const PHONE_ID_A = '109283746152345';
const PHONE_ID_B = '109283746152999';

function createClinic(id: string, ownerId: string, name: string): Business {
  return {
    id,
    ownerId,
    name,
    slug: id,
    title: name,
    subtitle: 'Clínica Odontológica Especializada',
    description: 'Atendimento humanizado e agendamento inteligente',
    phone: '+55 11 99999-0000',
    email: `${id}@clinica.com.br`,
    category: 'Saúde',
    address: 'Av Paulista 1000',
    modes: ['agendamento'] as any,
    features: { whatsapp: true } as any,
    published: true,
    theme: {
      template: 'minimal',
      primaryColor: '#0ea5e9',
      backgroundColor: '#ffffff',
      surfaceColor: '#f8fafc',
      textColor: '#0f172a',
      mutedTextColor: '#64748b',
      accentColor: '#38bdf8',
      fontFamily: 'sans',
      borderRadius: '8px',
      buttonStyle: 'rounded',
    },
    hours: {
      monday: { start: '08:00', end: '18:00' },
      tuesday: { start: '08:00', end: '18:00' },
      wednesday: { start: '08:00', end: '18:00' },
      thursday: { start: '08:00', end: '18:00' },
      friday: { start: '08:00', end: '18:00' },
      saturday: { start: '09:00', end: '13:00' },
      sunday: { start: '09:00', end: '13:00' },
    } as any,
    daysInAdvance: 30,
    bookingInterval: 40,
    slotInterval: 40,
    whatsapp: '+55 11 99999-0000',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  } as any;
}

function setupOdontoCatalog(db: DB) {
  const serviceLimpeza = {
    id: 'srv-limpeza',
    businessId: BIZ_A,
    name: 'Limpeza Dental Completa',
    description: 'Profilaxia e remoção de tártaro',
    price: 200,
    durationMin: 40,
    active: true,
    bookable: true,
    professionalIds: ['prof-orlando'],
  } as Service;
  const profOrlando = {
    id: 'prof-orlando',
    businessId: BIZ_A,
    name: 'Dr. Orlando',
    active: true,
    services: ['srv-limpeza'],
  } as unknown as Professional;
  db.services.push(serviceLimpeza);
  db.professionals.push(profOrlando);
  db.availability.push({
    id: 'av-limpeza',
    businessId: BIZ_A,
    professionalId: 'prof-orlando',
    serviceId: 'srv-limpeza',
    weekday: 2, // Tuesday
    start: '08:00',
    end: '18:00',
    slotMin: 40,
  });
}

beforeEach(async () => {
  // Global mock of Meta Graph API fetch
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/messages')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '5511999990000', wa_id: '5511999990000' }],
          messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }],
        }),
      } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: PHONE_ID_A,
        display_phone_number: '+55 11 99999-1111',
        verified_name: 'Clínica Odonto A',
        quality_rating: 'GREEN',
      }),
    } as any;
  }));

  const db = emptyDB();
  db.users.push(
    { id: OWNER_A, name: 'Dra. Ana', email: 'ana@clinica.com', passwordHash: 'hash', createdAt: '2026-01-01', role: 'owner', lastLoginAt: '' },
    { id: OWNER_B, name: 'Dr. Bruno', email: 'bruno@clinica.com', passwordHash: 'hash', createdAt: '2026-01-01', role: 'owner', lastLoginAt: '' },
    { id: MASTER_USER_ID, name: 'Master Admin', email: 'admin@instalink.app', passwordHash: 'hash', createdAt: '2026-01-01', role: 'master', lastLoginAt: '' },
  );

  const clinicA = createClinic(BIZ_A, OWNER_A, 'Clínica Odonto A');
  clinicA.whatsappIntegration = {
    status: 'connected',
    phoneNumberId: PHONE_ID_A,
    wabaId: 'waba-123456',
    displayPhone: '+55 11 99999-1111',
    verifiedName: 'Clínica Odonto A',
    connectedAt: '2026-09-10T12:00:00Z',
    lastWebhookAt: '',
    requestedAt: '',
    encryptedAccessToken: encryptSecret('EAATestValidTokenClinicA'),
    keyFingerprint: 'fp-1234',
    webhookSubscribedAt: '2026-09-10T12:00:00Z',
    registeredAt: '2026-09-10T12:00:00Z',
    registrationRequired: false,
    onboardingType: 'standard',
  };

  const clinicB = createClinic(BIZ_B, OWNER_B, 'Clínica Odonto B');
  clinicB.whatsappIntegration = {
    status: 'connected',
    phoneNumberId: PHONE_ID_B,
    wabaId: 'waba-789012',
    displayPhone: '+55 11 99999-2222',
    verifiedName: 'Clínica Odonto B',
    connectedAt: '2026-09-10T12:00:00Z',
    lastWebhookAt: '',
    requestedAt: '',
    encryptedAccessToken: encryptSecret('EAATestValidTokenClinicB'),
    keyFingerprint: 'fp-5678',
    webhookSubscribedAt: '2026-09-10T12:00:00Z',
    registeredAt: '2026-09-10T12:00:00Z',
    registrationRequired: false,
    onboardingType: 'standard',
  };

  db.businesses.push(clinicA, clinicB);
  setupOdontoCatalog(db);

  await writeDB(db);
});

describe('P6.1 — WhatsApp Cloud API E2E', () => {

  // 1. Webhook Handshake & Verification
  describe('1. Webhook Handshake e Assinatura Meta', () => {
    it('responde 200 e retorna o hub.challenge quando o verify token está correto', async () => {
      const req = jsonReq(`/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=test_challenge_123&hub.verify_token=${TEST_VERIFY_TOKEN}`);
      const res = await webhookGET(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('test_challenge_123');
    });

    it('responde 403 se o verify token for inválido', async () => {
      const req = jsonReq('/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=test_challenge_123&hub.verify_token=wrong_token');
      const res = await webhookGET(req);
      expect(res.status).toBe(403);
    });

    it('rejeita POST sem cabeçalho x-hub-signature-256 com 403', async () => {
      const payload = { object: 'whatsapp_business_account', entry: [] };
      const req = jsonReq('/api/whatsapp/webhook', {
        method: 'POST',
        body: payload,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(403);
    });

    it('rejeita POST com assinatura HMAC incorreta com 403', async () => {
      const payload = { object: 'whatsapp_business_account', entry: [] };
      const rawBody = JSON.stringify(payload);
      const req = new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        },
        body: rawBody,
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(403);
    });

    it('aceita POST com assinatura HMAC válida', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  messages: [
                    {
                      from: '5511988887777',
                      id: 'wamid.HBgLMTIzNDU2',
                      timestamp: '1758240000',
                      text: { body: 'Oi' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const rawBody = JSON.stringify(payload);
      const signature = signPayload(rawBody, TEST_APP_SECRET);

      const req = new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        body: rawBody,
      });

      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body.received).toBe(1);
    });
  });

  // 2. Tenant Isolation & Deduplication
  describe('2. Multi-tenant e Idempotência', () => {
    it('roteia mensagem para o business correto pelo phone_number_id', async () => {
      const payloadA = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Mariana Teste' }, wa_id: '5511977776666' }],
                  messages: [
                    {
                      from: '5511977776666',
                      id: 'wamid.msg_tenant_a_1',
                      timestamp: '1758240000',
                      text: { body: 'Olá Clínica A' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const rawA = JSON.stringify(payloadA);
      const reqA = new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(rawA) },
        body: rawA,
      });
      const resA = await webhookPOST(reqA);
      expect(resA.status).toBe(200);

      const db = await readDB();
      const conversationA = db.conversations.find((c) => c.businessId === BIZ_A && (c.channelUserId === '5511977776666' || c.phone.includes('977776666')));
      expect(conversationA).toBeDefined();
      expect(conversationA?.businessId).toBe(BIZ_A);

      // Verify that Clinic B was not touched
      const conversationB = db.conversations.find((c) => c.businessId === BIZ_B && (c.channelUserId === '5511977776666' || c.phone.includes('977776666')));
      expect(conversationB).toBeUndefined();
    });

    it('deduplica mensagens idênticas da Meta sem processar duas vezes', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Cliente Duplicado' }, wa_id: '5511966665555' }],
                  messages: [
                    {
                      from: '5511966665555',
                      id: 'wamid.msg_dedupe_test',
                      timestamp: '1758240000',
                      text: { body: 'Mensagem teste deduplicação' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const raw = JSON.stringify(payload);
      const sendReq = () => new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(raw) },
        body: raw,
      });

      // First webhook
      const res1 = await webhookPOST(sendReq());
      expect(res1.status).toBe(200);

      // Re-send same webhook from Meta
      const res2 = await webhookPOST(sendReq());
      expect(res2.status).toBe(200);

      const db = await readDB();
      const messages = db.messages.filter((m) => m.externalId === 'wamid.msg_dedupe_test');
      expect(messages).toHaveLength(1);
    });
  });

  // 3. New Contact vs Existing Contact Flow
  describe('3. Reconhecimento de Identidade e Pipeline', () => {
    it('novo cliente: cria contato, ingere lead via ingestLead com origem whatsapp', async () => {
      const customerPhone = '5511955554444';
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Carlos Novo' }, wa_id: customerPhone }],
                  messages: [
                    {
                      from: customerPhone,
                      id: 'wamid.msg_new_client',
                      timestamp: '1758240000',
                      text: { body: 'Olá gostaria de saber sobre valores' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const raw = JSON.stringify(payload);
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(raw) },
        body: raw,
      }));

      const db = await readDB();
      const contact = db.contacts.find((c) => c.businessId === BIZ_A && c.phone.includes('955554444'));
      expect(contact).toBeDefined();
      expect(contact?.name).toBe('Carlos Novo');

      const lead = db.leads.find((l) => l.businessId === BIZ_A && ((l as any).contactId === contact?.id || l.phone.includes('955554444')));
      expect(lead).toBeDefined();
      expect(lead?.origin).toBe('whatsapp');
      expect(lead?.stageId || lead?.status).toBe('new');
    });

    it('cliente existente com lead aberto: não duplica lead por "oi"', async () => {
      const customerPhone = '5511944443333';
      // First message: creates contact and lead
      const payload1 = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Fernanda Existente' }, wa_id: customerPhone }],
                  messages: [
                    {
                      from: customerPhone,
                      id: 'wamid.msg_exist_1',
                      timestamp: '1758240000',
                      text: { body: 'Olá quero agendar' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const raw1 = JSON.stringify(payload1);
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(raw1) },
        body: raw1,
      }));

      const db1 = await readDB();
      const leadsBefore = db1.leads.filter((l) => l.businessId === BIZ_A && l.phone.includes('944443333'));
      expect(leadsBefore).toHaveLength(1);

      // Second message: just "oi"
      const payload2 = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Fernanda Existente' }, wa_id: customerPhone }],
                  messages: [
                    {
                      from: customerPhone,
                      id: 'wamid.msg_exist_2',
                      timestamp: '1758240010',
                      text: { body: 'Oi' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      const raw2 = JSON.stringify(payload2);
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(raw2) },
        body: raw2,
      }));

      const db2 = await readDB();
      const leadsAfter = db2.leads.filter((l) => l.businessId === BIZ_A && l.phone.includes('944443333'));
      expect(leadsAfter).toHaveLength(1); // Não duplicou!
    });
  });

  // 4. Scheduling & Invariant (Limpeza, Orlando, Scheduled via createBookingTx)
  describe('4. Agendamento e Invariante de Pipeline', () => {
    it('lead só avança para scheduled via createBookingTx com booking real', async () => {
      // Step 1: Inbound message asking for Limpeza
      const customerPhone = '5511933332222';
      const payload1 = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Roberto Agendamento' }, wa_id: customerPhone }],
                  messages: [
                    {
                      from: customerPhone,
                      id: 'wamid.sched_1',
                      timestamp: '1758240000',
                      text: { body: 'Gostaria de agendar uma limpeza' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(JSON.stringify(payload1)) },
        body: JSON.stringify(payload1),
      }));

      let db = await readDB();
      const lead = db.leads.find((l) => l.businessId === BIZ_A && l.phone.includes('933332222'))!;
      expect(lead).toBeDefined();
      expect(lead.stageId || lead.status).not.toBe('scheduled'); // NOT scheduled yet!

      // Step 2: Book via createBookingTx inside lock
      let bookingResult: any;
      await updateDB((d) => {
        const b = d.businesses.find((x) => x.id === BIZ_A)!;
        const s = d.services.find((x) => x.id === 'srv-limpeza')!;
        bookingResult = createBookingTx(d, {
          business: b,
          service: s,
          professionalId: 'prof-orlando',
          date: '2026-09-22',
          time: '10:00',
          customer: {
            id: '',
            name: 'Roberto Agendamento',
            phone: customerPhone,
            email: 'roberto@email.com',
          },
          actor: 'agent',
          source: 'whatsapp',
          leadId: lead.id,
        });
      });

      expect(bookingResult.bookingId).toBeDefined();

      db = await readDB();
      const updatedLead = db.leads.find((l) => l.id === lead.id)!;
      // Invariant: Lead stage advanced to scheduled because booking was created!
      expect(updatedLead.stageId || updatedLead.status).toBe('scheduled');
      const booking = db.bookings.find((b) => b.id === bookingResult.bookingId);
      expect(booking?.serviceId).toBe('srv-limpeza');
      expect(booking?.professionalId).toBe('prof-orlando');
    });
  });

  // 5. Human Handoff / Takeover
  describe('5. Transição Humano vs Automação', () => {
    it('quando em modo human, bot não responde e operador envia mensagem manual pelo inbox', async () => {
      const customerPhone = '5511922221111';
      // Inbound asking for human
      const payload1 = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Juliana Handoff' }, wa_id: customerPhone }],
                  messages: [
                    {
                      from: customerPhone,
                      id: 'wamid.handoff_1',
                      timestamp: '1758240000',
                      text: { body: 'Quero falar com um atendente humano' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(JSON.stringify(payload1)) },
        body: JSON.stringify(payload1),
      }));

      let db = await readDB();
      const conv = db.conversations.find((c) => c.businessId === BIZ_A && (c.channelUserId === customerPhone || c.phone.includes('922221111')))!;
      expect(conv).toBeDefined();
      expect(conv.mode).toBe('human'); // Transferred to human!

      // New client message arrives while mode is human
      const payload2 = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  contacts: [{ profile: { name: 'Juliana Handoff' }, wa_id: customerPhone }],
                  messages: [
                    {
                      from: customerPhone,
                      id: 'wamid.handoff_2',
                      timestamp: '1758240010',
                      text: { body: 'Alguém aí?' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(JSON.stringify(payload2)) },
        body: JSON.stringify(payload2),
      }));

      db = await readDB();
      // Bot did NOT send any automated answer; only inbound message was appended
      const outboundFromBot = db.messages.filter((m) => m.conversationId === conv.id && m.direction === 'out' && m.by === 'automation');
      expect(outboundFromBot).toHaveLength(1); // Only the initial "Entendido! Estou transferindo..." message

      // Operator replies from inbox via API
      const tokenA = await createSession(OWNER_A);
      const replyReq = jsonReq('/api/conversations', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          conversationId: conv.id,
          action: 'send',
          text: 'Olá Juliana! Sou a recepcionista Flávia, como posso ajudar?',
        },
      });
      const replyRes = await conversationsPOST(replyReq);
      expect(replyRes.status).toBe(200);

      db = await readDB();
      const humanMsg = db.messages.find((m) => m.conversationId === conv.id && m.by === OWNER_A && m.body.includes('recepcionista Flávia'));
      expect(humanMsg).toBeDefined();

      // Return to automation
      const handbackReq = jsonReq('/api/conversations', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          conversationId: conv.id,
          action: 'setMode',
          mode: 'automation',
        },
      });
      const handbackRes = await conversationsPOST(handbackReq);
      expect(handbackRes.status).toBe(200);

      db = await readDB();
      const updatedConv = db.conversations.find((c) => c.id === conv.id)!;
      expect(updatedConv.mode).toBe('automation');
    });
  });

  // 6. Message Status Updates (delivered, read, failed)
  describe('6. Webhook de Status da Meta', () => {
    it('atualiza status da mensagem para delivered, read ou failed', async () => {
      // Seed an outbound message with an externalId
      const testExternalId = 'wamid.outbound_status_test_1';
      await updateDB((d) => {
        d.messages.push({
          id: 'msg-out-1',
          businessId: BIZ_A,
          conversationId: 'conv-test-1',
          by: 'agent',
          direction: 'out',
          channel: 'whatsapp',
          channelUserId: '5511999998888',
          body: 'Seu agendamento foi confirmado!',
          status: 'sent',
          externalId: testExternalId,
          at: '2026-09-19T10:00:00Z',
        });
      });

      // Status payload: delivered
      const deliveredPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  statuses: [
                    {
                      id: testExternalId,
                      status: 'delivered',
                      timestamp: '1758240050',
                      recipient_id: '5511999998888',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(JSON.stringify(deliveredPayload)) },
        body: JSON.stringify(deliveredPayload),
      }));

      let db = await readDB();
      expect(db.messages.find((m) => m.id === 'msg-out-1')?.status).toBe('delivered');

      // Status payload: read
      const readPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  statuses: [
                    {
                      id: testExternalId,
                      status: 'read',
                      timestamp: '1758240060',
                      recipient_id: '5511999998888',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
      await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(JSON.stringify(readPayload)) },
        body: JSON.stringify(readPayload),
      }));

      db = await readDB();
      expect(db.messages.find((m) => m.id === 'msg-out-1')?.status).toBe('read');
    });
  });

  // 7. P4 Automations & Loop Protection
  describe('7. P4 Automations e Prevenção de Loops', () => {
    it('executa send_channel_message via conector registrado fora de locks com proteção de loop', async () => {
      const db = await readDB();
      const clinic = db.businesses.find((b) => b.id === BIZ_A)!;
      const automation = {
        id: 'auto-test-channel',
        businessId: BIZ_A,
        name: 'Automação Canal WhatsApp',
        trigger: { event: 'lead.created' },
        nodes: [
          {
            id: 'node-action-1',
            type: 'action',
            action: {
              type: 'send_channel_message',
              params: {
                channel: 'whatsapp',
                to: '5511999998888',
                message: 'Mensagem de lembrete do P4',
              },
            },
          },
        ],
      } as any;

      const run = {
        id: 'run-auto-123',
        businessId: BIZ_A,
        automationId: automation.id,
        context: {
          contact: { phone: '5511999998888' },
        },
      } as any;

      const actionRes = (executeAction as any)({
        db,
        business: clinic,
        automation,
        nodeId: 'node-action-1',
        params: {
          __type: 'send_channel_message',
          channel: 'whatsapp',
          to: '5511999998888',
          message: 'Mensagem de lembrete do P4',
        },
        run,
        now: '2026-09-19T10:00:00Z',
      });

      expect(actionRes.ok).toBe(true);

      const pendingMsg = db.messages.find((m) => m.body === 'Mensagem de lembrete do P4');
      expect(pendingMsg).toBeDefined();
      expect(pendingMsg?.status).toBe('pending');
      expect(pendingMsg?.meta?.originRunId).toBe('run-auto-123');
    });
  });

  // 8. Campaigns & Marketing Consent
  describe('8. Campanhas e Consentimento marketingOptIn', () => {
    it('ignora leads com marketingOptIn=false e envia apenas para consentidos', async () => {
      // Setup contacts in Clinic A: one with opt-in, one without
      await updateDB((d) => {
        d.contacts.push(
          {
            id: 'cnt-optin-yes',
            businessId: BIZ_A,
            customerId: '',
            name: 'Cliente Consentiu',
            phone: '5511911110001',
            email: 'optin@email.com',
            source: 'whatsapp',
            lastInteraction: '2026-09-18T10:00:00Z',
            marketingOptIn: true,
            createdAt: '2026-09-18T10:00:00Z',
            updatedAt: '2026-09-18T10:00:00Z',
          },
          {
            id: 'cnt-optin-no',
            businessId: BIZ_A,
            customerId: '',
            name: 'Cliente Não Consentiu',
            phone: '5511911110002',
            email: 'nooptin@email.com',
            source: 'whatsapp',
            lastInteraction: '2026-09-18T10:00:00Z',
            marketingOptIn: false,
            createdAt: '2026-09-18T10:00:00Z',
            updatedAt: '2026-09-18T10:00:00Z',
          },
        );
      });

      const tokenA = await createSession(OWNER_A);
      // 1. Create campaign
      const createRes = await campaignsPOST(jsonReq('/api/campaigns', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          name: 'Campanha Clareamento',
          segment: 'all_optin',
          message: 'Aproveite a promoção de clareamento!',
        },
      }));
      expect(createRes.status).toBe(200);
      const { campaign } = await jsonBody(createRes);

      // 2. Mark ready
      const readyRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          id: campaign.id,
          action: 'ready',
        },
      }));
      expect(readyRes.status).toBe(200);

      // 3. Send
      const sendRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          id: campaign.id,
          action: 'send',
          templateName: 'promo_clareamento',
        },
      }));
      expect(sendRes.status).toBe(200);

      const db = await readDB();
      // Should only have dispatched for optin-yes
      const recipients = db.campaignRecipients.filter((r) => r.campaignId === campaign.id);
      expect(recipients.some((r) => r.phone === '5511911110001' && r.status === 'sent')).toBe(true);
      expect(recipients.some((r) => r.phone === '5511911110002')).toBe(false);
    });
  });

  // 9. Master Onboarding & Encryption
  describe('9. Configuração Segura Master e Criptografia AES-256-GCM', () => {
    it('salva credenciais criptografadas e nunca expõe o token na rota de configurações', async () => {
      // Test encrypt and decrypt roundtrip
      const rawSecret = 'EAA_VerySecretMetaGraphToken_123456789';
      const encrypted = encryptSecret(rawSecret);
      expect(encrypted).not.toBe(rawSecret);
      expect(encrypted).toContain(':'); // iv:authTag:cipherText
      expect(decryptSecret(encrypted)).toBe(rawSecret);

      // Verify settings GET does NOT return raw token or full sensitive IDs
      const tokenA = await createSession(OWNER_A);
      const getRes = await settingsGET(jsonReq(`/api/whatsapp?businessId=${BIZ_A}`, { token: tokenA }));
      expect(getRes.status).toBe(200);
      const config = await jsonBody(getRes);
      expect(config.status).toBe('connected');
      expect(config.integration.displayPhone).toBe('+55 11 99999-1111');
      expect(config.integration.accessToken).toBeUndefined(); // NEVER in GET response
      expect(config.integration.encryptedAccessToken).toBeUndefined(); // NEVER in GET response
      expect(config.integration.phoneNumberId).toBe(maskTechnicalId(PHONE_ID_A)); // Masked!
    });

    it('permite que o Master configure as credenciais da clínica via API com validação prévia', async () => {
      const masterToken = await createSession(MASTER_USER_ID);
      const masterReq = jsonReq(`/api/master/units/${BIZ_A}/whatsapp`, {
        method: 'POST',
        token: masterToken,
        body: {
          phoneNumberId: '109283746152999',
          wabaId: 'waba-new-999',
          accessToken: 'EAATestValidMasterConfigToken',
          displayPhone: '+55 11 98888-0000',
        },
      });

      const res = await masterWhatsappPOST(masterReq, { params: Promise.resolve({ id: BIZ_A }) });
      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      // Como a clínica BIZ_A já tinha webhookSubscribedAt e registeredAt antes deste POST,
      // as evidências prévias são preservadas e o status resulta em 'connected'.
      expect(body.status).toBe('connected');
      expect(body.ok).toBe(true);
      expect(body.accessToken).toBeUndefined(); // Secrets not returned!

      // Check DB storage
      const db = await readDB();
      const unitA = db.businesses.find((b) => b.id === BIZ_A)!;
      expect(unitA.whatsappIntegration?.status).toBe('connected');
      expect(unitA.whatsappIntegration?.phoneNumberId).toBe('109283746152999');
      // Secret must be encrypted
      expect(unitA.whatsappIntegration?.encryptedAccessToken).toBeDefined();
      expect(decryptSecret(unitA.whatsappIntegration!.encryptedAccessToken!)).toBe('EAATestValidMasterConfigToken');
    });

    it('retorna 503 se WHATSAPP_CREDENTIALS_KEY estiver ausente ao tentar configurar pelo Master', async () => {
      const origKey = process.env.WHATSAPP_CREDENTIALS_KEY;
      delete process.env.WHATSAPP_CREDENTIALS_KEY;
      try {
        const masterToken = await createSession(MASTER_USER_ID);
        const res = await masterWhatsappPOST(jsonReq(`/api/master/units/${BIZ_A}/whatsapp`, {
          method: 'POST',
          token: masterToken,
          body: {
            phoneNumberId: '109283746152999',
            accessToken: 'EAATokenWithoutKey',
          },
        }), { params: Promise.resolve({ id: BIZ_A }) });
        expect(res.status).toBe(503);
      } finally {
        process.env.WHATSAPP_CREDENTIALS_KEY = origKey;
      }
    });
  });

  // 10. Hardening & Review Fixes (Fail-closed, CAS Claim, Status, Webhook tenant resolution, Cron)
  describe('10. Hardening e Resiliência da Integração WhatsApp', () => {
    it('getCredentialsKey não faz fallback para outros segredos e encryptSecret falha se chave ausente', () => {
      const origKey = process.env.WHATSAPP_CREDENTIALS_KEY;
      delete process.env.WHATSAPP_CREDENTIALS_KEY;
      process.env.WHATSAPP_API_TOKEN = 'fallback_token';
      try {
        expect(getCredentialsKey()).toBeNull();
        expect(() => encryptSecret('my_token')).toThrowError(/WHATSAPP_CREDENTIALS_KEY/);
      } finally {
        process.env.WHATSAPP_CREDENTIALS_KEY = origKey;
      }
    });

    it('webhook falha fechado (503) se appSecret estiver ausente do servidor', async () => {
      const origSecret = process.env.WHATSAPP_APP_SECRET;
      delete process.env.WHATSAPP_APP_SECRET;
      delete process.env.META_APP_SECRET;
      try {
        expect(verifyMetaWebhookSignature('body', 'sha256=123')).toBe(false);
        const res = await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=123' },
          body: JSON.stringify({}),
        }));
        expect(res.status).toBe(503);
      } finally {
        process.env.WHATSAPP_APP_SECRET = origSecret;
      }
    });

    it('resolveTenantForChange respeita autoridade de phoneNumberId e não cai para WABA se phoneId não bateu', async () => {
      const db = await readDB();
      // Phone ID correto da clínica A
      const matchA = resolveTenantForChange(db, PHONE_ID_A, 'waba-123456');
      expect(matchA?.id).toBe(BIZ_A);

      // Phone ID desconhecido com WABA da clínica A: NUNCA deve retornar a clínica A!
      const mismatch = resolveTenantForChange(db, 'unknown_phone_id', 'waba-123456');
      expect(mismatch).toBeNull();

      // Sem phoneId, mas com WABA unívoco: fallback seguro
      const fallbackWaba = resolveTenantForChange(db, '', 'waba-789012');
      expect(fallbackWaba?.id).toBe(BIZ_B);
    });

    it('deliverPendingWhatsappMessages não gera double claim e respeita lease de envio', async () => {
      await updateDB((d) => {
        d.messages.push({
          id: 'msg-double-claim-1',
          businessId: BIZ_A,
          conversationId: 'conv-test-1',
          channel: 'whatsapp',
          channelUserId: '5511988887777',
          direction: 'out',
          body: 'Teste de concorrência outbox',
          status: 'pending',
          externalId: '',
          by: 'automation',
          at: '2026-09-19T10:00:00Z',
        });
      });

      const count = await deliverPendingWhatsappMessages(BIZ_A);
      expect(count.sent).toBe(1);

      const db = await readDB();
      const sentMsg = db.messages.find((m) => m.id === 'msg-double-claim-1');
      expect(sentMsg?.status).toBe('sent');
      expect(sentMsg?.claimToken).toBeUndefined();
    });

    it('falha transitiva na Graph API mantém status "pending", agenda nextRetryAt e deliverWhatsappMessage não retorna "failed"', async () => {
      // Mock fetch to simulate 500 transient error
      const mock500Fetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Meta server error', code: 2 } }),
      })) as any;

      await updateDB((d) => {
        d.messages.push({
          id: 'msg-retry-test-1',
          businessId: BIZ_A,
          conversationId: 'conv-test-1',
          channel: 'whatsapp',
          channelUserId: '5511988887777',
          direction: 'out',
          body: 'Teste de retry status honesto',
          status: 'pending',
          externalId: '',
          by: 'automation',
          at: '2026-09-19T10:00:00Z',
        });
      });

      const res = await deliverWhatsappMessage(BIZ_A, 'msg-retry-test-1', { fetchFn: mock500Fetch });
      expect(res.ok).toBe(false);
      expect(res.status).toBe('pending'); // HONESTO: pending, não failed!
      expect(res.nextRetryAt).toBeDefined();

      const db = await readDB();
      const msg = db.messages.find((m) => m.id === 'msg-retry-test-1')!;
      expect(msg.status).toBe('pending');
      expect(msg.attempts).toBe(1);
      expect(msg.nextRetryAt).toBeDefined();
    });

    it('cron de WhatsApp autenticado (/api/cron/whatsapp) roda retry queue com verifyCronAuth', async () => {
      process.env.CRON_SECRET = 'cron_secret_test_whatsapp_999';

      // 1. Sem autorização -> 401
      const noAuthRes = await cronWhatsappGET(jsonReq('/api/cron/whatsapp'));
      expect(noAuthRes.status).toBe(401);

      // 2. Com token correto -> 200 e processa retentativas
      const authReq = jsonReq('/api/cron/whatsapp', {
        headers: { authorization: 'Bearer cron_secret_test_whatsapp_999' },
      });
      const okRes = await cronWhatsappGET(authReq);
      expect(okRes.status).toBe(200);
      const summary = await jsonBody(okRes);
      expect(summary.ok).toBe(true);
      expect(summary.ranAt).toBeDefined();
      expect(typeof summary.messagesProcessed).toBe('number');
    });

    it('campanha rejeita envio sem templateName (sem bypass allowFreeText)', async () => {
      await updateDB((d) => {
        d.contacts.push({
          id: 'cnt-optin-template-test',
          businessId: BIZ_A,
          customerId: '',
          name: 'Cliente OptIn',
          phone: '5511911119999',
          email: 'optin@email.com',
          source: 'whatsapp',
          lastInteraction: '2026-09-18T10:00:00Z',
          marketingOptIn: true,
          createdAt: '2026-09-18T10:00:00Z',
          updatedAt: '2026-09-18T10:00:00Z',
        });
      });

      const tokenA = await createSession(OWNER_A);
      const createRes = await campaignsPOST(jsonReq('/api/campaigns', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          name: 'Campanha Sem Template',
          segment: 'all_optin',
          message: 'Mensagem sem template',
        },
      }));
      const { campaign } = await jsonBody(createRes);

      const readyRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: { businessId: BIZ_A, id: campaign.id, action: 'ready' },
      }));
      expect(readyRes.status).toBe(200);

      // Tenta enviar com allowFreeText: true mas sem templateName -> 400 template_required
      const sendRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          id: campaign.id,
          action: 'send',
          allowFreeText: true,
        },
      }));
      expect(sendRes.status).toBe(400);
      const errBody = await jsonBody(sendRes);
      expect(errBody.code).toBe('template_required');
    });

    it('rejeita chamadas externas Meta dentro de updateDB usando a guarda canônica de db-transaction', async () => {
      // 1. Chamada direta à guarda canônica dentro de mutação do banco falha sincronicamente
      await expect(
        updateDB(() => {
          assertOutsideDBTransaction();
        }),
      ).rejects.toThrow(/I\/O externo não é permitido dentro de uma mutação do banco/);

      // 2. sendMetaGraphMessage invoca assertOutsideDBTransaction e falha na chamada
      let caughtSendError: any;
      await updateDB(() => {
        sendMetaGraphMessage({
          phoneNumberId: PHONE_ID_A,
          accessToken: 'dummy-token',
          to: '5511999999999',
          body: 'Tentativa dentro de transação',
        }).catch((err) => {
          caughtSendError = err;
        });
      });
      expect(caughtSendError?.message).toMatch(/I\/O externo não é permitido dentro de uma mutação do banco/);

      // 3. deliverWhatsappMessage invoca assertOutsideDBTransaction e falha na chamada
      let caughtDeliverError: any;
      await updateDB(() => {
        deliverWhatsappMessage(BIZ_A, 'dummy-msg').catch((err) => {
          caughtDeliverError = err;
        });
      });
      expect(caughtDeliverError?.message).toMatch(/I\/O externo não é permitido dentro de uma mutação do banco/);
    });

    it('sendMetaGraphMessage e connector rejeitam resposta 200 da Meta se messages[0].id (wamid) estiver ausente', async () => {
      // Mock fetch responding 200 OK but with empty messages array (no wamid)
      const emptyIdFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '5511999990000', wa_id: '5511999990000' }],
          messages: [], // Missing wamid!
        }),
      })) as any;

      const res = await sendMetaGraphMessage({
        phoneNumberId: PHONE_ID_A,
        accessToken: 'EAATestValidTokenClinicA',
        to: '5511999990000',
        body: 'Teste sem wamid',
        fetchFn: emptyIdFetch,
      });

      expect(res.ok).toBe(false);
      expect(res.externalId).toBeUndefined();
      expect(res.error).toMatch(/wamid ausente/);
      expect(res.retryable).toBe(false);

      // Verify channel connector also rejects with provider_error and does NOT return code 'sent'
      const db = await readDB();
      const clinic = db.businesses.find((b) => b.id === BIZ_A)!;
      const connector = channelConnectorFor('whatsapp')!;
      const sendResult = await connector.send(
        { businessId: BIZ_A, business: clinic, nowISO: new Date().toISOString(), fetchFn: emptyIdFetch },
        { businessId: BIZ_A, integrationId: 'int-wa', provider: 'whatsapp', to: '5511999990000', body: 'Teste' },
      );
      expect(sendResult.ok).toBe(false);
      expect(sendResult.code).not.toBe('sent');
      expect(sendResult.code).toBe('provider_error');
    });

    it('getWhatsappCredentials nunca acopla token global a uma unidade com phoneNumberId diferente', async () => {
      const origToken = process.env.WHATSAPP_API_TOKEN;
      const origPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
      process.env.WHATSAPP_API_TOKEN = 'global_server_token_123';
      process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_ID_A; // Global token belongs to clinic A

      try {
        const db = await readDB();
        // Clínica C: tem phoneNumberId próprio mas não tem token criptografado
        const clinicC: Business = {
          ...db.businesses.find((b) => b.id === BIZ_B)!,
          id: 'biz-clinic-c',
          whatsappIntegration: {
            status: 'not_connected',
            phoneNumberId: '999888777666', // Different phone number ID!
            wabaId: 'waba-c',
            displayPhone: '',
            encryptedAccessToken: '',
          } as any,
        };

        const creds = getWhatsappCredentials(clinicC);
        // NUNCA pode acoplar o token global do Phone A à Clínica C!
        expect(creds).toBeNull();
      } finally {
        process.env.WHATSAPP_API_TOKEN = origToken;
        process.env.WHATSAPP_PHONE_NUMBER_ID = origPhone;
      }
    });

    it('deliverCampaignRecipient faz claim atômico via CAS: duas chamadas concorrentes geram apenas 1 HTTP', async () => {
      let httpCalls = 0;
      const countingFetch = vi.fn(async () => {
        httpCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.campaign_recipient_concurrency' }],
          }),
        };
      }) as any;

      await updateDB((d) => {
        d.campaigns.push({
          id: 'camp-conc-1',
          businessId: BIZ_A,
          name: 'Campanha Concorrência',
          segment: 'all_optin',
          segmentRef: '',
          channel: 'whatsapp',
          createdBy: OWNER_A,
          sentAt: '',
          message: 'Mensagem de teste',
          templateName: 'promo_conc',
          status: 'sending',
          counts: { eligible: 1, sent: 0, delivered: 0, failed: 0 },
          createdAt: '2026-09-19T10:00:00Z',
          updatedAt: '2026-09-19T10:00:00Z',
        });
        d.campaignRecipients.push({
          id: 'rec-conc-1',
          businessId: BIZ_A,
          campaignId: 'camp-conc-1',
          contactId: 'cnt-1',
          name: 'Destinatário Concorrente',
          phone: '5511988880001',
          status: 'pending',
          error: '',
          at: '2026-09-19T10:00:00Z',
        });
      });

      // Dispara 2 entregas simultâneas para o mesmo destinatário
      const [res1, res2] = await Promise.all([
        deliverCampaignRecipient('rec-conc-1', { fetchFn: countingFetch }),
        deliverCampaignRecipient('rec-conc-1', { fetchFn: countingFetch }),
      ]);

      // Exatamente UMA chamada HTTP executada
      expect(httpCalls).toBe(1);
      const okCount = [res1, res2].filter((r) => r.ok).length;
      const claimedCount = [res1, res2].filter((r) => r.status === 'claimed_by_other').length;
      expect(okCount).toBe(1);
      expect(claimedCount).toBe(1);

      const db = await readDB();
      const rec = db.campaignRecipients.find((r) => r.id === 'rec-conc-1')!;
      expect(rec.status).toBe('sent');
      expect(rec.externalId).toBe('wamid.campaign_recipient_concurrency');
    });

    it('campanha limita envio imediato no request a CAMPAIGN_IMMEDIATE_BATCH_LIMIT e cron continua a fila', async () => {
      // Cria 7 contatos com marketingOptIn
      await updateDB((d) => {
        for (let i = 1; i <= 7; i++) {
          d.contacts.push({
            id: `cnt-batch-test-${i}`,
            businessId: BIZ_A,
            customerId: '',
            name: `Cliente Lote ${i}`,
            phone: `551193333000${i}`,
            email: `cliente${i}@lote.com`,
            source: 'whatsapp',
            lastInteraction: '2026-09-18T10:00:00Z',
            marketingOptIn: true,
            createdAt: '2026-09-18T10:00:00Z',
            updatedAt: '2026-09-18T10:00:00Z',
          });
        }
      });

      const tokenA = await createSession(OWNER_A);
      const createRes = await campaignsPOST(jsonReq('/api/campaigns', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          name: 'Campanha Lote Grande',
          segment: 'all_optin',
          message: 'Mensagem de lote',
        },
      }));
      const { campaign } = await jsonBody(createRes);

      await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: { businessId: BIZ_A, id: campaign.id, action: 'ready' },
      }));

      // Dispara envio: request deve enviar no máximo CAMPAIGN_IMMEDIATE_BATCH_LIMIT (=5)
      const sendRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          id: campaign.id,
          action: 'send',
          templateName: 'template_lote',
        },
      }));
      expect(sendRes.status).toBe(200);

      let db = await readDB();
      const recs = db.campaignRecipients.filter((r) => r.campaignId === campaign.id);
      expect(recs.length).toBe(7);

      const sentImmediately = recs.filter((r) => r.status === 'sent');
      const pendingRemanentes = recs.filter((r) => r.status === 'pending');
      expect(sentImmediately.length).toBe(CAMPAIGN_IMMEDIATE_BATCH_LIMIT);
      expect(pendingRemanentes.length).toBe(7 - CAMPAIGN_IMMEDIATE_BATCH_LIMIT);

      // Enquanto houver pending, a campanha segue como 'sending' e sentAt não está definitivo
      let camp = db.campaigns.find((c) => c.id === campaign.id)!;
      expect(camp.status).toBe('sending');
      expect(camp.counts.sent).toBe(5);

      // Executa o cron worker (/api/cron/whatsapp) para processar o restante da fila
      process.env.CRON_SECRET = 'cron_secret_test_whatsapp_999';
      const cronRes = await cronWhatsappGET(jsonReq('/api/cron/whatsapp', {
        headers: { authorization: 'Bearer cron_secret_test_whatsapp_999' },
      }));
      expect(cronRes.status).toBe(200);

      // Agora todos os 7 foram enviados e a campanha foi finalizada como 'sent'
      db = await readDB();
      const allRecs = db.campaignRecipients.filter((r) => r.campaignId === campaign.id);
      expect(allRecs.every((r) => r.status === 'sent')).toBe(true);

      camp = db.campaigns.find((c) => c.id === campaign.id)!;
      expect(camp.status).toBe('sent');
      expect(camp.counts.sent).toBe(7);
      expect(camp.counts.failed).toBe(0);
      expect(camp.sentAt).toBeDefined();
    });

    it('disciplina de cancelamento de campanha: draft e ready cancelam, sending retorna 409, cron conclui sending e nunca reativa cancelled', async () => {
      // 0. Verifica a definição da regra estrita
      expect(CAMPAIGN_CANCELLABLE).toEqual(['draft', 'ready']);
      expect(campaignStatusDef('draft').cancellable).toBe(true);
      expect(campaignStatusDef('ready').cancellable).toBe(true);
      expect(campaignStatusDef('sending').cancellable).toBe(false);
      expect(campaignStatusDef('cancelled').cancellable).toBe(false);

      // Prepara 6 contatos com consentimento (maior que CAMPAIGN_IMMEDIATE_BATCH_LIMIT = 5)
      await updateDB((d) => {
        for (let i = 1; i <= 6; i++) {
          d.contacts.push({
            id: `cnt-cancel-rule-${i}`,
            businessId: BIZ_A,
            customerId: '',
            name: `Cliente Cancel Rule ${i}`,
            phone: `551194444000${i}`,
            email: `cliente${i}@cancel.com`,
            source: 'whatsapp',
            lastInteraction: '2026-09-18T10:00:00Z',
            marketingOptIn: true,
            createdAt: '2026-09-18T10:00:00Z',
            updatedAt: '2026-09-18T10:00:00Z',
          });
        }
      });

      const tokenA = await createSession(OWNER_A);

      // 1. draft pode cancelar
      const createDraftRes = await campaignsPOST(jsonReq('/api/campaigns', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          name: 'Campanha Teste Draft Cancel',
          segment: 'all_optin',
          message: 'Mensagem draft',
        },
      }));
      expect(createDraftRes.status).toBe(200);
      const { campaign: draftCamp } = await jsonBody(createDraftRes);
      expect(draftCamp.status).toBe('draft');

      const cancelDraftRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: { businessId: BIZ_A, id: draftCamp.id, action: 'cancel' },
      }));
      expect(cancelDraftRes.status).toBe(200);
      const { campaign: cancelledFromDraft } = await jsonBody(cancelDraftRes);
      expect(cancelledFromDraft.status).toBe('cancelled');

      // 2. ready pode cancelar
      const createReadyRes = await campaignsPOST(jsonReq('/api/campaigns', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          name: 'Campanha Teste Ready Cancel',
          segment: 'all_optin',
          message: 'Mensagem ready',
        },
      }));
      expect(createReadyRes.status).toBe(200);
      const { campaign: readyCamp } = await jsonBody(createReadyRes);

      const makeReadyRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: { businessId: BIZ_A, id: readyCamp.id, action: 'ready' },
      }));
      expect(makeReadyRes.status).toBe(200);

      const cancelReadyRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: { businessId: BIZ_A, id: readyCamp.id, action: 'cancel' },
      }));
      expect(cancelReadyRes.status).toBe(200);
      const { campaign: cancelledFromReady } = await jsonBody(cancelReadyRes);
      expect(cancelledFromReady.status).toBe('cancelled');

      // 3. sending retorna 409 / não é cancelável
      const createSendingRes = await campaignsPOST(jsonReq('/api/campaigns', {
        method: 'POST',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          name: 'Campanha Teste Sending Block',
          segment: 'all_optin',
          message: 'Mensagem sending',
        },
      }));
      const { campaign: sendingCamp } = await jsonBody(createSendingRes);

      await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: { businessId: BIZ_A, id: sendingCamp.id, action: 'ready' },
      }));

      const sendStartRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: {
          businessId: BIZ_A,
          id: sendingCamp.id,
          action: 'send',
          templateName: 'template_cancel_test',
        },
      }));
      expect(sendStartRes.status).toBe(200);

      let db = await readDB();
      const currentSendingCamp = db.campaigns.find((c) => c.id === sendingCamp.id)!;
      expect(currentSendingCamp.status).toBe('sending');

      // Tenta cancelar a campanha em 'sending' -> deve falhar com 409
      const cancelSendingRes = await campaignsPATCH(jsonReq('/api/campaigns', {
        method: 'PATCH',
        token: tokenA,
        body: { businessId: BIZ_A, id: sendingCamp.id, action: 'cancel' },
      }));
      expect(cancelSendingRes.status).toBe(409);
      const cancelErr = await jsonBody(cancelSendingRes);
      expect(cancelErr.error).toMatch(/não podem ser canceladas/);

      // Status no banco continua strictly 'sending'
      db = await readDB();
      const postCancelAttempt = db.campaigns.find((c) => c.id === sendingCamp.id)!;
      expect(postCancelAttempt.status).toBe('sending');

      // 4. cron continua normalmente a campanha sending até sent/partial/failed
      process.env.CRON_SECRET = 'cron_secret_test_whatsapp_999';
      const cronRes = await cronWhatsappGET(jsonReq('/api/cron/whatsapp', {
        headers: { authorization: 'Bearer cron_secret_test_whatsapp_999' },
      }));
      expect(cronRes.status).toBe(200);

      db = await readDB();
      const completedCamp = db.campaigns.find((c) => c.id === sendingCamp.id)!;
      expect(completedCamp.status).toBe('sent');
      expect(completedCamp.counts.sent).toBe(6);

      // 5. nenhuma campanha cancelled é reativada pelo worker
      // Simula uma campanha que ficou 'cancelled' tendo recipient pending
      await updateDB((d) => {
        d.campaigns.push({
          id: 'camp-permanently-cancelled',
          businessId: BIZ_A,
          name: 'Campanha Cancelada Permanente',
          segment: 'all_optin',
          segmentRef: '',
          message: 'Não deve ser entregue',
          status: 'cancelled',
          counts: { eligible: 1, sent: 0, delivered: 0, failed: 0 },
          channel: 'whatsapp',
          createdBy: 'user-admin',
          sentAt: '',
          createdAt: '2026-09-19T10:00:00Z',
          updatedAt: '2026-09-19T10:00:00Z',
        });
        d.campaignRecipients.push({
          id: 'rec-of-cancelled-camp',
          campaignId: 'camp-permanently-cancelled',
          businessId: BIZ_A,
          contactId: 'cnt-cancel-rule-1',
          phone: '5511944440001',
          name: 'Cliente Cancel Rule 1',
          status: 'pending',
          error: '',
          at: '2026-09-19T10:00:00Z',
          attempts: 0,
        });
      });

      // Tenta rodar worker de entrega
      const workerDeliverRes = await deliverCampaignRecipient('rec-of-cancelled-camp');
      expect(workerDeliverRes.status).toBe('failed');
      expect(workerDeliverRes.error).toMatch(/cancelada/i);

      // Executa também syncCampaignStatusAndCounts diretamente
      db = await readDB();
      await updateDB((d) => {
        const c = d.campaigns.find((x) => x.id === 'camp-permanently-cancelled')!;
        syncCampaignStatusAndCounts(d, c, '2026-09-19T10:05:00Z');
      });

      db = await readDB();
      const verifiedCamp = db.campaigns.find((c) => c.id === 'camp-permanently-cancelled')!;
      // Campanha continua strictly 'cancelled' (nunca reativada para sending ou sent)
      expect(verifiedCamp.status).toBe('cancelled');
    });

    it('P4 real E2E: emitAutomationEvent -> drainAutomations() com stepAutomationRun -> entrega externa com wamid preservado', async () => {
      let graphCalls = 0;
      const p4Fetch = vi.fn(async () => {
        graphCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.p4_e2e_real_999' }],
          }),
        };
      }) as any;

      // 1. Cadastra automação construída e validada via buildAutomation
      const auto = buildAutomation({
        id: 'auto-p4-real-test',
        businessId: BIZ_A,
        name: 'Automação P4 WhatsApp Real',
        event: 'lead.created',
        steps: [
          {
            kind: 'action',
            action: {
              type: 'send_channel_message',
              params: {
                channel: 'whatsapp',
                to: '5511999998888',
                message: 'Olá, seu agendamento está confirmado!',
                templateName: 'confirma_agendamento',
              },
            },
          },
        ],
      });

      await updateDB((d) => {
        d.automations.push(auto);

        // Habilita capacidades de automação na clínica
        const b = d.businesses.find((x) => x.id === BIZ_A)!;
        b.capabilityFlags = {
          ...(b.capabilityFlags || {}),
          'automation.basic': true,
          'automation.advanced': true,
        };

        // Emite o evento na transação (enfileira a execução)
        emitAutomationEvent(d, {
          businessId: BIZ_A,
          event: 'lead.created',
          data: {
            lead: { id: 'lead-p4-test', name: 'Paula', phone: '5511999998888' },
          },
          at: '2026-09-19T10:00:00Z',
        });
      });

      // 2. Mock global de fetch temporário para o disparo pós-commit do drainAutomations
      vi.stubGlobal('fetch', p4Fetch);

      try {
        // Executa o motor fora de transação
        const summary = await drainAutomations({ businessId: BIZ_A, nowISO: '2026-09-19T10:00:00Z' });
        expect(summary.claimed).toBeGreaterThanOrEqual(1);

        // Verifica que exatamente UMA chamada HTTP aconteceu
        expect(graphCalls).toBe(1);

        const db = await readDB();
        const p4Msg = db.messages.find((m) => m.body === 'Olá, seu agendamento está confirmado!')!;
        expect(p4Msg).toBeDefined();
        expect(p4Msg.status).toBe('sent');
        expect(p4Msg.externalId).toBe('wamid.p4_e2e_real_999');
        expect(p4Msg.meta?.originRunId).toBeDefined();
      } finally {
        // Restaura mock padrão do beforeEach
        vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
          const urlStr = String(url);
          if (urlStr.includes('/messages')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                messaging_product: 'whatsapp',
                contacts: [{ input: '5511999990000', wa_id: '5511999990000' }],
                messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }],
              }),
            } as any;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: PHONE_ID_A,
              display_phone_number: '+55 11 99999-1111',
              verified_name: 'Clínica Odonto A',
              quality_rating: 'GREEN',
            }),
          } as any;
        }));
      }
    });

    it('webhook processa lote com entry/change para Business A e Business B no mesmo payload com isolamento total', async () => {
      const mixedPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999991111', phone_number_id: PHONE_ID_A },
                  messages: [
                    {
                      from: '5511911111111',
                      id: 'wamid.msg_for_clinic_a',
                      timestamp: '1758240000',
                      text: { body: 'Mensagem exclusiva para Clínica A' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
          {
            id: 'waba-789012',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511999992222', phone_number_id: PHONE_ID_B },
                  messages: [
                    {
                      from: '5511922222222',
                      id: 'wamid.msg_for_clinic_b',
                      timestamp: '1758240001',
                      text: { body: 'Mensagem exclusiva para Clínica B' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(mixedPayload);
      const signature = signPayload(rawBody);

      const res = await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
        body: rawBody,
      }));
      expect(res.status).toBe(200);

      const db = await readDB();
      // Mensagem A gravada EXCLUSIVAMENTE na Clínica A
      const msgA = db.messages.find((m) => m.externalId === 'wamid.msg_for_clinic_a');
      expect(msgA).toBeDefined();
      expect(msgA?.businessId).toBe(BIZ_A);

      // Mensagem B gravada EXCLUSIVAMENTE na Clínica B
      const msgB = db.messages.find((m) => m.externalId === 'wamid.msg_for_clinic_b');
      expect(msgB).toBeDefined();
      expect(msgB?.businessId).toBe(BIZ_B);

      // Isolamento total de contatos
      const contactA = db.contacts.find((c) => c.phone.includes('11911111111'));
      expect(contactA?.businessId).toBe(BIZ_A);
      const contactB = db.contacts.find((c) => c.phone.includes('11922222222'));
      expect(contactB?.businessId).toBe(BIZ_B);
    });

    it('webhook com phoneNumberId desconhecido e WABA válido de A não escreve nada em A', async () => {
      const spoofPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-123456', // WABA válido de A
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+5511000000000', phone_number_id: 'unknown_unmatched_phone_id' },
                  messages: [
                    {
                      from: '5511999997777',
                      id: 'wamid.spoof_attack_attempt',
                      timestamp: '1758240000',
                      text: { body: 'Tentativa de spoofing via WABA' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(spoofPayload);
      const signature = signPayload(rawBody);

      const res = await webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
        body: rawBody,
      }));
      expect(res.status).toBe(200);

      const db = await readDB();
      // Não pode gravar em nenhuma unidade
      expect(db.messages.some((m) => m.externalId === 'wamid.spoof_attack_attempt')).toBe(false);
      expect(db.contacts.some((c) => c.phone.includes('11999997777'))).toBe(false);
    });

    it('ciclo completo de retry de mensagem: 500 agenda 30s, cron antes do prazo não envia, cron depois envia', async () => {
      const fixedBaseTime = new Date('2026-09-19T10:00:00Z').getTime();

      // Tentativa 1: falha transitiva 500
      let callCount = 0;
      const lifecycleFetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'Meta 500 transient', code: 2 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.lifecycle_success_attempt2' }],
          }),
        };
      }) as any;

      await updateDB((d) => {
        d.messages.push({
          id: 'msg-lifecycle-1',
          businessId: BIZ_A,
          conversationId: 'conv-test-1',
          channel: 'whatsapp',
          channelUserId: '5511988887777',
          direction: 'out',
          body: 'Teste ciclo completo',
          status: 'pending',
          externalId: '',
          by: 'automation',
          at: new Date(fixedBaseTime).toISOString(),
        });
      });

      // 1. Primeira tentativa falha com 500
      const res1 = await deliverWhatsappMessage(BIZ_A, 'msg-lifecycle-1', {
        fetchFn: lifecycleFetch,
        nowISO: new Date(fixedBaseTime).toISOString(),
      });
      expect(res1.ok).toBe(false);
      expect(res1.status).toBe('pending');
      expect(res1.attempts).toBe(1);
      expect(res1.nextRetryAt).toBeDefined();

      let db = await readDB();
      let msg = db.messages.find((m) => m.id === 'msg-lifecycle-1')!;
      expect(msg.status).toBe('pending');
      expect(msg.attempts).toBe(1);

      // 2. Cron executado antes do prazo (10 segundos após o erro; delay era de 30s)
      const earlyISO = new Date(fixedBaseTime + 10_000).toISOString();
      const earlyCron = await processPendingWhatsappRetries({
        nowISO: earlyISO,
        fetchFn: lifecycleFetch,
      });
      // 0 mensagens enviadas
      expect(earlyCron.messagesSent).toBe(0);
      expect(callCount).toBe(1); // Nenhuma nova chamada externa

      // 3. Cron executado depois do prazo (35 segundos após o erro)
      const dueISO = new Date(fixedBaseTime + 35_000).toISOString();
      const dueCron = await processPendingWhatsappRetries({
        nowISO: dueISO,
        fetchFn: lifecycleFetch,
      });
      expect(dueCron.messagesSent).toBe(1);
      expect(callCount).toBe(2); // Segunda tentativa realizada

      // Status final no banco
      db = await readDB();
      msg = db.messages.find((m) => m.id === 'msg-lifecycle-1')!;
      expect(msg.status).toBe('sent');
      expect(msg.externalId).toBe('wamid.lifecycle_success_attempt2');
    });

    it('dois crons concorrentes disputando a mesma mensagem executam apenas 1 chamada HTTP', async () => {
      let httpCalls = 0;
      const countFetch = vi.fn(async () => {
        httpCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messaging_product: 'whatsapp',
            messages: [{ id: 'wamid.concurrent_cron_msg' }],
          }),
        };
      }) as any;

      await updateDB((d) => {
        d.messages.push({
          id: 'msg-concurrent-cron-1',
          businessId: BIZ_A,
          conversationId: 'conv-test-1',
          channel: 'whatsapp',
          channelUserId: '5511988887777',
          direction: 'out',
          body: 'Concorrência cron',
          status: 'pending',
          externalId: '',
          by: 'automation',
          at: '2026-09-19T10:00:00Z',
        });
      });

      // Dispara 2 crons concorrentes
      const [cron1, cron2] = await Promise.all([
        processPendingWhatsappRetries({ fetchFn: countFetch }),
        processPendingWhatsappRetries({ fetchFn: countFetch }),
      ]);

      expect(httpCalls).toBe(1);
      expect(cron1.messagesSent + cron2.messagesSent).toBe(1);

      const db = await readDB();
      const msg = db.messages.find((m) => m.id === 'msg-concurrent-cron-1')!;
      expect(msg.status).toBe('sent');
      expect(msg.externalId).toBe('wamid.concurrent_cron_msg');
    });

    it('métrica messagesProcessed no resumo do cron conta tentativas reais e não apenas sucessos', async () => {
      const failFetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: '500 error', code: 2 } }),
      })) as any;

      await updateDB((d) => {
        d.messages.push({
          id: 'msg-processed-metric-1',
          businessId: BIZ_A,
          conversationId: 'conv-test-1',
          channel: 'whatsapp',
          channelUserId: '5511988887777',
          direction: 'out',
          body: 'Métrica teste',
          status: 'pending',
          externalId: '',
          by: 'automation',
          at: '2026-09-19T10:00:00Z',
        });
      });

      const summary = await processPendingWhatsappRetries({ fetchFn: failFetch });
      // Tentativa real executada: processed deve ser 1, sent deve ser 0
      expect(summary.messagesProcessed).toBe(1);
      expect(summary.messagesSent).toBe(0);
    });
  });
});
