import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('2.0 refinement pass — lower action and surface competition', () => {
  it('Dashboard quick actions use one contextual icon treatment, not semantic decoration', () => {
    const dashboard = read('src/app/(dashboard)/dashboard/page.tsx');
    const section = dashboard.slice(dashboard.indexOf('Ações rápidas'), dashboard.indexOf('</section>', dashboard.indexOf('Ações rápidas')));
    expect(section).toContain('dsh-quick__icon');
    expect(section).not.toContain('style=');
    expect(section).not.toMatch(/success-bg|warning-bg|ops-soft/);
  });

  it('Clients row keeps one primary and one strong secondary; preview/WhatsApp are quiet', () => {
    const clients = read('src/app/(dashboard)/clientes/page.tsx');
    expect(clients).toMatch(/variant="primary" onClick=\{\(\) => openFullProfile\(p\.key\)\}/);
    expect(clients).toMatch(/variant="ghost" onClick=\{\(\) => setOpenKey\(p\.key\)\}/);
    expect(clients).toMatch(/variant="secondary" onClick=\{\(\) => openBooking\(p\)\}/);
    expect(clients).not.toMatch(/Abrir WhatsApp[\s\S]{0,250}success-bg/);
  });

  it('Client 360 reserves primary for booking; edit/note/WhatsApp remain quiet', () => {
    const profile = read('src/components/dashboard/ClientProfileDrawer.tsx');
    expect(profile).toMatch(/variant="primary" size="sm" onClick=\{\(\) => onNewBooking\(person\)\}/);
    expect(profile).toMatch(/variant="ghost" size="sm" onClick=\{\(\) => \{ setTab\('notes'\)/);
    expect(profile).toMatch(/variant="ghost" size="sm" onClick=\{\(\) => \{\s*const opening = !editing/);
    expect(profile).toContain('text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--brand-fg)]');
  });

  it('outgoing conversation bubbles are muted and retain text/border distinction', () => {
    const conversations = read('src/components/dashboard/ConversationsView.tsx');
    expect(conversations).toMatch(/m\.direction === 'out' \? 'bg-\[var\(--brand-soft\)\] text-\[var\(--text\)\] border border-\[var\(--brand-border\)\]/);
    expect(conversations).not.toMatch(/m\.direction === 'out' \? 'bg-\[var\(--brand\)\] text-white/);
  });

  it('Results metrics share one panel instead of a grid of individually rounded cards', () => {
    const results = read('src/components/dashboard/results-view.tsx');
    const metricGrid = results.slice(results.indexOf('export function MetricGrid'), results.indexOf('export function FunnelView'));
    expect(metricGrid).toContain('className="ws-panel overflow-hidden"');
    expect(metricGrid).not.toContain('rounded-lg p-3.5');
    expect(metricGrid).not.toContain('bg-white border border-zinc-200');
  });
});
