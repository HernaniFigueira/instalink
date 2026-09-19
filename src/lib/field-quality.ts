// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 6 — QUALIDADE DOS CAMPOS (telefone BR · e-mail · CPF · CEP)
// ═══════════════════════════════════════════════════════════════
// O sistema já grava telefone como dígitos, valida CPF (dígito verificador) e
// tem `formatPhoneBR`/`formatCep` para exibir. O que faltava era a camada que
// a PESSOA usa enquanto digita: máscara progressiva, o que aceitar como
// colagem, e a mensagem certa quando o número não existe.
//
// Este módulo é a fonte ÚNICA das duas pontas:
//   • a tela usa `maskPhoneBR`/`maskCep`/`maskCpf` ao digitar (progressivo, sem
//     travar o cursor) e `phoneError`/`emailError`/`cpfError`/`cepError` para
//     dizer o que está errado;
//   • o servidor usa `normalizePhoneBR`/`normalizeEmail` (o mesmo que a tela e
//     a importação gravam). Nenhuma validação de tela é autoridade.
//
// Regra de telefone brasileiro: 10 ou 11 dígitos com DDD (o nono dígito é
// aceito; fixo também), ou 12/13 dígitos quando vier com o código do país 55.
// Nada de exigir celular onde o cliente tem fixo.
export type MaskOptions = { maxDigits?: number };

const DDD_MIN = 11;
const DDD_MAX = 99;

/** Só os dígitos (o que o banco guarda). */
export function digitsOf(value: unknown, max = 20): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, max);
}

/**
 * Telefone brasileiro para gravação: '' quando está vazio, senão os dígitos
 * (com o código do país removido, porque o cadastro é de uma unidade BR).
 */
export function normalizePhoneBR(value: unknown): string {
  let d = digitsOf(value, 15);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}

/** Telefone brasileiro válido (10 ou 11 dígitos, DDD plausível). */
export function isValidPhoneBR(value: unknown): boolean {
  const d = normalizePhoneBR(value);
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (ddd < DDD_MIN || ddd > DDD_MAX) return false;
  const body = d.slice(2);
  // Celular tem 9 dígitos e começa com 9; fixo tem 8 e começa com 2–5.
  if (body.length === 9) return body.startsWith('9');
  return /^[2-5]/.test(body);
}

/** Mensagem clara para o campo ('' = está válido ou vazio e opcional). */
export function phoneError(value: unknown, opts: { required?: boolean } = {}): string {
  const d = normalizePhoneBR(value);
  if (!d) return opts.required ? 'Informe o WhatsApp com DDD.' : '';
  if (d.length < 10) return 'Faltam dígitos no WhatsApp — informe DDD + número.';
  if (d.length > 11) return 'WhatsApp com dígitos a mais — confira o DDD.';
  if (!isValidPhoneBR(d)) return 'Número de WhatsApp inválido para o DDD informado.';
  return '';
}

/** Máscara progressiva enquanto digita: (11) 91234-5678 · (11) 3456-7890. */
export function maskPhoneBR(value: unknown): string {
  const d = normalizePhoneBR(value).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length < 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length === 0) return `(${ddd})`;
  // Até 5 dígitos ainda não dá para saber se é celular (9) ou fixo (8): não
  // inventa o traço no meio para depois movê-lo (o cursor pula se mover).
  if (rest.length <= 5) return `(${ddd}) ${rest}`;
  if (rest.length <= 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

// ── E-mail ────────────────────────────────────────────────────
/** E-mail para gravação: minúsculo, sem espaços, teto de 120. */
export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').slice(0, 120);
}

/**
 * Validação de e-mail alinhada à do cadastro (`customer-account`): forma
 * básica com domínio — recusa vírgula, ponto duplicado e domínio sem TLD,
 * que são os erros reais de digitação. Não é RFC completa (de propósito).
 */
export function isValidEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  if (!email || email.length > 120) return false;
  if (email.includes(',')) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  return /^[a-z0-9.-]+$/.test(domain);
}

export function emailError(value: unknown, opts: { required?: boolean } = {}): string {
  const raw = String(value ?? '').trim();
  if (!raw) return opts.required ? 'Informe o e-mail.' : '';
  const email = normalizeEmail(raw);
  if (email.length > 120) return 'E-mail muito longo (máximo 120 caracteres).';
  if (!email.includes('@')) return 'Falta o @ no e-mail.';
  if (email.split('@').length > 2) return 'O e-mail tem mais de um @.';
  if (!isValidEmail(email)) return 'Confira o e-mail — parece incompleto (ex: nome@dominio.com.br).';
  return '';
}

// ── CPF ───────────────────────────────────────────────────────
/** Máscara progressiva: 123.456.789-09. */
export function maskCpf(value: unknown): string {
  const d = digitsOf(value, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// ── CEP ───────────────────────────────────────────────────────
/** Máscara progressiva: 01310-100. */
export function maskCep(value: unknown): string {
  const d = digitsOf(value, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** CEP completo (8 dígitos) — a busca de endereço só faz sentido com isso. */
export function isValidCep(value: unknown): boolean {
  return digitsOf(value, 9).length === 8;
}

export function cepError(value: unknown): string {
  const d = digitsOf(value, 9);
  if (!d) return '';
  if (d.length !== 8) return 'O CEP tem 8 dígitos.';
  if (/^0{8}$/.test(d)) return 'CEP inválido.';
  return '';
}

/**
 * Erros do conjunto de campos de contato, na ordem em que a tela mostra.
 * Usado pelo cadastro manual E pela importação (Bloco 7) — uma régua só.
 */
export function contactFieldErrors(
  fields: { name?: unknown; phone?: unknown; email?: unknown; cpf?: unknown; cep?: unknown },
  opts: { requireName?: boolean; requirePhone?: boolean } = {},
): Record<'name' | 'phone' | 'email' | 'cpf' | 'cep', string> {
  const errors = { name: '', phone: '', email: '', cpf: '', cep: '' };
  if (opts.requireName && !String(fields.name ?? '').trim()) errors.name = 'Informe o nome.';
  errors.phone = phoneError(fields.phone, { required: opts.requirePhone });
  errors.email = emailError(fields.email);
  errors.cep = cepError(fields.cep);
  const cpf = digitsOf(fields.cpf, 11);
  if (cpf && cpf.length !== 11) errors.cpf = 'O CPF tem 11 dígitos.';
  return errors;
}

export function hasFieldErrors(errors: Record<string, string>): boolean {
  return Object.values(errors).some((e) => !!e);
}
