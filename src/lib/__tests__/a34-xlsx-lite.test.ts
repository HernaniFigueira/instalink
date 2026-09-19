// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 (rodada 5) — XLSX: ZIP BOMB E ARQUIVO FORJADO
// ═══════════════════════════════════════════════════════════════
// O leitor de .xlsx é nosso (o pacote `xlsx` do npm está descartado por CVE),
// então ele precisa ser hostil contra planilha maliciosa: a descompressão é
// fail-closed, o índice do ZIP é conferido e um arquivo que mente sobre o
// próprio tamanho não é lido. Aqui os .xlsx são FABRICADOS byte a byte.
import { describe, expect, it } from 'vitest';
import {
  XLSX_MAX_ENTRIES,
  XLSX_MAX_ENTRY_BYTES,
  XLSX_MAX_PARSED_ROWS,
  XLSX_TOO_BIG_MESSAGE,
  parseSheetXml,
  serialToISODate,
  xlsxToMatrix,
  xlsxToMatrixInfo,
} from '@/lib/xlsx-lite';
import { buildXlsx, xlsxWithRows, zip } from './helpers/xlsx-fixture';

/** Alguns MB de espaços: comprime a ~0,1% (o caso clássico de zip bomb). */
const spaces = (bytes: number) => ' '.repeat(bytes);

const RE_GRANDE = /grande demais|excede o limite seguro/i;

describe('xlsx-lite · planilha normal continua funcionando', () => {
  it('lê cabeçalho, linhas, acentos e datas', () => {
    const buf = buildXlsx([
      ['Nome', 'Telefone', 'Nascimento'],
      ['Ana Clara', '21988887777', 45000], // coluna 2 marcada como data
      ['João & Cia', '+5521988887777', 45200],
      [42, '', ''],
    ], { dateColumns: [2] });
    const { table, totalRows } = xlsxToMatrixInfo(buf);
    expect(table[0]).toEqual(['Nome', 'Telefone', 'Nascimento']);
    expect(table[1]).toEqual(['Ana Clara', '21988887777', serialToISODate(45000)]);
    expect(table[2]).toEqual(['João & Cia', '+5521988887777', serialToISODate(45200)]);
    expect(table[3]).toEqual(['42', '', '']);
    expect(totalRows).toBe(3); // fora o cabeçalho
  });

  it('conta as linhas do arquivo mesmo quando a tabela é lida (limite canônico)', () => {
    const buf = xlsxWithRows(40);
    const { table, totalRows } = xlsxToMatrixInfo(buf);
    expect(totalRows).toBe(40);
    expect(table).toHaveLength(41);
    expect(table[40]).toEqual(['Cliente 40', expect.stringMatching(/^119/)]);
  });

  it('arquivo de planilha altíssimo mas normal NÃO é recusado por engano', () => {
    // 5.001 linhas (uma acima do limite de importação) ainda é um arquivo
    // legítimo: quem recusa é a regra de negócio, não o leitor.
    const buf = xlsxWithRows(XLSX_MAX_PARSED_ROWS);
    const { totalRows } = xlsxToMatrixInfo(buf);
    expect(totalRows).toBe(XLSX_MAX_PARSED_ROWS);
    expect(buf.length).toBeLessThan(1_000_000); // compacto de verdade
  });

  it('planilha com entidades XML e acentos numéricos sai legível', () => {
    const buf = buildXlsx([['Nome'], ['Caf&#233; &amp; P&#227;o']]);
    expect(xlsxToMatrix(buf)[1][0]).toBe('Café & Pão');
  });

  it('lê por caminho alternativo quando o workbook não aponta a planilha', () => {
    const buf = zip({
      '[Content_Types].xml': '<Types/>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c></row></sheetData></worksheet>',
    });
    expect(xlsxToMatrix(buf)[0]).toEqual(['Nome']);
  });

  it('planilha sem nenhuma worksheet é recusada com mensagem clara', () => {
    const buf = zip({ '[Content_Types].xml': '<Types/>', 'xl/styles.xml': '<styleSheet/>' });
    expect(() => xlsxToMatrix(buf)).toThrow(/Não encontrei nenhuma planilha/i);
  });

  it('arquivo que não é ZIP é recusado (nada de tentar adivinhar)', () => {
    expect(() => xlsxToMatrix(Buffer.from('isto não é um xlsx'))).toThrow(/ZIP inválido/i);
  });
});

describe('xlsx-lite · zip bomb (o leitor é hostil de propósito)', () => {
  it('recusa descompressão que estoura o teto POR ENTRADA', () => {
    // ~9 MB de conteúdo, declarados corretamente: barrado antes de inflar.
    const buf = zip({ 'xl/worksheets/sheet1.xml': `<worksheet>${spaces(9_000_000)}</worksheet>` });
    expect(buf.length).toBeLessThan(50_000); // comprimiu pra quase nada: bomba
    expect(() => xlsxToMatrix(buf)).toThrow(XLSX_TOO_BIG_MESSAGE);
  });

  it('recusa arquivo que MENTE sobre o tamanho declarado (declara pouco, entrega muito)', () => {
    const buf = zip(
      { 'xl/worksheets/sheet1.xml': `<worksheet>${spaces(9_000_000)}</worksheet>` },
      { declareUncompressedSize: { entry: 'xl/worksheets/sheet1.xml', size: 120 } },
    );
    expect(() => xlsxToMatrix(buf)).toThrow(XLSX_TOO_BIG_MESSAGE);
  });

  it('recusa declaração absurda (2 GB declarados num arquivo de 1 KB)', () => {
    const buf = zip(
      { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>' },
      { declareUncompressedSize: { entry: 'xl/worksheets/sheet1.xml', size: 2_000_000_000 } },
    );
    expect(() => xlsxToMatrix(buf)).toThrow(XLSX_TOO_BIG_MESSAGE);
  });

  it('recusa a soma do XML descomprimido acima do teto TOTAL', () => {
    // 4 entradas de 7 MB: cada uma passa no teto individual, a soma não passa.
    const big = spaces(7_000_000);
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c></row></sheetData></worksheet>';
    const buf = zip({
      'xl/sharedStrings.xml': `<sst>${big}</sst>`,
      'xl/styles.xml': `<styleSheet>${big}</styleSheet>`,
      'xl/workbook.xml': `<workbook><sheets><sheet name="Base" r:id="rId1"/></sheets>${big}</workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>${big}`,
      'xl/worksheets/sheet1.xml': sheet,
    });
    expect(buf.length).toBeLessThan(200_000);
    expect(() => xlsxToMatrix(buf)).toThrow(XLSX_TOO_BIG_MESSAGE);
  });

  it('recusa ZIP com entradas demais (inchaço de diretório)', () => {
    const buf = zip(
      { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>' },
      { extraFiles: XLSX_MAX_ENTRIES },
    );
    expect(() => xlsxToMatrix(buf)).toThrow(XLSX_TOO_BIG_MESSAGE);
  });

  it('recusa contador de entradas mentiroso no índice central', () => {
    const buf = zip(
      { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>' },
      { fakeEntryCount: 9_999 },
    );
    expect(() => xlsxToMatrix(buf)).toThrow(XLSX_TOO_BIG_MESSAGE);
  });

  it('recusa offset de conteúdo inválido (índice apontando pro vazio)', () => {
    const buf = zip(
      { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>' },
      { corruptLocalOffsetFor: 'xl/worksheets/sheet1.xml' },
    );
    expect(() => xlsxToMatrix(buf)).toThrow(/corrompido|conteúdo/i);
  });

  it('recusa arquivo acima do teto de bytes antes mesmo de abrir o ZIP', () => {
    const buf = Buffer.alloc(4_000_001);
    buf.writeUInt32LE(0x06054b50, 0);
    expect(() => xlsxToMatrix(buf)).toThrow(/grande demais/i);
  });

  it('o teto de linhas é o mesmo da importação, nunca um número inventado', () => {
    expect(XLSX_MAX_PARSED_ROWS).toBe(5001);
  });

  it('entrada com método de compactação desconhecido é recusada', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c></row></sheetData></worksheet>';
    const buf = zip(
      { 'xl/worksheets/sheet1.xml': xml },
      { methodFor: { entry: 'xl/worksheets/sheet1.xml', method: 99 } },
    );
    expect(() => xlsxToMatrix(buf)).toThrow(/Compactação não suportada/i);
  });

  it('planilha grande PORÉM abaixo dos tetos continua sendo lida', () => {
    expect(XLSX_MAX_ENTRY_BYTES).toBe(8_000_000);
    // 7,5 MB de enchimento numa worksheet válida: comprime a poucos KB e o
    // leitor aceita (o teto existe para o arquivo mentiroso, não para o grande).
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c></row>'
      + `<row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c></row></sheetData>${spaces(7_500_000)}</worksheet>`;
    const buf = zip({ 'xl/worksheets/sheet1.xml': xml });
    expect(buf.length).toBeLessThan(100_000);
    const { table, totalRows } = xlsxToMatrixInfo(buf);
    expect(table).toEqual([['Nome'], ['Ana']]);
    expect(totalRows).toBe(1);
  });

  it('tamanho declarado que não confere derruba o arquivo (forjado)', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c></row></sheetData></worksheet>';
    const buf = zip({ 'xl/worksheets/sheet1.xml': xml }, {
      declareUncompressedSize: { entry: 'xl/worksheets/sheet1.xml', size: 12 },
    });
    expect(() => xlsxToMatrix(buf)).toThrow(/tamanho declarado não confere/i);
  });
});

describe('xlsx-lite · XML do conteúdo', () => {
  it('parseSheetXml lê inlineStr, sharedStrings, números e células vazias', () => {
    const xml = '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Inline</t></is></c></row>'
      + '<row r="2"><c r="B2"><v>7</v></c></row>'
      + '</sheetData></worksheet>';
    expect(parseSheetXml(xml, ['Compartilhado'], new Set())).toEqual([['Compartilhado', '', 'Inline'], ['', '7']]);
  });

  it('data serial absurda não vira data inventada', () => {
    expect(serialToISODate(25569)).toBe('1970-01-01');
    expect(serialToISODate(45000)).toBe('2023-03-15');
    expect(serialToISODate(0)).toBe('');            // antes da época
    expect(serialToISODate(-5)).toBe('');
    expect(serialToISODate(99_999_999)).toBe('');   // ano de 6 dígitos = nada
    expect(serialToISODate(Number.NaN)).toBe('');
  });

  it('linhas em branco do fim são descartadas (sem linha fantasma)', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c></row>'
      + '<row r="2"/><row r="3"/></sheetData></worksheet>';
    expect(parseSheetXml(xml, [], new Set())).toEqual([['Nome']]);
  });
});
