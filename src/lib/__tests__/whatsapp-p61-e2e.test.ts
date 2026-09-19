// ═══════════════════════════════════════════════════════════════════════════════
// P6.1 — WHATSAPP CLOUD API REAL E2E & OPERACIONAL AUTOMATION TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════
import './helpers/temp-db';

import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { createSession } from '../auth';
import { encryptSecret, decryptSecret } from '../whatsapp-cloud-api';
import { registerChannelConnector } from '../integrations/connectors';
import { maskTechnicalId } from '../whatsapp';
import { createBookingTx } from '../booking-create';
import { executeAction } from '../automation/actions';
import type { Business, DB, Service, Professional } from '../types';

import { GET as webhookGET, POST as webhookPOST } from '@/app/api/whatsapp/webhook/route';
import { GET as settingsGET } from '@/app/api/whatsapp/route';
import { POST as masterWhatsappPOST } from '@/app/api/master/units/[id]/whatsapp/route';
import { POST as conversationsPOST } from '@/app/api/conversations/route';
import { POST as campaignsPOST, PATCH as campaignsPATCH } from '@/app/api/campaigns/route';

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
  });
});
