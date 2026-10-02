import type { Booking, BookingConfig, ScheduleBlock, ScheduleResource, Service } from './types';

export const bufferPair = (service: Service | undefined, config: Pick<BookingConfig, 'bufferMin' | 'bufferBeforeMin' | 'bufferAfterMin'>) => ({
  before: service?.bufferBeforeMin ?? config.bufferBeforeMin ?? 0,
  after: service?.bufferAfterMin ?? config.bufferAfterMin ?? config.bufferMin ?? 0,
});

/** Existing Booking authority: frozen fields win individually; legacy fields inherit
 * the policy of THAT Booking's service, never the candidate service. */
export function bookingBufferPair(
  booking: Pick<Booking, 'bufferBeforeMin' | 'bufferAfterMin'>,
  service: Service | undefined,
  config: Pick<BookingConfig, 'bufferMin' | 'bufferBeforeMin' | 'bufferAfterMin'>,
) {
  const policy = bufferPair(service, config);
  return {
    before: booking.bufferBeforeMin ?? policy.before,
    after: booking.bufferAfterMin ?? policy.after,
  };
}

/** Absolute effective resource/block occupancy, excluding visual Booking duration. */
export function bookingOccupiedRange(
  booking: Booking,
  service: Service | undefined,
  config: Pick<BookingConfig, 'bufferMin' | 'bufferBeforeMin' | 'bufferAfterMin'>,
): { start: number; end: number } | null {
  if (!booking.startAt || !booking.endAt) return null;
  const start = Date.parse(booking.startAt), end = Date.parse(booking.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const pair = bookingBufferPair(booking, service, config);
  return { start: start - pair.before * 60000, end: end + pair.after * 60000 };
}

export const overlaps = (a: number, b: number, c: number, d: number) => a < d && b > c;

/** Hard operational blocks are independent from exceptions and cannot be bypassed by fit-in. */
export function blockConflict(blocks: ScheduleBlock[], businessId: string, professionalId: string, resourceIds: string[], start: number, end: number): boolean {
  return blocks.some(b => b.businessId === businessId && overlaps(start, end, Date.parse(b.startAt), Date.parse(b.endAt)) &&
    (!b.professionalId && !b.resourceId || !!b.professionalId && b.professionalId === professionalId || !!b.resourceId && resourceIds.includes(b.resourceId)));
}

/** One resource per alternative group; stable across retries, preferring existing assignments. */
export function assignResources(args: {
  requirements: string[][]; resources: ScheduleResource[]; bookings: Booking[];
  services: Service[];
  bookingConfig: Pick<BookingConfig, 'bufferMin' | 'bufferBeforeMin' | 'bufferAfterMin'>;
  blocks: ScheduleBlock[]; businessId: string; start: number; end: number; preferred?: string[];
}): string[] | null {
  const { requirements, resources, bookings, services, bookingConfig, blocks, businessId, start, end, preferred = [] } = args;
  const occupied = new Set<string>();
  for (const resource of resources) {
    if (resource.businessId !== businessId) continue;
    if (blocks.some(block => block.businessId === businessId && block.resourceId === resource.id && overlaps(start, end, Date.parse(block.startAt), Date.parse(block.endAt))) ||
      bookings.some(booking => {
        if (booking.businessId !== businessId || booking.status === 'cancelled' || !booking.resourceIds?.includes(resource.id)) return false;
        const range = bookingOccupiedRange(booking, services.find(s => s.businessId === businessId && s.id === booking.serviceId), bookingConfig);
        return !!range && overlaps(start, end, range.start, range.end);
      })) occupied.add(resource.id);
  }
  const choose = (index: number, selected: string[]): string[] | null => {
    if (index === requirements.length) return selected;
    const options = [...new Set(requirements[index])].filter(id => resources.some(r => r.id === id && r.businessId === businessId && r.active));
    options.sort((a, b) => Number(preferred.includes(b)) - Number(preferred.includes(a)) || a.localeCompare(b));
    for (const id of options) {
      if (occupied.has(id) || selected.includes(id)) continue;
      const result = choose(index + 1, [...selected, id]);
      if (result) return result;
    }
    return null;
  };
  return choose(0, []);
}

/** Persist only missing snapshots on a relevant write, while the old policy is still available. */
export function freezeLegacyBuffers(db: { bookings: Booking[]; services: Service[] }, businessId: string, config: Pick<BookingConfig, 'bufferMin' | 'bufferBeforeMin' | 'bufferAfterMin'>, serviceId?: string): number {
  let frozen = 0;
  for (const booking of db.bookings) {
    if (booking.businessId !== businessId || serviceId && booking.serviceId !== serviceId) continue;
    if (booking.bufferBeforeMin !== undefined && booking.bufferAfterMin !== undefined) continue;
    const pair = bookingBufferPair(booking, db.services.find(s => s.id === booking.serviceId && s.businessId === businessId), config);
    booking.bufferBeforeMin ??= pair.before;
    booking.bufferAfterMin ??= pair.after;
    frozen++;
  }
  return frozen;
}
