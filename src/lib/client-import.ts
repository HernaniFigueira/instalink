// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — IMPORTAR E EXPORTAR A BASE DE CLIENTES
// ═══════════════════════════════════════════════════════════════
// Quem chega de outro sistema tem a base num arquivo (CSV do Excel, do Google
// Contacts, de um sistema antigo — ou .xlsx). O trabalho aqui é:
//
//   • LER o arquivo como ele vem — separador `,` `;` ou TAB, BOM, aspas,
//     quebra de linha dentro da célula, cabeçalho em português ou inglês;
//   • MAPEAR as colunas (autodetecção primeiro; o usuário corrige o resto);
//   • dizer ANTES de escrever o que vai acontecer linha por linha (prévia);
//   • usar a MESMA régua de campos do resto do produto (`lib/field-quality`,
//     `isValidCpf`, `normalizeBirthDate`) e a MESMA identidade do CRM
//     (telefone/e-mail em dígitos/minúsculas);
//   • NUNCA sobrescrever um cadastro existente: o padrão é **não mexer**
//     (`skip_existing`); o modo opcional é **preencher só o que está vazio**
//     (`fill_empty`). Não existe overwrite nesta etapa;
//   • nunca MERGEAR duas pessoas: se o telefone da linha é de um cadastro e o
//     e-mail é de outro, a linha vira erro (`identity_conflict`) — inclusive
//     quando o conflito nasce entre duas linhas do próprio arquivo;
//   • exportar de volta no mesmo formato que se importa (ida e volta), com
//     célula à prova de fórmula do Excel (`spreadsheetSafeCell`).
//
// Módulo PURO (sem I/O): recebe texto/matriz e devolve decisão. Assim a prévia
// da tela e a gravação do servidor usam exatamente o mesmo plano.
import { digitsOf, emailError, normalizeEmail, normalizePhoneBR, phoneError } from './field-quality';
import { PROFILE_NOTE_MAX, PROFILE_TAGS_MAX, PROFILE_TAG_MAX, isValidCpf, normalizeBirthDate } from './contact-profile';
import type { BusinessCustomer } from './types';

// ── Limites (segurança e sanidade) ─────────────────────────────
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_CHARS = 2_000_000;
export const IMPORT_NAME_MAX = 80;
/** Teto da observação administrativa importada (mesmo do perfil). */
export const IMPORT_NOTE_MAX = PROFILE_NOTE_MAX;

/**
 * Colunas reconhecidas — a chave é o que aparece no cabeçalho, normalizado.
 * Só entra aqui o que a importação REALMENTE aplica (ver `EXPORT_ONLY_COLUMNS`
 * para o que é só de saída).
 */
export const IMPORT_COLUMNS = {
  name: ['nome', 'nome completo', 'cliente', 'name', 'full name'],
  phone: ['telefone', 'whatsapp', 'celular', 'fone', 'telefone/whatsapp', 'phone', 'mobile'],
  email: ['email', 'e-mail', 'endereco de email', 'mail'],
  cpf: ['cpf'],
  birthDate: ['nascimento', 'data de nascimento', 'aniversario', 'birthday', 'birth date'],
  cep: ['cep'],
  street: ['rua', 'logradouro', 'endereco', 'street'],
  number: ['numero', 'nº', 'n°', 'number'],
  complement: ['complemento', 'complement'],
  district: ['bairro', 'district'],
  city: ['cidade', 'city'],
  state: ['uf', 'estado', 'state'],
  tags: ['tags', 'etiquetas'],
  guardianName: ['responsavel', 'nome do responsavel', 'guardian'],
  guardianPhone: ['telefone do responsavel', 'whatsapp do responsavel'],
  guardianCpf: ['cpf do responsavel'],
  marketingOptIn: ['marketing', 'aceita promocoes', 'opt-in', 'opt in', 'consentimento', 'newsletter'],
  note: ['observacao', 'nota', 'obs', 'observacao administrativa'],
} as const;

export type ImportField = keyof typeof IMPORT_COLUMNS;

/**
 * Colunas que SÓ existem na exportação. Ficam declaradas para ninguém prometer
 * "ida e volta completa": origem, datas e última interação são histórico do
 * sistema, não dado de cadastro — reimportar não os recria.
 */
export const EXPORT_ONLY_COLUMNS = ['Origem', 'Criado em', 'Última interação'] as const;

/** Rótulo humano de cada campo (usado no mapeamento da tela). */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nome', phone: 'Telefone', email: 'E-mail', cpf: 'CPF', birthDate: 'Nascimento',
  cep: 'CEP', street: 'Rua', number: 'Número', complement: 'Complemento', district: 'Bairro',
  city: 'Cidade', state: 'UF', tags: 'Tags', marketingOptIn: 'Marketing', note: 'Observação',
  guardianName: 'Responsável', guardianPhone: 'Telefone do responsável', guardianCpf: 'CPF do responsável',
};

// ── Célula segura para planilha (CSV/Excel formula injection) ──
/** Primeiro caractere que o Excel/Sheets interpreta como FÓRMULA. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Neutraliza injeção de fórmula: `=HYPERLINK(...)`, `+cmd`, `-2+3`, `@foo`.
 * A defesa é o apóstrofo inicial (marcador de "isto é texto" no Excel), e o
 * parser devolve o valor original com `undoSpreadsheetEscape` — o arquivo não
 * executa nada e a ida e volta continua fiel.
 */
export function spreadsheetSafeCell(value: unknown): string {
  const s = String(value ?? '');
  return FORMULA_LEAD.test(s) ? `'${s}` : s;
}

/** Desfaz a neutralização: `'=A1` volta a ser `=A1`. */
export function undoSpreadsheetEscape(value: unknown): string {
  const s = String(value ?? '');
  return s.startsWith("'") && FORMULA_LEAD.test(s.slice(1)) ? s.slice(1) : s;
}

function csvCell(value: unknown): string {
  const safe = spreadsheetSafeCell(value);
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Linha no formato que a própria importação entende (ida e volta). */
export function toCSVRow(cells: unknown[], delimiter = ';'): string {
  return cells.map(csvCell).join(delimiter);
}

// ── Normalização de valores ────────────────────────────────────
/** Normaliza cabeçalho e valores de texto: sem acento, sem espaço extra. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Aceita "sim/1/true/x/aceito" como consentimento; vazio NÃO é consentimento. */
export function parseYesNo(value: unknown): boolean {
  const v = normalizeHeader(value);
  return ['sim', 's', '1', 'true', 'x', 'aceito', 'aceita', 'yes', 'y'].includes(v);
}

/** `DD/MM/AAAA`, `AAAA-MM-DD` e `DD-MM-AAAA` → `YYYY-MM-DD`. '' = não entendi. */
export function parseBirthDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const br = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (br) {
    const [, d, m, y] = br;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return '';
}

/** Etiquetas: separadas por vírgula/ponto e vírgula, sem repetição, com teto. */
export function parseTags(value: unknown): string[] {
  const seen = new Set<string>();
  for (const raw of String(value ?? '').split(/[,;]/)) {
    const tag = raw.replace(/\s+/g, ' ').trim().slice(0, PROFILE_TAG_MAX);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size >= PROFILE_TAGS_MAX) break;
  }
  return [...seen];
}

// ── CSV / matriz: leitura ──────────────────────────────────────
/**
 * Descobre o separador contando ocorrências FORA de aspas na primeira linha.
 * Excel em português exporta com `;` — e um arquivo assim lido com `,` vira
 * uma única coluna gigante.
 */
export function detectDelimiter(text: string): string {
  const firstLine = String(text ?? '').split(/\r?\n/).find((l) => l.trim() !== '') || '';
  let inside = false;
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch === '"') inside = !inside;
    else if (!inside && ch in counts) counts[ch] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

/** Parse de CSV com aspas, aspas escapadas ("") e quebra de linha em célula. */
export function parseCSV(text: string, delimiter?: string): string[][] {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const sep = delimiter || detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inside = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inside) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else inside = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inside = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  // Linhas totalmente vazias não representam nada.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Aliases normalizados UMA vez (mesma régua do cabeçalho): 'E-mail' vira
 * 'e mail' dos dois lados, e a comparação passa a funcionar.
 */
const NORMALIZED_ALIASES: [ImportField, string[]][] = (Object.entries(IMPORT_COLUMNS) as [ImportField, readonly string[]][])
  .map(([field, aliases]) => [field, aliases.map((a) => normalizeHeader(a))]);

/**
 * Só aliases LONGO podem casar por prefixo ("telefone do cliente"). Palavra
 * curta como `numero` casaria com "Número da sorte" — e a coluna desconhecida
 * tem que aparecer como desconhecida, não entrar no endereço.
 */
const PREFIX_MIN_LEN = 7;

/** Mapeia cada campo conhecido para o índice da coluna no arquivo. */
export function mapHeader(header: string[]): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  header.forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    for (const [field, aliases] of NORMALIZED_ALIASES) {
      if (map[field] !== undefined) continue;
      if (aliases.some((a) => h === a || (a.length >= PREFIX_MIN_LEN && h.startsWith(`${a} `)))) map[field] = idx;
    }
  });
  return map;
}

/** O que o cliente pode mandar como mapeamento: campo → coluna, ou "ignore". */
export type ImportMappingInput = Partial<Record<ImportField, number | 'ignore' | null | undefined>>;

export type MappingResult =
  | { ok: true; mapping: Partial<Record<ImportField, number>>; errors: string[] }
  | { ok: false; mapping: Partial<Record<ImportField, number>>; errors: string[] };

/**
 * Valida o mapeamento vindo da TELA (nunca confiamos só no navegador):
 * índice tem que existir no arquivo, campo tem que ser conhecido e duas
 * colunas diferentes não podem virar o mesmo campo.
 */
export function validateMapping(input: ImportMappingInput | undefined, width: number): MappingResult {
  const mapping: Partial<Record<ImportField, number>> = {};
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { ok: true, mapping, errors };
  const used = new Map<number, ImportField>();
  for (const [field, raw] of Object.entries(input) as [string, number | 'ignore' | null | undefined][]) {
    if (!(field in IMPORT_COLUMNS)) { errors.push(`Campo desconhecido no mapeamento: ${field}.`); continue; }
    if (raw === 'ignore' || raw === null || raw === undefined) continue;
    const idx = Number(raw);
    if (!Number.isInteger(idx) || idx < 0 || idx >= width) {
      errors.push(`A coluna ${String(raw)} de "${IMPORT_FIELD_LABELS[field as ImportField]}" não existe no arquivo.`);
      continue;
    }
    const clash = used.get(idx);
    if (clash) { errors.push(`A coluna ${idx + 1} foi usada para ${IMPORT_FIELD_LABELS[clash]} e ${IMPORT_FIELD_LABELS[field as ImportField]}.`); continue; }
    used.set(idx, field as ImportField);
    mapping[field as ImportField] = idx;
  }
  return { ok: errors.length === 0, mapping, errors };
}

export interface ParsedRow {
  /** Linha do arquivo (1-based, contando o cabeçalho) — a pessoa se localiza. */
  line: number;
  name: string;
  phone: string;
  email: string;
  cpf: string;
  birthDate: string;
  /** O que veio na coluna de nascimento, sem interpretar (só para a prévia). */
  birthRaw?: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  tags: string[];
  guardianName: string;
  guardianPhone: string;
  guardianCpf: string;
  marketingOptIn: boolean;
  note: string;
}

export interface ImportColumn {
  /** Índice no arquivo. */
  index: number;
  label: string;
  /** Campo detectado automaticamente (quando houve). */
  detected: ImportField | '';
  /** Amostra de valores (ajuda a reconhecer a coluna certa na tela). */
  sample: string[];
  /**
   * Coluna de histórico do PRÓPRIO Instalink (Origem, Criado em, Última
   * interação). É reconhecida de propósito e ignorada: reimportar não recria
   * histórico — por isso a tela não pede mapeamento nem diz que "veio tudo".
   */
  exportOnly?: boolean;
}

export interface ParsedFile {
  rows: ParsedRow[];
  columns: ImportColumn[];
  unknownColumns: string[];
  /** Colunas reconhecidas como histórico da exportação (não voltam). */
  exportOnlyColumns: string[];
  mapped: Partial<Record<ImportField, number>>;
  delimiter: string;
  headerError: string;
  mappingErrors: string[];
}

const FIELD_GETTERS: Record<ImportField, (r: string[]) => string> = Object.fromEntries(
  (Object.keys(IMPORT_COLUMNS) as ImportField[]).map((f) => [f, (r: string[]) => '']) as [ImportField, (r: string[]) => string][],
) as Record<ImportField, (r: string[]) => string>;

function rowFromCells(cells: string[], mapped: Partial<Record<ImportField, number>>, line: number): ParsedRow {
  const raw = (field: ImportField): string => {
    const idx = mapped[field];
    return idx === undefined ? '' : String(cells[idx] ?? '').trim();
  };
  const note = raw('note').slice(0, IMPORT_NOTE_MAX);
  return {
    line,
    name: raw('name').slice(0, IMPORT_NAME_MAX),
    phone: normalizePhoneBR(raw('phone')),
    email: normalizeEmail(raw('email')),
    cpf: digitsOf(raw('cpf'), 11),
    birthDate: parseBirthDate(raw('birthDate')),
    birthRaw: raw('birthDate'),
    cep: digitsOf(raw('cep'), 8),
    street: raw('street'),
    number: raw('number'),
    complement: raw('complement'),
    district: raw('district'),
    city: raw('city'),
    state: raw('state').toUpperCase().slice(0, 2),
    tags: parseTags(raw('tags')),
    guardianName: raw('guardianName').slice(0, IMPORT_NAME_MAX),
    guardianPhone: normalizePhoneBR(raw('guardianPhone')),
    guardianCpf: digitsOf(raw('guardianCpf'), 11),
    marketingOptIn: parseYesNo(raw('marketingOptIn')),
    note,
  };
}

/**
 * Lê uma MATRIZ (já sem o separador) — é o ponto comum entre CSV e XLSX, para
 * que os dois arquivos usem exatamente o mesmo planejador.
 */
export function parseMatrix(
  table: string[][],
  opts: { mapping?: ImportMappingInput; delimiter?: string } = {},
): ParsedFile {
  const empty: ParsedFile = {
    rows: [], columns: [], unknownColumns: [], exportOnlyColumns: [], mapped: {},
    delimiter: opts.delimiter || ',', headerError: '', mappingErrors: [],
  };
  if (table.length === 0) return { ...empty, headerError: 'O arquivo está vazio.' };
  const [header, ...body] = table;
  const detected = mapHeader(header);
  const width = header.length;
  const custom = validateMapping(opts.mapping, width);
  // O mapeamento do usuário MANDA quando vem; a autodetecção preenche o resto.
  const mapped: Partial<Record<ImportField, number>> = { ...detected, ...custom.mapping };

  const exportOnlyLabels = new Set(EXPORT_ONLY_COLUMNS.map((c) => normalizeHeader(c)));
  const columns: ImportColumn[] = header.map((label, index) => {
    const owner = (Object.keys(mapped) as ImportField[]).find((f) => mapped[f] === index);
    return {
      index,
      label: String(label ?? '').trim() || `Coluna ${index + 1}`,
      detected: owner || '',
      sample: body.slice(0, 3).map((r) => String(r[index] ?? '').trim()).filter(Boolean),
      exportOnly: !owner && exportOnlyLabels.has(normalizeHeader(label)),
    };
  });
  // "Desconhecida" é só o que NÃO é campo e NÃO é histórico da exportação.
  const exportOnlyColumns = columns.filter((c) => c.exportOnly).map((c) => c.label);
  const unknownColumns = columns
    .filter((c) => !c.detected && !c.exportOnly && normalizeHeader(c.label))
    .map((c) => c.label);

  if (mapped.name === undefined && mapped.phone === undefined && mapped.email === undefined) {
    return {
      rows: [], columns, unknownColumns, exportOnlyColumns, mapped, delimiter: opts.delimiter || ',',
      mappingErrors: custom.errors,
      headerError: 'Não reconheci as colunas. Escolha abaixo qual coluna é o Nome e qual é o Telefone/E-mail (ou baixe o modelo).',
    };
  }

  const rows = body.slice(0, IMPORT_MAX_ROWS)
    .map((cells, i) => rowFromCells(cells.map(undoSpreadsheetEscape), mapped, i + 2));

  return {
    rows, columns, unknownColumns, exportOnlyColumns, mapped, delimiter: opts.delimiter || ',',
    headerError: '', mappingErrors: custom.errors,
  };
}

/** Lê um arquivo CSV (texto) já aplicando o mapeamento escolhido. */
export function parseImportFile(text: string, mapping?: ImportMappingInput): ParsedFile {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(src);
  return parseMatrix(parseCSV(src, delimiter), { mapping, delimiter });
}

// ── Identidade: a MESMA chave do CRM ───────────────────────────
/** Telefone em dígitos ('' quando não há) — o que o CRM grava. */
export function identityPhone(value: unknown): string {
  return normalizePhoneBR(value);
}

/**
 * Chave de identidade para deduplicar DENTRO do arquivo: telefone ou e-mail.
 * A unidade já tem a regra equivalente em `lib/contacts.ts` (`findContact`);
 * aqui ela é repetida no que importa para a prévia — nunca por nome.
 */
export function importIdentityKey(row: Pick<ParsedRow, 'phone' | 'email'>): string {
  const phone = identityPhone(row.phone);
  if (phone) return `p:${phone}`;
  const email = normalizeEmail(row.email);
  return email ? `e:${email}` : '';
}

function contactIdentityKeys(c: BusinessCustomer): string[] {
  const keys: string[] = [];
  if (identityPhone(c.phone)) keys.push(`p:${identityPhone(c.phone)}`);
  if (normalizeEmail(c.email)) keys.push(`e:${normalizeEmail(c.email)}`);
  return keys;
}

// ── Plano da importação ────────────────────────────────────────
export type ImportAction = 'create' | 'fill' | 'skip' | 'error';

export type ImportIssue =
  | 'sem_nome'
  | 'telefone_invalido'
  | 'email_invalido'
  | 'cep_invalido'
  | 'cpf_invalido'
  | 'nascimento_invalido'
  | 'sem_contato'
  | 'identity_conflict'
  | 'repetido_no_arquivo'
  | 'ja_existe';

export interface ImportRowPlan extends ParsedRow {
  action: ImportAction;
  /** Contato que recebe os dados (quando o alvo é um cadastro existente). */
  contactId: string;
  issues: ImportIssue[];
  message: string;
}

export interface ImportPlan {
  rows: ImportRowPlan[];
  total: number;
  create: number;
  fill: number;
  skip: number;
  error: number;
  /** Linha → coluna usada, para a tela explicar o que foi aproveitado. */
  columns: ImportColumn[];
  unknownColumns: string[];
  /** Histórico da exportação reconhecido e ignorado (não volta na importação). */
  exportOnlyColumns: string[];
  mapped: Partial<Record<ImportField, number>>;
  delimiter: string;
  /** Modo escolhido: `skip` (padrão) ou `fill_empty`. */
  existingMode: ExistingMode;
}

/** O que fazer quando a linha descreve alguém que JÁ está na base. */
export type ExistingMode = 'skip' | 'fill_empty';

export const EXISTING_MODE_LABELS: Record<ExistingMode, string> = {
  skip: 'Manter cadastros existentes',
  fill_empty: 'Preencher somente dados que estiverem vazios',
};

const ISSUE_MESSAGE: Record<ImportIssue, string> = {
  sem_nome: 'Sem nome — informe quem é a pessoa.',
  telefone_invalido: 'Telefone inválido — confira o DDD e o número',
  email_invalido: 'E-mail inválido',
  cep_invalido: 'CEP incompleto',
  cpf_invalido: 'CPF inválido — os dígitos verificadores não conferem',
  nascimento_invalido: 'Data de nascimento inválida (confira o dia e o mês)',
  sem_contato: 'Precisa de telefone ou e-mail para entrar na base.',
  identity_conflict: 'Telefone e e-mail pertencem a cadastros diferentes. Revise esta linha.',
  repetido_no_arquivo: 'Repetido no arquivo — vale a primeira linha.',
  ja_existe: 'Já existe — não será alterado.',
};

export function issueMessage(issue: ImportIssue): string {
  return ISSUE_MESSAGE[issue];
}

function planMessage(action: ImportAction, issues: ImportIssue[], existing?: BusinessCustomer, filled?: number): string {
  if (action === 'error') {
    // O conflito de identidade fala mais alto: é o caso que exige decisão humana.
    if (issues.includes('identity_conflict')) return ISSUE_MESSAGE.identity_conflict;
    return issues
      .filter((i) => i !== 'ja_existe' && i !== 'repetido_no_arquivo')
      .map((i) => ISSUE_MESSAGE[i])
      .join(' · ');
  }
  if (action === 'skip') {
    if (issues.includes('repetido_no_arquivo')) {
      const first = (issues as any).line;
      return ISSUE_MESSAGE.repetido_no_arquivo;
    }
    return `${ISSUE_MESSAGE.ja_existe} (${existing?.name || 'cadastro atual'})`;
  }
  if (action === 'fill') {
    return filled && filled > 0
      ? `Complementa ${existing?.name || 'o cadastro'} — só os campos vazios (${filled}).`
      : `${existing?.name || 'Cadastro'} já está completo — nada a preencher.`;
  }
  return 'Cadastro novo.';
}

/**
 * Monta o PLANO da importação: o que cada linha vai fazer, sem escrever nada.
 *
 * `contacts` é a base atual DA UNIDADE (o servidor já filtra por businessId).
 * `existingMode` decide o destino de quem já existe: `skip` (padrão — não mexe
 * em nada) ou `fill_empty` (completa só o que está vazio).
 */
export function buildImportPlan(
  parsed: ParsedFile,
  contacts: BusinessCustomer[],
  opts: { existingMode?: ExistingMode } = {},
): ImportPlan {
  const existingMode: ExistingMode = opts.existingMode === 'fill_empty' ? 'fill_empty' : 'skip';

  const byKey = new Map<string, BusinessCustomer>();
  for (const c of contacts) for (const k of contactIdentityKeys(c)) if (!byKey.has(k)) byKey.set(k, c);

  // Tabela de identidade do que já foi PLANEJADO no arquivo, por chave.
  const claimed = new Map<string, { line: number; row: ParsedRow }>();
  const rows: ImportRowPlan[] = [];
  const counts = { create: 0, fill: 0, skip: 0, error: 0 };

  for (const row of parsed.rows) {
    const issues: ImportIssue[] = [];
    const phone = identityPhone(row.phone);
    const email = normalizeEmail(row.email);
    const phoneKey = phone ? `p:${phone}` : '';
    const emailKey = email ? `e:${email}` : '';
    const keys = [phoneKey, emailKey].filter(Boolean);

    if (!row.name) issues.push('sem_nome');
    if (row.phone && phoneError(row.phone)) issues.push('telefone_invalido');
    if (row.email && emailError(row.email)) issues.push('email_invalido');
    if (row.cep && row.cep.length !== 8) issues.push('cep_invalido');
    // CPF: dígito verificador de verdade (mesma função da ficha).
    if (row.cpf && !isValidCpf(row.cpf)) issues.push('cpf_invalido');
    if (row.guardianCpf && !isValidCpf(row.guardianCpf)) issues.push('cpf_invalido');
    // Nascimento: calendário real (31/02 não passa) e nunca futuro.
    if (row.birthRaw && !normalizeBirthDate(row.birthDate)) issues.push('nascimento_invalido');
    if (!phone && !email) issues.push('sem_contato');

    // ── Conflito de identidade ─────────────────────────────────
    // Telefone de um cadastro + e-mail de outro = duas pessoas diferentes na
    // mesma linha. O sistema NÃO escolhe: a linha volta para revisão.
    const phoneTarget = phoneKey ? byKey.get(phoneKey) : undefined;
    const emailTarget = emailKey ? byKey.get(emailKey) : undefined;
    const phoneClaim = phoneKey ? claimed.get(phoneKey) : undefined;
    const emailClaim = emailKey ? claimed.get(emailKey) : undefined;

    let conflict = false;
    if (phoneTarget && emailTarget && phoneTarget.id !== emailTarget.id) conflict = true;
    if (phoneClaim && emailClaim && phoneClaim.line !== emailClaim.line) conflict = true;
    // Linha do arquivo já reivindicou uma chave, e a outra chave é nova/diferente:
    // aceitar isso significaria anexar o dado de outra pessoa ao primeiro registro.
    if (phoneClaim && !emailClaim && emailKey) conflict = true;
    if (emailClaim && !phoneClaim && phoneKey) conflict = true;
    // Chave já planejada por outra linha, sem ser o mesmo par: mesma coisa.
    if (phoneClaim && phoneClaim.line !== row.line && emailKey && phoneClaim.row.email && normalizeEmail(phoneClaim.row.email) !== email) conflict = true;
    if (emailClaim && emailClaim.line !== row.line && phoneKey && emailClaim.row.phone && identityPhone(emailClaim.row.phone) !== phone) conflict = true;
    // Cadastro existente já tem um dos dados, e a linha traz OUTRO valor para a
    // mesma pessoa — trocar dado de cadastro não é trabalho da importação.
    if (conflict) issues.push('identity_conflict');

    const blocking = issues.filter((i) => i !== 'ja_existe' && i !== 'repetido_no_arquivo');

    if (conflict) {
      counts.error += 1;
      rows.push({ ...row, action: 'error', contactId: '', issues, message: ISSUE_MESSAGE.identity_conflict });
      continue;
    }

    // Repetido no arquivo (mesmas chaves já planejadas): vale a primeira.
    const claimLines = new Set([phoneClaim?.line, emailClaim?.line].filter((x): x is number => x !== undefined));
    if (keys.length > 0 && claimLines.size === 1 && keys.every((k) => claimed.get(k)?.line === [...claimLines][0])) {
      const line = [...claimLines][0];
      counts.skip += 1;
      rows.push({
        ...row, action: 'skip', contactId: '',
        issues: ['repetido_no_arquivo'],
        message: `${ISSUE_MESSAGE.repetido_no_arquivo} (linha ${line})`,
      });
      continue;
    }

    const existing = phoneTarget || emailTarget;
    if (existing) issues.push('ja_existe');

    if (blocking.length > 0) {
      counts.error += 1;
      rows.push({
        ...row, action: 'error', contactId: existing?.id || '',
        issues, message: planMessage('error', issues, existing),
      });
      continue;
    }

    // Reserva as chaves desta linha para as próximas.
    for (const k of keys) claimed.set(k, { line: row.line, row });

    if (existing) {
      if (existingMode === 'skip') {
        counts.skip += 1;
        rows.push({
          ...row, action: 'skip', contactId: existing.id, issues,
          message: planMessage('skip', issues, existing),
        });
        continue;
      }
      const filled = fillEmptyUpdates(row, existing).fieldCount;
      counts.fill += 1;
      rows.push({
        ...row, action: 'fill', contactId: existing.id, issues,
        message: planMessage('fill', issues, existing, filled),
      });
      continue;
    }

    counts.create += 1;
    rows.push({ ...row, action: 'create', contactId: '', issues, message: planMessage('create', issues) });
  }

  return {
    rows,
    total: rows.length,
    ...counts,
    columns: parsed.columns,
    unknownColumns: parsed.unknownColumns,
    exportOnlyColumns: parsed.exportOnlyColumns,
    mapped: parsed.mapped,
    delimiter: parsed.delimiter,
    existingMode,
  };
}

// ── Modo `fill_empty`: o que dá para preencher sem mexer no que existe ──
export interface FillEmptyResult {
  /** Campos de primeiro nível do contato (`name`, `email`, …). */
  contact: Partial<Pick<BusinessCustomer, 'name' | 'email'>>;
  /** Patch de perfil (só os campos vazios no cadastro atual). */
  profile: Record<string, unknown>;
  /** Observação administrativa a gravar no campo canônico (quando vazio). */
  adminNote: string;
  /** Observação que vai para o histórico (quando o campo já estava ocupado). */
  historyNote: string;
  /** Consentimento: só LIGA com "sim" explícito; nunca desliga. */
  marketingOptIn: boolean;
  fieldCount: number;
}

const has = (v: unknown) => String(v ?? '').trim() !== '';

/**
 * Decide o que o modo `fill_empty` pode escrever: **somente campo vazio**.
 * Nada que já tenha valor é substituído — nem nome, nem telefone, nem CPF,
 * nem endereço, nem etiqueta, nem observação.
 */
export function fillEmptyUpdates(row: ParsedRow, contact: BusinessCustomer): FillEmptyResult {
  const profile = (contact.profile || {}) as Record<string, any>;
  const address = (profile.address || {}) as Record<string, any>;
  const guardian = (profile.guardian || {}) as Record<string, any>;

  const contactPatch: FillEmptyResult['contact'] = {};
  if (!has(contact.name) && has(row.name)) contactPatch.name = row.name;
  if (!has(contact.email) && has(row.email)) contactPatch.email = normalizeEmail(row.email);

  const profilePatch: Record<string, unknown> = {};
  if (!has(profile.cpf) && has(row.cpf)) profilePatch.cpf = row.cpf;
  if (!has(profile.birthDate) && has(row.birthDate)) profilePatch.birthDate = row.birthDate;

  const addressPatch: Record<string, string> = {};
  const addrMap: [string, string][] = [
    ['cep', row.cep], ['street', row.street], ['number', row.number],
    ['complement', row.complement], ['district', row.district], ['city', row.city], ['state', row.state],
  ];
  for (const [field, value] of addrMap) if (has(value) && !has(address[field])) addressPatch[field] = value;
  if (Object.keys(addressPatch).length > 0) profilePatch.address = addressPatch;

  const guardianPatch: Record<string, string> = {};
  if (has(row.guardianName) && !has(guardian.name)) guardianPatch.name = row.guardianName;
  if (has(row.guardianPhone) && !has(guardian.phone)) guardianPatch.phone = row.guardianPhone;
  if (has(row.guardianCpf) && !has(guardian.cpf)) guardianPatch.cpf = row.guardianCpf;
  if (Object.keys(guardianPatch).length > 0) profilePatch.guardian = guardianPatch;

  // Etiquetas: entrada nova entra; nenhuma existente sai.
  const currentTags = Array.isArray(profile.tags) ? profile.tags.map((t: unknown) => normalizeHeader(t)) : [];
  const newTags = row.tags.filter((t) => !currentTags.includes(normalizeHeader(t)));
  if (newTags.length > 0 && currentTags.length < PROFILE_TAGS_MAX) {
    const room = PROFILE_TAGS_MAX - currentTags.length;
    profilePatch.tags = [...(profile.tags || []), ...newTags.slice(0, room)];
  }

  // Observação: campo canônico quando vazio; senão vai para o HISTÓRICO
  // (auditável, com autor) — nunca sobrescreve e nunca desaparece.
  let adminNote = '';
  let historyNote = '';
  if (has(row.note)) {
    if (!has(profile.adminNote)) adminNote = row.note;
    else historyNote = row.note;
  }

  const marketingOptIn = row.marketingOptIn === true;
  const fieldCount =
    Object.keys(contactPatch).length + Object.keys(profilePatch).length +
    (adminNote ? 1 : 0) + (historyNote ? 1 : 0) + (marketingOptIn ? 1 : 0);

  return { contact: contactPatch, profile: profilePatch, adminNote, historyNote, marketingOptIn, fieldCount };
}

/** Resumo em uma linha, para o cabeçalho da prévia. */
export function importSummary(plan: ImportPlan): string {
  const parts = [
    plan.create > 0 ? `${plan.create} novo${plan.create > 1 ? 's' : ''}` : '',
    plan.fill > 0 ? `${plan.fill} complementa${plan.fill > 1 ? 'm' : ''}` : '',
    plan.skip > 0 ? `${plan.skip} já na base / repetido${plan.skip > 1 ? 's' : ''}` : '',
    plan.error > 0 ? `${plan.error} com erro` : '',
  ].filter(Boolean);
  return parts.length === 0 ? 'Nenhuma linha para importar.' : parts.join(' · ');
}

// ── CSV: escrita ───────────────────────────────────────────────
export const EXPORT_COLUMNS = [
  'Nome', 'Telefone', 'E-mail', 'CPF', 'Nascimento', 'CEP', 'Rua', 'Número', 'Complemento',
  'Bairro', 'Cidade', 'UF', 'Tags', 'Responsável', 'Telefone do responsável', 'CPF do responsável',
  'Marketing', 'Observação',
  // Somente exportação (reimportar não recria histórico — ver EXPORT_ONLY_COLUMNS).
  'Origem', 'Criado em', 'Última interação',
] as const;

/** Só a parte de cadastro (o que a importação aceita de volta). */
export const EXPORT_IMPORTABLE_COLUMNS = EXPORT_COLUMNS.filter(
  (c) => !(EXPORT_ONLY_COLUMNS as readonly string[]).includes(c),
);

export function exportContactsCSV(contacts: BusinessCustomer[], delimiter = ';'): string {
  const lines = [toCSVRow([...EXPORT_COLUMNS], delimiter)];
  for (const c of contacts) {
    const p = (c.profile || {}) as Record<string, any>;
    const a = p.address || {};
    const g = p.guardian || {};
    lines.push(toCSVRow([
      c.name, c.phone, c.email, p.cpf || '', p.birthDate || '',
      a.cep || '', a.street || '', a.number || '', a.complement || '', a.district || '', a.city || '', a.state || '',
      (p.tags || []).join(', '),
      g.name || '', g.phone || '', g.cpf || '',
      c.marketingOptIn ? 'sim' : 'não',
      p.adminNote || c.note || '',
      c.source || '', c.createdAt ? c.createdAt.slice(0, 10) : '',
      c.lastInteraction ? c.lastInteraction.slice(0, 10) : '',
    ], delimiter));
  }
  return `${lines.join('\n')}\n`;
}

/** Modelo para baixar: cabeçalho + duas linhas de exemplo. */
export function importTemplateCSV(delimiter = ';'): string {
  return [
    toCSVRow(['Nome', 'Telefone', 'E-mail', 'CPF', 'Nascimento', 'CEP', 'Rua', 'Número', 'Bairro', 'Cidade', 'UF', 'Tags', 'Marketing', 'Observação'], delimiter),
    toCSVRow(['Maria Souza', '(21) 98888-7777', 'maria@exemplo.com', '', '12/05/1990', '22041-080', 'Rua das Flores', '120', 'Copacabana', 'Rio de Janeiro', 'RJ', 'vip, manhã', 'sim', 'Prefere manhã'], delimiter),
    toCSVRow(['João Lima', '11912345678', '', '', '', '', '', '', '', 'São Paulo', 'SP', '', 'não', ''], delimiter),
  ].join('\n') + '\n';
}

/**
 * Relatório das linhas que NÃO entraram — para a pessoa corrigir na planilha e
 * tentar de novo. Sai no mesmo formato seguro (`spreadsheetSafeCell`).
 */
export function errorReportCSV(rows: ImportRowPlan[], delimiter = ';'): string {
  const failed = rows.filter((r) => r.action === 'error');
  const lines = [toCSVRow(['Linha', 'Nome', 'Telefone', 'E-mail', 'Motivo'], delimiter)];
  for (const r of failed) {
    lines.push(toCSVRow([String(r.line), r.name, r.phone, r.email, r.message], delimiter));
  }
  return `${lines.join('\n')}\n`;
}
