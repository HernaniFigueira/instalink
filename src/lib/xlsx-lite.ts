// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — LEITOR DE .XLSX (SOMENTE SERVIDOR, SEM DEPENDÊNCIA)
// ═══════════════════════════════════════════════════════════════
// Por que não usar um pacote: o `xlsx` do registro npm está parado na 0.18.5,
// com vulnerabilidade conhecida de prototype pollution (CVE-2023-30533) e
// ReDoS — e o SheetJS passou a ser distribuído fora do npm (CDN própria), o
// que adicionaria uma dependência não-registrada ao build. Em vez de puxar
// isso para dentro do produto, aqui está o mínimo que o caso de uso precisa:
//
//   • um .xlsx é um ZIP com XML dentro; o `node:zlib` já sabe descomprimir;
//   • lemos a PRIMEIRA planilha, e só ela;
//   • valores de texto (sharedStrings/inlineStr/str) e números;
//   • células de DATA (formatos de data do Excel) viram `YYYY-MM-DD`, porque
//     "Nascimento" chega como número de série em praticamente toda planilha;
//   • limites iguais aos do CSV (tamanho, linhas) — o resto é recusado.
//
// O resultado é uma MATRIZ (`string[][]`) que entra no MESMO planejador do
// CSV: não existe caminho paralelo de importação.
//
// Este arquivo importa `node:zlib` de propósito: ele NÃO pode ser importado
// por componente de cliente (o parser não entra no bundle do navegador).
import { inflateRawSync } from 'node:zlib';
import { IMPORT_MAX_ROWS } from './client-import';

// ── Limites (defesa contra ZIP bomb) ───────────────────────────
// Um .xlsx é um ZIP: 4 MB comprimidos podem virar gigabytes descomprimidos se
// alguém montar o arquivo de má-fé. Aqui NÃO se confia no que o arquivo diz:
// cada entrada é conferida (tamanho declarado, offsets dentro do buffer) e a
// descompressão tem teto — passou disso, o arquivo inteiro é recusado.
/** Teto do arquivo (.xlsx binário) — mesma ordem de grandeza do CSV. */
export const XLSX_MAX_BYTES = 4_000_000;
/** Entradas (arquivos internos) aceitas no ZIP. */
export const XLSX_MAX_ENTRIES = 200;
/** Teto de UM XML descomprimido (por entrada). */
export const XLSX_MAX_ENTRY_BYTES = 8_000_000;
/** Teto do TOTAL de XML descomprimido que o parser chega a ler. */
export const XLSX_MAX_TOTAL_XML_BYTES = 24_000_000;
/** Linhas que o parser MATERIALIZA: o limite canônico + 1 (para provar o estouro). */
export const XLSX_MAX_PARSED_ROWS = IMPORT_MAX_ROWS + 1;
export const XLSX_TOO_BIG_MESSAGE = 'Planilha compactada excede o limite seguro.';

const PK_LOCAL = 0x04034b50;
const PK_CENTRAL = 0x02014b50;
const PK_EOCD = 0x06054b50;

export interface ZipEntry {
  name: string;
  method: number;
  dataStart: number;
  compressedSize: number;
  /** Tamanho declarado pelo diretório central (não confiamos nele — conferimos). */
  uncompressedSize: number;
}

/** Acumulador do que já foi descomprimido (teto global do parser). */
export interface XmlBudget { used: number }

/** Lê o diretório central do ZIP (o mínimo para achar e descomprimir arquivos). */
export function readZipIndex(buf: Buffer): ZipEntry[] {
  // EOCD: assinatura + comentário variável no fim — procura de trás para frente.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === PK_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo não parece ser um .xlsx (ZIP inválido).');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > XLSX_MAX_ENTRIES) throw new Error(XLSX_TOO_BIG_MESSAGE);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (centralOffset > buf.length) throw new Error('Arquivo .xlsx corrompido (índice fora do arquivo).');
  let ptr = centralOffset;
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > buf.length) throw new Error('Arquivo .xlsx corrompido (índice truncado).');
    if (buf.readUInt32LE(ptr) !== PK_CENTRAL) throw new Error('Arquivo .xlsx corrompido (índice inválido).');
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);

    // Tamanho declarado absurdo (o truque clássico do ZIP bomb) é recusado
    // ANTES de qualquer descompressão.
    if (uncompressedSize > XLSX_MAX_ENTRY_BYTES) throw new Error(XLSX_TOO_BIG_MESSAGE);
    if (compressedSize > buf.length) throw new Error('Arquivo .xlsx corrompido (tamanho da entrada).');

    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    if (ptr + 46 + nameLen + extraLen + commentLen > buf.length) {
      throw new Error('Arquivo .xlsx corrompido (índice truncado).');
    }
    if (localOffset + 30 > buf.length) throw new Error('Arquivo .xlsx corrompido (offset do conteúdo).');
    if (buf.readUInt32LE(localOffset) !== PK_LOCAL) throw new Error('Arquivo .xlsx corrompido (conteúdo ausente).');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compressedSize > buf.length) {
      throw new Error('Arquivo .xlsx corrompido (conteúdo fora do arquivo).');
    }
    entries.push({
      name: name.replace(/\\/g, '/'),
      method,
      dataStart,
      compressedSize,
      uncompressedSize,
    });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.length !== count) throw new Error('Arquivo .xlsx corrompido (índice incompleto).');
  return entries;
}

/**
 * Descomprime UMA entrada com teto de saída. O `maxOutputLength` do Node faz a
 * descompressão falhar em vez de alocar memória sem limite; depois conferimos o
 * que saiu contra o declarado (arquivo mentiroso é recusado).
 */
function readEntry(buf: Buffer, entry: ZipEntry, budget: XmlBudget): string {
  const raw = buf.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
  let out: string;
  if (entry.method === 0) {
    out = raw.toString('utf8');
  } else if (entry.method === 8) {
    let inflated: Buffer;
    try {
      inflated = inflateRawSync(raw, { maxOutputLength: XLSX_MAX_ENTRY_BYTES });
    } catch {
      throw new Error(XLSX_TOO_BIG_MESSAGE);
    }
    if (inflated.length > XLSX_MAX_ENTRY_BYTES) throw new Error(XLSX_TOO_BIG_MESSAGE);
    // Confere o que foi declarado: divergência = arquivo forjado/corrompido.
    if (entry.uncompressedSize > 0 && inflated.length !== entry.uncompressedSize) {
      throw new Error('Arquivo .xlsx corrompido (tamanho declarado não confere).');
    }
    out = inflated.toString('utf8');
  } else {
    throw new Error('Compactação não suportada neste .xlsx.');
  }
  budget.used += out.length;
  if (budget.used > XLSX_MAX_TOTAL_XML_BYTES) throw new Error(XLSX_TOO_BIG_MESSAGE);
  return out;
}

/** Entidades XML que aparecem em planilha (e os acentos em forma numérica). */
export function decodeXmlText(value: string): string {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** "AB12" → 27 (0-based). Sem letras válidas, devolve -1. */
export function columnIndexFromRef(ref: string): number {
  const letters = String(ref || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Strings compartilhadas: cada `<si>` pode ter vários `<t>` (texto rico). */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const inner = m[1] || '';
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(inner))) text += decodeXmlText(t[1] || '');
    out.push(text);
  }
  return out;
}

/** Formatos de data embutidos do Excel (numFmtId). */
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Quais índices de estilo (`cellXfs`) representam DATA. */
export function parseDateStyles(stylesXml: string): Set<number> {
  const custom = new Map<number, string>();
  const fmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let f: RegExpExecArray | null;
  while ((f = fmtRe.exec(stylesXml))) custom.set(Number(f[1]), decodeXmlText(f[2]));

  const dateStyles = new Set<number>();
  const xfRe = /<xf\b[^>]*>/g;
  const cellXfsBlock = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const block = cellXfsBlock ? cellXfsBlock[1] : '';
  let xf: RegExpExecArray | null;
  let index = 0;
  while ((xf = xfRe.exec(block))) {
    const id = Number((xf[0].match(/numFmtId="(\d+)"/) || [])[1] || 0);
    const code = custom.get(id) || '';
    const isDate = BUILTIN_DATE_FMT.has(id)
      // Formato customizado com dia/mês/ano fora de aspas = data de verdade.
      || (/[dmy]/i.test(code.replace(/"[^"]*"/g, '')) && !/^[#0.,%]+$/.test(code.trim()));
    if (isDate) dateStyles.add(index);
    index += 1;
  }
  return dateStyles;
}

/** Serial do Excel → `YYYY-MM-DD` (época 1899-12-30, já com o bug do 1900). */
export function serialToISODate(serial: number): string {
  // Fora da faixa de datas do Excel (1900-01-01 a 9999-12-31) não existe data:
  // devolve '' em vez de um ano de 6 dígitos que ninguém reconhece.
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return '';
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  if (!Number.isFinite(d.getTime())) return '';
  const iso = d.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

/**
 * Converte o XML da planilha numa matriz de texto. Células vazias no meio da
 * linha viram '' (a matriz precisa respeitar o índice das colunas).
 */
export function parseSheetXml(xml: string, shared: string[], dateStyles: Set<number>): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let r: RegExpExecArray | null;
  let seen = 0;
  while ((r = rowRe.exec(xml))) {
    seen += 1;
    // Materializa até o limite canônico + 1 (basta para PROVAR o estouro); o
    // total real vem de `countSheetRows`, sem construir objetos.
    if (seen > XLSX_MAX_PARSED_ROWS) break;
    const inner = r[2] || '';
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c: RegExpExecArray | null;
    let auto = 0;
    while ((c = cellRe.exec(inner))) {
      const attrs = c[1] || '';
      const body = c[2] || '';
      const refMatch = attrs.match(/r="([A-Za-z]+\d+)"/);
      const idx = refMatch ? columnIndexFromRef(refMatch[1]) : auto;
      const col = idx >= 0 ? idx : auto;
      auto = col + 1;
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      const styleIdx = Number((attrs.match(/s="(\d+)"/) || [])[1] ?? -1);

      let value = '';
      if (type === 'inlineStr') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t: RegExpExecArray | null;
        const parts: string[] = [];
        while ((t = tRe.exec(body))) parts.push(decodeXmlText(t[1]));
        value = parts.join('');
      } else {
        const vMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const raw = vMatch ? decodeXmlText(vMatch[1]) : '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'e') value = '';
        else if (type === 'd') value = String(raw).slice(0, 10);
        else if (type === 'b') value = raw === '1' ? 'sim' : 'não';
        else if (raw !== '' && dateStyles.has(styleIdx)) value = serialToISODate(Number(raw)) || raw;
        else value = raw;
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    if (cells.some((x) => x !== '')) rows.push(cells);
  }
  return rows;
}

/**
 * Quantas linhas o XML da planilha tem (contagem barata, sem montar matriz) —
 * é o número HONESTO que aparece na mensagem de limite.
 */
export function countSheetRows(xml: string): number {
  const matches = String(xml || '').match(/<row\b[\s>\/]/g);
  return matches ? matches.length : 0;
}

/**
 * Lê um .xlsx (Buffer) e devolve a matriz da PRIMEIRA planilha.
 * A ordem de procura é: workbook.xml (relação da primeira aba) e, se o arquivo
 * não tiver essa parte, a primeira worksheet existente no ZIP.
 */
export function xlsxToMatrix(buf: Buffer): string[][] {
  return xlsxToMatrixInfo(buf).table;
}

export interface XlsxMatrix {
  table: string[][];
  /** Linhas de dados do arquivo (fora o cabeçalho), mesmo acima do limite. */
  totalRows: number;
}

/** Igual a `xlsxToMatrix`, mas devolve também a contagem real de linhas. */
export function xlsxToMatrixInfo(buf: Buffer): XlsxMatrix {
  if (buf.length > XLSX_MAX_BYTES) throw new Error('Planilha grande demais (máximo ~4 MB). Divida em partes.');
  const entries = readZipIndex(buf);
  if (entries.length === 0) throw new Error('Arquivo .xlsx vazio ou corrompido.');
  const budget: XmlBudget = { used: 0 };
  const byName = new Map(entries.map((e) => [e.name, e]));

  const sharedEntry = byName.get('xl/sharedStrings.xml');
  const shared = sharedEntry ? parseSharedStrings(readEntry(buf, sharedEntry, budget)) : [];

  const stylesEntry = byName.get('xl/styles.xml');
  const dateStyles = stylesEntry ? parseDateStyles(readEntry(buf, stylesEntry, budget)) : new Set<number>();

  let sheetEntry: ZipEntry | undefined;
  const workbook = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const firstSheet = readEntry(buf, workbook, budget).match(/<sheet\b[^>]*r:id="([^"]+)"/);
    if (firstSheet) {
      const relRe = new RegExp(`<Relationship\\b[^>]*Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`);
      const relsXml = readEntry(buf, rels, budget);
      const rel = relsXml.match(relRe) || relsXml.match(
        new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheet[1]}"`),
      );
      if (rel) {
        const target = rel[1].replace(/^\//, '').replace(/^xl\//, '');
        sheetEntry = byName.get(`xl/${target}`) || byName.get(target);
      }
    }
  }
  if (!sheetEntry) {
    const first = entries.find((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name));
    if (!first) throw new Error('Não encontrei nenhuma planilha dentro do arquivo.');
    sheetEntry = first;
  }
  const sheetXml = readEntry(buf, sheetEntry, budget);
  const matrix = parseSheetXml(sheetXml, shared, dateStyles);
  if (matrix.length === 0) throw new Error('A primeira planilha está vazia.');
  // Linhas de dados = linhas do arquivo menos o cabeçalho (nunca negativo).
  const totalRows = Math.max(0, countSheetRows(sheetXml) - 1);
  return { table: matrix, totalRows };
}

/** Mesma coisa a partir do que o navegador mandou (base64). */
export function xlsxBase64ToMatrix(base64: string): string[][] {
  const clean = String(base64 || '').replace(/^data:[^,]+,/, '');
  return xlsxToMatrix(Buffer.from(clean, 'base64'));
}

/** Mesma coisa, com a contagem real de linhas (usada pela importação). */
export function xlsxBase64ToMatrixInfo(base64: string): XlsxMatrix {
  const clean = String(base64 || '').replace(/^data:[^,]+,/, '');
  return xlsxToMatrixInfo(Buffer.from(clean, 'base64'));
}
