import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { benchmarkEvents, PROFESSIONALS } from './fixtures';

describe('Agenda Temporal 2.0 — benchmark reproduzível', () => {
  it('gera cargas semanais de 200 e 1000 eventos para 5 profissionais', () => {
    const measurements: Array<{ events: number; generationMs: number; professionals: number }> = [];

    for (const count of [200, 1_000]) {
      const startedAt = performance.now();
      const events = benchmarkEvents(count);
      const generationMs = performance.now() - startedAt;
      const professionals = new Set(events.map((event) => event.professionalId)).size;
      measurements.push({ events: events.length, generationMs: Number(generationMs.toFixed(2)), professionals });
      expect(events).toHaveLength(count);
      expect(professionals).toBe(PROFESSIONALS.length);
    }

    console.info(`[agenda-temporal-benchmark] ${JSON.stringify(measurements)}`);
  }, 30_000);
});
