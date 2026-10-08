import { describe, expect, it } from 'vitest';
import { BOOKING_PAST_TIME_ERROR, bookingPastTimeError } from '../booking-past-time';

describe('bookingPastTimeError', () => {
  const today = '2026-10-08';
  const now = '14:30';

  it('uses one canonical message for an earlier day and an earlier time today', () => {
    expect(bookingPastTimeError('2026-10-07', '23:59', today, now)).toBe(BOOKING_PAST_TIME_ERROR);
    expect(bookingPastTimeError(today, '14:29', today, now)).toBe(BOOKING_PAST_TIME_ERROR);
  });

  it('keeps the current and future interval eligible for server validation', () => {
    expect(bookingPastTimeError(today, '14:30', today, now)).toBe('');
    expect(bookingPastTimeError(today, '14:31', today, now)).toBe('');
    expect(bookingPastTimeError('2026-10-09', '08:00', today, now)).toBe('');
  });

  it('does not show a past warning while the scheduling intent is incomplete or malformed', () => {
    expect(bookingPastTimeError('', '14:00', today, now)).toBe('');
    expect(bookingPastTimeError(today, '', today, now)).toBe('');
    expect(bookingPastTimeError(today, 'not-a-time', today, now)).toBe('');
  });
});
