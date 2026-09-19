// Operações de identidade para contas do consumidor criadas pela equipe.
// Este módulo não é usado pelo cadastro público: ele só apoia a porta
// administrativa de Clientes e mantém a conta Customer separada do contato.
import { randomBytes } from 'node:crypto';
import type { Customer, DB } from './types';
import { onlyDigits } from './utils';

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function normalizeCustomerEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase().slice(0, 120);
}

export function isValidCustomerEmail(value: unknown): boolean {
  const email = normalizeCustomerEmail(value);
  return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeCustomerPhone(value: unknown): string {
  return onlyDigits(String(value || ''));
}

export function isValidCustomerPhone(value: unknown): boolean {
  const phone = normalizeCustomerPhone(value);
  return phone.length >= 10 && phone.length <= 15;
}

/**
 * Senha temporária de uso único no fluxo administrativo.
 * O valor puro só existe no retorno da requisição que a criou; apenas o hash
 * é gravado no Customer. O alfabeto evita caracteres ambíguos e símbolos que
 * costumam quebrar cópia/cola.
 */
export function generateTemporaryPassword(length = 16): string {
  const size = Math.max(12, Math.min(64, Math.floor(length)));
  const bytes = randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i += 1) out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  return out;
}

export function customersMatchingIdentity(
  db: Pick<DB, 'customers'>,
  phone: string,
  email: string,
): Customer[] {
  const digits = normalizeCustomerPhone(phone);
  const cleanEmail = normalizeCustomerEmail(email);
  return db.customers.filter((customer) =>
    (digits && normalizeCustomerPhone(customer.phone) === digits) ||
    (cleanEmail && normalizeCustomerEmail(customer.email) === cleanEmail),
  );
}
