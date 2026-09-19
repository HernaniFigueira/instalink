// ═══════════════════════════════════════════════════════════════
// CARTEIRINHA DO CLIENTE (A3.3) — dados cadastrais ricos
// ═══════════════════════════════════════════════════════════════
// Fonte única de:
//   • normalização/validação do `BusinessCustomer.profile` (aditivo);
//   • idade DERIVADA da data de nascimento (nunca gravada — deriva sempre);
//   • formatação brasileira de CPF / telefone / CEP;
//   • etiquetas da carteirinha (paciente, lead, menor, responsável…).
//
// Regras:
//   • NADA aqui substitui name/phone/email: a identidade e o dedupe continuam
//     em lib/contacts.ts. `profile` só ACRESCENTA informação cadastral.
//   • Campo antigo ausente ⇒ perfil vazio (compatibilidade retroativa).
//   • Nenhum campo é obrigatório: a carteirinha funciona com só nome+telefone.
//
// Módulo PURO (sem I/O/DOM): testável e reutilizável no cliente e no servidor.
import { onlyDigits } from './utils';
import type { BusinessCustomer, ContactAddress, ContactGuardian, ContactProfile } from './types';

export const PROFILE_TEXT_MAX = 120;
export const PROFILE_NOTE_MAX = 1000;
export const PROFILE_TAG_MAX = 24;
export const PROFILE_TAGS_MAX = 8;
export const MAJOR_AGE = 18;

export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export function emptyAddress(): ContactAddress {
  return { cep: '', street: '', number: '', complement: '', district: '', city: '', state: '' };
}

export function emptyGuardian(): ContactGuardian {
  return { isMinor: false, name: '', phone: '', cpf: '', contactId: '', relationship: '' };
}

export function emptyProfile(): ContactProfile {
  return { birthDate: '', cpf: '', gender: '', adminNote: '', address: emptyAddress(), guardian: emptyGuardian(), tags: [] };
}

function text(v: unknown, max = PROFILE_TEXT_MAX): string {
  return String(v ?? '').trim().slice(0, max);
}

/** `YYYY-MM-DD` válido (e calendário real) ou ''. Nunca aceita data futura. */
export function normalizeBirthDate(v: unknown, now: Date = new Date()): string {
  const raw = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [y, m, d] = raw.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  // Data futura não é nascimento — descarta em vez de gerar idade negativa.
  if (raw > new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)) return '';
  return raw;
}

/** Idade completa em anos a partir de `YYYY-MM-DD`; `null` quando não há data. */
export function ageFromBirthDate(birthDate: string, now: Date = new Date()): number | null {
  const iso = normalizeBirthDate(birthDate, now);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Menor de idade — hierarquia sem contradição (ponto 6 do fechamento A3.3):
 *
 *   1. Se existe `birthDate` VÁLIDA, a idade derivada é a autoridade:
 *      `guardian.isMinor: true` com nascimento em 1990 NÃO classifica adulto.
 *   2. Sem `birthDate`, `guardian.isMinor` vale como declaração manual da
 *      equipe — é o único indício disponível.
 *
 * Assim as duas fontes nunca se contradizem em silêncio na carteirinha.
 */
export function isMinor(profile?: Pick<ContactProfile, 'birthDate' | 'guardian'> | null, now: Date = new Date()): boolean {
  if (!profile) return false;
  const age = ageFromBirthDate(profile.birthDate, now);
  if (age !== null) return age < MAJOR_AGE;
  return profile.guardian?.isMinor === true;
}

/** CPF válido (dígitos verificadores) — '' é aceito como "não informado". */
export function isValidCpf(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

/**
 * Validação canônica de CPF do cadastro, no SERVIDOR (ponto 4 do fechamento
 * A3.3). Cobre os DOIS campos e é chamada por POST e PATCH — a validação do
 * React é só conforto, nunca a autoridade.
 *
 * Regra: `''` = não informado, permitido. Havendo valor, precisa passar em
 * `isValidCpf`. Devolve `''` quando está tudo certo, ou a mensagem específica
 * do campo com problema.
 */
export function profileCpfError(profile: unknown): string {
  if (!profile || typeof profile !== 'object') return '';
  const raw = profile as Record<string, unknown>;
  const cpf = String(raw.cpf ?? '');
  if (onlyDigits(cpf) && !isValidCpf(cpf)) return 'CPF inválido.';
  const guardian = raw.guardian;
  if (guardian && typeof guardian === 'object') {
    const gCpf = String((guardian as Record<string, unknown>).cpf ?? '');
    if (onlyDigits(gCpf) && !isValidCpf(gCpf)) return 'CPF do responsável inválido.';
  }
  return '';
}

export function formatCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** `(11) 91234-5678` a partir de dígitos; devolve o que der para formatar. */
export function formatPhoneBR(input: string): string {
  const d = onlyDigits(input);
  if (d.length < 10) return d;
  const ddd = d.slice(0, 2);
  const rest = d.length >= 11 ? d.slice(2) : d.slice(2);
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
}

export function formatCep(input: string): string {
  const d = onlyDigits(input).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Normaliza o endereço preservando o que o patch NÃO enviou.
 *
 * Sem o `base`, `{ address: { number: '200' } }` reconstruía o objeto do zero
 * e apagava cep/street/city — o oposto da promessa de PATCH parcial (ponto 5
 * do fechamento A3.3). Regra: subcampo ausente (`undefined`) preserva o atual;
 * string vazia enviada de propósito continua limpando o campo.
 */
function normalizeAddress(v: unknown, base?: ContactAddress): ContactAddress {
  const from = base || emptyAddress();
  const raw = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const has = (k: string) => raw[k] !== undefined;
  const state = text(has('state') ? raw.state : from.state, 2).toUpperCase();
  return {
    cep: onlyDigits(String(has('cep') ? raw.cep ?? '' : from.cep)).slice(0, 8),
    street: has('street') ? text(raw.street) : from.street,
    number: has('number') ? text(raw.number, 20) : from.number,
    complement: has('complement') ? text(raw.complement, 60) : from.complement,
    district: has('district') ? text(raw.district) : from.district,
    city: has('city') ? text(raw.city) : from.city,
    state: (BRAZILIAN_STATES as readonly string[]).includes(state) ? state : '',
  };
}

/** Idem ao endereço: cada subcampo ausente preserva o valor atual. */
function normalizeGuardian(v: unknown, base?: ContactGuardian): ContactGuardian {
  const from = base || emptyGuardian();
  const raw = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const has = (k: string) => raw[k] !== undefined;
  return {
    isMinor: has('isMinor') ? raw.isMinor === true : from.isMinor,
    name: has('name') ? text(raw.name, 80) : from.name,
    phone: onlyDigits(String(has('phone') ? raw.phone ?? '' : from.phone)).slice(0, 13),
    cpf: onlyDigits(String(has('cpf') ? raw.cpf ?? '' : from.cpf)).slice(0, 11),
    // Vínculo futuro com outro contato da mesma unidade (ponto 7): opcional e
    // aditivo — ausente no patch preserva o atual; '' desvincula de propósito.
    contactId: has('contactId') ? text(raw.contactId, 64) : from.contactId,
    relationship: has('relationship') ? text(raw.relationship, 40) : from.relationship,
  };
}

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const item of v) {
    const tag = text(item, PROFILE_TAG_MAX);
    if (tag) seen.add(tag);
    if (seen.size >= PROFILE_TAGS_MAX) break;
  }
  return [...seen];
}

/**
 * Normaliza um payload de perfil (API/formulário) para o formato persistido.
 * Campos ausentes no patch são PRESERVADOS do perfil atual — um PATCH parcial
 * nunca apaga o que já estava preenchido.
 */
export function normalizeContactProfile(patch: unknown, current?: ContactProfile | null): ContactProfile {
  const base = current ? { ...emptyProfile(), ...current } : emptyProfile();
  if (!patch || typeof patch !== 'object') return base;
  const raw = patch as Record<string, unknown>;
  const has = (k: string) => raw[k] !== undefined;

  return {
    birthDate: has('birthDate') ? normalizeBirthDate(raw.birthDate) : base.birthDate,
    cpf: has('cpf') ? onlyDigits(String(raw.cpf ?? '')).slice(0, 11) : base.cpf,
    gender: has('gender') ? text(raw.gender, 40) : base.gender,
    adminNote: has('adminNote') ? text(raw.adminNote, PROFILE_NOTE_MAX) : base.adminNote,
    address: has('address') ? normalizeAddress(raw.address, base.address) : normalizeAddress(base.address),
    guardian: has('guardian') ? normalizeGuardian(raw.guardian, base.guardian) : normalizeGuardian(base.guardian),
    tags: has('tags') ? normalizeTags(raw.tags) : normalizeTags(base.tags),
  };
}

/** Aplica o patch no contato (mutação local dentro de updateDB) e devolve o perfil. */
export function applyContactProfile(c: BusinessCustomer, patch: unknown): ContactProfile {
  c.profile = normalizeContactProfile(patch, c.profile);
  c.updatedAt = new Date().toISOString();
  return c.profile;
}

/**
 * Perfil efetivo de um contato (nunca `undefined` para a UI).
 * Aceita o contato OU o perfil direto — a UI costuma ter um dos dois.
 */
export function profileOf(source?: { profile?: ContactProfile } | ContactProfile | null): ContactProfile {
  // Discriminador determinístico: um CONTATO sempre carrega `businessId`
  // (ou `customerId`/`notes`); um PERFIL nunca tem esses campos. Usar
  // `'profile' in source` falharia quando o contato ainda não tem perfil —
  // que é justamente o caso de compatibilidade retroativa.
  const looksLikeContact = !!source && typeof source === 'object'
    && ('profile' in source || 'businessId' in source || 'customerId' in source || 'notes' in source);
  const p = (looksLikeContact ? (source as { profile?: ContactProfile }).profile : source) as ContactProfile | undefined;
  if (!p) return emptyProfile();
  return {
    ...emptyProfile(),
    ...p,
    address: { ...emptyAddress(), ...(p.address || {}) },
    guardian: { ...emptyGuardian(), ...(p.guardian || {}) },
    tags: Array.isArray(p.tags) ? p.tags : [],
  };
}

/** Tem algum dado cadastral preenchido (a carteirinha sabe se está vazia). */
export function hasProfileData(p: ContactProfile): boolean {
  return !!(
    p.birthDate || p.cpf || p.gender || p.adminNote ||
    p.address.cep || p.address.street || p.address.city || p.address.state ||
    p.guardian.name || p.guardian.phone || p.guardian.cpf || p.tags.length
  );
}

/** Iniciais para o avatar (até 2 letras). */
export function initialsOf(name: string): string {
  return (name || '')
    .trim()
    .split(/\s+/)
    .filter((p) => p && !/^(de|da|do|das|dos|e)$/i.test(p))
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export interface ClientTag {
  id: string;
  label: string;
  tone: 'zinc' | 'green' | 'amber' | 'red' | 'blue' | 'lilac';
  /** Explicação curta (tooltip): etiqueta nunca é só cor. */
  hint: string;
}

/**
 * O que conta como atendimento REALIZADO (ponto 9 do fechamento A3.3).
 *
 * "Cliente atendido" não pode significar "tem booking": agendamento futuro,
 * pendente, cancelado ou falta não é atendimento realizado. Só `completed`
 * entra na conta — regra única, consumida pela etiqueta, pelo filtro
 * "Já atendidos" e pelo drawer.
 */
export const ATTENDED_BOOKING_STATUS = 'completed';

export function isAttendedBooking(status: unknown): boolean {
  return String(status ?? '') === ATTENDED_BOOKING_STATUS;
}

export function countAttended(bookings: ReadonlyArray<{ status?: string } | null | undefined>): number {
  return bookings.filter((b) => isAttendedBooking(b?.status)).length;
}

/**
 * Etiquetas da carteirinha, DERIVADAS dos dados reais (nunca digitadas à mão
 * para fingir estado). Ordem = importância para quem atende.
 */
export function clientTags(input: {
  name?: string;
  accountStatus?: 'none' | 'active';
  marketingOptIn?: boolean;
  /** Total de agendamentos no histórico (qualquer status). */
  bookingsCount?: number;
  /** Só os CONCLUÍDOS: é isso que autoriza a etiqueta "Cliente atendido". */
  attendedCount?: number;
  leadsCount?: number;
  profile?: ContactProfile | null;
  now?: Date;
}): ClientTag[] {
  const now = input.now || new Date();
  const profile = input.profile ? { ...emptyProfile(), ...input.profile } : emptyProfile();
  const out: ClientTag[] = [];

  const age = ageFromBirthDate(profile.birthDate, now);
  const minor = isMinor(profile, now);

  if (minor) {
    out.push({
      id: 'menor',
      label: age === null ? 'Menor de idade' : `Menor · ${age} anos`,
      tone: 'amber',
      hint: profile.guardian?.name
        ? `Responsável: ${profile.guardian.name}`
        : 'Menor de idade — registre o responsável.',
    });
  } else if (profile.guardian?.name) {
    out.push({ id: 'responsavel', label: 'Tem responsável', tone: 'blue', hint: `Responsável: ${profile.guardian.name}` });
  }

  // Ponto 9: a etiqueta exige atendimento CONCLUÍDO. Ter agendamento futuro
  // ou pendente não faz de ninguém "cliente atendido".
  const attended = input.attendedCount || 0;
  if (attended > 0) {
    const total = input.bookingsCount || attended;
    out.push({
      id: 'paciente',
      label: 'Cliente atendido',
      tone: 'green',
      hint: total > attended
        ? `${attended} atendimento(s) concluído(s) de ${total} no histórico`
        : `${attended} atendimento(s) concluído(s)`,
    });
  } else if ((input.bookingsCount || 0) > 0) {
    // Tem agenda, mas nada concluído ainda — dito com todas as letras.
    out.push({
      id: 'agendado',
      label: 'Com agendamentos',
      tone: 'blue',
      hint: `${input.bookingsCount} agendamento(s) no histórico, nenhum concluído`,
    });
  }
  if ((input.leadsCount || 0) > 0) {
    out.push({ id: 'lead', label: 'Lead no funil', tone: 'lilac', hint: `${input.leadsCount} oportunidade(s) em aberto` });
  }
  if (input.accountStatus === 'active') {
    out.push({ id: 'acesso', label: 'Acesso ativo', tone: 'blue', hint: 'A pessoa entra na área do cliente com login próprio.' });
  }
  if (input.marketingOptIn) {
    out.push({ id: 'marketing', label: 'Aceita promoções', tone: 'green', hint: 'Consentimento dado: pode entrar em campanhas.' });
  }
  for (const tag of profile.tags) {
    out.push({ id: `tag:${tag}`, label: tag, tone: 'zinc', hint: 'Etiqueta cadastrada pela equipe.' });
  }
  return out;
}
