// ═══════════════════════════════════════════════════════════════
// ESCOPO DE DADOS DO PROFISSIONAL — autoridade ÚNICA (servidor)
// ═══════════════════════════════════════════════════════════════
// Workflow + Permissões. `professionalScope` (access-core) já recortava
// agenda/fila/atendimento. Este módulo estende o MESMO recorte ao CRM:
// Clientes/Tutores, Pets, People 360, busca, Oportunidades, Pendências,
// Conversas e agregados do Visão geral.
//
// REGRA: quem tem `clientes=true` NÃO ganha o CRM inteiro por isso. Um login
// vinculado a um Profissional enxerga somente as pessoas/pets com VÍNCULO REAL
// com o trabalho dele:
//   • Booking atribuído ao profissional (customerId · petId · telefone);
//   • Encounter (registro de atendimento) do profissional (contactId ·
//     customerId · petId);
//   • entrada de fila atribuída ao profissional (contactId · bookingId).
// NUNCA por nome ou e-mail (homônimos). O telefone é a chave de identidade do
// CRM (upsertContact deduplica por ele) e o único elo possível quando o
// Booking não guarda contactId. Tenant primeiro: tudo é filtrado por
// `businessId` ANTES do recorte profissional.
//
// Papéis administrativos (OWNER/ADMIN/MASTER em suporte) e papéis sem vínculo
// com Profissional (Recepção) têm `professionalScope === ''` → escopo da
// unidade (nada muda para eles). Papel PROFISSIONAL SEM vínculo
// (`NO_PROFESSIONAL_SCOPE`) fecha por padrão: não vê pessoa nenhuma.
//
// Módulo PURO (sem I/O): as rotas passam o `db` já lido pelo guard.
import type {
  BusinessCustomer, Conversation, DB, Lead, Pet, Task,
} from './types';
import { NO_PROFESSIONAL_SCOPE } from './access-core';

/** Só o que a decisão precisa do contexto (compatível com AccessContext). */
export interface ScopeCtx {
  professionalScope: string;
  user?: { id: string };
}

const digits = (v: unknown): string => String(v || '').replace(/\D/g, '');
/** Mesma normalização de `phoneKey` (lib/whatsapp): remove DDI 55. */
export function phoneIdentity(v: unknown): string {
  return digits(v).replace(/^55(\d{10,11})$/, '$1');
}

export interface ClinicalLinks {
  /** false = sem recorte (escopo da unidade). */
  restricted: boolean;
  professionalId: string;
  bookingIds: Set<string>;
  encounterIds: Set<string>;
  queueIds: Set<string>;
  contactIds: Set<string>;
  customerIds: Set<string>;
  petIds: Set<string>;
  phones: Set<string>;
}

const UNRESTRICTED: ClinicalLinks = Object.freeze({
  restricted: false, professionalId: '',
  bookingIds: new Set<string>(), encounterIds: new Set<string>(), queueIds: new Set<string>(),
  contactIds: new Set<string>(), customerIds: new Set<string>(),
  petIds: new Set<string>(), phones: new Set<string>(),
}) as ClinicalLinks;

/** O contexto tem recorte de dados por profissional? */
export function isProfessionalScoped(ctx: Pick<ScopeCtx, 'professionalScope'>): boolean {
  return !!ctx.professionalScope;
}

const cache = new WeakMap<DB, Map<string, ClinicalLinks>>();

/**
 * Vínculos clínicos do profissional no tenant. Memoizado por (db, tenant,
 * profissional): o objeto `db` é imutável durante a leitura de uma requisição.
 */
export function clinicalLinks(db: DB, businessId: string, ctx: Pick<ScopeCtx, 'professionalScope'>): ClinicalLinks {
  const scope = ctx.professionalScope || '';
  if (!scope) return UNRESTRICTED;
  const key = `${businessId}|${scope}`;
  let perDb = cache.get(db);
  if (!perDb) { perDb = new Map(); cache.set(db, perDb); }
  const hit = perDb.get(key);
  if (hit) return hit;

  const links: ClinicalLinks = {
    restricted: true, professionalId: scope === NO_PROFESSIONAL_SCOPE ? '' : scope,
    bookingIds: new Set(), encounterIds: new Set(), queueIds: new Set(),
    contactIds: new Set(), customerIds: new Set(), petIds: new Set(), phones: new Set(),
  };
  // Papel de atendimento SEM vínculo: nenhum dado (fecha por padrão).
  if (scope === NO_PROFESSIONAL_SCOPE) { perDb.set(key, links); return links; }

  const addPhone = (p: unknown) => { const k = phoneIdentity(p); if (k) links.phones.add(k); };
  for (const b of db.bookings || []) {
    if (b.businessId !== businessId || b.professionalId !== scope) continue;
    links.bookingIds.add(b.id);
    if (b.customerId) links.customerIds.add(b.customerId);
    if (b.petId) links.petIds.add(b.petId);
    addPhone(b.customerPhone);
  }
  for (const e of db.encounters || []) {
    if (e.businessId !== businessId || e.professionalId !== scope) continue;
    links.encounterIds.add(e.id);
    if (e.bookingId) links.bookingIds.add(e.bookingId);
    if (e.contactId) links.contactIds.add(e.contactId);
    if (e.customerId) links.customerIds.add(e.customerId);
    if (e.petId) links.petIds.add(e.petId);
  }
  for (const q of db.queue || []) {
    if (q.businessId !== businessId || q.professionalId !== scope) continue;
    links.queueIds.add(q.id);
    if (q.bookingId) links.bookingIds.add(q.bookingId);
    if (q.contactId) links.contactIds.add(q.contactId);
    addPhone(q.customerPhone);
  }
  // Pet → tutor (relação real): quem atende o pet conhece o tutor.
  for (const pet of db.pets || []) {
    if (pet.businessId === businessId && links.petIds.has(pet.id) && pet.tutorId) links.contactIds.add(pet.tutorId);
  }
  // Contatos alcançados por conta (customerId) ou telefone (identidade CRM).
  for (const c of db.contacts || []) {
    if (c.businessId !== businessId) continue;
    if (c.customerId && links.customerIds.has(c.customerId)) links.contactIds.add(c.id);
    else if (c.phone && links.phones.has(phoneIdentity(c.phone))) links.contactIds.add(c.id);
  }
  perDb.set(key, links);
  return links;
}

// ── Contatos / Tutores ───────────────────────────────────────

export function canAccessContact(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, contact: Pick<BusinessCustomer, 'id' | 'businessId' | 'customerId' | 'phone'>,
): boolean {
  const links = clinicalLinks(db, contact.businessId, ctx);
  if (!links.restricted) return true;
  return links.contactIds.has(contact.id)
    || (!!contact.customerId && links.customerIds.has(contact.customerId))
    || (!!contact.phone && links.phones.has(phoneIdentity(contact.phone)));
}

export function scopeContacts<T extends Pick<BusinessCustomer, 'id' | 'businessId' | 'customerId' | 'phone'>>(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, contacts: T[],
): T[] {
  if (!ctx.professionalScope) return contacts;
  return contacts.filter((c) => canAccessContact(db, ctx, c));
}

/** Contato por id, DENTRO do tenant e do escopo; `null` = não existe para este login. */
export function accessibleContact(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, businessId: string, contactId: string,
): BusinessCustomer | null {
  const c = (db.contacts || []).find((x) => x.id === contactId && x.businessId === businessId);
  return c && canAccessContact(db, ctx, c) ? c : null;
}

// ── Pets ─────────────────────────────────────────────────────

export function canAccessPet(db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, pet: Pick<Pet, 'id' | 'businessId'>): boolean {
  const links = clinicalLinks(db, pet.businessId, ctx);
  if (!links.restricted) return true;
  return links.petIds.has(pet.id);
}

export function scopePets<T extends Pick<Pet, 'id' | 'businessId'>>(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, pets: T[],
): T[] {
  if (!ctx.professionalScope) return pets;
  return pets.filter((p) => canAccessPet(db, ctx, p));
}

// ── Pessoa 360 (chave de identidade do people360) ────────────

/** A pessoa agregada pelo People 360 está no escopo? (contato · conta · telefone) */
export function canAccessPerson(
  db: DB, businessId: string, ctx: Pick<ScopeCtx, 'professionalScope'>,
  person: { contactId?: string; customerId?: string; phone?: string },
): boolean {
  const links = clinicalLinks(db, businessId, ctx);
  if (!links.restricted) return true;
  return (!!person.contactId && links.contactIds.has(person.contactId))
    || (!!person.customerId && links.customerIds.has(person.customerId))
    || (!!person.phone && links.phones.has(phoneIdentity(person.phone)));
}

// ── Oportunidades (leads) ────────────────────────────────────

export function canAccessLead(db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, lead: Pick<Lead, 'businessId' | 'bookingId' | 'customerId' | 'phone'>): boolean {
  const links = clinicalLinks(db, lead.businessId, ctx);
  if (!links.restricted) return true;
  return (!!lead.bookingId && links.bookingIds.has(lead.bookingId))
    || (!!lead.customerId && links.customerIds.has(lead.customerId))
    || (!!lead.phone && links.phones.has(phoneIdentity(lead.phone)));
}

// ── Conversas ────────────────────────────────────────────────

export function canAccessConversation(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, conv: Pick<Conversation, 'businessId' | 'contactId' | 'customerId' | 'phone'>,
): boolean {
  const links = clinicalLinks(db, conv.businessId, ctx);
  if (!links.restricted) return true;
  return (!!conv.contactId && links.contactIds.has(conv.contactId))
    || (!!conv.customerId && links.customerIds.has(conv.customerId))
    || (!!conv.phone && links.phones.has(phoneIdentity(conv.phone)));
}

// ── Pendências (tasks) ───────────────────────────────────────

export function canAccessTask(db: DB, ctx: ScopeCtx, task: Task): boolean {
  const links = clinicalLinks(db, task.businessId, ctx);
  if (!links.restricted) return true;
  const me = ctx.user?.id || '';
  if (me && (task.assignedUserId === me || task.createdBy === me)) return true;
  if (task.bookingId && links.bookingIds.has(task.bookingId)) return true;
  if (task.encounterId && links.encounterIds.has(task.encounterId)) return true;
  if (task.leadId) {
    const lead = (db.leads || []).find((l) => l.id === task.leadId && l.businessId === task.businessId);
    if (lead && canAccessLead(db, ctx, lead)) return true;
  }
  if (task.customerId) {
    const c = (db.contacts || []).find((x) => (x.id === task.customerId || x.customerId === task.customerId) && x.businessId === task.businessId);
    if (c && canAccessContact(db, ctx, c)) return true;
  }
  return false;
}

// ── Visão do banco para agregados (Visão geral) ──────────────

/**
 * Cópia RASA do documento com as coleções de CRM recortadas pelo escopo do
 * profissional. Serve para agregados (contagens/painéis) que não podem somar
 * o que o login não pode abrir. Só leitura — nunca devolver para `updateDB`.
 * Sem recorte → o MESMO objeto (custo zero para Owner/Admin/Recepção).
 */
export function scopedDbView(db: DB, businessId: string, ctx: ScopeCtx): DB {
  if (!ctx.professionalScope) return db;
  const links = clinicalLinks(db, businessId, ctx);
  const mine = ctx.professionalScope === NO_PROFESSIONAL_SCOPE ? '' : ctx.professionalScope;
  return {
    ...db,
    bookings: (db.bookings || []).filter((b) => b.businessId !== businessId || (!!mine && b.professionalId === mine)),
    encounters: (db.encounters || []).filter((e) => e.businessId !== businessId || (!!mine && e.professionalId === mine)),
    queue: (db.queue || []).filter((q) => q.businessId !== businessId || (!!mine && q.professionalId === mine)),
    contacts: (db.contacts || []).filter((c) => c.businessId !== businessId || canAccessContact(db, ctx, c)),
    pets: (db.pets || []).filter((p) => p.businessId !== businessId || canAccessPet(db, ctx, p)),
    leads: (db.leads || []).filter((l) => l.businessId !== businessId || canAccessLead(db, ctx, l)),
    conversations: (db.conversations || []).filter((c) => c.businessId !== businessId || canAccessConversation(db, ctx, c)),
    tasks: (db.tasks || []).filter((t) => t.businessId !== businessId || canAccessTask(db, ctx, t)),
    // Pedidos do catálogo não têm vínculo clínico: fora do recorte profissional.
    orders: (db.orders || []).filter((o) => o.businessId !== businessId),
    messages: (db.messages || []).filter((m) => {
      if (m.businessId !== businessId) return true;
      const conv = (db.conversations || []).find((c) => c.id === m.conversationId);
      return !!conv && links.restricted && canAccessConversation(db, ctx, conv);
    }),
  };
}
