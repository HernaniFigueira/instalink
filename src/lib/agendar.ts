// ═══════════════════════════════════════════════════════════════
// /AGENDAR + WIDGET — fluxo público de agendamento (A2-B2 · F1)
// ═══════════════════════════════════════════════════════════════
// Módulo PURO do fluxo público autônomo (/agendar, embutido pelo widget
// /widget/booking.js). NÃO inventa uma segunda agenda: reutiliza
//   • lib/public.ts (getPublicData) como fonte canônica dos dados públicos
//     (via /agendar/page.tsx, Server Component);
//   • GET /api/bookings para slots/mapa de dias (mesmo motor computeSlots);
//   • POST /api/bookings + createBookingTx para criar (caminho único);
//   • lib/slot-states para os estados de loading/erro/vazio.
// As validações de verdade continuam 100% no servidor (tenant, serviço,
// bookable, slot, horizonte, leadMin, módulo ligado).
import type { DB, Professional, Service } from './types';
import { addDaysISO, isValidDateISO } from './tz';
import { effectiveHorizonDays } from './booking-ops';

export interface PublicBookingTarget {
  id: string;
  name: string;
  slug: string;
  logo: string;
  whatsapp: string;
  phone: string;
  address: string;
  description: string;
  booking: { horizonDays: number; leadMin: number; cancelUntilMin: number; bufferMin: number } | null;
  published: boolean;
}

/**
 * Resolve o alvo do fluxo por slug OU id (o widget manda `data-business`,
 * que pode ser qualquer um dos dois). Nunca vaza dados além do enxuto público.
 */
export function resolvePublicBookingTarget(db: DB, param: string): { business: PublicBookingTarget; notPublished: boolean } | null {
  const key = String(param || '').trim();
  if (!key) return null;
  const b = db.businesses.find((x) => x.slug === key) || db.businesses.find((x) => x.id === key);
  if (!b) return null;
  return {
    business: {
      id: b.id,
      name: b.name,
      slug: b.slug,
      logo: b.logo || '',
      whatsapp: b.whatsapp || '',
      phone: b.phone || '',
      address: b.address || '',
      description: b.description || '',
      booking: b.booking
        ? {
          horizonDays: Number(b.booking.horizonDays) || 60,
          leadMin: Number(b.booking.leadMin) || 0,
          cancelUntilMin: Number(b.booking.cancelUntilMin) || 0,
          bufferMin: Number(b.booking.bufferMin) || 0,
        }
        : null,
      published: b.published !== false,
    },
    notPublished: b.published === false,
  };
}

/** Serviços válidos para o fluxo público: ativos E aceitam agendamento. */
export function publicBookableServices(db: DB, businessId: string): Service[] {
  return db.services.filter((s) => s.businessId === businessId && s.active !== false && s.bookable !== false);
}

/** Profissionais ativos do negócio (o servidor continua resolvendo o dono do slot). */
export function publicActiveProfessionals(db: DB, businessId: string): Professional[] {
  return db.professionals.filter((p) => p.businessId === businessId && p.active !== false);
}

/**
 * Lista de dias do fluxo público — SEMPRE ancorada no `today` do SERVIDOR
 * (fuso do negócio) e construída por aritmética de calendário (addDaysISO).
 * Nunca por `Date.now() + i*86400000` no fuso do navegador (bug da auditoria
 * corrigido no A2-B5/F9 junto com a timezone por negócio).
 */
export function upcomingDays(today: string, count: number): string[] {
  if (!isValidDateISO(today) || count <= 0) return [];
  const days: string[] = [];
  for (let i = 0; i < count; i += 1) days.push(addDaysISO(today, i));
  return days;
}

/** Horizonte efetivo do fluxo público — MESMA regra do servidor (F5). */
export function publicHorizonDays(cfg: { horizonDays?: number } | null | undefined): number {
  return effectiveHorizonDays(cfg);
}
