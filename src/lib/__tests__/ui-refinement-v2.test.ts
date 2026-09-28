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

  it('conversation workspace fills the column and outgoing bubbles stay muted', () => {
    const conversations = read('src/components/dashboard/ConversationsView.tsx');
    const css = read('src/app/globals.css');
    expect(conversations).toContain('conversation-message-scroll');
    expect(conversations).not.toMatch(/max-h-\[(360|420)px\]/);
    expect(css).toContain('.conversation-message.is-outgoing {');
    expect(css).toContain('background:var(--accent-soft)');
    expect(css).not.toContain('.conversation-message.is-outgoing { border-color:var(--accent-border); border-bottom-right-radius:3px; background:var(--accent); color:#fff');
  });

  it('conversation workspace keeps its three responsive modes and an accessible, unbounded timeline', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('grid-template-columns:minmax(280px,300px) minmax(0,1fr) minmax(280px,310px)');
    expect(css).toContain('@media (max-width:1199px)');
    expect(css).toContain('@media (max-width:767px)');
    expect(css).toContain('.conversation-view[data-active="true"] .inbox-list { display:none; }');
    expect(css).toContain('.conversation-view[data-active="true"] .inbox-detail { display:flex; }');
    expect(css).toContain('.conversation-view[data-context-open="false"] .conversation-workspace');
    expect(css).toContain('grid-template-columns:minmax(270px,340px) minmax(0,1fr)');
    expect(css).toContain('.il-platform .conversation-view .inbox-filter { min-height:44px; }');
  });

  it('Results metrics share one panel instead of a grid of individually rounded cards', () => {
    const results = read('src/components/dashboard/results-view.tsx');
    const metricGrid = results.slice(results.indexOf('export function MetricGrid'), results.indexOf('export function FunnelView'));
    expect(metricGrid).toContain('className="ws-panel overflow-hidden"');
    expect(metricGrid).not.toContain('rounded-lg p-3.5');
    expect(metricGrid).not.toContain('bg-white border border-zinc-200');
  });
});
