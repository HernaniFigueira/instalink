// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 (rodada 5) — LIMITE DE LINHAS, "IGNORAR" E SAÍDA EM PARTES
// ═══════════════════════════════════════════════════════════════
// Três promessas que estavam frágeis e agora são testadas nas ROTAS reais:
//
//   1. UM limite canônico de linhas (CSV e .xlsx, prévia e gravação) — acima
//      dele o arquivo inteiro é recusado com o número real de linhas, e NADA
//      é gravado. Truncar em silêncio faria a pessoa achar que importou tudo;
//   2. `ignore` no mapeamento é DECISÃO, não ausência: vale até para coluna
//      que a autodetecção reconheceu (senão a pessoa não consegue descartar);
//   3. a saída completa nunca chega pela metade sem dizer: cada arquivo traz
//      `complete` + `pagination` (parte, total, hasMore, nextCursor) e a tela
//      baixa todas as partes — quem pegar só a primeira sabe que faltam.
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as importPOST } from '@/app/api/contacts/import/route';
import { GET as exportFullGET } from '@/app/api/contacts/export-full/route';
import { IMPORT_MAX_ROWS } from '../client-import';
import { xlsxWithRows } from './helpers/xlsx-fixture';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ = 'biz-b7-limites';
const OWNER = 'owner-b7-limites';

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

/** Base pequena: o limite é o único motivo para recusar. */
async function seed(contacts = 1) {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER, name: 'Dono', email: 'limites@example.com', passwordHash: 'hash', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BIZ));
  for (let i = 0; i < contacts; i++) {
    db.contacts.push({
      id: `ct-${i}`, businessId: BIZ, name: `Pessoa ${i}`, phone: `2198888${String(1000 + i)}`,
      email: '', customerId: '', createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: false,
    } as any);
  }
  await writeDB(db);
}

function jsonReq(path: string, body: unknown, token: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
const json = (res: Response) => res.json() as Promise<any>;

/** CSV com N linhas de dados (telefones distintos) + cabeçalho. */
function csvWithRows(rows: number, header = 'Nome;Telefone'): string {
  const lines = [header];
  for (let i = 1; i <= rows; i++) lines.push(`Cliente ${i};219${String(20000000 + i)}`);
  return lines.join('\n');
}

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER);
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B7 (5ª volta) — limite de linhas: um só, sem truncar', () => {
  it('o limite canônico é 5.000 e a mensagem usa o MESMO número', async () => {
    expect(IMPORT_MAX_ROWS).toBe(5000);
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv: csvWithRows(6320), mode: 'commit',
    }, token));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe('row_limit_exceeded');
    expect(body.totalRows).toBe(6320);
    expect(body.limit).toBe(5000);
    expect(body.error).toBe('Esta planilha tem 6.320 linhas. O limite por importação é 5.000. Divida o arquivo em partes.');
  });

  it('acima do limite NADA é gravado (zero contato novo, zero auditoria de importação)', async () => {
    const antes = (await readDB()).contacts.filter((c) => c.businessId === BIZ).length;
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv: csvWithRows(5001), mode: 'commit',
    }, token));
    expect(res.status).toBe(400);
    const db = await readDB();
    expect(db.contacts.filter((c) => c.businessId === BIZ)).toHaveLength(antes);
    // Nenhum dos telefones do arquivo entrou.
    expect(db.contacts.some((c) => c.name.startsWith('Cliente '))).toBe(false);
    expect(db.audit.some((a) => a.action === 'contact.imported')).toBe(false);
  });

  it('a MESMA regra vale para .xlsx (e o número vem do arquivo, não do que coube na memória)', async () => {
    const buf = xlsxWithRows(6320);
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, fileBase64: buf.toString('base64'), fileName: 'base.xlsx', mode: 'commit',
    }, token));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe('row_limit_exceeded');
    expect(body.totalRows).toBe(6320);   // contagem real da planilha
    expect(body.limit).toBe(5000);
    expect(body.error).toContain('6.320 linhas');
    expect((await readDB()).contacts.some((c) => c.name.startsWith('Cliente '))).toBe(false);
  });

  it('a prévia obedece ao mesmo limite (nada de prévia bonita de arquivo impossível)', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv: csvWithRows(5001), mode: 'preview',
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('row_limit_exceeded');
  });

  it('no limite EXATO a prévia passa e informa quantas linhas foram lidas', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv: csvWithRows(5000), mode: 'preview',
    }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.rowsRead).toBe(5000);
    expect(body.limit).toBe(5000);
    expect(body.plan.rowLimit).toMatchObject({ total: 5000, limit: 5000, exceeded: false });
    expect(body.plan.rows).toHaveLength(5000);
  });

  it('.xlsx no limite exato também passa (o teto é do produto, não do leitor)', async () => {
    const buf = xlsxWithRows(5000);
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, fileBase64: buf.toString('base64'), mode: 'preview',
    }, token));
    expect(res.status).toBe(200);
    expect((await json(res)).rowsRead).toBe(5000);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B7 (5ª volta) — "Ignorar" derruba a autodetecção', () => {
  const csv = [
    'Nome;Telefone;E-mail',
    'Ana Ignorada;21988887777;ana@exemplo.com',
  ].join('\n');

  it('phone = ignore: o telefone NÃO entra no plano, mesmo com o cabeçalho detectado', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv, mode: 'preview', mapping: { phone: 'ignore' },
    }, token));
    expect(res.status).toBe(200);
    const plan = (await json(res)).plan;
    expect(plan.rows[0].phone).toBe('');
    expect(plan.rows[0].email).toBe('ana@exemplo.com'); // o resto continua
    expect(plan.ignoredColumns).toContain('Telefone');
  });

  it('com o telefone ignorado, o cadastro nasce sem telefone (nada foi gravado da coluna)', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv, mode: 'commit', mapping: { phone: 'ignore' },
    }, token));
    expect(res.status).toBe(200);
    expect((await json(res)).result.created).toBe(1);
    const criado = (await readDB()).contacts.find((c) => c.email === 'ana@exemplo.com')!;
    expect(criado.phone).toBe('');
  });

  it('o mapeamento é CONFERIDO no servidor: coluna que não existe é 400', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv, mode: 'preview', mapping: { phone: 9 },
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/não existe no arquivo/i);
  });

  it('campo desconhecido no mapeamento é recusado (nada de campo inventado)', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv, mode: 'preview', mapping: { telefone: 1 },
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Campo desconhecido/i);
  });

  it('a mesma coluna em dois campos é recusada', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv, mode: 'preview', mapping: { name: 1, email: 1 },
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/usada para/i);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B7 (5ª volta) — saída completa nunca mente sobre o tamanho', () => {
  it('base que cabe num arquivo só: complete = true e nome sem "parte"', async () => {
    const res = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}`, undefined, token, 'GET'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.complete).toBe(true);
    expect(body.pagination).toMatchObject({
      part: 1, partSize: 1000, cursor: 0, totalContacts: 1, exportedContacts: 1, hasMore: false, nextCursor: '',
    });
    expect(res.headers.get('content-disposition')).not.toContain('-parte-');
  });

  it('base grande sai em partes numeradas, e só a última diz que não há mais', async () => {
    // 2.500 contatos com partSize 1.000 = 3 partes.
    // (A semente nova apaga a base — inclusive a sessão — então refaz o login.)
    await seed(2500);
    token = await createSession(OWNER);
    const partes: any[] = [];
    let cursor = '';
    for (let i = 0; i < 10; i++) {
      const qs = `businessId=${BIZ}&partSize=1000${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await exportFullGET(jsonReq(`/api/contacts/export-full?${qs}`, undefined, token, 'GET'));
      expect(res.status).toBe(200);
      const body = await json(res);
      partes.push({ body, cd: res.headers.get('content-disposition') || '' });
      if (!body.pagination.hasMore) break;
      cursor = String(body.pagination.nextCursor);
      expect(cursor).not.toBe('');
    }
    expect(partes).toHaveLength(3);
    const [p1, p2, p3] = partes;
    expect(p1.body.complete).toBe(false);
    expect(p1.body.pagination).toMatchObject({ part: 1, totalContacts: 2500, exportedContacts: 1000, hasMore: true, nextCursor: '1000' });
    expect(p2.body.pagination).toMatchObject({ part: 2, exportedContacts: 1000, hasMore: true, nextCursor: '2000' });
    expect(p3.body.pagination).toMatchObject({ part: 3, exportedContacts: 500, hasMore: false, nextCursor: '' });
    // Só o arquivo ÚNICO pode se dizer completo; uma parte nunca é "a base".
    expect(p1.body.complete).toBe(false);
    expect(p2.body.complete).toBe(false);
    expect(p3.body.complete).toBe(false);
    // O nome do arquivo diz em qual parte a pessoa está.
    expect(p1.cd).toContain('-parte-1-de-3.json');
    expect(p3.cd).toContain('-parte-3-de-3.json');
    // Nenhum contato repetido e nenhum esquecido.
    // O arquivo identifica o cadastro por `contactId` (e o vínculo por `customerId`).
    const ids = partes.flatMap((p) => p.body.contacts.map((c: any) => c.contactId));
    expect(ids).toHaveLength(2500);
    expect(new Set(ids).size).toBe(2500);
  });

  it('a partição não pula ninguém quando o total não é múltiplo do tamanho da parte', async () => {
    await seed(7);
    token = await createSession(OWNER);
    const nomes: string[] = [];
    let cursor = '';
    for (let i = 0; i < 5; i++) {
      const qs = `businessId=${BIZ}&partSize=3${cursor ? `&cursor=${cursor}` : ''}`;
      const body = await json(await exportFullGET(jsonReq(`/api/contacts/export-full?${qs}`, undefined, token, 'GET')));
      nomes.push(...body.contacts.map((c: any) => c.registration.name));
      if (!body.pagination.hasMore) break;
      cursor = String(body.pagination.nextCursor);
    }
    expect(nomes).toHaveLength(7);
    expect(new Set(nomes).size).toBe(7);
  });

  it('cursor e tamanho de parte inválidos são recusados (nada de parte arbitrária)', async () => {
    const casos: [string, string][] = [
      ['cursor=-1', 'invalid_cursor'],
      ['cursor=abc', 'invalid_cursor'],
      ['cursor=1.5', 'invalid_cursor'],
      ['partSize=0', 'invalid_part_size'],
      ['partSize=5001', 'invalid_part_size'],
      ['partSize=abc', 'invalid_part_size'],
    ];
    for (const [qs, code] of casos) {
      const res = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}&${qs}`, undefined, token, 'GET'));
      expect(res.status, qs).toBe(400);
      expect((await json(res)).code, qs).toBe(code);
    }
  });

  it('cada arquivo diz se está completo — a tela recusa o que não disser', async () => {
    const body = await json(await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}`, undefined, token, 'GET')));
    expect(typeof body.complete).toBe('boolean');
    expect(body.pagination).toBeTruthy();
    expect(body.pagination).toHaveProperty('hasMore');
    expect(body.pagination).toHaveProperty('totalContacts');
  });
});

// ═══════════════════════════════════════════════════════════════
// A TELA (o JSX não roda no vitest: a prova é sobre o código-fonte).
// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B7 (5ª volta) — a tela das duas pontas', () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const read = (rel: string) => stripComments(fs.readFileSync(rel, 'utf8'));

  it('a lista de clientes baixa TODAS as partes e avisa quando o arquivo não veio inteiro', () => {
    const page = read('src/app/(dashboard)/clientes/page.tsx');
    // Laço de paginação de verdade: segue o `nextCursor` enquanto houver mais.
    expect(page).toMatch(/page\.pagination\.hasMore/);
    expect(page).toMatch(/cursor = String\(page\.pagination\.nextCursor/);
    // Arquivo sem `complete`/`pagination` não é salvo como se fosse a base.
    expect(page).toMatch(/page\.complete === undefined/);
    expect(page).toMatch(/nenhum arquivo parcial foi salvo/);
    // O nome do arquivo vem do servidor (já com a parte) e o aviso é visível.
    expect(page).toMatch(/content-disposition/);
    expect(page).toMatch(/role="status"/);
    expect(page).toMatch(/Base completa: /);
    expect(page).toMatch(/paginação parou antes do fim/);
  });

  it('a planilha mostra quantas linhas foram lidas e o limite da importação', () => {
    const sheet = read('src/components/dashboard/ImportClientsSheet.tsx');
    expect(sheet).toMatch(/plan\.rowLimit\.total/);
    expect(sheet).toMatch(/linhas lidas \(limite/);
    // E deixa corrigir o mapeamento de TODAS as colunas, com "Ignorar".
    expect(sheet).toMatch(/<option value=\{ignore\}>Ignorar<\/option>/);
    expect(sheet).toMatch(/Ignoradas por você/);
  });
});
