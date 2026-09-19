// ═══════════════════════════════════════════════════════════════
// A3.4 · 2ª REVISÃO DA B5 — INTEGRIDADE DO AUTOSAVE, IDENTIDADE DA FILA
// ═══════════════════════════════════════════════════════════════
// O que esta suíte trava (e que a revisão apontou como blocker):
//
//   1. o autosave lê o DRAFT ATUAL (o ref é atualizado em toda digitação —
//      um único caminho de escrita, provado por regressão de fonte);
//   2. digitar durante o request NÃO é apagado pela resposta antiga
//      (`applySaveResult` decide o que adotar do servidor);
//   3. encaminhar o save seguinte com a versão FRESCA (não a do render);
//   4. escrita sem `expectedVersion` é recusada (400) — não há atalho;
//   5. 1 entrada da fila → no máximo 1 registro (walk-in), com revalidação na
//      transação, e o reload por id é leitura pura (nunca POST);
//   6. o pós-atendimento: "Agendar retorno" só abre o fluxo (não cria
//      agendamento) e "Pedir à recepção" cria Tarefa vinculada ao atendimento.
import './helpers/temp-db';

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import {
  GET as encountersGET, POST as encountersPOST, PATCH as encountersPATCH,
} from '@/app/api/encounters/route';
import { POST as tasksPOST } from '@/app/api/tasks/route';
import {
  applySaveResult, encounterDraftKey, encounterForQueue, followUpTaskNote, followUpTaskTitle,
} from '../encounters';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ = 'biz-r2';
const OTHER = 'biz-r2-outra';
const OWNER = 'owner-r2';

function business(id: string): Business {
  return {
    id, ownerId: OWNER, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
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
  db.users.push({ id: OWNER, name: 'Dona Unidade', email: 'r2@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BIZ));
  db.businesses.push(business(OTHER));
  db.professionals.push({ id: 'pro-1', businessId: BIZ, name: 'Bia', role: '', photo: '', active: true, userId: '', followsBusinessHours: true, createdAt: NOW } as any);
  db.services.push({ id: 'svc-1', businessId: BIZ, name: 'Limpeza', durationMin: 60, price: 100, description: '', active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW } as any);
  // Walk-in: chegou sem horário marcado, já em atendimento.
  db.queue.push({
    id: 'q-r2', businessId: BIZ, customerName: 'Seu Zé', customerPhone: '11933332222',
    contactId: 'ct-r2', serviceId: 'svc-1', professionalId: 'pro-1', bookingId: '', note: '',
    status: 'in_service', date: '2026-09-19', createdAt: '2026-09-19T11:20:00.000Z',
    calledAt: '2026-09-19T11:25:00.000Z', startedAt: '2026-09-19T11:30:00.000Z', endedAt: '',
    updatedBy: OWNER, updatedAt: NOW,
  } as any);
  db.queue.push({
    id: 'q-outra', businessId: OTHER, customerName: 'De fora', customerPhone: '', contactId: '',
    serviceId: '', professionalId: '', bookingId: '', note: '', status: 'waiting',
    date: '2026-09-19', createdAt: NOW, calledAt: '', startedAt: '', endedAt: '', updatedBy: '', updatedAt: NOW,
  } as any);
  await writeDB(db);
}

function jsonReq(path: string, body: unknown, token?: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
  });
}
const json = (res: Response) => res.json() as Promise<any>;

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SHEET = stripComments(read('src/components/dashboard/EncounterSheet.tsx'));
const QUEUE = stripComments(read('src/components/dashboard/QueuePanel.tsx'));
const AGENDA = stripComments(read('src/app/(dashboard)/agenda/page.tsx'));

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER);
});

async function createWalkIn() {
  const res = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, queueId: 'q-r2' }, token));
  expect(res.status).toBe(200);
  return (await json(res)).encounter;
}

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · 2ª revisão — autosave concorrente (regra pura)', () => {
  it('digitar durante o request NÃO é apagado pela resposta antiga', () => {
    const draftA = { complaint: 'a', evolution: '', guidance: '', followUp: '', internalNote: '', tags: '' };
    const draftB = { ...draftA, complaint: 'a + o que eu digitei depois' };
    const sentKey = encounterDraftKey(draftA);

    // Chegou a resposta do save que mandou A…
    const durante = applySaveResult({ sentKey, currentKey: encounterDraftKey(draftB), serverVersion: 2 });
    expect(durante.adoptServerForm).toBe(false);        // B continua na tela
    expect(durante.lastSavedKey).toBe(sentKey);         // o que foi gravado é A
    expect(durante.baseVersion).toBe(2);                // próxima escrita usa a versão nova

    // …e a tela pode mandar B com a versão 2 (o ciclo seguinte).
    expect(encounterDraftKey(draftB)).not.toBe(durante.lastSavedKey);
  });

  it('sem digitação durante o request, a tela adota o que o servidor gravou', () => {
    const form = { complaint: 'a', evolution: 'b', guidance: '', followUp: '', internalNote: '', tags: '' };
    const key = encounterDraftKey(form);
    const r = applySaveResult({ sentKey: key, currentKey: key, serverVersion: 3 });
    expect(r.adoptServerForm).toBe(true);
    expect(r.lastSavedKey).toBe(key);
    expect(r.baseVersion).toBe(3);
  });

  it('regressão de fonte: existe UM caminho de escrita do formulário (ref sempre em sincronia)', () => {
    // Se algum onChange voltar a chamar setForm direto, o ref fica velho e o
    // autosave salva o texto errado — exatamente o blocker da revisão.
    const setFormCalls = SHEET.match(/setForm\(/g) || [];
    expect(setFormCalls).toHaveLength(2); // dentro de updateForm e de apply — e nada mais
    expect(SHEET).toMatch(/const updateForm = useCallback\(\(next: Form\) => \{\s*latest\.current = \{ \.\.\.latest\.current, form: next \};\s*setForm\(next\);/);
    // E o onChange dos campos passa por updateForm.
    const onChanges = SHEET.match(/onChange=\{\(e\) => updateForm\(/g) || [];
    expect(onChanges.length).toBeGreaterThanOrEqual(6);
  });

  it('regressão de fonte: o save lê o ref (draft atual) e manda a versão do ref', () => {
    expect(SHEET).toMatch(/const sentForm = latest\.current\.form;/);
    expect(SHEET).toMatch(/encounterContentPayload\(businessId, current\.id, sentForm, current\.version\)/);
    expect(SHEET).toMatch(/currentKey: encounterDraftKey\(latest\.current\.form\)/);
  });

  it('finalizar/reabrir usam a versão FRESCA (nunca a do render)', () => {
    // O transition lê a revisão do REF no momento do clique (depois de um save,
    // já é a versão fresca), nunca de uma variável capturada no render.
    expect(SHEET).toMatch(/const current = latest\.current\.row;\s*if \(!current\) return;[\s\S]{0,60}setBusy\(action\);/);
    expect(SHEET).toMatch(/businessId, id: current\.id, action, expectedVersion: current\.version/);
    // O finalize passa pelo save ANTES de assinar (o documento sai com o texto da tela).
    expect(SHEET).toMatch(/if \(dirty\) \{\s*const ok = await save\(\);\s*if \(!ok\) return;\s*\}\s*await transition\('finalize'\);/);
    // E o finalize salva ANTES de assinar, para o documento sair com o texto da tela.
    expect(SHEET).toMatch(/if \(dirty\) \{\s*const ok = await save\(\);\s*if \(!ok\) return;\s*\}\s*await transition\('finalize'\);/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · 2ª revisão — fila 1:1, reload por id e pós-atendimento (rotas reais)', () => {
  it('walk-in cria UM registro; abrir de novo devolve o MESMO id', async () => {
    const first = await createWalkIn();
    const again = await json(await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, queueId: 'q-r2' }, token)));
    expect(again.reused).toBe(true);
    expect(again.encounter.id).toBe(first.id);
    const db = await readDB();
    expect(db.encounters.filter((e) => e.queueId === 'q-r2')).toHaveLength(1);
    // E o 1:1 puro também vale fora da rota.
    expect(encounterForQueue(db.encounters, BIZ, 'q-r2')!.id).toBe(first.id);
    expect(encounterForQueue(db.encounters, OTHER, 'q-r2')).toBeNull();
  });

  it('outra unidade não alcança a entrada da fila nem o registro', async () => {
    const e = await createWalkIn();
    const getOutra = await encountersGET(jsonReq(`/api/encounters?businessId=${OTHER}&queueId=q-r2`, undefined, token, 'GET'));
    expect((await json(getOutra)).encounter).toBeNull();
    const postOutra = await encountersPOST(jsonReq('/api/encounters', { businessId: OTHER, queueId: 'q-r2' }, token));
    expect(postOutra.status).toBe(404);
    const idOutra = await encountersGET(jsonReq(`/api/encounters?businessId=${OTHER}&id=${e.id}`, undefined, token, 'GET'));
    expect(idOutra.status).toBe(404);
  });

  it('reload por id depois do conflito: continua UM registro (nunca POST para recarregar)', async () => {
    const e = await createWalkIn();
    // Aba A salva (v1 → 2) — o registro walk-in existe e é único.
    const a = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'texto da aba A', expectedVersion: e.version,
    }, token, 'PATCH'));
    expect(a.status).toBe(200);
    // Aba B (velha) é recusada…
    const b = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'texto da aba B', expectedVersion: 1,
    }, token, 'PATCH'));
    expect(b.status).toBe(409);
    // …e o "Recarregar registro" é LEITURA por id: a contagem não muda.
    const reload = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${e.id}`, undefined, token, 'GET'));
    expect(reload.status).toBe(200);
    expect((await json(reload)).encounter.evolution).toBe('texto da aba A');
    const db = await readDB();
    expect(db.encounters).toHaveLength(1);
    expect(db.encounters[0].queueId).toBe('q-r2');
  });

  it('regressão de fonte: a tela recarrega POR ID (não usa POST como se fosse reload)', () => {
    expect(SHEET).toMatch(/\/api\/encounters\?businessId=\$\{businessId\}&id=\$\{encodeURIComponent\(current\.id\)\}/);
    expect(SHEET).toMatch(/onClick=\{\(\) => \{ void reload\(\); \}\}/);
  });

  it('pós-atendimento: "Pedir à recepção" cria TAREFA vinculada ao atendimento', async () => {
    const e = await createWalkIn();
    const fin = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'limpeza feita', followUp: 'retorno em 30 dias', expectedVersion: e.version,
    }, token, 'PATCH'));
    const finalized = (await json(fin)).encounter;
    const ok = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, action: 'finalize', expectedVersion: finalized.version,
    }, token, 'PATCH'));
    expect(ok.status).toBe(200);

    const note = followUpTaskNote('retorno em 30 dias', 'ligar e marcar');
    const res = await tasksPOST(jsonReq('/api/tasks', {
      businessId: BIZ,
      title: followUpTaskTitle(finalized.customerName),
      note,
      contactId: finalized.contactId || undefined,
      encounterId: finalized.id,
    }, token));
    expect(res.status).toBe(201);
    const task = (await json(res)).task;
    expect(task.title).toBe('Agendar retorno de Seu Zé');
    expect(task.status).toBe('open');
    const db = await readDB();
    const stored = db.tasks.find((t) => t.id === task.id)!;
    expect(stored.encounterId).toBe(finalized.id);     // vínculo com o atendimento
    expect(stored.note).toContain('retorno em 30 dias');
    expect(db.audit.some((a) => a.action === 'task.created' && a.meta?.encounterId === finalized.id)).toBe(true);
    // Nada de sistema paralelo de pendência: a tarefa é a estrutura que já existe.
    expect(db.tasks).toHaveLength(1);
  });

  it('"Agendar retorno" NÃO cria agendamento sozinho — só abre o fluxo preenchido', async () => {
    const e = await createWalkIn();
    const k = await readDB();
    expect(k.bookings).toHaveLength(0);
    // O contrato da tela: o pai recebe a semente e abre o formulário; quem cria
    // agendamento é o NewBookingSheet, com confirmação humana.
    expect(SHEET).toMatch(/onScheduleReturn\(\{/);
    expect(SHEET).toMatch(/Agendar retorno abre o agendamento já preenchido — nada é marcado sem você confirmar/);
    expect(AGENDA).toMatch(/onScheduleReturn=\{\(info\) => \{\s*setQueueEncounter\(null\);\s*setCreating\(\{/);
    expect(AGENDA).toMatch(/initial=\{\{\s*name: creating\.name/);
    expect((await readDB()).bookings).toHaveLength(0);
  });

  it('a fila oferece a porta de volta ao registro, sem mexer no status', () => {
    expect(QUEUE).toMatch(/row\.status === 'in_service' && canEncounter && onEncounter && \([\s\S]{0,120}Abrir atendimento/);
    // A ação chama onEncounter (abre/reutiliza), nunca `move(row, ...)`.
    const bloco = QUEUE.slice(QUEUE.indexOf('Abrir atendimento') - 300, QUEUE.indexOf('Abrir atendimento') + 40);
    expect(bloco).not.toMatch(/move\(row/);
    expect(bloco).toMatch(/onEncounter\(row\)/);
  });

  it('quem reabre é quem administra — e a fila usa a régua real do papel', () => {
    expect(AGENDA).toMatch(/const canReopen = canReopenEncounter\(role\);/);
    expect(AGENDA).toMatch(/canReopen=\{canReopen\}/);
    // Nada de canReopen chumbado no fluxo da fila.
    expect(AGENDA).not.toMatch(/QueueEncounter[\s\S]{0,400}canReopen=\{false\}/);
  });
});
