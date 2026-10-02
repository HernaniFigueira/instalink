import type { Booking } from './types';

/** Apply only a server-confirmed temporal echo to the already visible booking.
 * Identity/tenant are taken from the existing row, never from the browser.
 * Outside the loaded date range, remove it; focus revalidation still fetches
 * other sessions normally. No speculative changes while a PATCH is pending. */
export function applyBookingTemporalPatch(
  rows: Booking[],
  patch: Partial<Booking> & Pick<Booking, 'id'>,
  range: { from: string; to: string },
): Booking[] {
  return rows.flatMap((row) => {
    if (row.id !== patch.id) return [row];
    if (patch.businessId && patch.businessId !== row.businessId) return [row];
    const updated = { ...row, ...patch, businessId: row.businessId };
    return updated.date >= range.from && updated.date <= range.to ? [updated] : [];
  });
}
