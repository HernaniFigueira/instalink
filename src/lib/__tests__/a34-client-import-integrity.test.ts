// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 (2ª volta) — INTEGRIDADE, PORTABILIDADE E SEGURANÇA
// ═══════════════════════════════════════════════════════════════
// Os gaps que a revisão apontou, um a um:
//
//   1. importação NÃO sobrescreve: padrão `skip_existing`; opção `fill_empty`
//      completa SÓ campo vazio (nada preenchido é substituído);
//   2. conflito de identidade (telefone de um cadastro + e-mail de outro, e a
//      mesma colisão entre duas linhas do arquivo) = ERRO, nunca merge;
//   3. CPF com dígito verificador de verdade e nascimento no calendário real
//      (31/02 não passa);
//   4. observação administrativa realmente persistida (campo canônico quando
//      vazio; histórico auditável quando já havia observação);
//   5. tags reconhecidas e preservadas na ida e volta;
//   6. célula à prova de fórmula (CSV/Excel injection) — inclusive no
//      relatório de erros;
//   7. mapeamento de colunas vindo da tela, validado no servidor;
//   8. .xlsx lido no servidor, sem dependência nova, reusando o mesmo planner;
//   9. saída completa em JSON restrita a OWNER/ADMIN e sem nenhum segredo.
import './helpers/temp-db';

import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as importPOST } from '@/app/api/contacts/import/route';
import { GET as exportGET } from '@/app/api/contacts/export/route';
import { GET as exportFullGET } from '@/app/api/contacts/export-full/route';
import {
  buildImportPlan, errorReportCSV, exportContactsCSV, fillEmptyUpdates, parseImportFile, parseMatrix,
  spreadsheetSafeCell, undoSpreadsheetEscape,
} from '../client-import';
import { columnIndexFromRef, parseSharedStrings, parseSheetXml, xlsxToMatrix } from '../xlsx-lite';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ = 'biz-b7b';
const OTHER = 'biz-b7b-outra';
const OWNER = 'owner-b7b';
const ADMIN = 'admin-b7b';
/** CPFs VÁLIDOS de verdade (dígitos verificadores conferem). */
const CPF_A = '111.444.777-35';
const CPF_B = '529.982.247-25';

function business(id: string, owner = OWNER): Business {
  return {
    id, ownerId: owner, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
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
  db.users.push({ id: OWNER, name: 'Dono', email: 'b7b@example.com', passwordHash: 'hash-secreto-do-dono', createdAt: NOW, role: 'owner' });
  db.users.push({ id: ADMIN, name: 'Gerente', email: 'adm@example.com', passwordHash: 'hash-do-admin', createdAt: NOW, role: 'admin' });
  db.businesses.push(business(BIZ));
  db.businesses.push(business(OTHER, 'outro-dono'));
  db.members.push({ id: 'm-adm', businessId: BIZ, userId: ADMIN, role: 'ADMIN', active: true, permissions: {}, createdAt: NOW, updatedAt: NOW } as any);
  // Dois cadastros distintos: um com telefone, outro com e-mail.
  db.contacts.push({
    id: 'ct-phone', businessId: BIZ, name: 'Ana do Telefone', phone: '21988887777', email: '',
    customerId: '', createdAt: NOW, updatedAt: NOW, source: 'agendamento', lastInteraction: NOW, marketingOptIn: true,
  } as any);
  db.contacts.push({
    id: 'ct-mail', businessId: BIZ, name: 'Beto do E-mail', phone: '', email: 'beto@exemplo.com',
    customerId: '', createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: false,
  } as any);
  db.contacts.push({
    id: 'ct-outra', businessId: OTHER, name: 'De fora', phone: '11911112222', email: 'fora@exemplo.com',
    customerId: '', createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: false,
  } as any);
  // Segredos que NÃO podem sair em nenhuma exportação.
  db.integrations.push({
    id: 'int-1', businessId: BIZ, channel: 'whatsapp', status: 'connected',
    encryptedAccessToken: 'TOKEN-SECRETO-DA-META', phoneNumberId: '123', createdAt: NOW, updatedAt: NOW,
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
let adminToken = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER);
  adminToken = await createSession(ADMIN);
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B7 (2ª volta) — nunca sobrescrever', () => {
  it('padrão SKIP: cadastro existente termina exatamente como estava', async () => {
    const csv = [
      'Nome;Telefone;E-mail;Marketing;Observação',
      'Ana Renomeada;(21) 98888-7777;nova@exemplo.com;não;mudou tudo',
    ].join('\n');
    const res = await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv, mode: 'commit' }, token));
    expect(res.status).toBe(200);
    expect((await json(res)).result).toMatchObject({ created: 0, filled: 0, skipped: 1 });
    const ana = (await readDB()).contacts.find((c) => c.id === 'ct-phone')!;
    expect(ana.name).toBe('Ana do Telefone');
    expect(ana.email).toBe('');
    expect(ana.marketingOptIn).toBe(true);   // e o consentimento existente NÃO caiu
    expect(ana.profile).toBeUndefined();
  });

  it('fill_empty completa só o vazio — nome, telefone e consentimento ficam', async () => {
    const csv = [
      'Nome;Telefone;E-mail;CPF;Nascimento;Observação;Marketing',
      `Ana Renomeada;(21) 98888-7777;ana@exemplo.com;${CPF_A};12/05/1990;prefere manhã;não`,
    ].join('\n');
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv, mode: 'commit', existingMode: 'fill_empty',
    }, token));
    expect(res.status).toBe(200);
    expect((await json(res)).result).toMatchObject({ created: 0, filled: 1 });
    const ana = (await readDB()).contacts.find((c) => c.id === 'ct-phone')!;
    expect(ana.name).toBe('Ana do Telefone');          // preenchido → NÃO troca
    expect(ana.phone).toBe('21988887777');              // preenchido → NÃO troca
    expect(ana.email).toBe('ana@exemplo.com');          // vazio → preenche
    expect(ana.profile?.cpf).toBe('11144477735');       // vazio → preenche
    expect(ana.profile?.birthDate).toBe('1990-05-12');
    expect(ana.profile?.adminNote).toBe('prefere manhã');
    expect(ana.marketingOptIn).toBe(true);              // "não" nunca desliga consentimento
  });

  it('consentimento: só "sim" explícito liga; vazio nunca presume; existente nunca cai', async () => {
    // Ana já aceitava. O arquivo diz "não" → continua aceitando (nunca desliga).
    await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, mode: 'commit', existingMode: 'fill_empty',
      csv: 'Nome;Telefone;Marketing\nAna;(21) 98888-7777;não',
    }, token));
    // Beto não aceitava e o arquivo diz "sim" → passa a aceitar.
    await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, mode: 'commit', existingMode: 'fill_empty',
      csv: 'Nome;E-mail;Marketing\nBeto;beto@exemplo.com;sim',
    }, token));
    const db = await readDB();
    expect(db.contacts.find((c) => c.id === 'ct-phone')!.marketingOptIn).toBe(true);
    expect(db.contacts.find((c) => c.id === 'ct-mail')!.marketingOptIn).toBe(true);

    // Cadastro NOVO com a coluna vazia: consentimento fica FALSO (nunca presumido).
    await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, mode: 'commit', csv: 'Nome;Telefone;Marketing\nNovo Sem Info;11977776666;',
    }, token));
    const novo = (await readDB()).contacts.find((c) => c.phone === '11977776666')!;
    expect(novo.marketingOptIn).toBe(false);
  });

  it('fill_empty não repete etiqueta nem inventa consentimento', () => {
    const contato = {
      id: 'c1', businessId: BIZ, customerId: '', name: 'X', phone: '21988887777', email: '',
      createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: false,
      profile: { tags: ['Vip'], adminNote: 'já tem observação' },
    } as any;
    const row = {
      line: 2, name: 'X', phone: '21988887777', email: '', cpf: '', birthDate: '', cep: '', street: '',
      number: '', complement: '', district: '', city: '', state: '', tags: ['vip', 'Novo'],
      guardianName: '', guardianPhone: '', guardianCpf: '', marketingOptIn: false, note: 'observação do arquivo',
    };
    const updates = fillEmptyUpdates(row, contato);
    expect(updates.profile.tags).toEqual(['Vip', 'Novo']);   // 'vip' não duplica
    expect(updates.adminNote).toBe('');                       // campo ocupado → não mexe
    expect(updates.historyNote).toBe('observação do arquivo'); // …mas a observação vai para o histórico
    expect(updates.marketingOptIn).toBe(false);
  });
});

describe('A3.4 · B7 (2ª volta) — conflito de identidade', () => {
  const base = (partial: any) => ({
    id: 'c', businessId: BIZ, customerId: '', name: 'X', phone: '', email: '',
    createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: false, ...partial,
  });

  it('telefone de um cadastro + e-mail de outro = ERRO (nunca escolhe e nunca junta)', () => {
    const contacts = [
      base({ id: 'ct-phone', name: 'Ana', phone: '21988887777' }),
      base({ id: 'ct-mail', name: 'Beto', email: 'beto@exemplo.com' }),
    ];
    const parsed = parseImportFile('Nome;Telefone;E-mail\nAna/Beto;(21) 98888-7777;beto@exemplo.com');
    const plan = buildImportPlan(parsed, contacts as any);
    expect(plan.error).toBe(1);
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].issues).toContain('identity_conflict');
    expect(plan.rows[0].message).toBe('Telefone e e-mail pertencem a cadastros diferentes. Revise esta linha.');
  });

  it('conflito ENTRE LINHAS do arquivo também é erro — o segundo não altera o primeiro', () => {
    const parsed = parseImportFile([
      'Nome;Telefone;E-mail',
      'Primeiro;11911110000;compartilhado@exemplo.com',
      'Segundo;11922220000;compartilhado@exemplo.com',   // mesmo e-mail, telefone diferente
    ].join('\n'));
    const plan = buildImportPlan(parsed, []);
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[1].action).toBe('error');
    expect(plan.rows[1].issues).toContain('identity_conflict');
  });

  it('a mesma pessoa repetida nas duas linhas é só repetição (não é conflito)', () => {
    const parsed = parseImportFile([
      'Nome;Telefone;E-mail',
      'Igual;11911110000;mesma@exemplo.com',
      'Igual;11911110000;mesma@exemplo.com',
    ].join('\n'));
    const plan = buildImportPlan(parsed, []);
    expect(plan.create).toBe(1);
    expect(plan.skip).toBe(1);
    expect(plan.rows[1].message).toMatch(/linha 2/);
  });
});

describe('A3.4 · B7 (2ª volta) — CPF e nascimento de verdade', () => {
  it('CPF com 11 dígitos mas dígito verificador errado é erro', () => {
    const plan = buildImportPlan(parseImportFile(`Nome;Telefone;CPF\nAna;21988887777;123.456.789-00`), []);
    expect(plan.error).toBe(1);
    expect(plan.rows[0].issues).toContain('cpf_invalido');
    // O MESMO CPF válido passa.
    const ok = buildImportPlan(parseImportFile(`Nome;Telefone;CPF\nAna;21988887777;${CPF_A}`), []);
    expect(ok.create).toBe(1);
    expect(ok.rows[0].cpf).toBe('11144477735');
  });

  it('31/02 não vira data válida só porque o formato bate', () => {
    const plan = buildImportPlan(parseImportFile('Nome;Telefone;Nascimento\nAna;21988887777;31/02/1990'), []);
    expect(plan.error).toBe(1);
    expect(plan.rows[0].issues).toContain('nascimento_invalido');
    const ok = buildImportPlan(parseImportFile('Nome;Telefone;Nascimento\nAna;21988887777;29/02/1992'), []);
    expect(ok.create).toBe(1);
  });

  it('CPF inválido do responsável também barra a linha', () => {
    const plan = buildImportPlan(parseImportFile('Nome;Telefone;CPF do responsável\nAna;21988887777;111.111.111-11'), []);
    expect(plan.error).toBe(1);
  });
});

describe('A3.4 · B7 (2ª volta) — observação e tags', () => {
  it('a observação do arquivo é PERSISTIDA (campo administrativo canônico)', async () => {
    const csv = 'Nome;Telefone;Observação\nNovato;11955554444;prefere contato por mensagem';
    const res = await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv, mode: 'commit' }, token));
    expect((await json(res)).result.created).toBe(1);
    const db = await readDB();
    const novo = db.contacts.find((c) => c.phone === '11955554444')!;
    expect(novo.profile?.adminNote).toBe('prefere contato por mensagem');
    // E a exportação devolve a mesma observação (a prévia não prometeu nada em vão).
    expect(exportContactsCSV([novo])).toContain('prefere contato por mensagem');
  });

  it('observação de quem JÁ tem observação entra no histórico, com autor', async () => {
    const db0 = await readDB();
    const ana = db0.contacts.find((c) => c.id === 'ct-phone')!;
    ana.profile = { birthDate: '', cpf: '', gender: '', adminNote: 'observação antiga', address: undefined, guardian: undefined, tags: [] } as any;
    await writeDB(db0);
    const csv = 'Nome;Telefone;Observação\nAna;(21) 98888-7777;novo combinado';
    await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, csv, mode: 'commit', existingMode: 'fill_empty',
    }, token));
    const db = await readDB();
    const maria = db.contacts.find((c) => c.id === 'ct-phone')!;
    expect(maria.profile?.adminNote).toBe('observação antiga');   // não sobrescreveu
    expect(maria.notes?.[0]?.text).toBe('novo combinado');        // e não desapareceu
    expect(maria.notes?.[0]?.byName).toBe('Dono');
    expect(db.audit.some((a) => a.action === 'contact.note_added' && a.meta?.origin === 'importacao')).toBe(true);
  });

  it('tags sobrevivem à ida e volta (exportar → importar)', async () => {
    const csv = 'Nome;Telefone;Tags;Marketing\nCom Tags;11933334444;"vip, manhã, vip"';
    await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv, mode: 'commit' }, token));
    const db = await readDB();
    const c = db.contacts.find((x) => x.phone === '11933334444')!;
    expect(c.profile?.tags).toEqual(['vip', 'manhã']);   // sem repetição
    // Exporta → lê de volta: as tags continuam lá.
    const exported = exportContactsCSV([c]);
    const back = parseImportFile(exported);
    expect(back.rows[0].tags).toEqual(['vip', 'manhã']);
    expect(back.rows[0].phone).toBe('11933334444');
  });
});

describe('A3.4 · B7 (2ª volta) — célula à prova de fórmula', () => {
  it('neutraliza = + - @ (e devolve o valor original na leitura)', () => {
    expect(spreadsheetSafeCell('=HYPERLINK("http://x")')).toBe("'=HYPERLINK(\"http://x\")");
    expect(spreadsheetSafeCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(spreadsheetSafeCell('-2+3')).toBe("'-2+3");
    expect(spreadsheetSafeCell('@foo')).toBe("'@foo");
    expect(spreadsheetSafeCell('Maria')).toBe('Maria');
    // Ida e volta: o dado volta igual ao que entrou.
    for (const v of ['=1+1', '+x', '-y', '@z']) expect(undoSpreadsheetEscape(spreadsheetSafeCell(v))).toBe(v);
  });

  it('o CSV exportado não deixa a planilha executar nada', async () => {
    const csv = [
      'Nome;Telefone;Observação;Tags',
      '"=HYPERLINK(""http://malicioso"",""clique"")";11955550000;+cmd|calc;@tag',
    ].join('\n');
    await importPOST(jsonReq('/api/contacts/import', { businessId: BIZ, csv, mode: 'commit' }, token));
    const db = await readDB();
    const perigo = db.contacts.find((c) => c.phone === '11955550000')!;
    const out = exportContactsCSV([perigo]);
    // Nenhuma célula começa com o gatilho de fórmula…
    for (const line of out.split('\n').slice(1).filter(Boolean)) {
      for (const cell of line.split(';')) {
        const v = cell.startsWith('"') ? cell.slice(1, -1) : cell;
        expect(v.startsWith('=') || v.startsWith('+') || v.startsWith('@')).toBe(false);
      }
      // …e o valor original continua legível (com o apóstrofo de segurança).
      expect(line).toContain("'");
    }
    // O relatório de erros nasce igualmente seguro.
    const plan = buildImportPlan(parseImportFile('Nome;Telefone\n=PERIGO;119123'), []);
    const report = errorReportCSV(plan.rows);
    expect(report).toContain(";'=PERIGO;");
  });
});

describe('A3.4 · B7 (2ª volta) — mapeamento e planilha', () => {
  it('o mapeamento do usuário manda, é validado e não aceita coluna inexistente', () => {
    const matrix = [['Coluna A', 'Coluna B'], ['Ana', '21988887777']];
    const auto = parseMatrix(matrix);
    expect(auto.headerError).not.toBe('');                 // nada reconhecido
    const manual = parseMatrix(matrix, { mapping: { name: 0, phone: 1 } });
    expect(manual.headerError).toBe('');
    expect(manual.rows[0].name).toBe('Ana');
    expect(manual.rows[0].phone).toBe('21988887777');
    // Índice fora do arquivo é recusado com explicação.
    const bad = parseMatrix(matrix, { mapping: { name: 9 } });
    expect(bad.mappingErrors[0]).toMatch(/não existe no arquivo/);
    // A mesma coluna não pode virar dois campos.
    const dup = parseMatrix(matrix, { mapping: { name: 0, phone: 0 } });
    expect(dup.mappingErrors.some((e) => /usada para/.test(e))).toBe(true);
  });

  it('a planilha .xlsx é lida no SERVIDOR sem dependência e reusa o mesmo planner', async () => {
    // Gera um .xlsx de verdade (ZIP + XML) e importa pelas rotas reais.
    const xlsx = buildXlsx([
      ['Nome', 'Telefone', 'Nascimento', 'Tags'],
      ['Da Planilha', '(21) 95555-4444', 33005, 'vip, retorno'],   // 33005 = data serial
    ]);
    const res = await importPOST(jsonReq('/api/contacts/import', {
      businessId: BIZ, mode: 'commit', fileName: 'base.xlsx',
      fileBase64: Buffer.from(xlsx).toString('base64'),
    }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.result.created).toBe(1);
    const c = (await readDB()).contacts.find((x) => x.phone === '21955554444')!;
    expect(c.name).toBe('Da Planilha');
    expect(c.profile?.tags).toEqual(['vip', 'retorno']);
    // A data serial virou data de verdade (o estilo do exemplo é de data).
    expect(c.profile?.birthDate).toBe('1990-05-12');
  });

  it('o leitor de .xlsx entende referências, texto compartilhado e recusa o que não é ZIP', () => {
    expect(columnIndexFromRef('A1')).toBe(0);
    expect(columnIndexFromRef('C7')).toBe(2);
    expect(columnIndexFromRef('AB2')).toBe(27);
    expect(parseSharedStrings('<sst><si><t>Oi</t></si><si><r><t>Rich</t></r><r><t> Text</t></r></si></sst>'))
      .toEqual(['Oi', 'Rich Text']);
    const rows = parseSheetXml(
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c><c r="B1" t="s"><v>0</v></c></row></sheetData>',
      ['Valor'], new Set<number>(),
    );
    expect(rows).toEqual([['Nome', 'Valor']]);
    expect(() => xlsxToMatrix(Buffer.from('isto não é um xlsx'))).toThrow(/ZIP|inválido|planilha/i);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B7 (2ª volta) — saída completa (JSON) sem segredos', () => {
  it('só quem administra leva a base inteira; a permissão de Clientes não basta', async () => {
    const dono = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}`, undefined, token, 'GET'));
    expect(dono.status).toBe(200);
    expect(dono.headers.get('content-type')).toContain('application/json');
    // ADMIN também pode.
    const admin = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}`, undefined, adminToken, 'GET'));
    expect(admin.status).toBe(200);
  });

  it('quem só tem a permissão de Clientes (recepção) não leva a base completa', async () => {
    const db0 = await readDB();
    db0.users.push({ id: 'rec-b7b', name: 'Recepção', email: 'rec@example.com', passwordHash: 'hash-da-recepcao', createdAt: NOW, role: 'admin' } as any);
    db0.members.push({
      id: 'm-rec', businessId: BIZ, userId: 'rec-b7b', role: 'RECEPTION', active: true,
      permissions: { clientes: true, agenda: true, atendimento: false }, createdAt: NOW, updatedAt: NOW,
    } as any);
    await writeDB(db0);
    const recToken = await createSession('rec-b7b');

    const full = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}`, undefined, recToken, 'GET'));
    expect(full.status).toBe(403);
    expect((await json(full)).error).toMatch(/administra a unidade/i);
    // O CSV simples continua sendo do trabalho dela…
    const csv = await exportGET(jsonReq(`/api/contacts/export?businessId=${BIZ}`, undefined, recToken, 'GET'));
    expect(csv.status).toBe(200);
    // …e o arquivo completo NÃO tem a seção de atendimento para quem não tem
    // a permissão de atendimento (dado clínico).
    const db1 = await readDB();
    db1.encounters.push({
      id: 'enc-x', businessId: BIZ, bookingId: '', queueId: '', serviceId: '', professionalId: '',
      customerId: '', contactId: 'ct-phone', customerName: 'Ana', date: '2026-09-10', time: '09:00',
      complaint: 'sigiloso', evolution: '', guidance: '', followUp: '', internalNote: '',
      tags: [], status: 'finalized', version: 2, createdAt: NOW, updatedAt: NOW, createdBy: OWNER,
      updatedBy: OWNER, finalizedAt: NOW, finalizedBy: OWNER, signedBy: '',
    } as any);
    db1.members.push({
      id: 'm-adm2', businessId: BIZ, userId: 'sem-atendimento', role: 'ADMIN', active: true,
      permissions: { clientes: true, atendimento: false }, createdAt: NOW, updatedAt: NOW,
    } as any);
    db1.users.push({ id: 'sem-atendimento', name: 'Admin sem atendimento', email: 'sa@example.com', passwordHash: 'h', createdAt: NOW, role: 'admin' } as any);
    await writeDB(db1);
    const saToken = await createSession('sem-atendimento');
    const semAtendimento = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}`, undefined, saToken, 'GET'));
    expect(semAtendimento.status).toBe(200);
    const text = await semAtendimento.text();
    expect(text).not.toContain('sigiloso');
    expect(JSON.parse(text).omitted.join(' ')).toMatch(/atendimento/);
  });

  it('a saída completa não atravessa a unidade (nem por id de outro negócio)', async () => {
    // O dono da unidade BIZ pede a base de OUTRA unidade — não passa, e nada
    // do outro tenant aparece nem no corpo do erro.
    const res = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${OTHER}`, undefined, token, 'GET'));
    expect([403, 404]).toContain(res.status);
    expect(await res.text()).not.toContain('fora@exemplo.com');
    // A importação segue a mesma regra.
    const imp = await importPOST(jsonReq('/api/contacts/import', {
      businessId: OTHER, mode: 'preview', csv: 'Nome;Telefone\nX;11999998888',
    }, token));
    expect([403, 404]).toContain(imp.status);
  });

  it('o arquivo completo traz histórico e NÃO traz segredo nenhum', async () => {
    // Um atendimento para provar a seção e um contato com histórico.
    const db0 = await readDB();
    db0.bookings.push({
      id: 'bk-full', businessId: BIZ, customerId: '', serviceId: '', professionalId: '',
      date: '2026-09-10', time: '10:00', customerName: 'Ana do Telefone', customerPhone: '21988887777',
      status: 'done', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
    } as any);
    db0.conversations.push({
      id: 'cv-1', businessId: BIZ, contactId: 'ct-phone', customerId: '', channel: 'whatsapp',
      status: 'open', createdAt: NOW, updatedAt: NOW,
    } as any);
    db0.messages.push({
      id: 'msg-1', businessId: BIZ, conversationId: 'cv-1', direction: 'in', body: 'oi, tudo bem?',
      status: 'sent', externalId: 'wamid', by: 'contact', at: NOW,
    } as any);
    db0.encounters.push({
      id: 'enc-full', businessId: BIZ, bookingId: 'bk-full', queueId: '', serviceId: '', professionalId: '',
      customerId: '', contactId: 'ct-phone', customerName: 'Ana do Telefone', date: '2026-09-10', time: '10:00',
      complaint: 'dor', evolution: 'limpeza', guidance: '', followUp: '', internalNote: 'nota interna',
      tags: [], status: 'finalized', version: 2, createdAt: NOW, updatedAt: NOW, createdBy: OWNER, updatedBy: OWNER,
      finalizedAt: NOW, finalizedBy: OWNER, signedBy: 'Bia',
    } as any);
    await writeDB(db0);

    const res = await exportFullGET(jsonReq(`/api/contacts/export-full?businessId=${BIZ}`, undefined, token, 'GET'));
    const text = await res.text();
    const payload = JSON.parse(text);

    expect(payload.format).toBe('instalink.customers.full');
    const ana = payload.contacts.find((c: any) => c.contactId === 'ct-phone');
    expect(ana.registration.phone).toBe('21988887777');
    expect(ana.bookings.map((b: any) => b.id)).toEqual(['bk-full']);
    expect(ana.conversations[0].messages[0].text).toBe('oi, tudo bem?');
    expect(ana.encounters.map((e: any) => e.id)).toEqual(['enc-full']);   // OWNER tem atendimento

    // NENHUM segredo, em lugar nenhum.
    for (const forbidden of [
      'hash-secreto-do-dono', 'hash-do-admin', 'passwordHash', 'TOKEN-SECRETO-DA-META',
      'encryptedAccessToken', 'fora@exemplo.com', 'De fora',
    ]) {
      expect(text, `não pode vazar: ${forbidden}`).not.toContain(forbidden);
    }
    // E o arquivo DIZ o que ficou de fora (transparência para quem migra).
    expect(payload.omitted.join(' ')).toMatch(/senha|credenciais/i);
    expect(payload.omitted.join(' ')).toMatch(/token/i);

    // Auditoria da saída.
    const audit = (await readDB()).audit.filter((a) => a.action === 'contact.exported' && a.meta?.format === 'json');
    expect(audit).toHaveLength(1);
    expect(audit[0].meta.rows).toBeGreaterThanOrEqual(2);
    expect(audit[0].meta.includeEncounters).toBe(true);
  });

  it('CSV simples continua reimportável nos campos suportados (e diz o que é só saída)', async () => {
    const res = await exportGET(jsonReq(`/api/contacts/export?businessId=${BIZ}`, undefined, token, 'GET'));
    const csv = await res.text();
    const parsed = parseImportFile(csv);
    expect(parsed.headerError).toBe('');
    const ana = parsed.rows.find((r) => r.phone === '21988887777')!;
    expect(ana.name).toBe('Ana do Telefone');
    // Colunas de histórico são declaradas como somente-exportação.
    const { EXPORT_ONLY_COLUMNS } = await import('../client-import');
    expect([...EXPORT_ONLY_COLUMNS]).toEqual(['Origem', 'Criado em', 'Última interação']);
    // As colunas de histórico são reconhecidas e declaradas como somente-exportação
    // (não aparecem como "desconhecidas" nem pedem mapeamento).
    expect(parsed.unknownColumns).toEqual([]);
    expect(parsed.exportOnlyColumns).toEqual(['Origem', 'Criado em', 'Última interação']);
    expect(parsed.columns.filter((c) => c.exportOnly).every((c) => c.detected === '')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// A TELA: as etapas e os botões que o pedido exige (o JSX não roda no vitest,
// então a prova é sobre o código-fonte — sem comentários, para não passar por
// causa de texto explicativo).
// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B7 (2ª volta) — o fluxo na tela', () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const read = (rel: string) => stripComments(fs.readFileSync(rel, 'utf8'));

  it('a importação tem Upload → Prévia → Mapeamento → Validar → Importar → Resultado', () => {
    const sheet = read('src/components/dashboard/ImportClientsSheet.tsx');
    // Upload: arquivo ou texto colado.
    expect(sheet).toMatch(/type="file"/);
    expect(sheet).toMatch(/<textarea/);
    // Prévia recalculada + o resultado do commit.
    expect(sheet).toMatch(/mode: 'preview'/);
    expect(sheet).toMatch(/mode: 'commit'/);
    // Mapeamento por dropdown, com "Ignorar" e os campos nomeados.
    expect(sheet).toMatch(/<Select/);
    expect(sheet).toMatch(/IMPORT_FIELD_LABELS\[f\]|<option value=\{ignore\}>Ignorar/);
    expect(sheet).toMatch(/Não reconheci/);
    // Modos de quem já existe, com os dois rótulos canônicos.
    expect(sheet).toMatch(/EXISTING_MODE_LABELS\[m\]/);
    expect(sheet).toMatch(/'skip', 'fill_empty'/);
    // Relatório de erros baixável.
    expect(sheet).toMatch(/errorReportCSV\(plan\.rows\)/);
    expect(sheet).toMatch(/Baixar relatório de erros/);
    // Aceita planilha e diz como resolver se preferir CSV.
    expect(sheet).toMatch(/\.xlsx/);
    // Nunca promete atualização de cadastro existente (o padrão é não mexer).
    expect(sheet).not.toMatch(/atualiza(r|dos|ção) de cadastro/i);
  });

  it('a lista de clientes oferece CSV reimportável e a saída completa só para quem administra', () => {
    const page = read('src/app/(dashboard)/clientes/page.tsx');
    expect(page).toMatch(/export\?businessId/);
    expect(page).toMatch(/export-full\?businessId/);
    expect(page).toMatch(/Exportar tudo \(JSON\)/);
    expect(page).toMatch(/const canExportFull = \['OWNER', 'ADMIN', 'MASTER'\]/);
  });
});

// ── Construtor de .xlsx de teste (ZIP real, sem dependência) ────
function buildXlsx(rows: (string | number)[][]): Buffer {
  const shared: string[] = [];
  const sharedOf = (v: string) => {
    const i = shared.indexOf(v);
    return i >= 0 ? i : (shared.push(v) - 1);
  };
  const cells = rows.map((row, r) => {
    const parts = row.map((value, cIdx) => {
      const ref = `${String.fromCharCode(65 + cIdx)}${r + 1}`;
      if (typeof value === 'number') {
        // Número com estilo 1 = data no styles.xml abaixo.
        return `<c r="${ref}" s="1"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="s"><v>${sharedOf(String(value))}</v></c>`;
    });
    return `<row r="${r + 1}">${parts.join('')}</row>`;
  }).join('');
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook><sheets><sheet name="Base" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    'xl/sharedStrings.xml': `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${cells}</sheetData></worksheet>`,
  };
  return zip(files);
}

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
