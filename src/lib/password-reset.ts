import { createHash, randomBytes } from 'node:crypto';
import type { DB, PasswordReset } from './types';

// Tokens de recuperação: uso único, 1h de expiração, só o hash no banco.
export const RESET_TTL_MS = 3600000;

export function newResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token || '').digest('hex');
}

export function findValidReset(db: DB, kind: 'user' | 'customer', token: string): PasswordReset | null {
  const hash = hashResetToken(token);
  const r = db.passwordResets.find((x) => x.kind === kind && x.tokenHash === hash && !x.usedAt);
  if (!r) return null;
  if (new Date(r.expiresAt).getTime() < Date.now()) return null;
  return r;
}
