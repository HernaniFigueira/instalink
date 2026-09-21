// ═══════════════════════════════════════════════════════════════
// Mapeamento linha ↔ domínio (núcleo operacional da agenda).
// ═══════════════════════════════════════════════════════════════
// Regra: o domínio (lib/types.ts) NÃO muda. As linhas do Postgres são
// convertidas para os MESMOS objetos que o resto do produto já consome —
// motores puros (computeSlots, resolveProfessional, automations) continuam
// recebendo exatamente os mesmos tipos de antes.
import type {
  Availability, AvailabilityException, Booking, Business, Professional, Service,
} from '../types';
import { defaultBookingConfig } from '../types';

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v || ''));
const dateISO = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || ''));
const clock = (v: unknown): string => {
  // time do PG: '09:30:00' → '09:30' (o domínio compara 'HH:MM')
  const s = String(v || '');
  return s.length >= 5 ? s.slice(0, 5) : s;
};
const minutesOf = (v: unknown): number => {
  const s = clock(v);
  const [h, m] = s.split(':');
  return (Number(h || 0) * 60) + Number(m || 0);
};
const nullable = (v: string): string | null => (v ? v : null);

// ── Booking ──────────────────────────────────────────────────
export function rowToBooking(r: any): Booking {
  const b: Booking = {
    id: String(r.id),
    businessId: String(r.business_id),
    customerId: r.customer_id ? String(r.customer_id) : '',
    serviceId: String(r.service_id),
    professionalId: r.professional_id ? String(r.professional_id) : '',
    date: dateISO(r.date),
    time: clock(r.time),
    customerName: String(r.customer_name || ''),
    customerPhone: String(r.customer_phone || ''),
    status: r.status,
    note: String(r.note || ''),
    answers: Array.isArray(r.answers) ? r.answers.map(String) : [],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    history: Array.isArray(r.history) ? r.history : [],
    rescheduleCount: Number(r.reschedule_count || 0),
  };
  if (r.previous_id) b.previousId = String(r.previous_id);
  if (r.lead_id) b.leadId = String(r.lead_id);
  if (r.series_id) b.seriesId = String(r.series_id);
  if (r.series_index != null) b.seriesIndex = Number(r.series_index);
  if (r.series_count != null) b.seriesCount = Number(r.series_count);
  if (r.series_request_id) b.seriesRequestId = String(r.series_request_id);
  if (r.series_fingerprint) b.seriesFingerprint = String(r.series_fingerprint);
  if (r.booking_kind && r.booking_kind !== 'standard') b.bookingKind = r.booking_kind;
  if (r.checked_in_at) b.checkedInAt = iso(r.checked_in_at);
  if (r.checked_in_by) b.checkedInBy = String(r.checked_in_by);
  if (r.checked_in_by_name) b.checkedInByName = String(r.checked_in_by_name);
  return b;
}

export function bookingToRow(b: Booking, durationMin: number): Record<string, unknown> {
  const startMin = minutesOf(b.time);
  return {
    id: b.id,
    business_id: b.businessId,
    customer_id: nullable(b.customerId),
    service_id: b.serviceId,
    professional_id: nullable(b.professionalId),
    date: b.date,
    time: b.time,
    start_min: startMin,
    end_min: startMin + Math.max(1, durationMin),
    customer_name: b.customerName,
    customer_phone: b.customerPhone,
    status: b.status,
    note: b.note,
    answers: JSON.stringify(b.answers || []),
    created_at: b.createdAt,
    updated_at: b.updatedAt,
    history: JSON.stringify(b.history || []),
    previous_id: nullable(b.previousId || ''),
    reschedule_count: b.rescheduleCount || 0,
    lead_id: nullable(b.leadId || ''),
    series_id: nullable(b.seriesId || ''),
    series_index: b.seriesIndex ?? null,
    series_count: b.seriesCount ?? null,
    series_request_id: nullable(b.seriesRequestId || ''),
    series_fingerprint: nullable(b.seriesFingerprint || ''),
    booking_kind: b.bookingKind === 'fit_in' ? 'fit_in' : 'standard',
    checked_in_at: b.checkedInAt ? b.checkedInAt : null,
    checked_in_by: b.checkedInBy || null,
    checked_in_by_name: b.checkedInByName || null,
  };
}

// ── Service / Professional / Availability / Exception ─────────
export function rowToService(r: any): Service {
  return {
    id: String(r.id),
    businessId: String(r.business_id),
    categoryId: String(r.category_id || ''),
    name: String(r.name || ''),
    description: String(r.description || ''),
    image: String(r.image || ''),
    price: Number(r.price || 0),
    showPrice: r.show_price !== false,
    durationMin: Number(r.duration_min || 30),
    professionalIds: Array.isArray(r.professional_ids) ? r.professional_ids.map(String) : [],
    active: r.active !== false,
    featured: r.featured === true,
    bookable: r.bookable !== false,
    questions: Array.isArray(r.questions) ? r.questions.map(String) : [],
  };
}

export function rowToProfessional(r: any): Professional {
  const p: Professional = {
    id: String(r.id),
    businessId: String(r.business_id),
    name: String(r.name || ''),
    role: String(r.role || ''),
    photo: String(r.photo || ''),
    active: r.active !== false,
  };
  if (r.user_id) p.userId = String(r.user_id);
  if (typeof r.follow_business_hours === 'boolean') p.followBusinessHours = r.follow_business_hours;
  return p;
}

export function rowToAvailability(r: any): Availability {
  return {
    id: String(r.id),
    businessId: String(r.business_id),
    professionalId: r.professional_id ? String(r.professional_id) : '',
    serviceId: r.service_id ? String(r.service_id) : '',
    weekday: Number(r.weekday),
    start: clock(r.start),
    end: clock(r.end),
    slotMin: Number(r.slot_min || 30),
  };
}

export function rowToException(r: any): AvailabilityException {
  return {
    id: String(r.id),
    businessId: String(r.business_id),
    date: dateISO(r.date),
    closed: r.closed === true,
    start: String(r.start || ''),
    end: String(r.end || ''),
    note: String(r.note || ''),
  };
}

/** Linha businesses → o subconjunto de Business que a agenda consome. */
export function rowToBusinessCore(r: any): Pick<Business, 'id' | 'organizationId' | 'ownerId' | 'name' | 'booking' | 'businessTimezone' | 'automations' | 'capabilityFlags' | 'modes' | 'features'> {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    ownerId: String(r.owner_id),
    name: String(r.name || ''),
    booking: { ...defaultBookingConfig(), ...(r.booking && typeof r.booking === 'object' ? r.booking : {}) },
    businessTimezone: r.business_timezone ? String(r.business_timezone) : undefined,
    automations: (r.automations && typeof r.automations === 'object') ? r.automations : {},
    capabilityFlags: (r.capability_flags && typeof r.capability_flags === 'object') ? r.capability_flags : {},
    modes: Array.isArray(r.modes) ? r.modes : [],
    features: (r.features && typeof r.features === 'object') ? r.features : undefined,
  };
}
