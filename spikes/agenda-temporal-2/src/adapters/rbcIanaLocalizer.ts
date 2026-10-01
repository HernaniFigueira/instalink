import { DateTime } from 'luxon';
import { luxonLocalizer } from 'react-big-calendar';
import { requireTimeZone } from '../domain/temporal-contract';

/**
 * RBC's Luxon localizer accepts a DateTime-shaped API. Bind only that factory
 * to this adapter instance's IANA zone instead of mutating Luxon Settings.
 * A localizer can therefore coexist with another tenant's localizer in the
 * same JS realm; the domain still owns conversion to/from canonical instants.
 */
export function createIanaLuxonLocalizer(timeZone: string) {
  const zone = requireTimeZone(timeZone);
  const zonedDateTimeApi = {
    fromJSDate(date: Date, options?: Parameters<typeof DateTime.fromJSDate>[1]) {
      return DateTime.fromJSDate(date, { ...options, zone });
    },
    min(...values: DateTime[]) {
      return DateTime.min(...values);
    },
    max(...values: DateTime[]) {
      return DateTime.max(...values);
    },
    local() {
      return DateTime.now().setZone(zone);
    },
  };

  return luxonLocalizer(zonedDateTimeApi, { firstDayOfWeek: 1 });
}
