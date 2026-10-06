import { createHash } from 'node:crypto';

/**
 * Opaque, stable URL key for the clinical People 360 projection.
 * The internal identity index may choose a global Customer ID as its canonical
 * alias; do not put that alias in a Professional-facing URL or response.
 */
export function clinicalPeople360Key(internalIdentityKey: string): string {
  const digest = createHash('sha256').update(String(internalIdentityKey || '')).digest('hex');
  return `clinical:${digest}`;
}
