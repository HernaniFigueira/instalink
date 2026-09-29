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
    const whatsapp = profile.slice(profile.indexOf('function A2'), profile.indexOf('function Empty', profile.indexOf('function A2')));
    expect(whatsapp).toContain("className={buttonCls('secondary', 'sm')}");
    expect(whatsapp).not.toContain('hover:text-[var(--brand-fg)]');
    const ui = read('src/components/ui.tsx');
    expect(ui).toContain("secondary:\n    'bg-[var(--surface)] text-[var(--text)] border border-[var(--border-strong)] hover:bg-[var(--surface-hover)]'");
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

  it('conversation focus is query-backed and removes global shell chrome without rebuilding the workspace', () => {
    const shell = read('src/components/DashboardShell.tsx');
    const css = read('src/app/globals.css');
    expect(shell).toContain("params.get('focus') === '1'");
    expect(shell).toContain("params.get('standalone') === '1'");
    expect(shell).toContain('{!conversationFocus && <WorkspaceNavigation');
    expect(shell).toContain('{!conversationFocus && <WorkspaceTopbar');
    expect(shell).toContain("conversationFocus && 'workspace-shell--conversation-focus'");
    expect(css).toContain('.workspace-shell--conversation-focus .workspace-main-col');
    expect(css).toContain('height: 100dvh');
  });

  it('booking sheet expands responsively while retaining the shared sheet and side panel', () => {
    const booking = read('src/components/dashboard/NewBookingSheet.tsx');
    const drawer = read('src/components/ui.tsx');
    const css = read('src/app/globals.css');
    expect(booking).toContain('WORKSPACE_SHEET_SIZES.wide');
    expect(booking).toContain('WORKSPACE_SHEET_SIZES.nestedForm');
    expect(booking).toContain('sideTitle="Cadastrar novo paciente"');
    expect(css).toContain('@media (max-width: 1359px)');
    expect(drawer).toContain("expanded ? 'w-full max-w-[1280px]'");
    expect(drawer).toContain('data-expanded={expanded ? \'true\' : undefined}');
    expect(css).toContain(".il-drawer__strip[data-expanded='true'] { width:100%; max-width:1280px; }");
  });

  it('shared discard confirmation distinguishes safe and destructive decisions', () => {
    const dialog = read('src/components/dashboard/OverlayDismissGuard.tsx');
    const css = read('src/app/globals.css');
    expect(dialog).toContain('data-safe-action');
    expect(dialog).toContain('il-control--secondary overlay-confirm__action');
    expect(dialog).toContain('il-control--destructive overlay-confirm__action');
    expect(dialog).toContain("event.key === 'Escape'");
    expect(css).toContain('.overlay-confirm .il-control--secondary');
    expect(css).toContain('.overlay-confirm .il-control--destructive { border: 1px solid var(--danger); background: var(--danger); color: #fff; }');
  });

  it('Results metrics share one panel instead of a grid of individually rounded cards', () => {
    const results = read('src/components/dashboard/results-view.tsx');
    const metricGrid = results.slice(results.indexOf('export function MetricGrid'), results.indexOf('export function FunnelView'));
    expect(metricGrid).toContain('className="ws-panel overflow-hidden"');
    expect(metricGrid).not.toContain('rounded-lg p-3.5');
    expect(metricGrid).not.toContain('bg-white border border-zinc-200');
  });

  it('PageFrame aplica largura por arquétipo; workspaces operacionais não ficam estreitos', () => {
    const shell = read('src/components/DashboardShell.tsx');
    const routes = read('src/lib/panel.ts');
    const css = read('src/app/globals.css');
    expect(shell).toContain('pageTypeForPath(pathname)');
    expect(shell).toContain('<PageFrame key={business.id} type={pageType}');
    expect(css).toContain('.il-page-frame--workspace { max-width:none; }');
    expect(css).toContain('.il-page-frame--form { max-width:var(--page-width-form); }');
    expect(css).toContain('--page-width-form:60rem');
    expect(css).toContain('margin-inline:auto');
    for (const [route, type] of [['/agenda', 'workspace'], ['/conversas', 'workspace'], ['/atendimento', 'record'], ['/configuracoes', 'form']]) {
      const index = routes.indexOf(`href: '${route}'`);
      expect(index, route).toBeGreaterThanOrEqual(0);
      expect(routes.slice(index, index + 240)).toContain(`pageType: '${type}'`);
    }
  });

  it('full-page Client 360 returns to the real list URL with state and a business fallback', () => {
    const page = read('src/app/(dashboard)/clientes/[id]/page.tsx');
    const profile = read('src/components/dashboard/ClientProfileDrawer.tsx');
    const helper = read('src/lib/client-return.ts');
    expect(page).toContain('clientListReturnHref(search.toString(), businessId)');
    expect(page).toContain('pageBackHref={listHref}');
    expect(profile).toContain('pageBackHref?: string');
    expect(profile).toContain('pageBackHref || `/clientes?b=${encodeURIComponent(businessId)}`');
    expect(helper).toContain('b: params.get(\'b\') || fallbackBusinessId || \'\'');
    expect(profile).not.toContain('history.back');
    const ui = read('src/components/ui.tsx');
    expect(ui).toContain('export function PageBackAction');
    expect(page).toContain('<PageBackAction href={listHref} label="Voltar para clientes" />');
    expect(read('src/components/dashboard/EncounterSheet.tsx')).toContain('<PageBackAction className="encounter-page__back"');
  });

  it('agent visual-only migration and selected controls share tokens without changing agent calls', () => {
    const agent = read('src/app/(dashboard)/agente/page.tsx');
    expect(agent).toContain('il-field-control');
    expect(agent).toContain("buttonCls('secondary', 'sm')");
    expect(agent).toContain('aria-pressed={agent.tone === t.id}');
    expect(agent).toContain('aria-pressed={on}');
    expect(agent).not.toMatch(/text-zinc-|bg-white|border-2/);
    const encounter = read('src/components/dashboard/EncounterSheet.tsx');
    const anamnese = read('src/components/dashboard/AnamneseFiller.tsx');
    expect(encounter).toContain('className="il-option-choice"');
    expect(anamnese).toContain('className="il-option-choice" aria-pressed={on}');
    expect(encounter).toContain('FOLLOW_UP_MODES');
    expect(anamnese).toContain('history');
  });
});
