// ═══════════════════════════════════════════════════════════════
// ESCOPO DE DADOS — autoridade ÚNICA (servidor)
// ═══════════════════════════════════════════════════════════════
// CLINICAL ACCESS: aqui vivem DUAS noções DIFERENTES, e confundi-las foi o
// defeito corrigido nesta fase:
//
//   1. ESCOPO OPERACIONAL — "o que é o MEU trabalho"
//      `operationalScope`: agenda, fila e atendimentos do profissional
//      vinculado, mais os vínculos reais (booking/encounter/queue/telefone)
//      que governam CRM: Oportunidades, Conversas, Pedidos e Pendências.
//      Continua RESTRITO ao vínculo — paciente da clínica não é carteira
//      particular, mas a agenda de outro profissional também não é minha.
//
//   2. ACESSO CLÍNICO AO PACIENTE — "quais pacientes da minha clínica eu
//      posso consultar clinicamente"
//      `patientAccess`: para um Professional ATIVO vinculado, a base de
//      pacientes é a UNIDADE inteira (mesmo `businessId`): ele localiza,
//      abre e LÊ o histórico clínico longitudinal de qualquer paciente —
//      inclusive registros produzidos por outros profissionais — para
//      continuidade assistencial. Papel PROFISSIONAL SEM vínculo
//      (`NO_PROFESSIONAL_SCOPE`) continua fechando por padrão: sem vínculo,
//      sem leitura clínica.
//
// A separação NÃO concede, por si só, escrita clínica (o contrato F1 continua
// mandando: só o profissional responsável edita o próprio Encounter) nem
// módulos comerciais (Conversas/WhatsApp, Oportunidades, marketing, gasto,
// pedidos, financeiro). Papéis administrativos e a Recepção seguem com o
// comportamento que já tinham: escopo da unidade, sem identidade clínica
// automática.
//
// Módulo PURO (sem I/O): as rotas passam o `db` já lido pelo guard.
import type {
  BusinessCustomer, Conversation, DB, Lead, Pet, Task,
} from './types';
import { NO_PROFESSIONAL_SCOPE } from './access-core';

// Reexportado para os consumidores do escopo (rotas/testes) lerem a sentinela
// do MESMO lugar de onde sai a decisão de acesso clínico.
export { NO_PROFESSIONAL_SCOPE } from './access-core';

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

// ── 1 · ESCOPO OPERACIONAL ("o que é meu trabalho") ──────────
export interface OperationalScope {
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

/** Compatibilidade: o nome antigo designava exatamente o escopo operacional. */
export type ClinicalLinks = OperationalScope;

const UNRESTRICTED: OperationalScope = Object.freeze({
  restricted: false, professionalId: '',
  bookingIds: new Set<string>(), encounterIds: new Set<string>(), queueIds: new Set<string>(),
  contactIds: new Set<string>(), customerIds: new Set<string>(),
  petIds: new Set<string>(), phones: new Set<string>(),
}) as OperationalScope;

/** O contexto tem recorte de dados por profissional? */
export function isProfessionalScoped(ctx: Pick<ScopeCtx, 'professionalScope'>): boolean {
  return !!ctx.professionalScope;
}

const cache = new WeakMap<DB, Map<string, OperationalScope>>();

/**
 * Vínculos OPERACIONAIS do profissional no tenant: agendamentos, registros de
 * atendimento e entradas de fila atribuídos a ele, mais as pessoas/pets/telefones
 * alcançados por esse trabalho. É o que decide AGENDA, FILA, PENDÊNCIAS,
 * OPORTUNIDADES e CONVERSAS — nunca a leitura clínica do paciente.
 * Memoizado por (db, tenant, profissional): o `db` é imutável durante a leitura.
 */
export function operationalScope(db: DB, businessId: string, ctx: Pick<ScopeCtx, 'professionalScope'>): OperationalScope {
  const scope = ctx.professionalScope || '';
  if (!scope) return UNRESTRICTED;
  const key = `${businessId}|${scope}`;
  let perDb = cache.get(db);
  if (!perDb) { perDb = new Map(); cache.set(db, perDb); }
  const hit = perDb.get(key);
  if (hit) return hit;

  const links: OperationalScope = {
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

/** Nome histórico do escopo operacional (compatibilidade de import). */
export const clinicalLinks = operationalScope;

// ── 2 · ACESSO CLÍNICO AO PACIENTE ("pacientes da minha clínica") ──
export type PatientAccessLevel = 'unit' | 'none';

export interface PatientAccess {
  /**
   * 'unit' = o login pode consultar clinicamente os pacientes do tenant
   * (escopo da unidade, ou Professional ATIVO vinculado).
   * 'none'  = papel de atendimento SEM vínculo: fechado por padrão.
   */
  level: PatientAccessLevel;
  /** Profissional vinculado ('' quando não há vínculo). */
  professionalId: string;
}

export function patientAccess(ctx: Pick<ScopeCtx, 'professionalScope'>): PatientAccess {
  const scope = ctx.professionalScope || '';
  if (!scope) return { level: 'unit', professionalId: '' };
  if (scope === NO_PROFESSIONAL_SCOPE) return { level: 'none', professionalId: '' };
  return { level: 'unit', professionalId: scope };
}

/** O login lê o prontuário/registro clínico de pacientes deste tenant? */
export function canReadClinicalRecords(ctx: Pick<ScopeCtx, 'professionalScope'>): boolean {
  return patientAccess(ctx).level === 'unit';
}

// O `professionalScope` é derivado POR UNIDADE (access-core). O helper confere
// que o profissional realmente existe NAQUELE tenant antes de liberar leitura:
// um id de escopo não atravessa `businessId` nem por engano de chamador.
const tenantGuardCache = new WeakMap<DB, Map<string, boolean>>();
function professionalBelongsToTenant(db: DB, businessId: string, professionalId: string): boolean {
  const key = `${businessId}|${professionalId}`;
  let perDb = tenantGuardCache.get(db);
  if (!perDb) { perDb = new Map(); tenantGuardCache.set(db, perDb); }
  const hit = perDb.get(key);
  if (hit !== undefined) return hit;
  const ok = (db.professionals || []).some((p) =>
    p.businessId === businessId && p.id === professionalId && p.active !== false);
  perDb.set(key, ok);
  return ok;
}

export interface ClinicalPatientBase {
  contactIds: Set<string>;
  customerIds: Set<string>;
  phones: Set<string>;
  petIds: Set<string>;
}

const baseCache = new WeakMap<DB, Map<string, ClinicalPatientBase>>();

/**
 * Base de PACIENTES CLÍNICOS do tenant: pessoas com pegada clínica (pet,
 * agendamento ou atendimento) e todos os pets da unidade. É o universo de
 * leitura do Professional — CRM puro (contato só de conversa/campanha, sem
 * paciente) fica de fora. Tenant primeiro: nada de outro `businessId`.
 */
export function clinicalPatientBase(db: DB, businessId: string): ClinicalPatientBase {
  let perDb = baseCache.get(db);
  if (!perDb) { perDb = new Map(); baseCache.set(db, perDb); }
  const hit = perDb.get(businessId);
  if (hit) return hit;

  const base: ClinicalPatientBase = {
    contactIds: new Set(), customerIds: new Set(), phones: new Set(), petIds: new Set(),
  };
  const addPhone = (p: unknown) => { const k = phoneIdentity(p); if (k) base.phones.add(k); };
  const addContact = (id: unknown) => { if (id) base.contactIds.add(String(id)); };
  const addCustomer = (id: unknown) => { if (id) base.customerIds.add(String(id)); };

  for (const pet of db.pets || []) {
    if (pet.businessId !== businessId) continue;
    base.petIds.add(pet.id);
    addContact(pet.tutorId);
  }
  for (const b of db.bookings || []) {
    if (b.businessId !== businessId) continue;
    addCustomer(b.customerId);
    addPhone(b.customerPhone);
    if (b.petId) base.petIds.add(b.petId);
  }
  for (const e of db.encounters || []) {
    if (e.businessId !== businessId) continue;
    addContact(e.contactId);
    addCustomer(e.customerId);
    if (e.petId) base.petIds.add(e.petId);
  }
  // Alias da MESMA pessoa: contatos que compartilham conta ou telefone da
  // pegada clínica (o cadastro pode ter sido dividido — nenhum evento é
  // reescrito, só reconhecido). Duas passadas fecham pet → tutor → aliases.
  const unitContacts = (db.contacts || []).filter((c) => c.businessId === businessId);
  for (let pass = 0; pass < 2; pass++) {
    for (const c of unitContacts) {
      const reachable = base.contactIds.has(c.id)
        || (!!c.customerId && base.customerIds.has(c.customerId))
        || (!!c.phone && base.phones.has(phoneIdentity(c.phone)));
      if (!reachable) continue;
      base.contactIds.add(c.id);
      addCustomer(c.customerId);
      addPhone(c.phone);
    }
  }
  perDb.set(businessId, base);
  return base;
}

function contactInClinicalBase(
  db: DB, contact: Pick<BusinessCustomer, 'id' | 'businessId' | 'customerId' | 'phone'>,
): boolean {
  const base = clinicalPatientBase(db, contact.businessId);
  return base.contactIds.has(contact.id)
    || (!!contact.customerId && base.customerIds.has(contact.customerId))
    || (!!contact.phone && base.phones.has(phoneIdentity(contact.phone)));
}

// ── Contatos / Tutores — LEITURA clínica ─────────────────────
// A leitura acompanha o ACESSO CLÍNICO (unidade inteira para o Professional
// vinculado). A ESCRITA continua governada pelo vínculo operacional em
// `isLinkedContact` — ler o tutor do paciente não é administrar o CRM dele.

export function canReadContact(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, contact: Pick<BusinessCustomer, 'id' | 'businessId' | 'customerId' | 'phone'>,
): boolean {
  const access = patientAccess(ctx);
  if (access.level === 'none') return false;
  if (!access.professionalId) return true; // escopo da unidade: comportamento preservado
  if (!professionalBelongsToTenant(db, contact.businessId, access.professionalId)) return false;
  return contactInClinicalBase(db, contact);
}

/** Compatibilidade histórica: `canAccessContact` designa a leitura clínica. */
export const canAccessContact = canReadContact;

export function scopeReadableContacts<T extends Pick<BusinessCustomer, 'id' | 'businessId' | 'customerId' | 'phone'>>(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, contacts: T[],
): T[] {
  if (!isProfessionalScoped(ctx)) return contacts;
  return contacts.filter((c) => canReadContact(db, ctx, c));
}

/** Compatibilidade histórica: `scopeContacts` designa a leitura clínica. */
export const scopeContacts = scopeReadableContacts;

/** Vínculo OPERACIONAL com o contato (agendamento/atendimento/fila). */
export function isLinkedContact(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, contact: Pick<BusinessCustomer, 'id' | 'businessId' | 'customerId' | 'phone'>,
): boolean {
  const links = operationalScope(db, contact.businessId, ctx);
  if (!links.restricted) return true;
  return links.contactIds.has(contact.id)
    || (!!contact.customerId && links.customerIds.has(contact.customerId))
    || (!!contact.phone && links.phones.has(phoneIdentity(contact.phone)));
}

/** Contato por id, DENTRO do tenant e do ACESSO CLÍNICO; `null` = não existe para este login. */
export function accessibleContact(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, businessId: string, contactId: string,
): BusinessCustomer | null {
  const c = (db.contacts || []).find((x) => x.id === contactId && x.businessId === businessId);
  return c && canReadContact(db, ctx, c) ? c : null;
}

// ── Pets / Pacientes — LEITURA clínica ───────────────────────

export function canReadPet(db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, pet: Pick<Pet, 'id' | 'businessId'>): boolean {
  const access = patientAccess(ctx);
  if (access.level === 'none') return false;
  if (!access.professionalId) return true;
  if (!professionalBelongsToTenant(db, pet.businessId, access.professionalId)) return false;
  return clinicalPatientBase(db, pet.businessId).petIds.has(pet.id);
}

/** Compatibilidade histórica: `canAccessPet` designa a leitura clínica. */
export const canAccessPet = canReadPet;

export function scopeReadablePets<T extends Pick<Pet, 'id' | 'businessId'>>(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, pets: T[],
): T[] {
  if (!isProfessionalScoped(ctx)) return pets;
  return pets.filter((p) => canReadPet(db, ctx, p));
}

/** Compatibilidade histórica: `scopePets` designa a leitura clínica. */
export const scopePets = scopeReadablePets;

/** Vínculo OPERACIONAL com o pet (pet de agendamento/atendimento próprio). */
export function isLinkedPet(db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, pet: Pick<Pet, 'id' | 'businessId'>): boolean {
  const links = operationalScope(db, pet.businessId, ctx);
  if (!links.restricted) return true;
  return links.petIds.has(pet.id);
}

// ── Pessoa 360 (chave de identidade do people360) — LEITURA clínica ──

/** A pessoa agregada pelo People 360 está no acesso clínico? (contato · conta · telefone) */
export function canReadPerson(
  db: DB, businessId: string, ctx: Pick<ScopeCtx, 'professionalScope'>,
  person: { contactId?: string; customerId?: string; phone?: string },
): boolean {
  const access = patientAccess(ctx);
  if (access.level === 'none') return false;
  if (!access.professionalId) return true;
  if (!professionalBelongsToTenant(db, businessId, access.professionalId)) return false;
  const base = clinicalPatientBase(db, businessId);
  return (!!person.contactId && base.contactIds.has(person.contactId))
    || (!!person.customerId && base.customerIds.has(person.customerId))
    || (!!person.phone && base.phones.has(phoneIdentity(person.phone)));
}

/** Compatibilidade histórica: `canAccessPerson` designa a leitura clínica. */
export const canAccessPerson = canReadPerson;

// ── Oportunidades (leads) — VÍNCULO operacional (não é acesso clínico) ──

export function canAccessLead(db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, lead: Pick<Lead, 'businessId' | 'bookingId' | 'customerId' | 'phone'>): boolean {
  const links = operationalScope(db, lead.businessId, ctx);
  if (!links.restricted) return true;
  return (!!lead.bookingId && links.bookingIds.has(lead.bookingId))
    || (!!lead.customerId && links.customerIds.has(lead.customerId))
    || (!!lead.phone && links.phones.has(phoneIdentity(lead.phone)));
}

// ── Conversas — VÍNCULO operacional (WhatsApp não vem com o acesso clínico) ──

export function canAccessConversation(
  db: DB, ctx: Pick<ScopeCtx, 'professionalScope'>, conv: Pick<Conversation, 'businessId' | 'contactId' | 'customerId' | 'phone'>,
): boolean {
  const links = operationalScope(db, conv.businessId, ctx);
  if (!links.restricted) return true;
  return (!!conv.contactId && links.contactIds.has(conv.contactId))
    || (!!conv.customerId && links.customerIds.has(conv.customerId))
    || (!!conv.phone && links.phones.has(phoneIdentity(conv.phone)));
}

// ── Pendências (tasks) — VÍNCULO operacional: pendência não é prontuário ──

export function canAccessTask(db: DB, ctx: ScopeCtx, task: Task): boolean {
  const links = operationalScope(db, task.businessId, ctx);
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
    if (c && isLinkedContact(db, ctx, c)) return true;
  }
  return false;
}

// ── Visão do banco para agregados OPERACIONAIS (Visão geral) ──

/**
 * Cópia RASA do documento com as coleções de CRM recortadas pelo ESCOPO
 * OPERACIONAL do profissional. Serve para agregados (contagens/painéis) que
 * não podem somar o que o login não pode abrir — a leitura clínica do paciente
 * NÃO muda estes números. Só leitura — nunca devolver para `updateDB`.
 * Sem recorte → o MESMO objeto (custo zero para Owner/Admin/Recepção).
 */
export function scopedDbView(db: DB, businessId: string, ctx: ScopeCtx): DB {
  if (!ctx.professionalScope) return db;
  const links = operationalScope(db, businessId, ctx);
  const mine = ctx.professionalScope === NO_PROFESSIONAL_SCOPE ? '' : ctx.professionalScope;
  return {
    ...db,
    bookings: (db.bookings || []).filter((b) => b.businessId !== businessId || (!!mine && b.professionalId === mine)),
    encounters: (db.encounters || []).filter((e) => e.businessId !== businessId || (!!mine && e.professionalId === mine)),
    queue: (db.queue || []).filter((q) => q.businessId !== businessId || (!!mine && q.professionalId === mine)),
    contacts: (db.contacts || []).filter((c) => c.businessId !== businessId || isLinkedContact(db, ctx, c)),
    pets: (db.pets || []).filter((p) => p.businessId !== businessId || isLinkedPet(db, ctx, p)),
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
