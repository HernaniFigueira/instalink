import type { DB } from './types';

/**
 * Fonte canônica de referência histórica para Service/Professional.
 * MÍNIMO: Booking, QueueEntry, Encounter (Encounter pode existir sem Booking, via queueId).
 * Auditado: DB possui serviceId/professionalId em Booking, Queue, Encounter, Finance, Availability, etc.
 * - Availability é configuração, não histórico → não bloqueia.
 * - Lead serviceId é interesse, não operacional → não bloqueia.
 * - Finance é histórico financeiro, mas a regra clínica pede bloqueio operacional/clínico (Booking/Queue/Encounter). Finance não bloqueia hard delete de serviço (poderia preservar, mas não é mandatório do P0).
 */
export function serviceHasHistory(db: DB, businessId: string, serviceId: string): boolean {
  if (!serviceId) return false;
  if (db.bookings.some((b) => b.businessId === businessId && b.serviceId === serviceId)) return true;
  if (db.queue.some((q) => q.businessId === businessId && q.serviceId === serviceId)) return true;
  if (db.encounters?.some?.((e) => e.businessId === businessId && e.serviceId === serviceId)) return true;
  if ((db as any).financeEntries?.some?.((f: any) => f.businessId === businessId && f.serviceId === serviceId)) return true;
  return false;
}

export function professionalHasHistory(db: DB, businessId: string, professionalId: string): boolean {
  if (!professionalId) return false;
  if (db.bookings.some((b) => b.businessId === businessId && b.professionalId === professionalId)) return true;
  if (db.queue.some((q) => q.businessId === businessId && q.professionalId === professionalId)) return true;
  if (db.encounters?.some?.((e) => e.businessId === businessId && e.professionalId === professionalId)) return true;
  if ((db as any).financeEntries?.some?.((f: any) => f.businessId === businessId && f.professionalId === professionalId)) return true;
  if ((db as any).anamneseResponses?.some?.((a: any) => a.businessId === businessId && a.professionalId === professionalId)) return true;
  return false;
}

export function historyRefsForBusiness(db: DB, businessId: string): { services: string[]; professionals: string[] } {
  const services = new Set<string>();
  const professionals = new Set<string>();
  for (const b of db.bookings) {
    if (b.businessId !== businessId) continue;
    if (b.serviceId) services.add(b.serviceId);
    if (b.professionalId) professionals.add(b.professionalId);
  }
  for (const q of db.queue) {
    if (q.businessId !== businessId) continue;
    if (q.serviceId) services.add(q.serviceId);
    if (q.professionalId) professionals.add(q.professionalId);
  }
  for (const e of db.encounters) {
    if (e.businessId !== businessId) continue;
    if (e.serviceId) services.add(e.serviceId);
    if (e.professionalId) professionals.add(e.professionalId);
  }
  for (const f of (db as any).financeEntries || []) {
    if (f.businessId !== businessId) continue;
    if (f.serviceId) services.add(f.serviceId);
    if (f.professionalId) professionals.add(f.professionalId);
  }
  for (const a of (db as any).anamneseResponses || []) {
    if (a.businessId !== businessId) continue;
    if (a.professionalId) professionals.add(a.professionalId);
  }
  return { services: [...services], professionals: [...professionals] };
}
