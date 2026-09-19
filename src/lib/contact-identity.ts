// ═══════════════════════════════════════════════════════════════
// EDIÇÃO SEGURA DA IDENTIDADE DO CONTATO (fechamento A3.3)
// ═══════════════════════════════════════════════════════════════
// Fonte única da regra de trocar nome/telefone/e-mail de um BusinessCustomer
// pelo painel. Existe para que a regra NÃO fique espalhada na rota.
//
// Fronteiras que este módulo garante:
//
//   • `BusinessCustomer` é o cadastro DA UNIDADE (a ficha da clínica).
//     `Customer` é a conta GLOBAL de login. Trocar telefone/e-mail aqui NÃO
//     altera a identidade global: quem tem acesso continua entrando com o
//     e-mail/telefone da conta, e a carteirinha mostra os dois separados
//     (`accountEmail`/`accountPhone`).
//
//   • Nunca funde pessoas. Se o telefone/e-mail digitado já pertence a OUTRO
//     contato da mesma unidade, a edição é RECUSADA (409) em vez de mover o
//     vínculo ou mesclar fichas por engano — trocar um dado digitado não é
//     dizer "estas duas pessoas são a mesma".
//
// Módulo PURO (sem I/O/DOM): recebe o DB, devolve decisão. Testável.
import { normalizeCustomerEmail, normalizeCustomerPhone, isValidCustomerEmail } from './customer-account';
// A3.4 · Bloco 6 — a régua de telefone é a MESMA da tela e da importação.
import { isValidPhoneBR, phoneError } from './field-quality';
import type { BusinessCustomer, DB } from './types';

export const CONTACT_NAME_MAX = 80;

export type IdentityEdit = {
  /** Ausente (`undefined`) = não mexer. Presente = o novo valor. */
  name?: unknown;
  phone?: unknown;
  email?: unknown;
};

export type IdentityResolution =
  | { ok: true; name: string; phone: string; email: string; changed: string[] }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Valida e normaliza a edição de identidade de um contato.
 *
 * `contact` é o contato que está sendo editado (para excluí-lo da checagem de
 * conflito: o próprio contato sempre "conflita" consigo mesmo).
 */
export function resolveContactIdentity(
  db: Pick<DB, 'contacts'>,
  businessId: string,
  contact: Pick<BusinessCustomer, 'id' | 'name' | 'phone' | 'email'>,
  edit: IdentityEdit,
): IdentityResolution {
  // ── Nome ────────────────────────────────────────────────────────
  const name = edit.name === undefined
    ? String(contact.name || '')
    : String(edit.name ?? '').trim().slice(0, CONTACT_NAME_MAX);
  if (!name) {
    return { ok: false, status: 400, error: 'Informe o nome do cliente.' };
  }

  // ── Telefone ────────────────────────────────────────────────────
  // Ausente = mantém. Presente e vazio = remover o telefone (só se sobrar
  // e-mail, senão a ficha perde a única âncora de identidade).
  const phone = edit.phone === undefined ? normalizeCustomerPhone(contact.phone) : normalizeCustomerPhone(edit.phone);
  if (edit.phone !== undefined && phone && !isValidPhoneBR(phone)) {
    return { ok: false, status: 400, error: phoneError(phone) || 'Telefone inválido.' };
  }

  // ── E-mail ──────────────────────────────────────────────────────
  const email = edit.email === undefined ? normalizeCustomerEmail(contact.email) : normalizeCustomerEmail(edit.email);
  if (edit.email !== undefined && email && !isValidCustomerEmail(email)) {
    return { ok: false, status: 400, error: 'Informe um e-mail válido.' };
  }

  if (!phone && !email) {
    return { ok: false, status: 400, error: 'O cliente precisa de um WhatsApp ou e-mail.' };
  }

  // ── Conflito com OUTRO contato da MESMA unidade ─────────────────
  // Não é dedupe automático: é recusa. Fundir fichas é decisão humana.
  const clash = db.contacts.find((c) => {
    if (c.businessId !== businessId) return false;
    if (c.id === contact.id) return false;
    const samePhone = !!phone && normalizeCustomerPhone(c.phone) === phone;
    const sameEmail = !!email && normalizeCustomerEmail(c.email) === email;
    return samePhone || sameEmail;
  });
  if (clash) {
    const what = phone && normalizeCustomerPhone(clash.phone) === phone ? 'WhatsApp' : 'e-mail';
    return {
      ok: false,
      status: 409,
      error: `Este ${what} já pertence a outro cliente (${clash.name || 'sem nome'}). `
        + 'Abra a ficha dele em vez de mover o dado: assim ninguém é fundido por engano.',
    };
  }

  const changed: string[] = [];
  if (name !== String(contact.name || '')) changed.push('nome');
  if (phone !== normalizeCustomerPhone(contact.phone)) changed.push('telefone');
  if (email !== normalizeCustomerEmail(contact.email)) changed.push('e-mail');

  return { ok: true, name, phone, email, changed };
}
