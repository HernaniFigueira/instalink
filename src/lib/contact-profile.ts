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
  return { isMinor: false, name: '', phone: '', cpf: '' };
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

/** Menor de idade: pela idade derivada OU pela declaração da equipe. */
export function isMinor(profile?: Pick<ContactProfile, 'birthDate' | 'guardian'> | null, now: Date = new Date()): boolean {
  if (!profile) return false;
  if (profile.guardian?.isMinor === true) return true;
  const age = ageFromBirthDate(profile.birthDate, now);
  return age !== null && age < MAJOR_AGE;
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

function normalizeAddress(v: unknown): ContactAddress {
  const raw = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const state = text(raw.state, 2).toUpperCase();
  return {
    cep: onlyDigits(String(raw.cep ?? '')).slice(0, 8),
    street: text(raw.street),
    number: text(raw.number, 20),
    complement: text(raw.complement, 60),
    district: text(raw.district),
    city: text(raw.city),
    state: (BRAZILIAN_STATES as readonly string[]).includes(state) ? state : '',
  };
}

function normalizeGuardian(v: unknown): ContactGuardian {
  const raw = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    isMinor: raw.isMinor === true,
    name: text(raw.name, 80),
    phone: onlyDigits(String(raw.phone ?? '')).slice(0, 13),
    cpf: onlyDigits(String(raw.cpf ?? '')).slice(0, 11),
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
    address: has('address') ? normalizeAddress(raw.address) : normalizeAddress(base.address),
    guardian: has('guardian') ? normalizeGuardian(raw.guardian) : normalizeGuardian(base.guardian),
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
 * Etiquetas da carteirinha, DERIVADAS dos dados reais (nunca digitadas à mão
 * para fingir estado). Ordem = importância para quem atende.
 */
export function clientTags(input: {
  name?: string;
  accountStatus?: 'none' | 'active';
  marketingOptIn?: boolean;
  bookingsCount?: number;
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

  if ((input.bookingsCount || 0) > 0) {
    out.push({ id: 'paciente', label: 'Cliente atendido', tone: 'green', hint: `${input.bookingsCount} agendamento(s) no histórico` });
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
