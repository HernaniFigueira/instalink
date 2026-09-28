import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { panelNavigation, panelRouteFor, PANEL_ROUTES } from '../panel';
import { isLegacyPagesEnabled } from '../product';
import { workspaceAreas } from '../workspace-navigation';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const fullNavigation = panelNavigation({
  permissions: {
    dashboard: true, agenda: true, clientes: true, leads: true, catalogo: true,
    pagina: true, equipe: true, financeiro: true, config: true, agente: true,
    campanhas: true, whatsapp: true, pedidos: true,
  } as any,
  modes: ['services', 'bookings'], features: {},
});

describe('Clinical OS · superfícies operacionais da Página legada', () => {
  it('uma única flag controla a ocultação e restauração dos pontos de entrada', () => {
    expect(isLegacyPagesEnabled({})).toBe(false);
    expect(isLegacyPagesEnabled({ GODOUTOR_LEGACY_PAGES: '1' })).toBe(true);
    expect(read('next.config.js')).toContain('GODOUTOR_LEGACY_PAGES: process.env.GODOUTOR_LEGACY_PAGES ||');

    const shell = read('src/components/DashboardShell.tsx');
    const dashboard = read('src/app/(dashboard)/dashboard/page.tsx');
    const settings = read('src/app/(dashboard)/configuracoes/page.tsx');
    const resources = read('src/app/(dashboard)/recursos/page.tsx');
    const help = read('src/components/dashboard/HelpCenter.tsx');
    const navigation = read('src/components/dashboard/WorkspaceNavigation.tsx');

    expect(shell).toMatch(/legacyPagesEnabled\s*&&\s*<>\s*·\s*<a href=\{`\/\$\{business\.slug\}`\}/);
    expect(shell).toMatch(/legacyPagesEnabled[\s\S]*?allowed: nav\.allowed\.filter\(\(route\) => route\.href !== '\/pagina'\)/);
    expect(shell).toContain('buildNavSearchItems(operationalNav, q)');
    expect(dashboard).toMatch(/legacyPagesEnabled\s*&&\s*links\.pagina\s*===\s*true/);
    expect(dashboard).toContain("item.href.split('?')[0] !== '/pagina'");
    expect(settings).toMatch(/legacyPagesEnabled\s*&&\s*<section[\s\S]*?Editar página pública/);
    expect(resources).toMatch(/legacyPagesEnabled\s*&&\s*<Link href=\{`\/pagina/);
    expect(help).toMatch(/legacyPagesEnabled\s*\|\|\s*p\.href\s*!==\s*'\/pagina'/);
    expect(help).toContain("c.href.split('?')[0] !== '/pagina'");
    expect(navigation).toContain("c.href.split('?')[0] !== '/pagina'");

    // O contrato on/off cobre também a porta de navegação, sem perder a rota.
    const defaultPaths = workspaceAreas(fullNavigation.allowed)
      .flatMap((area) => area.items.map((item) => item.href));
    const legacyPaths = workspaceAreas(fullNavigation.allowed, { legacyPages: true })
      .flatMap((area) => area.items.map((item) => item.href));
    expect(defaultPaths).not.toContain('/pagina');
    expect(legacyPaths).toContain('/pagina');
  });

  it('preserva editor, slug público, APIs de página e rotas consumidas por widgets/agendamento', () => {
    expect(PANEL_ROUTES.some((route) => route.href === '/pagina')).toBe(true);
    expect(panelRouteFor('/pagina')).toBeTruthy();
    for (const file of [
      'src/app/(dashboard)/pagina/page.tsx',
      'src/app/[slug]/page.tsx',
      'src/app/api/pages/route.ts',
      'src/app/api/bookings/route.ts',
      'src/app/widget/booking.js/route.ts',
    ]) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    }
    expect(read('src/lib/product.ts')).toContain('quem tem o deep link /pagina continua chegando');
    const dashboard = read('src/app/(dashboard)/dashboard/page.tsx');
    const results = read('src/app/(dashboard)/resultados/page.tsx');
    expect(dashboard).toContain('pageStats ?');
    expect(dashboard).toContain('Presença online · visitas por dia');
    expect(results).toContain('/api/analytics');
    expect(results).toContain('Página pública');
  });
});
