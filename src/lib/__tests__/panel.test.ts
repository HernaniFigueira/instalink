import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  API_GUARDS, FULL_WIDTH_PATHS, PANEL_ROUTES, emptyPanelContext, firstAllowedPath,
  hasPermission, isPanelRouteVisible, panelAccess, panelNavigation, panelRouteFor,
  permissionForPath, visiblePanelRoutes,
} from '../panel';
import { inPanelPath } from '../client-auth';
import type { PanelContext } from '../panel';
import type { PermissionId } from '../types';

const ALL_PERMISSIONS: PermissionId[] = [
  'dashboard', 'agenda', 'clientes', 'leads', 'pedidos', 'catalogo', 'pagina',
  'agente', 'whatsapp', 'campanhas', 'equipe', 'config', 'financeiro', 'admin',
];

function ctx(partial: Partial<PanelContext> = {}): PanelContext {
  return {
    permissions: Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true])),
    modes: ['services', 'bookings'],
    features: { whatsapp: true, agent: true, reviews: true },
    ...partial,
  };
}

describe('panel — catálogo de rotas', () => {
  it('toda rota tem rótulo, ícone, permissão e área', () => {
    expect(PANEL_ROUTES.length).toBeGreaterThanOrEqual(14);
    for (const r of PANEL_ROUTES) {
      expect(r.href.startsWith('/')).toBe(true);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.icon.length).toBeGreaterThan(0);
      expect(ALL_PERMISSIONS).toContain(r.permission);
      expect(r.area && r.area.length > 0).toBe(true);
    }
  });

  it('resolve a rota ignorando barra final', () => {
    expect(panelRouteFor('/agenda')?.label).toBe('Agenda');
    expect(panelRouteFor('/agenda/')?.label).toBe('Agenda');
    expect(panelRouteFor('/rota-inexistente')).toBeUndefined();
  });

  it('rotas de agenda/pedidos só existem com o módulo ligado', () => {
    expect(panelRouteFor('/agenda')?.modes).toContain('bookings');
    expect(panelRouteFor('/pedidos')?.modes?.length).toBeGreaterThan(0);
    expect(panelRouteFor('/dashboard')?.modes).toBeUndefined();
  });

  it('FULL_WIDTH_PATHS vem do próprio catálogo (sem lista paralela)', () => {
    for (const p of FULL_WIDTH_PATHS) expect(panelRouteFor(p)).toBeDefined();
    expect(FULL_WIDTH_PATHS).toContain('/agenda');
  });
});

describe('panel — acesso (403 amigável, nunca logout)', () => {
  it('com permissão e módulo ativo, permite', () => {
    const a = panelAccess('/agenda', ctx());
    expect(a.state).toBe('allow');
    expect(a.area).toBe('Agenda');
    expect(a.reason).toBe('');
  });

  it('sem permissão, nega por permissão e rotula a área', () => {
    const c = ctx({ permissions: { dashboard: true } });
    const a = panelAccess('/equipe', c);
    expect(a.state).toBe('denied');
    expect(a.reason).toBe('permission');
    expect(a.area).toBe('Equipe');
  });

  it('com permissão mas módulo desligado, nega por módulo', () => {
    const a = panelAccess('/pedidos', ctx({ modes: ['services', 'bookings'] }));
    expect(a.state).toBe('denied');
    expect(a.reason).toBe('module');
  });

  it('rota oculta (Pedidos) fora da navegação mas ainda acessível quando o módulo legado existe', () => {
    expect(panelRouteFor('/pedidos')?.hidden).toBe(true);
    const a = panelAccess('/pedidos', ctx({ modes: ['products', 'orders'] }));
    expect(a.state).toBe('allow');
  });

  it('rota fora do catálogo é "unknown" (ex.: /onboarding) — sem guarda aqui', () => {
    expect(panelAccess('/onboarding', ctx()).state).toBe('unknown');
    expect(panelAccess('/', ctx()).state).toBe('unknown');
  });

  it('inPanelPath separa painel de rotas públicas (401 só redireciona no painel)', () => {
    expect(inPanelPath('/agenda')).toBe(true);
    expect(inPanelPath('/dashboard/')).toBe(true);
    expect(inPanelPath('/onboarding')).toBe(true);
    expect(inPanelPath('/login')).toBe(false);
    expect(inPanelPath('/odonto-smile')).toBe(false);
    expect(inPanelPath('/')).toBe(false);
  });
});

describe('panel — navegação contextual', () => {
  it('Dashboard é o item primário e o resto vem agrupado por seção', () => {
    const nav = panelNavigation(ctx());
    expect(nav.primary?.href).toBe('/dashboard');
    expect(nav.sections.map((s) => s.label)).toEqual(['Operacional', 'Catálogo', 'Atendimento', 'Gestão', 'Presença', 'Administração']);
    expect(nav.all[0].href).toBe('/dashboard');
  });

  it('o eixo do produto: Agenda/Clientes, Serviços/Produtos, WhatsApp/Assistente, Página', () => {
    const nav = panelNavigation(ctx({ modes: ['services', 'bookings', 'products'] }));
    const hrefs = nav.all.map((r) => r.href);
    expect(hrefs).toEqual([
      '/dashboard',
      '/agenda', '/clientes',
      '/servicos', '/produtos',
      '/whatsapp', '/agente',
      '/resultados', '/campanhas',
      '/pagina',
      '/equipe', '/recursos', '/configuracoes',
    ]);
    const labels = new Map(nav.all.map((r) => [r.href, r.label]));
    expect(labels.get('/agente')).toBe('Assistente');
    expect(labels.get('/pagina')).toBe('Página');
  });

  it('clínica (services+bookings) não vê Pedidos nem Produtos', () => {
    const nav = panelNavigation(ctx({ modes: ['services', 'bookings'] }));
    const hrefs = nav.all.map((r) => r.href);
    expect(hrefs).toContain('/agenda');
    expect(hrefs).toContain('/servicos');
    expect(hrefs).not.toContain('/pedidos');
    expect(hrefs).not.toContain('/produtos');
  });

  it('Pedidos nunca aparece na navegação — nem para quem tem o módulo legado', () => {
    // O caminho principal foi removido do produto; a rota continua existindo
    // (histórico preservado) apenas por URL direta para empresas legadas.
    const nav = panelNavigation(ctx({ modes: ['products', 'orders'] }));
    const hrefs = nav.all.map((r) => r.href);
    expect(hrefs).not.toContain('/pedidos');
    expect(hrefs).toContain('/produtos');
    expect(hrefs).not.toContain('/agenda');
  });

  it('sem permissão a rota some do menu (esconder é UX; a segurança é no servidor)', () => {
    const c = ctx({ permissions: { dashboard: true, agenda: true } });
    const hrefs = visiblePanelRoutes(c).map((r) => r.href);
    expect(hrefs).toEqual(['/dashboard', '/agenda']);
    expect(hasPermission('equipe', c)).toBe(false);
    expect(isPanelRouteVisible(panelRouteFor('/equipe')!, c)).toBe(false);
  });

  it('firstAllowedPath nunca deixa o usuário sem destino', () => {
    expect(firstAllowedPath(ctx())).toBe('/dashboard');
    expect(firstAllowedPath(ctx({ permissions: { agenda: true } }))).toBe('/agenda');
    expect(firstAllowedPath(emptyPanelContext())).toBe('');
  });

  it('permissionForPath devolve a permissão da rota', () => {
    expect(permissionForPath('/equipe')).toBe('equipe');
    expect(permissionForPath('/resultados')).toBe('financeiro');
    expect(permissionForPath('/fora')).toBe('');
  });
});

describe('panel — guardas de servidor (regressão: ninguém remove a checagem)', () => {
  const root = path.resolve(__dirname, '../../..');

  function guardCalls(file: string): string[] {
    const src = readFileSync(path.join(root, file), 'utf8');
    return [...src.matchAll(/requireBusiness\(([\s\S]*?)\)\s*;/g)].map((m) => m[1]);
  }

  it('cada API do painel exige a permissão declarada em API_GUARDS', () => {
    expect(API_GUARDS.length).toBeGreaterThanOrEqual(10);
    for (const g of API_GUARDS) {
      const calls = guardCalls(g.file);
      expect(calls.length, `${g.file} precisa chamar requireBusiness`).toBeGreaterThan(0);
      const perms = Array.isArray(g.permission) ? g.permission : [g.permission];
      for (const p of perms) {
        const found = calls.some((c) => c.includes(`'${p}'`));
        expect(found, `${g.route} deve exigir '${p}'`).toBe(true);
      }
    }
  });

  it('overview exige dashboard e bookings exige agenda', () => {
    const overview = API_GUARDS.find((g) => g.route === '/api/overview');
    const bookings = API_GUARDS.find((g) => g.route === '/api/bookings');
    expect(overview?.permission).toBe('dashboard');
    expect(bookings?.permission).toBe('agenda');
  });
});
