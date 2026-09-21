// ═══════════════════════════════════════════════════════════════
// A3.4 — CORREÇÃO FINAL APÓS TESTE HUMANO REAL
// ═══════════════════════════════════════════════════════════════
// Cada bloco aqui nasceu de um problema visto USANDO o produto:
//   1. a fila criava contato sem mostrar que a pessoa já existia no CRM;
//   2. a fila oferecia qualquer profissional, mesmo para serviço restrito;
//   3. dava para INICIAR um serviço que o profissional não atende;
//   4. o encaixe aceitava horário de hoje que já passou;
//   5. encaixe e "precisa de fechamento" pintavam âmbar por cima do verde;
//   6. quem finalizava não tinha como CONSULTAR o que registrou;
//   7. "Finalizar e assinar" prometia assinatura que não existe;
//   8. a via impressa saía vazia quando o autosave ainda não tinha voltado;
//   9. no celular a página ganhava rolagem horizontal;
//  10/11. hierarquia da sidebar e acento do item ativo.
//
// As regras vivem no SERVIDOR (rotas reais, banco temporário isolado); as
// regressões de layout são de CÓDIGO-FONTE, apontando o arquivo — o projeto
// não tem jsdom, então o contrato é a classe/atributo que o navegador recebe.
import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as queueGET, POST as queuePOST, PATCH as queuePATCH } from '@/app/api/queue/route';
import { POST as encountersPOST, GET as encountersGET, PATCH as encountersPATCH } from '@/app/api/encounters/route';
import { POST as bookingsPOST } from '@/app/api/bookings/route';
import { encounterFormPrintBlocks, encounterVersion } from '../encounters';
import { fitInPastError, FIT_IN_PAST_ERROR } from '../fit-in';
import { professionalServesService, serviceRequiresProfessional, PROFESSIONAL_NOT_ELIGIBLE_ERROR } from '../booking';
import { resolveQueueAssignment } from '../queue';
import { FIT_IN_MARK_CLS, FIT_IN_STRIPE_CLS } from '../status';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const TODAY = '2026-09-19';
const BIZ = 'biz-htf';
const OTHER = 'biz-htf-outra';
const OWNER = 'owner-htf';
const ORLANDO = 'user-orlando';
const SILVIO = 'user-silvio';
const PRO_ORLANDO = 'pro-orlando';
const PRO_SILVIO = 'pro-silvio';
const SVC_ODONTO = 'svc-odonto';
const SVC_LIVRE = 'svc-livre';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(`${root}/${rel}`, 'utf8');
const FILES = {
  QUEUE: 'src/components/dashboard/QueuePanel.tsx',
  SHEET: 'src/components/dashboard/EncounterSheet.tsx',
  AGENDA: 'src/app/(dashboard)/agenda/page.tsx',
  SHELL: 'src/components/DashboardShell.tsx',
};
const QUEUE = read(FILES.QUEUE);
const SHEET = read(FILES.SHEET);
const AGENDA = read(FILES.AGENDA);
const SHELL = read(FILES.SHELL);

function business(id: string, ownerId = OWNER): Business {
  return {
    id, ownerId, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  } as Business;
}

async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER, name: 'Dona Unidade', email: 'htf@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' } as any,
    { id: ORLANDO, name: 'Dr. Orlando', email: 'orlando@example.com', passwordHash: 'x', createdAt: NOW, role: 'user' } as any,
    { id: SILVIO, name: 'Dr. Sílvio', email: 'silvio@example.com', passwordHash: 'x', createdAt: NOW, role: 'user' } as any,
  );
  db.businesses.push(business(BIZ), business(OTHER, 'ninguem'));
  db.members.push(
    { id: 'm-orl', businessId: BIZ, userId: ORLANDO, role: 'PROFISSIONAL', active: true, permissions: {}, createdAt: NOW, updatedAt: NOW } as any,
    { id: 'm-sil', businessId: BIZ, userId: SILVIO, role: 'PROFISSIONAL', active: true, permissions: {}, createdAt: NOW, updatedAt: NOW } as any,
  );
  db.professionals.push(
    // Orlando só faz alinhamento/implante; Sílvio é quem atende Odonto.
    { id: PRO_ORLANDO, businessId: BIZ, name: 'Dr. Orlando', role: '', photo: '', active: true, userId: ORLANDO, followsBusinessHours: true, createdAt: NOW } as any,
    { id: PRO_SILVIO, businessId: BIZ, name: 'Dr. Sílvio', role: '', photo: '', active: true, userId: SILVIO, followsBusinessHours: true, createdAt: NOW } as any,
  );
  db.services.push(
    { id: SVC_ODONTO, businessId: BIZ, name: 'Odonto', durationMin: 30, price: 200, description: '', active: true, bookable: true, professionalIds: [PRO_SILVIO], createdAt: NOW, updatedAt: NOW } as any,
    { id: SVC_LIVRE, businessId: BIZ, name: 'Alinhamento', durationMin: 30, price: 150, description: '', active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW } as any,
  );
  db.availability.push({
    id: 'av-1', businessId: BIZ, professionalId: '', serviceId: '', weekday: new Date(`${TODAY}T12:00:00Z`).getUTCDay(),
    start: '08:00', end: '20:00', slotMin: 30,
  } as any);
  db.contacts.push(
    { id: 'ct-ana', businessId: BIZ, name: 'Ana Hernani', phone: '11999990001', email: '', customerId: '', note: '', notes: [], createdAt: NOW, lastInteraction: NOW, source: 'manual', marketingOptIn: false } as any,
    { id: 'ct-outra', businessId: OTHER, name: 'De outra unidade', phone: '11999990002', email: '', customerId: '', note: '', notes: [], createdAt: NOW, lastInteraction: NOW, source: 'manual', marketingOptIn: false } as any,
  );
  await writeDB(db);
}

function jsonReq(path: string, body: unknown, token?: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
const json = (res: Response) => res.json() as Promise<any>;

let owner = '', orlando = '', silvio = '';

beforeEach(async () => {
  // Relógio fixo: 17:00 no fuso do negócio em 19/09/2026 — é o "agora" das
  // regras de encaixe no passado (09:00 recusado, 17:30 permitido).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-19T20:00:00Z'));
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  owner = await createSession(OWNER);
  orlando = await createSession(ORLANDO);
  silvio = await createSession(SILVIO);
});
afterEach(() => { vi.useRealTimers(); });

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · FILA — buscar o cliente existente antes de criar', () => {
  it('a tela busca no CRM ao digitar (nome ou WhatsApp) e deixa escolher o cadastro', () => {
    expect(QUEUE).toMatch(/\/api\/contacts\?businessId=\$\{encodeURIComponent\(businessId\)\}&q=\$\{encodeURIComponent\(q\)\}&limit=8/);
    expect(QUEUE).toMatch(/setTimeout\(\(\) => \{[\s\S]{0,120}fetch\(/);   // debounce, não request por tecla
    expect(QUEUE).toMatch(/data-queue-contact-results="true"/);
    expect(QUEUE).toMatch(/data-queue-contact=\{c\.id\}/);
    expect(QUEUE).toMatch(/Cliente já cadastrado/);
    expect(QUEUE).toMatch(/\+ Novo cliente \/ visitante/);
    // A identidade escolhida vai para o servidor como `contactId`.
    expect(QUEUE).toMatch(/contactId: picked\?\.id \|\| ''/);
  });

  it('escolher um cadastro existente usa AQUELE contato (nada de segundo cadastro)', async () => {
    const res = await queuePOST(jsonReq('/api/queue', {
      businessId: BIZ, contactId: 'ct-ana', customerName: 'Ana Hernani', customerPhone: '11999990001',
      serviceId: SVC_LIVRE, professionalId: PRO_ORLANDO,
    }, owner));
    expect(res.status).toBe(200);
    const entry = (await json(res)).entry;
    expect(entry.contactId).toBe('ct-ana');
    const db = await readDB();
    expect(db.contacts.filter((c) => c.businessId === BIZ).length).toBe(1);  // nenhum contato novo
    expect(db.queue).toHaveLength(1);
  });

  it('contactId de OUTRA unidade é recusado e NÃO grava nada (tenant-safe)', async () => {
    const res = await queuePOST(jsonReq('/api/queue', {
      businessId: BIZ, contactId: 'ct-outra', customerName: 'De outra unidade', customerPhone: '11999990002',
    }, owner));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/não é desta unidade/i);
    const db = await readDB();
    expect(db.queue).toHaveLength(0);
    expect(db.contacts.filter((c) => c.businessId === BIZ).length).toBe(1);
  });

  it('walk-in novo cria o cadastro MÍNIMO uma única vez (sem exigir ficha completa)', async () => {
    const payload = { businessId: BIZ, customerName: 'Douglas', customerPhone: '11988887777', serviceId: SVC_LIVRE };
    expect((await queuePOST(jsonReq('/api/queue', payload, owner))).status).toBe(200);
    expect((await queuePOST(jsonReq('/api/queue', payload, owner))).status).toBe(200);
    const db = await readDB();
    const mine = db.contacts.filter((c) => c.businessId === BIZ && c.phone === '11988887777');
    expect(mine).toHaveLength(1);            // o MESMO telefone não duplica o contato
    expect(db.queue).toHaveLength(2);
    expect(db.queue.every((q) => q.contactId === mine[0].id)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · FILA — serviço filtra o profissional', () => {
  it('serviço com lista de profissionais: só os elegíveis entram na conta', () => {
    const service = { professionalIds: [PRO_SILVIO] };
    expect(serviceRequiresProfessional(service)).toBe(true);
    expect(professionalServesService(service, PRO_SILVIO, [{ id: PRO_SILVIO, active: true } as any])).toBe(true);
    expect(professionalServesService(service, PRO_ORLANDO, [{ id: PRO_ORLANDO, active: true } as any])).toBe(false);
    // Serviço SEM lista mantém a política atual: qualquer profissional ativo.
    expect(serviceRequiresProfessional({ professionalIds: [] })).toBe(false);
    expect(professionalServesService({ professionalIds: [] }, PRO_ORLANDO, [{ id: PRO_ORLANDO, active: true } as any])).toBe(true);
    expect(professionalServesService({ professionalIds: [] }, PRO_ORLANDO, [{ id: PRO_ORLANDO, active: false } as any])).toBe(false);
  });

  it('a tela só oferece quem atende o serviço (e pré-seleciona quando há um só)', () => {
    expect(QUEUE).toMatch(/const requiredProIds = service\?\.professionalIds \|\| \[\];/);
    expect(QUEUE).toMatch(/eligiblePros = requiredProIds\.length[\s\S]{0,90}professionals\.filter\(\(p\) => requiredProIds\.includes\(p\.id\)\)/);
    // Trocar o serviço reavalia a lista e descarta quem deixou de ser elegível.
    expect(QUEUE).toMatch(/function chooseService\(id: string\)/);
    expect(QUEUE).toMatch(/professionalId: req\.length === 1 && next\[0\]/);
    // A agenda entrega a régua do serviço junto com a lista.
    expect(AGENDA).toMatch(/professionalIds: x\.professionalIds \|\| \[\]/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · FILA — profissional inelegível não inicia (servidor)', () => {
  async function entryFor(serviceId: string, extra: Record<string, unknown> = {}) {
    const res = await queuePOST(jsonReq('/api/queue', {
      businessId: BIZ, customerName: 'Walk-in', customerPhone: '11977776666', serviceId, ...extra,
    }, owner));
    expect(res.status).toBe(200);
    return (await json(res)).entry;
  }

  it('regra pura: quem assume é validado contra o serviço (e o escopo assume quando atende)', () => {
    const base = { entryProfessionalId: '', requestedProfessionalId: '', error: PROFESSIONAL_NOT_ELIGIBLE_ERROR };
    expect(resolveQueueAssignment({ ...base, serviceProfessionalIds: [PRO_SILVIO], scopeProfessionalId: PRO_ORLANDO }))
      .toMatchObject({ ok: false, error: PROFESSIONAL_NOT_ELIGIBLE_ERROR });
    expect(resolveQueueAssignment({ ...base, serviceProfessionalIds: [PRO_SILVIO], scopeProfessionalId: PRO_SILVIO }))
      .toMatchObject({ ok: true, professionalId: PRO_SILVIO });
    // Sem exigência do serviço, a política atual continua: o escopo assume.
    expect(resolveQueueAssignment({ ...base, serviceProfessionalIds: [], scopeProfessionalId: PRO_ORLANDO }))
      .toMatchObject({ ok: true, professionalId: PRO_ORLANDO });
    // Serviço com lista e operador sem vínculo: nada é fabricado.
    expect(resolveQueueAssignment({ ...base, serviceProfessionalIds: [PRO_SILVIO], scopeProfessionalId: '' }))
      .toMatchObject({ ok: true, professionalId: '' });
  });

  it('Dr. Orlando NÃO inicia Odonto (serviço do Dr. Sílvio) — 403 com a razão', async () => {
    const entry = await entryFor(SVC_ODONTO);          // entrada sem dono
    expect(entry.professionalId).toBe('');
    const res = await queuePATCH(jsonReq('/api/queue', { businessId: BIZ, id: entry.id, status: 'in_service' }, orlando, 'PATCH'));
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe(PROFESSIONAL_NOT_ELIGIBLE_ERROR);
    const row = (await readDB()).queue.find((q) => q.id === entry.id)!;
    expect(row.status).toBe('waiting');                 // a fila NÃO andou
    expect(row.professionalId).toBe('');                // e nada foi fabricado
  });

  it('Dr. Sílvio inicia Odonto: o escopo vira o profissional da entrada', async () => {
    const entry = await entryFor(SVC_ODONTO);
    const res = await queuePATCH(jsonReq('/api/queue', { businessId: BIZ, id: entry.id, status: 'in_service' }, silvio, 'PATCH'));
    expect(res.status).toBe(200);
    const row = (await readDB()).queue.find((q) => q.id === entry.id)!;
    expect(row.status).toBe('in_service');
    expect(row.professionalId).toBe(PRO_SILVIO);
  });

  it('a dona/secretaria não FABRICA vínculo inelegível (troca explícita é validada)', async () => {
    const entry = await entryFor(SVC_ODONTO);
    const errado = await queuePATCH(jsonReq('/api/queue', {
      businessId: BIZ, id: entry.id, status: 'called', professionalId: PRO_ORLANDO,
    }, owner, 'PATCH'));
    expect(errado.status).toBe(403);
    expect((await json(errado)).error).toBe(PROFESSIONAL_NOT_ELIGIBLE_ERROR);
    const certo = await queuePATCH(jsonReq('/api/queue', {
      businessId: BIZ, id: entry.id, status: 'called', professionalId: PRO_SILVIO,
    }, owner, 'PATCH'));
    expect(certo.status).toBe(200);
    expect((await json(certo)).entry.professionalId).toBe(PRO_SILVIO);
  });

  it('serviço SEM lista de profissionais: a política atual segue valendo', async () => {
    const entry = await entryFor(SVC_LIVRE);
    const res = await queuePATCH(jsonReq('/api/queue', { businessId: BIZ, id: entry.id, status: 'in_service' }, orlando, 'PATCH'));
    expect(res.status).toBe(200);
    expect((await readDB()).queue.find((q) => q.id === entry.id)!.professionalId).toBe(PRO_ORLANDO);
  });

  it('a criação também recusa profissional explícito fora do serviço', async () => {
    const res = await queuePOST(jsonReq('/api/queue', {
      businessId: BIZ, customerName: 'Walk-in', customerPhone: '11977776666',
      serviceId: SVC_ODONTO, professionalId: PRO_ORLANDO,
    }, owner));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(PROFESSIONAL_NOT_ELIGIBLE_ERROR);
  });

  it('o REGISTRO revalida: Orlando não abre atendimento de Odonto, Sílvio abre', async () => {
    const entry = await entryFor(SVC_ODONTO);
    const bloqueado = await encountersPOST(jsonReq('/api/encounters', {
      businessId: BIZ, queueId: entry.id, customerName: 'Walk-in', serviceId: SVC_ODONTO,
    }, orlando));
    expect(bloqueado.status).toBe(403);
    expect((await json(bloqueado)).error).toBe(PROFESSIONAL_NOT_ELIGIBLE_ERROR);
    expect((await readDB()).encounters).toHaveLength(0);

    const liberado = await encountersPOST(jsonReq('/api/encounters', {
      businessId: BIZ, queueId: entry.id, customerName: 'Walk-in', serviceId: SVC_ODONTO,
    }, silvio));
    expect(liberado.status).toBe(200);
    expect((await json(liberado)).encounter.professionalId).toBe(PRO_SILVIO);
  });

  it('quem opera o balcão SEM vínculo não é bloqueado: nada de vínculo a fabricar', async () => {
    // A dona/secretaria não é profissional nenhum — o serviço restrito não
    // cria um vínculo do nada, e o registro segue sem profissional (como
    // sempre foi). O que nunca passa é um profissional CONCRETO inelegível.
    const entry = await entryFor(SVC_ODONTO);
    const res = await encountersPOST(jsonReq('/api/encounters', {
      businessId: BIZ, queueId: entry.id, customerName: 'Walk-in', serviceId: SVC_ODONTO,
    }, owner));
    expect(res.status).toBe(200);
    expect((await json(res)).encounter.professionalId).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · ENCAIXE — o passado de hoje não é encaixável', () => {
  it('régua pura: agora 17:00 → 09:00 e 16:59 recusados, 17:00 e 17:30 permitidos', () => {
    expect(fitInPastError(TODAY, '09:00', TODAY, '17:00')).toBe(FIT_IN_PAST_ERROR);
    expect(fitInPastError(TODAY, '16:59', TODAY, '17:00')).toBe(FIT_IN_PAST_ERROR);
    expect(fitInPastError(TODAY, '17:00', TODAY, '17:00')).toBe('');
    expect(fitInPastError(TODAY, '17:30', TODAY, '17:00')).toBe('');
    // Outro dia não é assunto desta régua (o passado de DATA já era bloqueado).
    expect(fitInPastError('2026-09-20', '08:00', TODAY, '17:00')).toBe('');
  });

  it('o SERVIDOR recusa o encaixe passado e explica o motivo', async () => {
    const res = await bookingsPOST(jsonReq('/api/bookings', {
      businessId: BIZ, asOwner: true, customerName: 'Clara', customerPhone: '11988887777',
      serviceId: SVC_ODONTO, professionalId: PRO_SILVIO, date: TODAY, time: '09:00',
      bookingKind: 'fit_in', confirmFitIn: true,
    }, owner));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(FIT_IN_PAST_ERROR);
    expect((await readDB()).bookings).toHaveLength(0);
  });

  it('o encaixe de horário FUTURO continua funcionando (inclusive fora da grade)', async () => {
    const res = await bookingsPOST(jsonReq('/api/bookings', {
      businessId: BIZ, asOwner: true, customerName: 'Clara', customerPhone: '11988887777',
      serviceId: SVC_ODONTO, professionalId: PRO_SILVIO, date: TODAY, time: '17:30',
      bookingKind: 'fit_in',
    }, owner));
    expect(res.status).toBe(200);
    const db = await readDB();
    expect(db.bookings.find((b) => b.date === TODAY && b.time === '17:30')?.bookingKind).toBe('fit_in');
  });

  it('a tela avisa ANTES de chamar o servidor', () => {
    const sheet = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(sheet).toMatch(/fitInPastError\(date, fitInTime, today, nowHM\(new Date\(\), timezone \|\| undefined\)\)/);
    expect(sheet).toMatch(/if \(opts\.fitIn\) \{[\s\S]{0,140}fitInPastError\(date, when/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · COR — encaixe e atenção não misturam fundos', () => {
  it('o selo do encaixe é CONTORNO âmbar, nunca preenchimento sobre o status', () => {
    expect(FIT_IN_MARK_CLS).toMatch(/border-dashed/);
    expect(FIT_IN_MARK_CLS).toMatch(/var\(--attention-mark\)/);
    expect(FIT_IN_MARK_CLS).not.toMatch(/bg-/);          // sem fundo âmbar sobre o verde
    expect(FIT_IN_STRIPE_CLS).toMatch(/var\(--attention-mark\)/);
    expect(FIT_IN_STRIPE_CLS).toMatch(/absolute/);
  });

  it('o bloco da agenda usa o acento novo e mantém o status como base', () => {
    expect(AGENDA).toMatch(/FIT_IN_MARK_CLS/);
    expect(AGENDA).toMatch(/\{b\.fitIn && <span aria-hidden="true" className=\{FIT_IN_STRIPE_CLS\} \/>\}/);
    expect(AGENDA).not.toMatch(/bg-\[var\(--attention-bg\)\] text-\[var\(--attention-fg\)\][^`]*ENCAIXE/);
    // "Precisa de fechamento" continua sendo contorno + marcador "!".
    expect(AGENDA).toMatch(/ATTENTION_RING_CLS/);
    expect(AGENDA).toMatch(/ATTENTION_MARK_CLS/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · ATENDIDOS HOJE — consultar o que foi registrado', () => {
  it('concluído sai da fila viva, entra no histórico do dia e o registro abre em leitura', async () => {
    const created = await queuePOST(jsonReq('/api/queue', {
      businessId: BIZ, customerName: 'Walk-in', customerPhone: '11977776666', serviceId: SVC_ODONTO, professionalId: PRO_SILVIO,
    }, owner));
    const id = (await json(created)).entry.id;
    await queuePATCH(jsonReq('/api/queue', { businessId: BIZ, id, status: 'in_service' }, silvio, 'PATCH'));
    await queuePATCH(jsonReq('/api/queue', { businessId: BIZ, id, status: 'done' }, silvio, 'PATCH'));

    const lista = await json(await queueGET(jsonReq(`/api/queue?businessId=${BIZ}`, undefined, silvio, 'GET')));
    expect(lista.entries).toHaveLength(0);
    expect(lista.done.map((e: any) => e.id)).toContain(id);

    const aberto = await encountersPOST(jsonReq('/api/encounters', {
      businessId: BIZ, queueId: id, customerName: 'Walk-in', serviceId: SVC_ODONTO,
      evolution: 'Profilaxia e aplicação de flúor',
    }, silvio));
    const encounter = (await json(aberto)).encounter;
    await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: encounter.id, action: 'finalize', expectedVersion: encounterVersion(encounter),
    }, silvio, 'PATCH'));

    const leitura = await json(await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&queueId=${id}`, undefined, silvio, 'GET')));
    expect(leitura.encounter.status).toBe('finalized');
    expect(leitura.encounter.id).toBe(encounter.id);

    // É leitura: editar o finalizado continua 409 (a integridade não mudou).
    const editar = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: encounter.id, guidance: 'mudar depois',
      expectedVersion: encounterVersion(leitura.encounter),
    }, silvio, 'PATCH'));
    expect(editar.status).toBe(409);
  });

  it('a rail mostra "Atendidos hoje" só quando existe registro — e separado da fila', () => {
    expect(QUEUE).toMatch(/Atendidos hoje/);
    expect(QUEUE).toMatch(/data-queue-done-section="true"/);
    expect(QUEUE).toMatch(/\{doneRows\.length > 0 && \(/);
    expect(QUEUE).toMatch(/data-queue-done=\{row\.id\}/);
    expect(QUEUE).toMatch(/Ver atendimento/);
    expect(AGENDA).toMatch(/done=\{queueDone\}/);
    // O profissional vê os próprios registros pelo escopo já existente.
    expect(QUEUE).toMatch(/canEncounter && onEncounter/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · VIA DO CLIENTE — o que está na tela é o que sai no papel', () => {
  it('a impressão usa o FORMULÁRIO visível (o autosave pode não ter voltado)', () => {
    const blocks = encounterFormPrintBlocks({
      complaint: 'dor', evolution: 'limpeza', guidance: 'evitar frios', followUp: 'retorno em 30 dias',
      internalNote: 'segredo da unidade', tags: '',
    });
    expect(blocks.map((b) => b.label)).toEqual(['O que o cliente procurou', 'O que foi feito', 'Orientações', 'Retorno sugerido']);
    expect(JSON.stringify(blocks)).toContain('evitar frios');
    expect(JSON.stringify(blocks)).not.toContain('segredo da unidade');
  });

  it('a tela deriva a via do cliente do `form`, nunca do último payload do servidor', () => {
    expect(SHEET).toMatch(/const printBlocks = row \? encounterFormPrintBlocks\(form\) : \[\];/);
    expect(SHEET).not.toMatch(/encounterPrintBlocks\(row\)/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · LINGUAGEM — sem promessa de assinatura digital', () => {
  it('a tela fala "finalizar", não "assinar"', () => {
    expect(SHEET).toMatch(/Finalizar atendimento/);
    expect(SHEET).toMatch(/Finalizado por \{encounterSignature\(row\)\}/);
    expect(SHEET).not.toMatch(/Finalizar e assinar/);
    expect(SHEET).not.toMatch(/Assinado por/);
    expect(SHEET).not.toMatch(/finalizado e assinado/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · MOBILE (320–430px) — sem rolagem horizontal da página', () => {
  it('a Agenda não tem mais subtítulo permanente e mantém uma data móvel curta', () => {
    expect(AGENDA).not.toContain('Abra um atendimento para ver detalhes e ações.');
    expect(AGENDA).toContain('agenda-date-narrow');

  });

  it('na fila as ações descem de linha em vez de espremer nome/serviço', () => {
    expect(QUEUE).toMatch(/basis-\[calc\(100%-3rem\)\]/);
    expect(QUEUE).toMatch(/flex w-full flex-wrap items-center gap-2 sm:w-auto/);
    expect(QUEUE).not.toMatch(/whitespace-nowrap/);
  });

  it('o rodapé do registro empilha: botões em largura total no celular', () => {
    const wFull = SHEET.match(/className="w-full sm:w-auto"/g) || [];
    expect(wFull.length).toBeGreaterThanOrEqual(4);      // imprimir, salvar, finalizar, reabrir
    expect(SHEET).toMatch(/mr-auto flex w-full min-w-0 flex-wrap items-center gap-2 text-xs/);
  });

  it('nenhuma largura fixa acima da viewport nos três arquivos', () => {
    for (const [nome, src] of [['QueuePanel', QUEUE], ['EncounterSheet', SHEET], ['agenda/page', AGENDA]] as const) {
      for (const m of src.matchAll(/(?<!max-)\b(?:min-)?w-\[(\d{3,})px\]/g)) {
        expect(Number(m[1]), `${nome}: ${m[0]}`).toBeLessThanOrEqual(430);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// D360: sidebar geometry/identity/collapse now covered by WorkspaceNavigation.test.tsx
// and real desktop/mobile journeys, rather than retired CSS/source strings.
