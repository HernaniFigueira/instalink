// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — IMPORTAR E EXPORTAR A BASE DE CLIENTES
// ═══════════════════════════════════════════════════════════════
// Travas deste bloco:
//   • o arquivo é lido como ele VEM (;,  ,  TAB, BOM, aspas, acento, CRLF);
//   • a prévia não escreve nada e diz linha por linha o que aconteceria;
//   • a identidade é a do CRM (telefone/e-mail) — NUNCA por nome;
//   • repetido no arquivo conta uma vez; quem já está na base é ATUALIZADO;
//   • linha torta não vira cadastro (a régua do Bloco 6 vale aqui);
//   • exportar devolve o MESMO formato que a importação entende (ida e volta);
//   • nada atravessa a fronteira da unidade.
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as importPOST } from '@/app/api/contacts/import/route';
import { GET as exportGET } from '@/app/api/contacts/export/route';
import {
  buildImportPlan, detectDelimiter, exportContactsCSV, importIdentityKey, importSummary,
  importTemplateCSV, mapHeader, parseBirthDate, parseCSV, parseImportFile, parseYesNo, toCSVRow,
} from '../client-import';
import { filterContactsForExport } from '../client-export';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ = 'biz-b7';
const OTHER = 'biz-b7-outra';
const OWNER = 'owner-b7';

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
  db.users.push({ id: OWNER, name: 'Dona Base', email: 'b7@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BIZ));
  db.businesses.push(business(OTHER));
  db.contacts.push({
    id: 'ct-existing', businessId: BIZ, name: 'Maria Antiga', phone: '21988887777',
    email: 'maria@exemplo.com', customerId: '', createdAt: NOW, updatedAt: NOW,
    source: 'agendamento', lastInteraction: NOW, marketingOptIn: false,
  } as any);
  db.contacts.push({
    id: 'ct-outra', businessId: OTHER, name: 'De outra unidade', phone: '11911112222',
    email: 'fora@exemplo.com', customerId: '', createdAt: NOW, updatedAt: NOW,
    source: 'manual', lastInteraction: NOW, marketingOptIn: false,
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

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER);
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · Bloco 7 — leitura do arquivo (regras puras)', () => {
  it('entende ponto e vírgula, vírgula e TAB — e não engasga com BOM/CRLF', () => {
    expect(detectDelimiter('nome;telefone\nA;11')).toBe(';');
    expect(detectDelimiter('nome,telefone\nA,11')).toBe(',');
    expect(detectDelimiter('nome\ttelefone\nA\t11')).toBe('\t');
    const rows = parseCSV('\uFEFFnome;telefone\r\nAna;21999998888\r\n');
    expect(rows).toEqual([['nome', 'telefone'], ['Ana', '21999998888']]);
    // Aspas, aspas escapadas e quebra de linha DENTRO da célula.
    expect(parseCSV('a,b\n"diz ""oi""",x')).toEqual([['a', 'b'], ['diz "oi"', 'x']]);
    expect(parseCSV('a,b\n"linha1\nlinha2",x')).toEqual([['a', 'b'], ['linha1\nlinha2', 'x']]);
    // Linha vazia no meio não vira registro fantasma.
    expect(parseCSV('a,b\n\nX,Y\n')).toEqual([['a', 'b'], ['X', 'Y']]);
  });

  it('reconhece cabeçalho em português e inglês, com acento e variações', () => {
    const map = mapHeader(['Nome Completo', 'WhatsApp', 'E-mail', 'Data de Nascimento', 'CEP', 'Aceita promoções']);
    expect(map.name).toBe(0);
    expect(map.phone).toBe(1);
    expect(map.email).toBe(2);
    expect(map.birthDate).toBe(3);
    expect(map.cep).toBe(4);
    expect(map.marketingOptIn).toBe(5);
    const en = mapHeader(['Name', 'Mobile', 'Mail']);
    expect([en.name, en.phone, en.email]).toEqual([0, 1, 2]);
  });

  it('normaliza o que o arquivo traz (telefone, data, sim/não) sem inventar dado', () => {
    expect(parseBirthDate('12/05/1990')).toBe('1990-05-12');
    expect(parseBirthDate('1990-5-2')).toBe('1990-05-02');
    expect(parseBirthDate('ontem')).toBe('');
    expect(parseYesNo('SIM')).toBe(true);
    expect(parseYesNo('não')).toBe(false);
    expect(parseYesNo('')).toBe(false);   // vazio NÃO é consentimento
    const parsed = parseImportFile('Nome;Telefone\n  Ana  ;+55 (21) 98888-7777\n');
    expect(parsed.rows[0]).toMatchObject({ line: 2, name: 'Ana', phone: '21988887777' });
    // Cabeçalho sem nome/telefone/e-mail é recusado com instrução clara.
    expect(parseImportFile('Cor;Tamanho\nazul;M').headerError).toMatch(/colunas/i);
  });

  it('a identidade do arquivo é telefone ou e-mail — nunca o nome', () => {
    expect(importIdentityKey({ phone: '(21) 98888-7777', email: '' })).toBe('p:21988887777');
    expect(importIdentityKey({ phone: '', email: ' Ana@Exemplo.com ' })).toBe('e:ana@exemplo.com');
    expect(importIdentityKey({ phone: '', email: '' })).toBe('');
  });
});

describe('A3.4 · Bloco 7 — plano da importação (prévia pura)', () => {
  const base = {
    id: 'ct1', businessId: BIZ, customerId: '', name: 'Maria Antiga', phone: '21988887777',
    email: 'maria@exemplo.com', createdAt: NOW, updatedAt: NOW, source: 'agendamento',
    lastInteraction: NOW, marketingOptIn: false,
  } as any;

  function plan(csv: string, contacts = [base]) {
    return buildImportPlan(parseImportFile(csv), contacts);
  }

  it('separa novo, atualização, repetido e erro — e não duplica quem já existe', () => {
    const csv = [
      'Nome;Telefone;E-mail',
      'Maria Souza;(21) 98888-7777;maria@exemplo.com',   // já existe (telefone) → atualiza
      'João Lima;11912345678;',                            // novo
      'João Repetido;11912345678;',                        // repetido no arquivo
      'Sem Contato;;',                                     // erro: sem telefone/e-mail
      'Fone Torto;09912345678;',                           // erro: DDD inexistente
    ].join('\n');
    const p = plan(csv);
    expect({ create: p.create, update: p.update, skip: p.skip, error: p.error }).toEqual({ create: 1, update: 1, skip: 1, error: 2 });
    expect(p.rows.map((r) => r.action)).toEqual(['update', 'create', 'skip', 'error', 'error']);
    // Atualização aponta para o contato CERTO (o do telefone digitado).
    expect(p.rows[0].contactId).toBe('ct1');
    // O repetido diz em qual linha o primeiro apareceu.
    expect(p.rows[2].message).toMatch(/linha 3/);
    // Erros explicam o que consertar, em português.
    expect(p.rows[3].message).toMatch(/telefone ou e-mail/i);
    expect(p.rows[4].message).toMatch(/DDD/i);
    expect(importSummary(p)).toContain('1 novo');
  });

  it('casa por e-mail também (quem não tem telefone no arquivo não vira segundo cadastro)', () => {
    const p = plan(['Nome;Telefone;E-mail', 'Maria Antiga;;maria@exemplo.com'].join('\n'));
    expect(p.update).toBe(1);
    expect(p.rows[0].contactId).toBe('ct1');
    expect(p.rows[0].message).toMatch(/e-mail/i);
  });

  it('NÃO casa por nome: duas pessoas com o mesmo nome continuam duas', () => {
    const csv = ['Nome;Telefone', 'Maria Antiga;11955554444'].join('\n');
    const p = plan(csv);
    expect(p.create).toBe(1);
    expect(p.rows[0].action).toBe('create');
  });

  it('lista as colunas que não reconheceu em vez de ignorar em silêncio', () => {
    const p = plan(['Nome;Telefone;Número da sorte', 'Ana;21999990000;7'].join('\n'));
    expect(p.unknownColumns).toEqual(['Número da sorte']);
  });

  it('o modelo para baixar é lido pela própria importação (ida e volta)', () => {
    const template = importTemplateCSV();
    const parsed = parseImportFile(template);
    expect(parsed.headerError).toBe('');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].phone).toBe('21988887777');
    expect(parsed.rows[0].marketingOptIn).toBe(true);
    expect(parsed.rows[1].email).toBe('');
  });

  it('a exportação alimenta a importação sem intermediário', () => {
    const csv = exportContactsCSV([base]);
    const parsed = parseImportFile(csv);
    expect(parsed.headerError).toBe('');
    expect(parsed.rows[0].name).toBe('Maria Antiga');
    expect(parsed.rows[0].phone).toBe('21988887777');
    expect(parsed.rows[0].email).toBe('maria@exemplo.com');
    expect(parsed.rows[0].marketingOptIn).toBe(false);
    // E a célula que tem ponto e vírgula sai entre aspas (senão viraria coluna).
    expect(toCSVRow(['a;b', 'c'])).toBe('"a;b";c');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · Bloco 7 — importar e exportar pelas rotas reais', () => {
  const CSV = [
    'Nome;Telefone;E-mail;Nascimento;CEP;Cidade;UF;Marketing',
    'Maria Souza;(21) 98888-7777;maria@exemplo.com;12/05/1990;22041-080;Rio de Janeiro;RJ;sim',
    'João Lima;11912345678;joao@exemplo.com;;;;;não',
    'Linha Ruim;09912345678;;;;;;',
  ].join('\n');

  it('a prévia NÃO escreve nada e devolve o plano completo', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv: CSV, mode: 'preview' }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.plan.create).toBe(1);      // João
    expect(body.plan.update).toBe(1);      // Maria (telefone já na base)
    expect(body.plan.error).toBe(1);       // DDD inexistente
    expect(body.summary).toContain('1 novo');
    const db = await readDB();
    expect(db.contacts).toHaveLength(2);   // nada foi gravado
    expect(db.audit.some((a) => a.action === 'contact.imported')).toBe(false);
  });

  it('o commit cria, atualiza e aplica o perfil — com auditoria do que entrou', async () => {
    const res = await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv: CSV, mode: 'commit' }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.result).toMatchObject({ created: 1, updated: 1, errors: 1 });
    const db = await readDB();
    const mine = db.contacts.filter((c) => c.businessId === BIZ);
    expect(mine).toHaveLength(2); // o walk-in torto não entrou
    const maria = mine.find((c) => c.phone === '21988887777')!;
    expect(maria.id).toBe('ct-existing');                            // atualizou, não duplicou
    expect(maria.name).toBe('Maria Souza');
    expect(maria.marketingOptIn).toBe(true);                         // consentimento explícito
    expect(maria.profile?.birthDate).toBe('1990-05-12');
    expect(maria.profile?.address?.cep).toBe('22041080');
    expect(maria.profile?.address?.city).toBe('Rio de Janeiro');
    const joao = mine.find((c) => c.phone === '11912345678')!;
    expect(joao.source).toBe('importacao');
    expect(joao.marketingOptIn).toBe(false);                         // "não" no arquivo
    const audit = db.audit.find((a) => a.action === 'contact.imported')!;
    expect(audit.meta).toMatchObject({ created: 1, updated: 1, errors: 1 });
  });

  it('reimportar o MESMO arquivo não cria ninguém de novo (idempotente)', async () => {
    await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv: CSV, mode: 'commit' }, token));
    const before = (await readDB()).contacts.filter((c) => c.businessId === BIZ).length;
    const again = await json(await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv: CSV, mode: 'commit' }, token)));
    expect(again.result.created).toBe(0);
    expect(again.result.updated).toBe(2);
    expect((await readDB()).contacts.filter((c) => c.businessId === BIZ)).toHaveLength(before);
  });

  it('não toca a base de OUTRA unidade nem aceita csv vazio', async () => {
    const otherCsv = 'Nome;Telefone\nIntruso;11999998888\n';
    // CSV enviado para a unidade B não enxerga (nem altera) contatos da unidade A.
    const res = await importPOST(jsonReq('/api/contacts/import', { businessId: OTHER, csv: otherCsv, mode: 'commit' }, token));
    expect(res.status).toBe(200);
    const db = await readDB();
    expect(db.contacts.filter((c) => c.businessId === OTHER).map((c) => c.phone)).toEqual(['11911112222', '11999998888']);
    expect(db.contacts.filter((c) => c.businessId === BIZ)).toHaveLength(1);
    const vazio = await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv: '   ', mode: 'preview' }, token));
    expect(vazio.status).toBe(400);
  });

  it('exporta CSV da unidade, com filtro e consentimento — e registra a saída', async () => {
    const res = await exportGET(jsonReq(`/api/contacts/export?businessId=${BIZ}`, undefined, token, 'GET'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('clientes-');
    const text = await res.text();
    expect(text.split('\n')[0]).toContain('Nome');
    expect(text).toContain('Maria Antiga');
    expect(text).not.toContain('De outra unidade');   // a outra unidade fica de fora

    // Filtro de marketing: só quem aceita.
    const db = await readDB();
    db.contacts.find((c) => c.id === 'ct-existing')!.marketingOptIn = true;
    await writeDB(db);
    const soMarketing = await (await exportGET(jsonReq(`/api/contacts/export?businessId=${BIZ}&marketing=1`, undefined, token, 'GET'))).text();
    expect(soMarketing).toContain('Maria Antiga');
    const nada = await (await exportGET(jsonReq(`/api/contacts/export?businessId=${OTHER}&marketing=1`, undefined, token, 'GET'))).text();
    expect(nada).not.toContain('De outra unidade');   // sem consentimento lá

    const audit = (await readDB()).audit.filter((a) => a.action === 'contact.exported');
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(audit[0].meta?.rows).toBeGreaterThanOrEqual(1);
  });

  it('a seleção de exportação é estável, respeita o teto e busca por telefone/e-mail', () => {
    const rows = filterContactsForExport([
      { id: 'b', name: 'Zeca', phone: '11911112222', email: '', profile: undefined } as any,
      { id: 'a', name: 'Ana', phone: '21988887777', email: 'ana@x.com', profile: undefined } as any,
    ] as any);
    expect(rows.map((r) => r.name)).toEqual(['Ana', 'Zeca']);      // ordem estável
    expect(filterContactsForExport(rows as any, { max: 1 })).toHaveLength(1);
    expect(filterContactsForExport(rows as any, { q: '(21) 98888' }).map((r) => r.name)).toEqual(['Ana']);
    expect(filterContactsForExport(rows as any, { q: 'ANA@X.COM' }).map((r) => r.name)).toEqual(['Ana']);
  });
});
