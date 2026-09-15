// Relação Customer × Business ("contato"): uma pessoa faz parte da base de
// contatos de um negócio. A conta (Customer) é GLOBAL; o contato é
// contextual. Upsert idempotente por customerId OU telefone normalizado —
// nunca cria duplicado. Preserva a lógica histórica de dedupe por telefone.
import { randomUUID } from 'node:crypto';
import { onlyDigits } from './utils';
import type { BusinessCustomer, ContactNote, DB } from './types';

export interface ContactInput {
  businessId: string;
  customerId?: string; // '' = sem conta (guest/legado)
  name?: string;
  phone?: string;
  email?: string;
  source?: string; // signup | login | google | agendamento | pedido | lead | ...
  marketingOptIn?: boolean;
  now?: string; // permite "voltar no tempo" na migração
}

/** Chave de dedupe: conta primeiro, depois telefone. */
export function contactKey(customerId: string, phone: string): string {
  const digits = onlyDigits(phone || '');
  if (customerId) return `c:${customerId}`;
  if (digits) return `p:${digits}`;
  return '';
}

export function findContact(db: DB, businessId: string, customerId: string, phone: string, name = ''): BusinessCustomer | undefined {
  const digits = onlyDigits(phone || '');
  return db.contacts.find(
    (c) =>
      c.businessId === businessId &&
      ((customerId && c.customerId === customerId) ||
        (digits && onlyDigits(c.phone) === digits) ||
        // Só agrupa "só nome" quando os DOIS lados não têm telefone/conta.
        (!customerId && !digits && !!name && !c.customerId && !onlyDigits(c.phone) && c.name === name)),
  );
}

/** UPSERT de contato (nunca duplica). Retorna o contato. */
export function upsertContact(db: DB, input: ContactInput): BusinessCustomer | null {
  const digits = onlyDigits(input.phone || '');
  const name = (input.name || '').trim().slice(0, 80);
  if (!input.customerId && !digits && !name) return null;

  const existing = findContact(db, input.businessId, input.customerId || '', input.phone || '', name);

  if (existing) {
    // Promove guest (phone-only) para conta quando o customerId aparece.
    if (input.customerId && !existing.customerId) existing.customerId = input.customerId;
    if (name) existing.name = name;
    if (digits) existing.phone = digits;
    if (input.email?.trim()) existing.email = input.email.trim().toLowerCase().slice(0, 120);
    if (input.source && !existing.source) existing.source = input.source;
    if (input.marketingOptIn !== undefined) existing.marketingOptIn = input.marketingOptIn === true;
    existing.lastInteraction = input.now || new Date().toISOString();
    existing.updatedAt = input.now || new Date().toISOString();
    return existing;
  }

  const now = input.now || new Date().toISOString();
  const contact: BusinessCustomer = {
    id: randomUUID(),
    businessId: input.businessId,
    customerId: input.customerId || '',
    name,
    phone: digits,
    email: (input.email || '').trim().toLowerCase().slice(0, 120),
    createdAt: now,
    updatedAt: now,
    source: input.source || 'interaction',
    lastInteraction: now,
    marketingOptIn: input.marketingOptIn === true,
  };
  db.contacts.push(contact);
  return contact;
}

/**
 * Migração defensiva (idempotente): cria contatos para pessoas que já
 * possuem pedidos/agendamentos/leads, sem duplicar por telefone e usando
 * customerId quando disponível. Nada é apagado.
 */
export function backfillContacts(db: DB): void {
  if (!Array.isArray(db.contacts)) db.contacts = [];
  const bizIds = new Set(db.businesses.map((b) => b.id));

  type Row = { businessId: string; customerId: string; name: string; phone: string; email: string; source: string; at: string };
  const rows: Row[] = [];

  for (const o of db.orders) if (bizIds.has(o.businessId)) {
    rows.push({ businessId: o.businessId, customerId: o.customerId || '', name: o.customerName, phone: o.customerPhone, email: '', source: 'pedido', at: o.createdAt });
  }
  for (const b of db.bookings) if (bizIds.has(b.businessId)) {
    rows.push({ businessId: b.businessId, customerId: b.customerId || '', name: b.customerName, phone: b.customerPhone, email: '', source: 'agendamento', at: b.createdAt });
  }
  for (const l of db.leads) if (bizIds.has(l.businessId)) {
    rows.push({ businessId: l.businessId, customerId: l.customerId || '', name: l.name, phone: l.phone, email: l.email, source: l.origin || 'lead', at: l.createdAt });
  }

  // Do mais antigo ao mais novo: createdAt fica no primeiro, lastInteraction no último.
  rows.sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const r of rows) {
    upsertContact(db, {
      businessId: r.businessId, customerId: r.customerId, name: r.name,
      phone: r.phone, email: r.email, source: r.source, now: r.at,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// OBSERVAÇÕES DO CLIENTE (P2) — APPEND-ONLY
// ═══════════════════════════════════════════════════════════════
// Regras:
//   • observação nova NUNCA sobrescreve nem apaga as anteriores;
//   • cada registro guarda QUEM escreveu, QUANDO escreveu e o TEXTO;
//   • o contexto (agendamento) é gravado quando existir;
//   • o campo legado `Contact.note` (texto único) continua intacto e é
//     exibido como "registro anterior" — nada é migrado destrutivamente.
export const NOTE_MAX_LEN = 1000;

export interface VisibleNote extends ContactNote {
  /** true = veio do campo legado `note` (sem autor/data confiáveis). */
  legacy?: boolean;
}

/** Observações visíveis (legado primeiro, depois as novas em ordem de escrita). */
export function contactNotes(c: Pick<BusinessCustomer, 'id' | 'note' | 'notes' | 'createdAt'>): VisibleNote[] {
  const out: VisibleNote[] = [];
  const legacy = String(c.note || '').trim();
  if (legacy) {
    out.push({ id: `legacy-${c.id || 'note'}`, at: c.createdAt || '', by: '', byName: '', text: legacy, legacy: true });
  }
  for (const n of Array.isArray(c.notes) ? c.notes : []) {
    if (!n || typeof n.text !== 'string' || !n.text.trim()) continue;
    out.push({ ...n, text: n.text.slice(0, NOTE_MAX_LEN) });
  }
  return out;
}

/**
 * Acrescenta uma observação (append-only). Retorna `null` quando o texto é
 * vazio — nunca gravamos registro vazio nem apagamos nada.
 */
export function addContactNote(
  c: BusinessCustomer,
  input: { text: string; by?: string; byName?: string; at?: string; bookingId?: string },
): ContactNote | null {
  const text = String(input.text || '').trim().slice(0, NOTE_MAX_LEN);
  if (!text) return null;
  if (!Array.isArray(c.notes)) c.notes = [];
  const note: ContactNote = {
    id: randomUUID(),
    at: input.at || new Date().toISOString(),
    by: input.by || '',
    byName: String(input.byName || '').slice(0, 80),
    text,
  };
  if (input.bookingId) note.bookingId = String(input.bookingId).slice(0, 64);
  c.notes.push(note);
  c.updatedAt = note.at;
  c.lastInteraction = note.at;
  return note;
}

export interface PublicContact {
  id: string;
  businessId: string;
  customerId: string;
  name: string;
  phone: string;
  email: string;
  createdAt: string;
  source: string;
  lastInteraction: string;
  marketingOptIn: boolean;
}

export function publicContact(c: BusinessCustomer): PublicContact {
  return {
    id: c.id, businessId: c.businessId, customerId: c.customerId,
    name: c.name, phone: c.phone, email: c.email,
    createdAt: c.createdAt, source: c.source,
    lastInteraction: c.lastInteraction, marketingOptIn: c.marketingOptIn,
  };
}
