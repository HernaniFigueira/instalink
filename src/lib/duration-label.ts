/** Presentation only: stored durations and cadence remain integer minutes. */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return minutes < 60 ? `${minutes} min` : `${minutes} min · ${hours}h${rest ? String(rest).padStart(2, '0') : ''}`;
}
