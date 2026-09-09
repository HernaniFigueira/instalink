// Rate limiting best-effort em memória (por instância serverless).
// Protege contra abuso casual e força bruta simples sem prejudicar UX.
// Para limite global/distribuído, evoluir para KV/Redis quando escalar.
import type { NextRequest } from 'next/server';

interface Bucket { count: number; reset: number }

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.reset < now) buckets.delete(k);
  }
  if (buckets.size > 20000) buckets.clear();
}

export function ipFrom(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return ip.slice(0, 64);
}

// Retorna ok=false quando estourou o teto (max chamadas por windowMs).
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > max) return { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}
