import type { Booking, BookingConfig, ScheduleBlock, ScheduleResource, Service } from './types';

export const bufferPair = (service: Service | undefined, config: Pick<BookingConfig, 'bufferMin' | 'bufferBeforeMin' | 'bufferAfterMin'>) => ({
  before: service?.bufferBeforeMin ?? config.bufferBeforeMin ?? 0,
  after: service?.bufferAfterMin ?? config.bufferAfterMin ?? config.bufferMin ?? 0,
});

export const overlaps = (a: number, b: number, c: number, d: number) => a < d && b > c;

/** Hard operational blocks are independent from exceptions and cannot be bypassed by fit-in. */
export function blockConflict(blocks: ScheduleBlock[], businessId: string, professionalId: string, resourceIds: string[], start: number, end: number): boolean {
  return blocks.some(b => b.businessId === businessId && overlaps(start, end, Date.parse(b.startAt), Date.parse(b.endAt)) &&
    (!b.professionalId && !b.resourceId || !!b.professionalId && b.professionalId === professionalId || !!b.resourceId && resourceIds.includes(b.resourceId)));
}

/** One resource per alternative group; stable across retries, preferring existing assignments. */
export function assignResources(args: {
  requirements: string[][]; resources: ScheduleResource[]; bookings: Booking[];
  blocks: ScheduleBlock[]; businessId: string; start: number; end: number; preferred?: string[];
}): string[] | null {
  const { requirements, resources, bookings, blocks, businessId, start, end, preferred = [] } = args;
  const selected: string[] = [];
  for (const group of requirements) {
    const options = [...new Set(group)].filter(id => resources.some(r => r.id === id && r.businessId === businessId && r.active));
    options.sort((a, b) => Number(preferred.includes(b)) - Number(preferred.includes(a)) || a.localeCompare(b));
    const chosen = options.find(id => !selected.includes(id) && !blocks.some(block => block.businessId === businessId && block.resourceId === id && overlaps(start, end, Date.parse(block.startAt), Date.parse(block.endAt))) &&
      !bookings.some(booking => booking.businessId === businessId && booking.status !== 'cancelled' && booking.resourceIds?.includes(id) && booking.startAt && booking.endAt && overlaps(start, end, Date.parse(booking.startAt) - (booking.bufferBeforeMin || 0) * 60000, Date.parse(booking.endAt) + (booking.bufferAfterMin || 0) * 60000)));
    if (!chosen) return null;
    selected.push(chosen);
  }
  return selected;
}
