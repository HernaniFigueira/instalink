import './helpers/temp-db';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB, updateDB } from '../db';
import { createSession } from '../auth';
import { biz, service, user } from './helpers/automation-fixtures';
import { defaultWhatsappIntegration } from '../whatsapp';
import { defaultAgent } from '../agent';
import { EvolutionClient, EvolutionError, evolutionConfigured, evolutionInstanceName, normalizeEvolutionMessage, webhookToken } from '../whatsapp-providers/evolution';
import { experimentalLifecycle } from '../whatsapp-providers/lifecycle';
import { deliverWhatsappMessage, processPendingWhatsappRetries, encryptSecret } from '../whatsapp-cloud-api';
import { sendWhatsappText } from '../whatsapp-providers/send';
import { createBookingTx } from '../booking-create';
import { addDaysISO, todayISO, weekdayOf } from '../tz';
import { POST as webhook } from '@/app/api/whatsapp/providers/evolution/webhook/route';
import { GET as settings, POST as manage } from '@/app/api/whatsapp/providers/evolution/route';
import { GET as conversations, POST as reply } from '@/app/api/conversations/route';
import { POST as officialManage } from '@/app/api/whatsapp/route';
import { GET as agenda } from '@/app/api/bookings/route';
import { PUT as updateAgent } from '@/app/api/agent/route';

const instances = new Map<string, { state: string; phone: string }>();
let fetchMock: ReturnType<typeof vi.fn>;
let seq = 0;
const actor = { id: 'owner-a', email: 'owner-a@t.com' };
const phone = '5511988887777';
function request(path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function event(body: string, id = `incoming-${++seq}`, businessId = 'a', extra: any = {}) {
  const instance = evolutionInstanceName(businessId);
  return { event: 'messages.upsert', instance, data: {
    key: { id, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
    pushName: 'Maria Demo', message: { conversation: body }, messageTimestamp: Math.floor(Date.now() / 1000),
  }, ...extra };
}
async function incoming(body: string, id?: string, businessId = 'a', extra: any = {}) {
  const payload = event(body, id, businessId, extra);
  const res = await webhook(request('/api/whatsapp/providers/evolution/webhook', payload, undefined,
    { 'x-instalink-webhook-secret': webhookToken(payload.instance) }));
  expect(res.status).toBe(200);
  return res.json();
}
async function connected(id = 'a') {
  await experimentalLifecycle(id, 'connect', actor);
  instances.get(evolutionInstanceName(id))!.state = 'open';
  await experimentalLifecycle(id, 'status', actor);
}
const outgoing = async (id = 'a') => (await readDB()).messages.filter((m) => m.businessId === id && m.direction === 'out');

beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('AUTOMATION_INLINE', '0');
  vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.example.test');
  vi.stubEnv('EVOLUTION_API_KEY', 'test-evolution-api-key-never-exposed');
  vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', 'test-webhook-secret-32-characters-minimum');
  vi.stubEnv('EVOLUTION_WEBHOOK_URL', 'https://instalink.example.test/api/whatsapp/providers/evolution/webhook');
  vi.stubEnv('WHATSAPP_CREDENTIALS_KEY', 'test-meta-encryption-key');
  instances.clear(); seq = 0;
  fetchMock = vi.fn(async (url: any, init: any = {}) => {
    const u = new URL(String(url)); const parts = u.pathname.split('/'); const name = decodeURIComponent(parts.at(-1)!);
    const body = init.body ? JSON.parse(init.body) : {};
    let data: any = {};
    if (u.hostname === 'graph.facebook.com') data = { messages: [{ id: `wamid-${++seq}` }] };
    else if (u.pathname === '/instance/create') { instances.set(body.instanceName, { state: 'close', phone: '5511999990000' }); data = { hash: process.env.EVOLUTION_API_KEY }; }
    else if (u.pathname === '/instance/fetchInstances') { const i = instances.get(u.searchParams.get('instanceName')!); data = i ? [{ name: u.searchParams.get('instanceName'), ownerJid: `${i.phone}@s.whatsapp.net`, token: process.env.EVOLUTION_API_KEY }] : []; }
    else if (parts[2] === 'connectionState') data = { instance: { instanceName: name, state: instances.get(name)?.state } };
    else if (parts[2] === 'connect') { instances.get(name)!.state = 'connecting'; data = { code: 'test-qr-material', base64: '', pairingCode: null }; }
    else if (parts[2] === 'logout') { instances.get(name)!.state = 'close'; data = { status: 'SUCCESS' }; }
    else if (parts[2] === 'delete') { instances.delete(name); data = { status: 'SUCCESS' }; }
    else if (parts[1] === 'message') data = { key: { id: `sent-${++seq}` } };
    return new Response(JSON.stringify(data), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const db = emptyDB();
  for (const id of ['a', 'b']) {
    db.businesses.push(biz(id, { features: { agent: true } as any,
      businessTimezone: 'America/Sao_Paulo', whatsappIntegration: defaultWhatsappIntegration() }));
    db.users.push(user(`owner-${id}`, `Owner ${id}`));
    db.agents.push({ ...defaultAgent(id), channels: { site: false, whatsapp: true } });
    db.services.push(service(`svc-${id}`, id, { name: 'Limpeza Dental', professionalIds: [`pro-${id}`] }));
    db.services.push(service(`svc2-${id}`, id, { name: 'Avaliação', professionalIds: [`pro-${id}`] }));
    db.professionals.push({ id: `pro-${id}`, businessId: id, name: `Profissional ${id}`, active: true } as any);
    for (let weekday = 0; weekday < 7; weekday++) db.availability.push({ id: `${id}-${weekday}`, businessId: id, professionalId: `pro-${id}`, serviceId: '', weekday, start: '09:00', end: '17:00', slotMin: 30 });
  }
  await writeDB(db);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Evolution transport and lifecycle', () => {
  it('creates a deterministic but distinct instance per tenant and returns only a real provider QR', async () => {
    const a = await experimentalLifecycle('a', 'connect', actor);
    const b = await experimentalLifecycle('b', 'connect', actor);
    expect(evolutionInstanceName('a')).not.toBe(evolutionInstanceName('b'));
    expect(a.status).toBe('qr_pending'); expect(a.qr).toMatch(/^data:image\/png;base64,/);
    expect(b.status).not.toBe('connected');
    const create = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/instance/create'));
    expect(create).toHaveLength(2);
    const payload = JSON.parse(create[0][1].body);
    expect(payload.integration).toBe('WHATSAPP-BAILEYS');
    expect(payload.webhook.headers['x-instalink-webhook-secret']).toBe(webhookToken(evolutionInstanceName('a')));
    expect(JSON.stringify(a)).not.toContain(process.env.EVOLUTION_API_KEY);
    expect(JSON.stringify(await readDB())).not.toContain(process.env.EVOLUTION_WEBHOOK_SECRET);
    expect(JSON.stringify(await readDB())).not.toContain(process.env.EVOLUTION_API_KEY);
    expect(JSON.stringify(await readDB())).not.toContain('test-qr-material');
  });
  it('reuses persisted instance, maps open to connected and obtains actual number', async () => {
    await connected();
    const result = await experimentalLifecycle('a', 'connect', actor);
    expect(result.status).toBe('connected'); expect(result.displayPhone).toBe('5511999990000');
    expect(result.connectedAt).toBeTruthy(); expect(result.qr).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/instance/create'))).toHaveLength(1);
  });
  it('disconnect and remove preserve all commercial history', async () => {
    await connected(); await incoming('Oi');
    const before = await readDB();
    expect((await experimentalLifecycle('a', 'disconnect', actor)).status).toBe('disconnected');
    expect((await experimentalLifecycle('a', 'remove', actor)).selected).toBe(false);
    const after = await readDB();
    for (const key of ['contacts', 'leads', 'conversations', 'messages', 'bookings'] as const) expect(after[key]).toEqual(before[key]);
    expect(instances.size).toBe(0);
    expect(after.audit.some((a) => a.action === 'whatsapp.experimental_removed')).toBe(true);
  });
  it('serializes concurrent lifecycle mutations and creates at most one instance', async () => {
    const results = await Promise.allSettled([experimentalLifecycle('a', 'connect', actor), experimentalLifecycle('a', 'connect', actor)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/instance/create'))).toHaveLength(1);
  });
  it('fails closed without server configuration, never calls provider or marks connected', async () => {
    vi.stubEnv('EVOLUTION_API_KEY', '');
    expect(evolutionConfigured()).toBe(false);
    await expect(experimentalLifecycle('a', 'connect', actor)).rejects.toThrow('Provider experimental ainda não configurado no servidor.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await readDB()).businesses[0].whatsappIntegration?.status).toBe('not_connected');
  });
  it('sanitizes provider body and network errors, sets timeout and prevents redirects', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: process.env.EVOLUTION_API_KEY }), { status: 401 }));
    await expect(experimentalLifecycle('a', 'connect', actor)).rejects.toThrow('HTTP 401');
    const db = await readDB(); expect(db.businesses[0].whatsappIntegration?.status).toBe('error');
    expect(JSON.stringify(db)).not.toContain(process.env.EVOLUTION_API_KEY);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    fetchMock.mockRejectedValueOnce(new Error(`request failed ${process.env.EVOLUTION_API_KEY}`));
    await expect(new EvolutionClient().status(evolutionInstanceName('a'))).rejects.toThrow('HTTP 502');
  });
  it('does not accept successful response without send id', async () => {
    await connected(); fetchMock.mockResolvedValueOnce(new Response('{}'));
    const b = (await readDB()).businesses[0];
    const r = await sendWhatsappText(b, { to: phone, body: 'Teste' });
    expect(r.ok).toBe(false);
  });
  it('refuses to switch away from a connected official account', async () => {
    await updateDB((d) => { d.businesses[0].whatsappIntegration!.status = 'connected'; });
    await expect(experimentalLifecycle('a', 'connect', actor)).rejects.toThrow('Desconecte o WhatsApp oficial');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HTTP security and tenant binding', () => {
  it('unauthenticated and other tenant callers cannot read, connect or disconnect', async () => {
    const tokenB = await createSession('owner-b');
    expect((await settings(request('/api/whatsapp/providers/evolution?businessId=a'))).status).toBe(401);
    for (const action of ['connect', 'disconnect', 'status', 'remove']) {
      expect((await manage(request('/api/whatsapp/providers/evolution', { businessId: 'a', action }, tokenB))).status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a member without whatsapp permission cannot manage the connection', async () => {
    await updateDB((d) => {
      d.users.push(user('restricted', 'Restrito'));
      d.members.push({ id: 'restricted-member', userId: 'restricted', businessId: 'a', role: 'PROFISSIONAL', permissions: { whatsapp: false }, active: true } as any);
    });
    const token = await createSession('restricted');
    expect((await manage(request('/api/whatsapp/providers/evolution', { businessId: 'a', action: 'connect' }, token))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('ignores caller instance, never exposes secrets in GET/POST response', async () => {
    const token = await createSession('owner-a');
    const res = await manage(request('/api/whatsapp/providers/evolution', { businessId: 'a', action: 'connect', instance: evolutionInstanceName('b') }, token));
    expect(res.status).toBe(200); expect(instances.has(evolutionInstanceName('a'))).toBe(true); expect(instances.has(evolutionInstanceName('b'))).toBe(false);
    const text = await res.text();
    const get = await settings(request('/api/whatsapp/providers/evolution?businessId=a', undefined, token));
    expect(get.headers.get('cache-control')).toBe('no-store');
    for (const secret of [process.env.EVOLUTION_API_KEY!, process.env.EVOLUTION_WEBHOOK_SECRET!, webhookToken(evolutionInstanceName('a'))]) {
      expect(text).not.toContain(secret); expect(JSON.stringify(await get.clone().json())).not.toContain(secret);
    }
  });
  it('invalid webhook header and cross-instance tokens are rejected before writes', async () => {
    await connected();
    for (const token of ['', 'invalid', webhookToken(evolutionInstanceName('b'))]) {
      const r = await webhook(request('/api/whatsapp/providers/evolution/webhook', event('Oi'), undefined, { 'x-instalink-webhook-secret': token }));
      expect(r.status).toBe(403);
    }
    expect((await readDB()).messages).toHaveLength(0);
  });
  it('authenticated but unknown instance cannot enter any tenant, and payload businessId is ignored', async () => {
    await incoming('Oi', 'unknown', 'a');
    expect((await readDB()).contacts).toHaveLength(0);
    await connected('a'); await incoming('Oi', 'mapped', 'a', { businessId: 'b' });
    const db = await readDB();
    for (const key of ['contacts', 'leads', 'conversations', 'messages'] as const) expect(db[key].every((v) => v.businessId === 'a')).toBe(true);
  });
  it('official configuration cannot overwrite an experimental binding', async () => {
    await connected(); const token = await createSession('owner-a');
    expect((await officialManage(request('/api/whatsapp', { businessId: 'a', action: 'disconnect' }, token))).status).toBe(409);
    expect((await readDB()).businesses[0].whatsappIntegration?.provider).toBe('whatsapp_web');
  });
  it('late connection open event after logout checks real state rather than reviving the session', async () => {
    await connected(); await experimentalLifecycle('a', 'disconnect', actor);
    await incoming('', 'late', 'a', { event: 'connection.update', data: { state: 'open' } });
    expect((await readDB()).businesses[0].whatsappIntegration?.status).toBe('disconnected');
  });
});

describe('shared inbound, real agent, CRM and Agenda', () => {
  it('Oi creates contact, lead, conversation, inbound and auto outbound; replays are atomic', async () => {
    await connected();
    await Promise.all([incoming('Oi', 'same'), incoming('Oi', 'same')]);
    let db = await readDB();
    expect(db.contacts).toHaveLength(1); expect(db.leads).toHaveLength(1); expect(db.conversations).toHaveLength(1);
    expect(db.messages.filter((m) => m.direction === 'in')).toHaveLength(1);
    expect(await outgoing()).toHaveLength(1);
    expect((await outgoing())[0].status).toBe('sent');
    expect((await outgoing())[0].body).toContain('Negócio a');
    expect(db.conversations[0].unread).toBe(1);
    await incoming('Olá novamente'); db = await readDB();
    expect(db.contacts).toHaveLength(1); expect(db.leads).toHaveLength(1);
    const token = await createSession('owner-a');
    const inbox = await conversations(request('/api/conversations?businessId=a', undefined, token));
    expect((await inbox.json()).conversations).toHaveLength(1);
  });
  it('same external id in distinct tenants remains isolated', async () => {
    await connected('a'); await connected('b');
    await incoming('Oi', 'shared-external-id', 'a'); await incoming('Oi', 'shared-external-id', 'b');
    const db = await readDB();
    for (const id of ['a', 'b']) {
      expect(db.contacts.filter((c) => c.businessId === id)).toHaveLength(1);
      expect(db.leads.filter((c) => c.businessId === id)).toHaveLength(1);
      expect(db.messages.filter((m) => m.businessId === id && m.direction === 'in')).toHaveLength(1);
    }
  });
  it('real agent setting off still ingests and does not auto reply, including handoff acknowledgement', async () => {
    await connected(); const token = await createSession('owner-a');
    const req = new NextRequest('http://localhost/api/agent', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ businessId: 'a', channels: { whatsapp: false } }) });
    expect((await updateAgent(req)).status).toBe(200);
    await incoming('Oi'); await incoming('quero falar com um atendente');
    expect(await outgoing()).toHaveLength(0);
    const db = await readDB(); expect(db.messages).toHaveLength(2); expect(db.conversations[0].mode).toBe('human');
  });
  it.each(['quero falar com uma pessoa', 'quero falar com atendente', 'atendente', 'humano', 'suporte humano', 'quero falar com um atendente'])('handoff %s responds once and stops until reactivation', async (text) => {
    await connected(); await incoming(text, 'handoff'); await incoming(text, 'handoff'); await incoming('Oi');
    expect(await outgoing()).toHaveLength(1); expect((await readDB()).conversations[0].mode).toBe('human');
    const token = await createSession('owner-a');
    const id = (await readDB()).conversations[0].id;
    expect((await reply(request('/api/conversations', { businessId: 'a', conversationId: id, action: 'switch_mode', mode: 'automation' }, token))).status).toBe(200);
    await incoming('Oi'); expect(await outgoing()).toHaveLength(2);
  });
  it('answers actual service price, then goes service → availability → day → time → confirm → real Booking', async () => {
    await connected(); await incoming('Qual o preço da Limpeza Dental?');
    expect((await outgoing()).at(-1)!.body).toContain('50,00');
    await incoming('quero agendar'); expect((await outgoing()).at(-1)!.body).toContain('Avaliação');
    await incoming('Limpeza Dental'); expect((await outgoing()).at(-1)!.body).toContain('horários livres');
    await incoming('amanhã'); expect((await outgoing()).at(-1)!.body).toContain('09:00');
    await incoming('09:00'); expect((await outgoing()).at(-1)!.body).toContain('Confirma?');
    expect((await readDB()).bookings).toHaveLength(0);
    await incoming('sim', 'confirm-booking'); await incoming('sim', 'confirm-booking');
    const db = await readDB(); expect(db.bookings).toHaveLength(1);
    const booking = db.bookings[0]; expect(booking.businessId).toBe('a'); expect(booking.serviceId).toBe('svc-a');
    expect(booking.professionalId).toBe('pro-a'); expect(booking.date).toBe(addDaysISO(todayISO(), 1));
    expect(db.leads.find((l) => l.businessId === 'a')?.stageId).toBe('scheduled');
    expect((await outgoing()).at(-1)!.body).toContain('Agendado!');
    expect(db.contacts.filter((c) => c.businessId === 'b')).toHaveLength(0);
    expect(db.bookings.filter((b) => b.businessId === 'b')).toHaveLength(0);
    const token = await createSession('owner-a');
    const page = await agenda(request('/api/bookings?businessId=a&mode=manage', undefined, token));
    expect(page.status).toBe(200); expect((await page.json()).bookings[0].id).toBe(booking.id);
  });
  it('slot occupied between offer and confirmation does not double book and resumes slot selection', async () => {
    await connected(); await incoming('quero agendar limpeza amanhã'); await incoming('09:00');
    await updateDB((d) => { createBookingTx(d, { business: d.businesses[0], service: d.services[0], actor: 'agent',
      date: addDaysISO(todayISO(), 1), time: '09:00', customer: { id: '', name: 'Outro cliente', phone: '11977776666' } }); });
    await incoming('sim');
    const db = await readDB(); expect(db.bookings).toHaveLength(1);
    expect((await outgoing()).at(-1)!.body).toContain('acabou de ser ocupado');
    expect(db.conversations.find((c) => c.channelUserId === phone)?.context?.flow?.step).toBe('pick_slot');
    await incoming('09:30'); await incoming('sim'); expect((await readDB()).bookings).toHaveLength(2);
  });
  it('human reply uses same outbox and experimental transport', async () => {
    await connected(); await incoming('Oi');
    const conv = (await readDB()).conversations[0]; const token = await createSession('owner-a');
    const r = await reply(request('/api/conversations', { businessId: 'a', conversationId: conv.id, body: 'Olá, aqui é a equipe.' }, token));
    expect(r.status).toBe(200); expect((await r.json()).message.status).toBe('sent');
    expect((await readDB()).conversations[0].mode).toBe('human');
    await incoming('Oi'); expect(await outgoing()).toHaveLength(2);
  });
  it('disabling agent also silences an already queued agent reply', async () => {
    await connected(); fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await incoming('Oi');
    await updateDB((d) => { d.agents[0].channels.whatsapp = false; });
    fetchMock.mockClear();
    await processPendingWhatsappRetries({ nowISO: new Date(Date.now() + 60_000).toISOString() });
    expect(fetchMock).not.toHaveBeenCalled(); expect((await outgoing())[0].status).toBe('failed');
  });
  it('pending automation is silenced after takeover, no cross-channel claim', async () => {
    await connected(); await incoming('Oi');
    await updateDB((d) => {
      const conv = d.conversations[0]; conv.mode = 'human';
      d.messages.push({ ...d.messages[1], id: 'pending-bot', externalId: '', status: 'pending' });
      d.messages.push({ ...d.messages[1], id: 'pending-ig', channel: 'instagram', externalId: '', status: 'pending' });
    });
    fetchMock.mockClear(); await deliverWhatsappMessage('a', 'pending-bot'); await deliverWhatsappMessage('a', 'pending-ig');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('normalization and outbound routing', () => {
  it.each([
    { key: { id: '1', remoteJid: `${phone}@s.whatsapp.net`, fromMe: true }, message: { conversation: 'echo' } },
    { key: { id: '1', remoteJid: '123@g.us', remoteJidAlt: `${phone}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'group' } },
    { key: { id: '1', remoteJid: 'status@broadcast', fromMe: false }, message: { conversation: 'status' } },
    { key: { id: '1', remoteJid: '123@lid', fromMe: false }, message: { conversation: 'lid-only' } },
    { key: { id: '1', remoteJid: `${phone}@s.whatsapp.net`, fromMe: false }, message: { imageMessage: { caption: 'image' } } },
  ])('ignores unsupported event %#', (data) => expect(normalizeEvolutionMessage(data)).toBeNull());
  it('accepts extended text and resolved PN alternative to LID', () => {
    expect(normalizeEvolutionMessage({ key: { id: 'id', fromMe: false, remoteJid: '123@lid', remoteJidAlt: `${phone}@s.whatsapp.net` }, message: { extendedTextMessage: { text: 'Oi' } } })?.phone).toBe(phone);
  });
  it('routes legacy/meta_cloud to existing sender, whatsapp_web to Evolution, rejects Meta templates on QR', async () => {
    const meta = (await readDB()).businesses[1];
    meta.whatsappIntegration = { ...defaultWhatsappIntegration(), phoneNumberId: '1234', encryptedAccessToken: encryptSecret('test-meta-token') };
    expect((await sendWhatsappText(meta, { to: phone, body: 'Meta' })).ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('graph.facebook.com');
    await connected(); const web = (await readDB()).businesses[0];
    expect((await sendWhatsappText(web, { to: phone, body: 'Web' })).ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/message/sendText/');
    expect((await sendWhatsappText(web, { to: phone, body: 'Template', template: { name: 'x', language: 'pt_BR' } })).ok).toBe(false);
  });
  it('does not blindly retry ambiguous send timeouts; a replay never creates another auto reply', async () => {
    await connected();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await incoming('Oi', 'ambiguous'); await incoming('Oi', 'ambiguous');
    expect(await outgoing()).toHaveLength(1); expect((await outgoing())[0].status).toBe('failed');
    fetchMock.mockClear(); await processPendingWhatsappRetries(); expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('additional fail-closed and live status contracts', () => {
  it('connection webhook reconciles open, number, date and audit without client polling', async () => {
    await experimentalLifecycle('a', 'connect', actor);
    instances.get(evolutionInstanceName('a'))!.state = 'open';
    await incoming('', 'state', 'a', { event: 'connection.update', data: { state: 'open' } });
    const db = await readDB();
    expect(db.businesses[0].whatsappIntegration?.status).toBe('connected');
    expect(db.businesses[0].whatsappIntegration?.lastWebhookAt).toBeTruthy();
    expect(db.businesses[0].whatsappIntegration?.connectedAt).toBeTruthy();
    expect(db.audit.some((a) => a.action === 'whatsapp.experimental_connected')).toBe(true);
  });
  it('first inbound can race the connection webhook without being lost', async () => {
    await experimentalLifecycle('a', 'connect', actor);
    instances.get(evolutionInstanceName('a'))!.state = 'open';
    await incoming('Oi'); expect((await readDB()).messages.filter((m) => m.direction === 'in')).toHaveLength(1);
  });
  it('a generic service question lists the real catalog, not a fake demo catalog', async () => {
    await connected(); await incoming('Quais serviços vocês oferecem?');
    const text = (await outgoing()).at(-1)!.body;
    expect(text).toContain('Limpeza Dental'); expect(text).toContain('Avaliação'); expect(text).toContain('50,00');
  });
  it('unavailable QR never becomes a fabricated connection or image', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ count: 0 })));
    expect(await new EvolutionClient().qr(evolutionInstanceName('a'))).toBeNull();
  });
  it('empty/unknown connection state fails rather than implying connected', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ instance: { instanceName: evolutionInstanceName('a'), state: 'unknown' } })));
    await expect(new EvolutionClient().status(evolutionInstanceName('a'))).rejects.toBeInstanceOf(EvolutionError);
  });
  it('invalid JSON and oversized body are refused without writes', async () => {
    const req = (text: string) => new NextRequest('http://localhost/api/whatsapp/providers/evolution/webhook', { method: 'POST', body: text });
    expect((await webhook(req('{broken'))).status).toBe(400);
    expect((await webhook(req('x'.repeat(256_001)))).status).toBe(413);
    expect((await readDB()).messages).toHaveLength(0);
  });
  it('disconnected session never ingests late messages', async () => {
    await connected(); await experimentalLifecycle('a', 'disconnect', actor);
    await incoming('Oi'); expect((await readDB()).messages).toHaveLength(0);
  });
  it('retryable rejection uses existing outbox + cron instead of another queue', async () => {
    await connected(); fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await incoming('Oi', 'limited');
    const message = (await outgoing())[0]; expect(message.status).toBe('pending'); expect(message.nextRetryAt).toBeTruthy();
    await incoming('Oi', 'limited'); expect(await outgoing()).toHaveLength(1);
    const result = await processPendingWhatsappRetries({ nowISO: new Date(Date.now() + 60_000).toISOString() });
    expect(result.messagesSent).toBe(1); expect((await outgoing())[0].status).toBe('sent');
  });
});
