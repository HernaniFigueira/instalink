// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — IMPORTAR E EXPORTAR A BASE DE CLIENTES
// ═══════════════════════════════════════════════════════════════
// Quem chega de outro sistema tem a base num arquivo (CSV do Excel, do Google
// Contacts, de um sistema antigo). O trabalho aqui é:
//
//   • LER o arquivo como ele vem — separador `,` `;` ou TAB, BOM, aspas,
//     quebra de linha dentro da célula, cabeçalho em português ou inglês;
//   • dizer ANTES de escrever o que vai acontecer linha por linha (prévia);
//   • usar a MESMA régua de campos do resto do produto (`lib/field-quality`)
//     e a MESMA identidade do CRM (telefone/e-mail em dígitos/minúsculas);
//   • nunca duplicar pessoa: linha repetida dentro do arquivo ou já existente
//     na unidade vira ATUALIZAÇÃO, não um segundo cadastro;
//   • exportar de volta no mesmo formato que se importa (ida e volta).
//
// Módulo PURO (sem I/O): recebe texto/linhas e devolve decisão. Assim a prévia
// da tela e a gravação do servidor usam exatamente o mesmo plano.
import { digitsOf, emailError, normalizeEmail, normalizePhoneBR, phoneError } from './field-quality';
import type { BusinessCustomer } from './types';

// ── Limites (segurança e sanidade) ─────────────────────────────
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_CHARS = 2_000_000;
export const IMPORT_NAME_MAX = 80;

/** Colunas reconhecidas — a chave é o que aparece no cabeçalho, normalizado. */
export const IMPORT_COLUMNS = {
  name: ['nome', 'nome completo', 'cliente', 'name', 'full name'],
  phone: ['telefone', 'whatsapp', 'celular', 'fone', 'telefone/whatsapp', 'phone', 'mobile'],
  email: ['email', 'e-mail', 'endereco de email', 'mail'],
  cpf: ['cpf'],
  birthDate: ['nascimento', 'data de nascimento', 'aniversario', 'birthday', 'birth date'],
  cep: ['cep'],
  street: ['rua', 'logradouro', 'endereco', 'endereço', 'street'],
  number: ['numero', 'número', 'nº', 'n°', 'number'],
  city: ['cidade', 'city'],
  state: ['uf', 'estado', 'state'],
  marketingOptIn: ['marketing', 'aceita promocoes', 'aceita promoções', 'opt-in', 'opt in', 'consentimento', 'newsletter'],
  note: ['observacao', 'observação', 'nota', 'note', 'obs'],
} as const;

export type ImportField = keyof typeof IMPORT_COLUMNS;

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

/** Data de nascimento aceita `DD/MM/AAAA`, `AAAA-MM-DD` e `DD-MM-AAAA`. */
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

// ── CSV: leitura ───────────────────────────────────────────────
/**
 * Descobre o separador contando ocorrências FORA de aspas na primeira linha.
 * Excel em português exporta com `;` — e um arquivo assim lido com `,` vira
 * uma única coluna gigante.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
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
  city: string;
  state: string;
  marketingOptIn: boolean;
  note: string;
}

export type ImportIssue =
  | 'sem_nome'
  | 'telefone_invalido'
  | 'email_invalido'
  | 'cep_invalido'
  | 'cpf_invalido'
  | 'nascimento_invalido'
  | 'sem_contato'
  | 'repetido_no_arquivo'
  | 'ja_existe';

export interface ImportRowPlan extends ParsedRow {
  action: 'create' | 'update' | 'skip' | 'error';
  /** Contato que será atualizado (quando `action === 'update'`). */
  contactId: string;
  /** Problemas encontrados: os que impedem (`error`) e os que só avisam. */
  issues: ImportIssue[];
  /** Mensagem curta em português para a prévia. */
  message: string;
}

export interface ImportPlan {
  rows: ImportRowPlan[];
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  /** Cabeçalhos que NÃO foram reconhecidos (transparência com o usuário). */
  unknownColumns: string[];
  /** Mapeamento usado (nome do campo → coluna do arquivo). */
  mapped: Partial<Record<ImportField, number>>;
  delimiter: string;
}

/**
 * O parser devolve `birthDate: ''` tanto para "não veio nada" quanto para
 * "veio algo ilegível". A prévia precisa distinguir os dois — para isso a
 * linha guarda se HAVIA conteúdo na coluna.
 */
function rawBirthWasNotParsed(row: ParsedRow & { birthRaw?: string }): boolean {
  return !!row.birthRaw && !row.birthDate;
}

const ISSUE_MESSAGE: Record<ImportIssue, string> = {
  sem_nome: 'Sem nome — informe quem é a pessoa.',
  telefone_invalido: 'Telefone inválido — confira o DDD e o número',
  email_invalido: 'E-mail inválido',
  cep_invalido: 'CEP incompleto',
  cpf_invalido: 'CPF com 11 dígitos?',
  nascimento_invalido: 'Data de nascimento não reconhecida',
  sem_contato: 'Precisa de telefone ou e-mail para entrar na base.',
  repetido_no_arquivo: 'Repetido no arquivo — vale a primeira linha.',
  ja_existe: 'Já está na base — os dados serão atualizados.',
};

/**
 * Lê o arquivo e devolve as linhas já normalizadas. Não decide nada sobre a
 * base: só entende o texto.
 */
export function parseImportFile(text: string): { rows: ParsedRow[]; unknownColumns: string[]; mapped: Partial<Record<ImportField, number>>; delimiter: string; headerError: string } {
  const table = parseCSV(text);
  const delimiter = detectDelimiter(String(text ?? '').replace(/^\uFEFF/, ''));
  if (table.length === 0) return { rows: [], unknownColumns: [], mapped: {}, delimiter, headerError: 'O arquivo está vazio.' };
  const [header, ...body] = table;
  const mapped = mapHeader(header);
  const known = new Set(Object.values(mapped));
  const unknownColumns = header
    .map((h, i) => (known.has(i) ? '' : String(h || '').trim()))
    .filter(Boolean);
  if (mapped.name === undefined && mapped.phone === undefined && mapped.email === undefined) {
    return {
      rows: [], unknownColumns, mapped, delimiter,
      headerError: 'Não reconheci as colunas. Use um cabeçalho com “nome” e “telefone” ou “e-mail” (baixe o modelo).',
    };
  }
  const get = (r: string[], field: ImportField): string => {
    const idx = mapped[field];
    return idx === undefined ? '' : String(r[idx] ?? '').trim();
  };
  const rows: ParsedRow[] = body.slice(0, IMPORT_MAX_ROWS).map((r, i) => ({
    line: i + 2, // +1 do cabeçalho, +1 porque a linha 1 é o cabeçalho
    name: get(r, 'name').slice(0, IMPORT_NAME_MAX),
    phone: normalizePhoneBR(get(r, 'phone')),
    email: normalizeEmail(get(r, 'email')),
    cpf: digitsOf(get(r, 'cpf'), 11),
    birthDate: parseBirthDate(get(r, 'birthDate')),
    birthRaw: get(r, 'birthDate'),
    cep: digitsOf(get(r, 'cep'), 8),
    street: get(r, 'street'),
    number: get(r, 'number'),
    city: get(r, 'city'),
    state: get(r, 'state').toUpperCase().slice(0, 2),
    marketingOptIn: parseYesNo(get(r, 'marketingOptIn')),
    note: get(r, 'note').slice(0, 500),
  }));
  return { rows, unknownColumns, mapped, delimiter, headerError: '' };
}

// ── CSV: escrita ───────────────────────────────────────────────
function csvCell(value: unknown): string {
  const s = String(value ?? '');
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Linha no formato que a própria importação entende (ida e volta). */
export function toCSVRow(cells: unknown[], delimiter = ';'): string {
  return cells.map(csvCell).join(delimiter);
}

export const EXPORT_COLUMNS = [
  'Nome', 'Telefone', 'E-mail', 'CPF', 'Nascimento', 'CEP', 'Rua', 'Número', 'Cidade', 'UF',
  'Marketing', 'Etiquetas', 'Origem', 'Criado em', 'Última interação', 'Observação',
] as const;

export function exportContactsCSV(contacts: BusinessCustomer[], delimiter = ';'): string {
  const lines = [toCSVRow([...EXPORT_COLUMNS], delimiter)];
  for (const c of contacts) {
    const p = c.profile;
    lines.push(toCSVRow([
      c.name, c.phone, c.email, p?.cpf || '', p?.birthDate || '',
      p?.address?.cep || '', p?.address?.street || '', p?.address?.number || '',
      p?.address?.city || '', p?.address?.state || '',
      c.marketingOptIn ? 'sim' : 'não',
      (p?.tags || []).join(', '),
      c.source || '', c.createdAt ? c.createdAt.slice(0, 10) : '',
      c.lastInteraction ? c.lastInteraction.slice(0, 10) : '',
      c.note || '',
    ], delimiter));
  }
  return `${lines.join('\n')}\n`;
}

/** Modelo para baixar: cabeçalho + duas linhas de exemplo. */
export function importTemplateCSV(delimiter = ';'): string {
  return [
    toCSVRow(['Nome', 'Telefone', 'E-mail', 'CPF', 'Nascimento', 'CEP', 'Cidade', 'UF', 'Marketing', 'Observação'], delimiter),
    toCSVRow(['Maria Souza', '(21) 98888-7777', 'maria@exemplo.com', '', '12/05/1990', '22041-080', 'Rio de Janeiro', 'RJ', 'sim', 'Prefere manhã'], delimiter),
    toCSVRow(['João Lima', '11912345678', '', '', '', '', 'São Paulo', 'SP', 'não', ''], delimiter),
  ].join('\n') + '\n';
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

/**
 * Monta o PLANO da importação: o que cada linha vai fazer, sem escrever nada.
 *
 * `contacts` é a base atual DA UNIDADE (o servidor já filtra por businessId).
 */
export function buildImportPlan(parsed: ReturnType<typeof parseImportFile>, contacts: BusinessCustomer[]): ImportPlan {
  const byKey = new Map<string, BusinessCustomer>();
  for (const c of contacts) for (const k of contactIdentityKeys(c)) if (!byKey.has(k)) byKey.set(k, c);

  const seen = new Map<string, number>();
  const rows: ImportRowPlan[] = [];
  const counts = { create: 0, update: 0, skip: 0, error: 0 };

  for (const row of parsed.rows) {
    const issues: ImportIssue[] = [];
    const key = importIdentityKey(row);

    if (!row.name) issues.push('sem_nome');
    const phoneMsg = phoneError(row.phone);
    if (row.phone && phoneMsg) issues.push('telefone_invalido');
    const mailMsg = emailError(row.email);
    if (row.email && mailMsg) issues.push('email_invalido');
    if (row.cep && row.cep.length !== 8) issues.push('cep_invalido');
    if (row.cpf && row.cpf.length !== 11) issues.push('cpf_invalido');
    // Nascimento só é problema quando o arquivo TROUXE algo que não deu para ler
    // (data vazia é simplesmente "não informado").
    if (rawBirthWasNotParsed(row)) issues.push('nascimento_invalido');
    if (!row.phone && !row.email) issues.push('sem_contato');

    // Erros que IMPEDEM a linha (não se inventa cadastro com dado torto).
    const blocking = issues.filter((i) => i !== 'ja_existe' && i !== 'repetido_no_arquivo');

    // Repetido dentro do arquivo: vale a primeira (o resto é ruído do export).
    const firstLine = key ? seen.get(key) : undefined;
    if (key && firstLine !== undefined) {
      counts.skip += 1;
      rows.push({
        ...row, action: 'skip', contactId: '',
        issues: ['repetido_no_arquivo'],
        message: `${ISSUE_MESSAGE.repetido_no_arquivo} (linha ${firstLine})`,
      });
      continue;
    }

    const existing = key ? byKey.get(key) : undefined;
    if (existing) issues.push('ja_existe');

    if (blocking.length > 0) {
      counts.error += 1;
      rows.push({
        ...row, action: 'error', contactId: existing?.id || '',
        issues,
        message: blocking.map((i) => ISSUE_MESSAGE[i]).join(' · '),
      });
      continue;
    }

    if (key) seen.set(key, row.line);
    if (existing) {
      counts.update += 1;
      rows.push({
        ...row, action: 'update', contactId: existing.id, issues,
        message: `Atualiza ${existing.name || 'o cadastro'} (mesmo ${identityPhone(row.phone) ? 'telefone' : 'e-mail'}).`,
      });
    } else {
      counts.create += 1;
      rows.push({ ...row, action: 'create', contactId: '', issues, message: 'Cadastro novo.' });
    }
  }

  return {
    rows,
    total: rows.length,
    ...counts,
    unknownColumns: parsed.unknownColumns,
    mapped: parsed.mapped,
    delimiter: parsed.delimiter,
  };
}

/** Resumo em uma linha, para o cabeçalho da prévia. */
export function importSummary(plan: ImportPlan): string {
  const parts = [
    plan.create > 0 ? `${plan.create} novo${plan.create > 1 ? 's' : ''}` : '',
    plan.update > 0 ? `${plan.update} atualiza${plan.update > 1 ? 'm' : ''}` : '',
    plan.skip > 0 ? `${plan.skip} repetido${plan.skip > 1 ? 's' : ''}` : '',
    plan.error > 0 ? `${plan.error} com erro` : '',
  ].filter(Boolean);
  return parts.length === 0 ? 'Nenhuma linha para importar.' : parts.join(' · ');
}
