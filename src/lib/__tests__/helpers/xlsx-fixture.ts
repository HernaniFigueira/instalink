// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7/8 — FIXTURE DE .XLSX PARA TESTE (ZIP real, sem dependência)
// ═══════════════════════════════════════════════════════════════
// Monta um .xlsx de verdade (ZIP + XML com `node:zlib`) para os testes de
// importação e de segurança. Alguns parâmetros existem só para FABRICAR os
// casos de ataque (tamanho declarado absurdo, offset inválido, excesso de
// entradas) — é assim que se prova que a defesa funciona.
import zlib from 'node:zlib';

export interface XlsxFixtureOptions {
  /** Nome da planilha interna (padrão `sheet1`). */
  sheetName?: string;
  /** Sobrescreve o tamanho DESCOMPRIMIDO declarado no diretório central. */
  declareUncompressedSize?: { entry: string; size: number };
  /** Grava um offset de conteúdo inválido no diretório central. */
  corruptLocalOffsetFor?: string;
  /** Mentira no contador de entradas do EOCD (prova o teto de entradas). */
  fakeEntryCount?: number;
  /** Arquivos extras (para estourar o teto de entradas). */
  extraFiles?: number;
  /** Método de compactação forjado (0 = sem compactação, 8 = deflate). */
  methodFor?: { entry: string; method: number };
  /** Colunas cujo número deve ser tratado como data (estilo 1). */
  dateColumns?: number[];
}

/** CRC32 (exigido pelo formato ZIP). */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zip(files: Record<string, string | Buffer>, opts: XlsxFixtureOptions = {}): Buffer {
  // Entradas extras de enchimento: servem para estourar o teto de entradas.
  for (let i = 0; i < (opts.extraFiles || 0); i++) {
    (files as Record<string, string>)[`xl/extra/arquivo-${i}.xml`] = `<raiz>${i}</raiz>`;
  }
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const rawContent = files[name];
    const data = Buffer.isBuffer(rawContent) ? rawContent : Buffer.from(rawContent, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const localDeclared = opts.declareUncompressedSize?.entry === name
      ? opts.declareUncompressedSize.size
      : data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(opts.methodFor?.entry === name ? opts.methodFor.method : 8, 8);
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
    central.writeUInt16LE(opts.methodFor?.entry === name ? opts.methodFor.method : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(localDeclared, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(opts.corruptLocalOffsetFor === name ? 0xfffffff0 : offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = opts.fakeEntryCount ?? names.length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** Monta um .xlsx com as linhas dadas (primeira linha = cabeçalho). */
export function buildXlsx(rows: (string | number)[][], opts: XlsxFixtureOptions = {}): Buffer {
  const shared: string[] = [];
  const sharedOf = (v: string) => {
    const i = shared.indexOf(v);
    return i >= 0 ? i : (shared.push(v) - 1);
  };
  const sheetName = opts.sheetName || 'sheet1';
  const cells = rows.map((row, r) => {
    const parts = row.map((value, cIdx) => {
      const ref = `${String.fromCharCode(65 + cIdx)}${r + 1}`;
      if (typeof value === 'number') {
        // Estilo 1 = data (numFmtId 14) e é só assim que número vira data.
        const s = (opts.dateColumns || []).includes(cIdx) ? 1 : 0;
        return `<c r="${ref}" s="${s}"><v>${value}</v></c>`;
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
    [`xl/worksheets/${sheetName}.xml`]: `<?xml version="1.0"?><worksheet><sheetData>${cells}</sheetData></worksheet>`,
  };
  return zip(files, opts);
}

/** .xlsx com uma planilha de N linhas de nome/telefone (linha 1 = cabeçalho). */
export function xlsxWithRows(dataRows: number, opts: XlsxFixtureOptions = {}): Buffer {
  const rows: (string | number)[][] = [['Nome', 'Telefone']];
  for (let i = 1; i <= dataRows; i++) {
    rows.push([`Cliente ${i}`, `119${String(10000000 + i).slice(0, 8)}`]);
  }
  return buildXlsx(rows, opts);
}
