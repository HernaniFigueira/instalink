import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  API_GUARDS, FOOTER_SECTIONS, FULL_WIDTH_PATHS, LEGACY_ROUTES, PANEL_ROUTES, PANEL_SECTIONS,
  allowedPanelRoutes, activePanelPath, activePanelRoute, emptyPanelContext, firstAllowedPath,
  hasAnyPermission, hasPermission, isPanelRouteAllowed, isPanelRouteVisible, panelAccess,
  panelNavigation, panelRouteFor, panelRoutesIn, permissionForPath, permissionsForRoute,
  routeRequiresBusiness, visiblePanelRoutes,
} from '../panel';
import { inPanelPath } from '../client-auth';
import { requiresActiveBusiness } from '../business-context';
import type { PanelContext } from '../panel';
import type { PermissionId } from '../types';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

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

/** Pastas de rota reais dentro do grupo (dashboard). */
function dashboardRouteFolders(): string[] {
  const dir = path.join(root, 'src/app/(dashboard)');
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'page.tsx')))
    .map((e) => `/${e.name}`)
    .sort();
}

// ═══════════════════════════════════════════════════════════════
// 1. CATÁLOGO — a única lista de destinos
// ═══════════════════════════════════════════════════════════════
describe('catálogo — completude (por qual porta se chega até mim?)', () => {
  it('tem as 22 portas da arquitetura consolidada', () => {
    expect(PANEL_ROUTES).toHaveLength(22);
  });

  it('toda porta do catálogo tem uma rota real no disco', () => {
    for (const r of PANEL_ROUTES) {
      const file = `src/app/(dashboard)${r.href}/page.tsx`;
      expect(existsSync(path.join(root, file)), `${r.href} precisa existir em ${file}`).toBe(true);
    }
  });

  it('toda rota do painel nasce no catálogo (nenhuma porta órfã)', () => {
    const catalog = PANEL_ROUTES.map((r) => r.href).sort();
    expect(dashboardRouteFolders()).toEqual(catalog);
  });

  it('nenhuma rota legada renomeada continua existindo como página', () => {
    for (const legacy of ['/horarios', '/whatsapp', '/esteira', '/integracoes']) {
      expect(existsSync(path.join(root, `src/app/(dashboard)${legacy}/page.tsx`)), `${legacy} deveria ter virado redirect`).toBe(false);
      expect(panelRouteFor(legacy)).toBeUndefined();
    }
  });

  it('hrefs são únicos e absolutos', () => {
    const hrefs = PANEL_ROUTES.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h.startsWith('/') && !h.endsWith('/')).toBe(true);
  });

  it('cada porta tem rótulo, ícone, descrição real, permissão e área', () => {
    for (const r of PANEL_ROUTES) {
      expect(r.label.length, `${r.href} sem label`).toBeGreaterThan(0);
      expect(r.icon.length, `${r.href} sem ícone`).toBeGreaterThan(0);
      // descrição é o texto do tooltip/atalho: nunca vazia, nunca um eco do rótulo
      expect(r.description.length, `${r.href} sem descrição`).toBeGreaterThanOrEqual(20);
      expect(r.description.toLowerCase(), `${r.href} com descrição = rótulo`).not.toBe(r.label.toLowerCase());
      expect(r.area && r.area.length > 0, `${r.href} sem área`).toBe(true);
      for (const p of permissionsForRoute(r)) expect(ALL_PERMISSIONS, `${r.href} com permissão inválida`).toContain(p);
    }
  });

  it('o campo "hidden" morreu: existe `sidebar`, que continua declarando o destino', () => {
    const src = read('src/lib/panel.ts');
    expect(src).not.toMatch(/hidden\??:/);
    expect(src).not.toMatch(/hidden: true/);
    for (const r of PANEL_ROUTES) {
      expect('hidden' in r, `${r.href} ainda usa hidden`).toBe(false);
      if (r.sidebar !== undefined) expect(typeof r.sidebar).toBe('boolean');
    }
  });

  it('largura é política declarada (full = tela densa · contained = formulário/lista)', () => {
    for (const r of PANEL_ROUTES) {
      if (r.width !== undefined) expect(['full', 'contained']).toContain(r.width);
    }
    // telas densas aproveitam a largura; formulários ficam em coluna de leitura
    expect(panelRouteFor('/agenda')?.width).toBe('full');
    expect(panelRouteFor('/funil')?.width).toBe('full');
    expect(panelRouteFor('/conversas')?.width).toBe('full');
    expect(panelRouteFor('/configuracoes')?.width ?? 'contained').toBe('contained');
    expect(panelRouteFor('/pagina')?.width ?? 'contained').toBe('contained');
  });

  it('todo ícone do catálogo existe no shell (nada de quadrado vazio no menu)', () => {
    const shell = read('src/components/DashboardShell.tsx');
    const declared = new Set([...shell.matchAll(/^  ([a-zA-Z]+): \(/gm)].map((m) => m[1]));
    expect(declared.size).toBeGreaterThan(20);
    for (const r of PANEL_ROUTES) {
      expect(declared.has(r.icon), `ícone '${r.icon}' de ${r.href} não existe em DashboardShell`).toBe(true);
    }
  });

  it('FULL_WIDTH_PATHS é derivado do catálogo (sem lista paralela)', () => {
    expect(FULL_WIDTH_PATHS).toEqual(PANEL_ROUTES.filter((r) => r.width === 'full').map((r) => r.href));
    for (const p of FULL_WIDTH_PATHS) expect(panelRouteFor(p)).toBeDefined();
    expect(FULL_WIDTH_PATHS).toContain('/agenda');
    expect(FULL_WIDTH_PATHS).not.toContain('/configuracoes');
  });

  it('resolve a porta ignorando barra final', () => {
    expect(panelRouteFor('/agenda')?.label).toBe('Agenda');
    expect(panelRouteFor('/agenda/')?.label).toBe('Agenda');
    expect(panelRouteFor('/rota-inexistente')).toBeUndefined();
    expect(panelRouteFor('/agenda/123')).toBeUndefined(); // exato ≠ ancestral
  });

  it('rotas de agenda/catálogo só existem com o módulo ligado', () => {
    expect(panelRouteFor('/agenda')?.modes).toContain('bookings');
    expect(panelRouteFor('/pedidos')?.modes?.length).toBeGreaterThan(0);
    expect(panelRouteFor('/disponibilidade')?.modes).toEqual(['services', 'bookings']);
    expect(panelRouteFor('/dashboard')?.modes).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. SEÇÕES — jornada, não organograma
// ═══════════════════════════════════════════════════════════════
describe('catálogo — seções', () => {
  it('as 8 seções canônicas, na ordem de uso, todas no menu principal (A3.4)', () => {
    // A3.4: "Início" virou SEÇÃO de uma porta (`/dashboard`). Antes o item
    // primário flutuava sem título; com o menu maior ele ficava sem contexto.
    expect(PANEL_SECTIONS.map((s) => s.label)).toEqual([
      'Início', 'Operação', 'Pessoas', 'Oferta', 'Crescimento', 'Resultados', 'Presença', 'Administração',
    ]);
    // NENHUMA seção fica presa no rodapé: a barra tem um comportamento só.
    // Configurações é porta do menu como qualquer outra (decisão A3.3).
    expect(PANEL_SECTIONS.filter((s) => s.footer).map((s) => s.id)).toEqual([]);
    expect(FOOTER_SECTIONS).toEqual([]);
  });

  it('toda porta pertence a uma seção existente (Início inclusive)', () => {
    const ids = PANEL_SECTIONS.map((s) => s.id);
    for (const r of PANEL_ROUTES) {
      expect(r.section, `${r.href} sem seção`).toBeDefined();
      expect(ids, `${r.href} em seção desconhecida`).toContain(r.section!);
    }
    // Início tem seção própria e é a PRIMEIRA do menu.
    expect(panelRoutesIn('inicio').map((r) => r.href)).toEqual(['/dashboard']);
  });

  it('nenhuma seção nasce vazia (Presença é a única de uma porta, por decisão)', () => {
    for (const sec of PANEL_SECTIONS) {
      const count = panelRoutesIn(sec.id).length;
      expect(count, `seção ${sec.label} sem nenhuma porta`).toBeGreaterThanOrEqual(1);
    }
    // Presença = a porta pública (Página). Um destino só, declarado assim pela
    // arquitetura (A1.2): separar "o que o cliente vê" de "o que a casa opera"
    // vale mais do que agrupar por contagem.
    expect(panelRoutesIn('presenca').map((r) => r.href)).toEqual(['/pagina']);
  });

  it('Oferta é o que eu ofereço e vendo (catálogo), não a operação da equipe', () => {
    // A3.4: Profissionais e Disponibilidade SAÍRAM daqui — a régua é quem usa
    // a tela no dia a dia (quem atende), não a semelhança de assunto.
    expect(panelRoutesIn('oferta').map((r) => r.href)).toEqual(['/servicos', '/produtos']);
  });

  it('Operação é o dia a dia; Administração é ajuste raro', () => {
    // A3.4: Profissionais, Disponibilidade e Pedidos entraram em Operação.
    // Pedidos só existe com o módulo ativo (modes: ['orders']).
    expect(panelRoutesIn('operacao').map((r) => r.href)).toEqual([
      '/agenda', '/profissionais', '/disponibilidade', '/conversas', '/agente', '/tarefas', '/pedidos',
    ]);
    expect(panelRoutesIn('administracao').map((r) => r.href)).toEqual(['/equipe', '/recursos', '/configuracoes']);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. SIDEBAR = PROJEÇÃO DO CATÁLOGO
// ═══════════════════════════════════════════════════════════════
describe('sidebar — projeção (permissão ∩ módulos, ordem do catálogo)', () => {
  it('clínica completa: ordem exata e seções na ordem canônica', () => {
    const nav = panelNavigation(ctx());
    // A3.4: Início é seção de uma porta; `primary` (item sem seção) fica vazio.
    expect(nav.primary).toBeNull();
    expect(nav.sections.map((s) => s.label)).toEqual([
      'Início', 'Operação', 'Pessoas', 'Oferta', 'Crescimento', 'Resultados', 'Presença', 'Administração',
    ]);
    // Administração agora é a última seção do MENU (não do rodapé fixo).
    expect(nav.footerSections).toEqual([]);
    expect(nav.sidebar.map((r) => r.href)).toEqual([
      '/dashboard',
      // A3.4 — Operação: agenda + quem atende + quando atende + o dia.
      // (Pedidos/Produtos exigem os módulos correspondentes: entram no teste
      // seguinte, com o contexto de quem os tem.)
      '/agenda', '/profissionais', '/disponibilidade',
      '/conversas', '/agente', '/tarefas',
      '/clientes', '/funil',
      '/servicos',
      '/campanhas', '/automacoes', '/canais',
      '/resultados', '/organizacao',
      '/pagina',
      '/equipe', '/recursos', '/configuracoes',
    ]);
    expect(nav.all).toEqual(nav.allowed);
  });

  it('rótulos canônicos (uma palavra por conceito)', () => {
    const labels = new Map(PANEL_ROUTES.map((r) => [r.href, r.label]));
    expect(labels.get('/disponibilidade')).toBe('Disponibilidade');
    expect(labels.get('/conversas')).toBe('Conversas');
    expect(labels.get('/funil')).toBe('Funil');
    expect(labels.get('/canais')).toBe('Canais & Integrações');
    expect(labels.get('/tarefas')).toBe('Tarefas');
    expect(labels.get('/execucoes')).toBe('Execuções');
    expect(labels.get('/organizacao')).toBe('Organização');
    expect(labels.get('/agente')).toBe('Assistente');
    // vocabulário antigo não volta como rótulo de porta
    for (const antigo of ['Horários', 'Esteira', 'WhatsApp', 'Integrações']) {
      expect([...labels.values()]).not.toContain(antigo);
    }
  });

  it('loja (products+orders) vê Vitrine de produtos e não vê agenda/serviços', () => {
    const nav = panelNavigation(ctx({ modes: ['products', 'orders'] }));
    const hrefs = nav.sidebar.map((r) => r.href);
    expect(hrefs).toContain('/produtos');
    expect(hrefs).not.toContain('/agenda');
    expect(hrefs).not.toContain('/servicos');
    expect(hrefs).not.toContain('/disponibilidade');
    // A3.4: com o módulo de pedidos ativo, Pedidos aparece em OPERAÇÃO (não em
    // Oferta, não como "outro destino"): o histórico de pedidos é operação.
    expect(panelRoutesIn('operacao').map((r) => r.href)).toContain('/pedidos');
    expect(panelRoutesIn('oferta').map((r) => r.href)).not.toContain('/pedidos');
    expect(nav.more.map((r) => r.href)).not.toContain('/pedidos');
  });

  it('seção sem portas permitidas não é renderizada (nada de título vazio)', () => {
    // Perfil que só enxerga a página pública: uma seção, sem rodapé.
    const nav = panelNavigation(ctx({ permissions: { pagina: true } }));
    expect(nav.sections.map((s) => s.id)).toEqual(['presenca']);
    expect(nav.footerSections).toEqual([]);
    expect(nav.sections.every((s) => s.items.length > 0)).toBe(true);
    // Loja (products+orders): Oferta existe, mas só com a vitrine dentro.
    const loja = panelNavigation(ctx({ modes: ['products', 'orders'] }));
    expect(loja.sections.find((s) => s.id === 'oferta')?.items.map((r) => r.href)).toEqual(['/produtos']);
    expect(loja.sections.every((s) => s.items.length > 0)).toBe(true);
  });

  it('destinos fora do menu continuam declarados e acessíveis (`sidebar: false` ≠ escondido)', () => {
    // A3.4: Pedidos voltou ao menu — mas só com o módulo de pedidos ativo.
    const legacy = panelNavigation(ctx({ modes: ['products', 'orders'] }));
    expect(legacy.sidebar.map((r) => r.href)).toContain('/pedidos');
    expect(legacy.more.map((r) => r.href)).not.toContain('/pedidos');
    expect(panelAccess('/pedidos', ctx({ modes: ['products', 'orders'] })).state).toBe('allow');
    // Sem o módulo, a porta de Pedidos não aparece para o usuário.
    const vitrine = panelNavigation(ctx({ modes: ['products'] }));
    expect(vitrine.sidebar.map((r) => r.href)).not.toContain('/pedidos');
    expect(panelAccess('/pedidos', ctx({ modes: ['products'] })).state).toBe('denied');

    const nav = panelNavigation(ctx());
    expect(nav.sidebar.map((r) => r.href)).not.toContain('/execucoes');
    expect(nav.more.map((r) => r.href)).toEqual(['/execucoes']);
    expect(panelAccess('/execucoes', ctx()).state).toBe('allow');
  });

  it('sem permissão a porta some do menu (esconder é UX; a segurança é no servidor)', () => {
    const c = ctx({ permissions: { dashboard: true, agenda: true } });
    // Tarefas entra junto porque aceita a permissão de agenda (array = qualquer
    // uma satisfaz): quem opera a agenda precisa ver o que ficou combinado.
    expect(visiblePanelRoutes(c).map((r) => r.href)).toEqual(['/dashboard', '/agenda', '/tarefas']);
    expect(hasPermission('equipe', c)).toBe(false);
    expect(isPanelRouteVisible(panelRouteFor('/equipe')!, c)).toBe(false);
    expect(isPanelRouteAllowed(panelRouteFor('/equipe')!, c)).toBe(false);
    // e a primeira porta permitida continua sendo uma porta do menu
    expect(firstAllowedPath(c)).toBe('/dashboard');
  });

  it('permissão em array = qualquer uma satisfaz (mesma semântica do servidor)', () => {
    const tarefas = panelRouteFor('/tarefas')!;
    expect(Array.isArray(tarefas.permission)).toBe(true);
    expect(permissionsForRoute(tarefas)).toEqual(['clientes', 'agenda', 'leads', 'config']);
    expect(hasAnyPermission(['clientes', 'agenda', 'leads', 'config'], ctx({ permissions: { leads: true } }))).toBe(true);
    expect(isPanelRouteAllowed(tarefas, ctx({ permissions: { leads: true } }))).toBe(true);
    expect(isPanelRouteAllowed(tarefas, ctx({ permissions: { pagina: true } }))).toBe(false);
    expect(panelAccess('/tarefas', ctx({ permissions: { agenda: true } })).state).toBe('allow');
  });

  it('firstAllowedPath nunca deixa o usuário sem destino (e prefere porta do menu)', () => {
    expect(firstAllowedPath(ctx())).toBe('/dashboard');
    expect(firstAllowedPath(ctx({ permissions: { agenda: true } }))).toBe('/agenda');
    // só um destino fora do menu → ainda assim há para onde ir
    expect(firstAllowedPath(ctx({ permissions: { pedidos: true }, modes: ['orders'] }))).toBe('/pedidos');
    expect(firstAllowedPath(emptyPanelContext())).toBe('');
  });

  it('permissionForPath devolve a primeira permissão da porta', () => {
    expect(permissionForPath('/equipe')).toBe('equipe');
    expect(permissionForPath('/resultados')).toBe('financeiro');
    expect(permissionForPath('/tarefas')).toBe('clientes');
    expect(permissionForPath('/fora')).toBe('');
  });

  it('o shell não tem lista própria: navegação e largura vêm do catálogo', () => {
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toMatch(/panelNavigation\(panelCtx\)/);
    expect(shell).toMatch(/activePanelPath\(pathname\)/);
    expect(shell).toMatch(/activeRoute\?\.width === 'full'/);
    expect(shell).toMatch(/nav\.footerSections/);
    // nenhum href de porta escrito à mão no shell (só /master, fora do catálogo)
    expect(shell).not.toMatch(/href="\/(dashboard|agenda|clientes|servicos|configuracoes|conversas|funil|canais)"/);
    expect(shell).not.toMatch(/FULL_WIDTH_PATHS/);
  });

  it('estado ativo por ancestralidade: subrota mantém a porta acesa', () => {
    expect(activePanelPath('/clientes')).toBe('/clientes');
    expect(activePanelPath('/clientes/123')).toBe('/clientes');
    expect(activePanelPath('/clientes/')).toBe('/clientes');
    expect(activePanelPath('/configuracoes?x=1'.split('?')[0])).toBe('/configuracoes');
    expect(activePanelPath('/onboarding')).toBe('');
    expect(activePanelPath('/odonto-smile')).toBe('');
    expect(activePanelRoute('/canais/qualquer')?.href).toBe('/canais');
  });

  it('mobile tem affordance: fileira rola com aviso, "Mais" fora da rolagem', () => {
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toMatch(/Mais/);
    expect(shell).toMatch(/aria-expanded=\{moreOpen\}/);
    expect(shell).toMatch(/aria-controls="mobile-nav-more"/);
    expect(shell).toMatch(/bg-gradient-to-l from-white/); // degradê = "tem mais"
    expect(shell).toMatch(/scrollIntoView/);              // ativa entra na área visível
    expect(shell).toMatch(/nav\.sidebar/);                // pills = projeção, não lista própria
  });

  it('nenhum hook depois do early return do shell (ordem de hooks estável)', () => {
    // O shell renderiza um skeleton enquanto /api/auth/me não chega e o painel
    // completo depois. Hook chamado só no segundo render muda a contagem e o
    // React aborta: "rendered more hooks than during the previous render" —
    // para o lojista isso aparece como "Application error: a client-side
    // exception has occurred" logo depois do login. Regressão estática.
    const shell = read('src/components/DashboardShell.tsx');
    const cut = shell.indexOf('if (!ready || !user) {');
    expect(cut).toBeGreaterThan(0);
    const depois = shell.slice(cut);
    const hooks = [...depois.matchAll(/\buse(State|Effect|Callback|Memo|Ref|Context|Reducer|LayoutEffect|Router|Pathname|SearchParams|BusinessId|PanelHome|AreaLoad)\s*\(/g)]
      .map((m) => m[0].trim());
    expect(hooks, `hooks depois do early return: ${hooks.join(', ')}`).toEqual([]);
  });

  it('seções colapsáveis guardam preferência e abrem sozinhas na tela atual', () => {
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toMatch(/il-nav-closed/);
    expect(shell).toMatch(/aria-expanded=\{!isClosed\}/);
    expect(shell).toMatch(/A seção da tela atual abre sozinha/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. ACESSO — 403 amigável, nunca logout
// ═══════════════════════════════════════════════════════════════
describe('acesso — 403 amigável, nunca logout', () => {
  it('com permissão e módulo ativo, permite', () => {
    const a = panelAccess('/agenda', ctx());
    expect(a.state).toBe('allow');
    expect(a.area).toBe('Agenda');
    expect(a.reason).toBe('');
  });

  it('sem permissão, nega por permissão e rotula a área', () => {
    const a = panelAccess('/equipe', ctx({ permissions: { dashboard: true } }));
    expect(a.state).toBe('denied');
    expect(a.reason).toBe('permission');
    expect(a.area).toBe('Equipe');
  });

  it('com permissão mas módulo desligado, nega por módulo', () => {
    const a = panelAccess('/pedidos', ctx({ modes: ['services', 'bookings'] }));
    expect(a.state).toBe('denied');
    expect(a.reason).toBe('module');
  });

  it('áreas novas rotulam o 403 com o nome da porta', () => {
    expect(panelAccess('/disponibilidade', ctx({ permissions: {} })).area).toBe('Disponibilidade');
    expect(panelAccess('/conversas', ctx({ permissions: {} })).area).toBe('Conversas');
    expect(panelAccess('/funil', ctx({ permissions: {} })).area).toBe('Funil');
    expect(panelAccess('/canais', ctx({ permissions: {} })).area).toBe('Canais & Integrações');
    expect(panelAccess('/tarefas', ctx({ permissions: {} })).area).toBe('Tarefas');
    expect(panelAccess('/execucoes', ctx({ permissions: {} })).area).toBe('Execuções');
    expect(panelAccess('/organizacao', ctx({ permissions: {} })).area).toBe('Organização');
  });

  it('subrota herda a guarda da porta (reconhece rotas filhas)', () => {
    expect(panelAccess('/clientes/123', ctx()).state).toBe('allow');
    expect(panelAccess('/clientes/123', ctx({ permissions: { dashboard: true } })).state).toBe('denied');
    expect(panelAccess('/canais/qualquer', ctx({ permissions: { dashboard: true } })).reason).toBe('permission');
  });

  it('rota fora do catálogo é "unknown" (ex.: /onboarding) — sem guarda aqui', () => {
    expect(panelAccess('/onboarding', ctx()).state).toBe('unknown');
    expect(panelAccess('/', ctx()).state).toBe('unknown');
    expect(panelAccess('/odonto-smile', ctx()).state).toBe('unknown');
  });

  it('inPanelPath separa painel de rotas públicas (401 só redireciona no painel)', () => {
    expect(inPanelPath('/agenda')).toBe(true);
    expect(inPanelPath('/dashboard/')).toBe(true);
    expect(inPanelPath('/clientes/123')).toBe(true); // ancestralidade
    expect(inPanelPath('/onboarding')).toBe(true);
    expect(inPanelPath('/login')).toBe(false);
    expect(inPanelPath('/odonto-smile')).toBe(false);
    expect(inPanelPath('/')).toBe(false);
    expect(inPanelPath('/horarios')).toBe(false); // virou redirect, não é porta
  });

  it('403 tem porta de volta derivada do catálogo (nunca hardcoded por tela)', () => {
    const notice = read('src/components/dashboard/AccessNotice.tsx');
    expect(notice).toMatch(/PanelHomeProvider/);
    expect(notice).toMatch(/usePanelHome/);
    expect(notice).toMatch(/const backHref = homeHref \|\| panelHome;/);
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toMatch(/firstAllowedPath\(panelCtx\)/);
    expect(shell).toMatch(/<PanelHomeProvider home=\{homeHref\}>/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. UNIDADE ATIVA (?b=) — visão de organização não exige
// ═══════════════════════════════════════════════════════════════
describe('contexto de unidade — a regra vem do catálogo', () => {
  it('Organização dispensa ?b=; todo o resto exige', () => {
    expect(routeRequiresBusiness('/organizacao')).toBe(false);
    expect(panelRouteFor('/organizacao')?.requiresBusiness).toBe(false);
    expect(routeRequiresBusiness('/dashboard')).toBe(true);
    expect(routeRequiresBusiness('/conversas')).toBe(true);
    // fora do catálogo: conservador (exige)
    expect(routeRequiresBusiness('/onboarding')).toBe(true);
    expect(routeRequiresBusiness('/')).toBe(true);
  });

  it('requiresActiveBusiness é a mesma decisão (sem segunda lista)', () => {
    for (const r of PANEL_ROUTES) {
      expect(requiresActiveBusiness(r.href), r.href).toBe(routeRequiresBusiness(r.href));
    }
    expect(requiresActiveBusiness('/organizacao')).toBe(false);
    expect(requiresActiveBusiness('/dashboard')).toBe(true);
    const bc = read('src/lib/business-context.ts');
    expect(bc).toMatch(/routeRequiresBusiness\(pathname\)/);
    expect(bc).not.toMatch(/!== '\/organizacao'/);
  });

  it('o shell preserva os demais parâmetros ao injetar ?b=', () => {
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toMatch(/new URLSearchParams\(params\.toString\(\)\)/);
    expect(shell).toMatch(/qs\.set\('b', businesses\[0\]\.id\)/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. ROTAS LEGADAS → CANÔNICAS (308, com ?b= preservado)
// ═══════════════════════════════════════════════════════════════
describe('rotas legadas — redirect permanente declarado uma vez', () => {
  it('as quatro portas renomeadas têm origem e destino certos', () => {
    expect(LEGACY_ROUTES).toEqual([
      { from: '/horarios', to: '/disponibilidade' },
      { from: '/whatsapp', to: '/conversas' },
      { from: '/esteira', to: '/funil' },
      { from: '/integracoes', to: '/canais?tab=integracoes' },
    ]);
    for (const { from, to } of LEGACY_ROUTES) {
      expect(panelRouteFor(from), `${from} não pode ser porta`).toBeUndefined();
      expect(panelRouteFor(to.split('?')[0]), `${to} precisa ser porta canônica`).toBeDefined();
    }
  });

  it('next.config.js declara exatamente o mapa do catálogo, como 308', () => {
    const cfg = read('next.config.js');
    expect(cfg).toMatch(/async redirects\(\)/);
    expect(cfg).toMatch(/permanent: true/); // true ⇒ 308 (preserva método)
    expect(cfg).not.toMatch(/permanent: false/);
    for (const { from, to } of LEGACY_ROUTES) {
      expect(cfg, `${from} sem redirect`).toMatch(new RegExp(`from: '${from.replace('/', '\\/')}'`));
      expect(cfg, `${from} → ${to} divergente`).toContain(`to: '${to}'`);
    }
    // nenhuma origem a mais (redirect fantasma = porta que ninguém declarou)
    const sources = [...cfg.matchAll(/from: '([^']+)'/g)].map((m) => m[1]);
    expect(sources.sort()).toEqual(LEGACY_ROUTES.map((r) => r.from).sort());
  });

  it('links antigos de abas de Configurações chegam na porta canônica', () => {
    const cfgPage = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(cfgPage).toMatch(/canais: '\/canais\?tab=canais'/);
    expect(cfgPage).toMatch(/integracoes: '\/canais\?tab=integracoes'/);
    expect(cfgPage).toMatch(/router\.replace/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. UMA PORTA POR CONCEITO (sem navegação paralela)
// ═══════════════════════════════════════════════════════════════
describe('uma porta por conceito', () => {
  it('Configurações só tem abas que EDITAM algo (canais/integrações saíram)', () => {
    const cfgPage = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(cfgPage).not.toMatch(/CanaisIntegracoesView/);
    expect(cfgPage).not.toMatch(/IntegracoesView/);
    expect(cfgPage).toMatch(/\['negocio', 'Negócio'\]/);
    expect(cfgPage).toMatch(/\['agenda', 'Agenda'\]/);
    // A3.3 CONVERGÊNCIA (ponto 2): a aba "Aparência" / "Identidade do painel"
    // SAIU da UI. O painel usa o design system padrão — cor de sidebar não é
    // mais uma escolha do lojista. `appearance.navColor` continua aceito nos
    // dados (sem migração destrutiva), mas nada na tela o edita.
    expect(cfgPage).not.toMatch(/\['aparencia', 'Aparência'\]/);
    expect(cfgPage).not.toMatch(/NAV_PRESETS/);
    expect(cfgPage).not.toMatch(/Identidade do painel/i);
    expect(cfgPage).not.toMatch(/aparência do painel/i);
    expect(cfgPage).not.toMatch(/\['canais', 'Canais'\]/);
    expect(cfgPage).not.toMatch(/\['integracoes', 'Integrações'\]/);
    // A1.2 · Bloco 2: a aba CRM antiga saiu — era texto + links para portas
    // que já estão no menu (segunda navegação disfarçada de configuração).
    expect(cfgPage).not.toMatch(/\['crm', 'CRM'\]/);
  });

  it('A1.2 B2 — Regras de reserva moram em Configurações; Disponibilidade ficou com "quando atende"', () => {
    const cfgPage = read('src/app/(dashboard)/configuracoes/page.tsx');
    // A aba Agenda EDITA a BookingConfig (mesma API de antes — nenhuma engine nova).
    expect(cfgPage).toMatch(/Regras de reserva/);
    expect(cfgPage).toMatch(/leadMin/);
    expect(cfgPage).toMatch(/cancelUntilMin/);
    expect(cfgPage).toMatch(/horizonDays/);
    expect(cfgPage).toMatch(/bufferMin/);
    expect(cfgPage).toMatch(/apiSend\(`\/api\/businesses\/\$\{businessId\}`, 'PATCH', \{ booking: cfg \}/);

    // Disponibilidade não edita mais regras de reserva — só aponta para lá.
    const disp = read('src/app/(dashboard)/disponibilidade/page.tsx');
    expect(disp).not.toMatch(/BookingSettings/);
    expect(disp).not.toMatch(/leadMin/);
    expect(disp).toMatch(/\/configuracoes\?tab=agenda/);
    // O componente saiu dos painéis de catálogo (não há segunda cópia).
    const panels = read('src/components/dashboard/catalog-panels.tsx');
    expect(panels).not.toMatch(/export function BookingSettings/);
  });

  it('A1.2 B2 — tabs relevantes são deep-linkable (estado na URL, não em useState)', () => {
    // Canais: aba derivada do ?tab= a cada render (volta/refresh/deep-link).
    const canais = read('src/app/(dashboard)/canais/page.tsx');
    expect(canais).toMatch(/const tab = tabFromParam\(params\.get\('tab'\)\)/);
    expect(canais).not.toMatch(/useState<CanaisTab>/);
    // Configurações: mesma regra, com redirect legado preservado.
    const cfgPage = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(cfgPage).toMatch(/const tab = tabFromParam\(tabParam\)/);
    expect(cfgPage).toMatch(/router\.push\(`\/configuracoes\?\$\{qs\.toString\(\)\}`/);
    expect(cfgPage).not.toMatch(/useState<ConfigTab>/);
    // Conversas: busca contextual na URL (?q=), filtro client-side seguro.
    const conversas = read('src/app/(dashboard)/conversas/page.tsx');
    expect(conversas).toMatch(/params\.get\('q'\)/);
    expect(conversas).toMatch(/qs\.set\('q'/);
    expect(conversas).toMatch(/qs\.delete\('q'\)/);
  });

  it('A1.2 B2 — Funil administra a MESMA máquina de estados do backend (sem configuração paralela)', () => {
    const esteira = read('src/components/dashboard/EsteiraView.tsx');
    // A UI conecta no pipeline real: normalização de leitura compartilhada…
    expect(esteira).toMatch(/normalizeLeadStageId/);
    // …e o editor de etapas, visível apenas com permissão confirmada pelo servidor.
    expect(esteira).toMatch(/canEditPipeline/);
    expect(esteira).toMatch(/PipelineStagesPanel/);
    const editor = read('src/components/dashboard/PipelineStagesPanel.tsx');
    expect(editor).toMatch(/apiSend\('\/api\/pipeline', 'PATCH'/); // mesma API oficial
    expect(editor).toMatch(/stagesInOrder/);                      // mesma ordem do backend
    expect(editor).not.toMatch(/\/api\/stages/);                  // nenhuma API paralela
    // O guard de escrita continua no servidor.
    const pipelineApi = read('src/app/api/pipeline/route.ts');
    expect(pipelineApi).toMatch(/requireBusiness\(req, businessId, 'config'\)/);
    expect(pipelineApi).toMatch(/canEdit: guard\.ctx\.permissions\.config === true/);
  });

  it('A1.2 B2 — a UI concorda com o guard (atalho do Funil em Clientes exige a permissão de Funil)', () => {
    const clientes = read('src/app/(dashboard)/clientes/page.tsx');
    expect(clientes).toMatch(/usePanelPermissions/);
    expect(clientes).toMatch(/permissions\.leads === true/);
    // O hook resolve a unidade pela MESMA fonte do shell — ?b= estranho não concede nada.
    const hook = read('src/components/dashboard/usePanelPermissions.ts');
    expect(hook).toMatch(/resolveActiveBusinessId\(requested, list\)/);
    expect(hook).toMatch(/\/api\/auth\/me/);
  });

  it('/canais é a porta única de canais, fontes e integrações', () => {
    const canais = read('src/app/(dashboard)/canais/page.tsx');
    expect(canais).toMatch(/WhatsappChannelPanel/);
    expect(canais).toMatch(/CanaisIntegracoesView only="channel"/);
    expect(canais).toMatch(/CanaisIntegracoesView only="source"/);
    expect(canais).toMatch(/CanaisIntegracoesView only="technical"/);
    expect(canais).toMatch(/<IntegracoesView \/>/);
    expect(canais).toMatch(/tab=|qs\.set\('tab'/);
  });

  it('Conversas é o inbox; conectar canal mora em Canais', () => {
    const conversas = read('src/app/(dashboard)/conversas/page.tsx');
    expect(conversas).not.toMatch(/action: 'connect'/);       // não conecta daqui
    expect(conversas).toMatch(/channelsHref/);                 // aponta para a porta certa
    const panel = read('src/components/dashboard/WhatsappChannelPanel.tsx');
    expect(panel).toMatch(/action: 'connect'/);
  });

  it('Tarefas e Execuções têm porta própria e atalho contextual em Automações', () => {
    const auto = read('src/components/dashboard/AutomationsView.tsx');
    expect(auto).toMatch(/href=\{`\/execucoes\$\{unitQuery\}`\}/);
    expect(auto).toMatch(/href=\{`\/tarefas\$\{unitQuery\}`\}/);
    // as abas duplicadas deixaram de existir
    expect(auto).not.toMatch(/tab === 'runs'/);
    expect(auto).not.toMatch(/tab === 'tasks'/);
    expect(read('src/components/dashboard/TaskPanel.tsx')).toMatch(/export function TaskPanel/);
    expect(read('src/components/dashboard/RunsPanel.tsx')).toMatch(/export function RunsPanel/);
  });

  it('Organização é porta real (acessível com uma unidade só)', () => {
    const nav = panelNavigation(ctx());
    expect(nav.sidebar.map((r) => r.href)).toContain('/organizacao');
    expect(nav.sections.find((s) => s.id === 'resultados')?.items.map((r) => r.href))
      .toEqual(['/resultados', '/organizacao']);
    const page = read('src/app/(dashboard)/organizacao/page.tsx');
    expect(page).toMatch(/Adicionar unidade/);
    expect(page).not.toMatch(/businesses\.length > 1/);
  });

  it('Clientes não embute a segunda cópia do funil (atalho contextual permanece)', () => {
    const clientes = read('src/app/(dashboard)/clientes/page.tsx');
    expect(clientes).not.toMatch(/EsteiraView/);
    expect(clientes).toMatch(/href=\{`\/funil\?b=\$\{businessId\}`\}/);
    expect(clientes).toMatch(/router\.replace\(`\/funil/); // ?view=esteira antigo
    expect(clientes).not.toMatch(/Clientes & Esteira/);
  });

  it('todo destino fora do menu tem um atalho contextual real (nunca porta fantasma)', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : (/\.tsx?$/.test(e.name) ? [full] : []);
    });
    const files = [
      ...walk(path.join(root, 'src/app/(dashboard)')),
      ...walk(path.join(root, 'src/components')),
    ];
    // A3.4: só Execuções segue fora do menu; Pedidos passou a ser porta de
    // Operação (com gate de módulo). Destino fora do menu SEM atalho vira
    // porta fantasma — por isso a lista abaixo é curta de propósito.
    const offMenu = PANEL_ROUTES.filter((r) => r.sidebar === false);
    expect(offMenu.map((r) => r.href).sort()).toEqual(['/execucoes']);
    for (const route of offMenu) {
      const own = path.join(root, `src/app/(dashboard)${route.href}`);
      const re = new RegExp('href=\\{[`\'"]' + route.href.replace(/\//g, '\\/'));
      const linked = files.some((f) => !f.startsWith(own) && re.test(readFileSync(f, 'utf8')));
      expect(linked, `${route.href} não tem nenhum atalho contextual`).toBe(true);
    }
  });

  it('atalhos de Oferta são projetados do catálogo (sem segunda lista de links)', () => {
    const panels = read('src/components/dashboard/catalog-panels.tsx');
    expect(panels).toMatch(/panelRoutesIn\('oferta'\)/);
    expect(panels).not.toMatch(/href: `\/horarios/);
    expect(panels).not.toMatch(/'servicos' \| 'profissionais' \| 'horarios'/);
  });

  it('nenhum link interno aponta para rota renomeada', () => {
    const offenders: string[] = [];
    const files = [
      'src/app/(dashboard)/dashboard/page.tsx',
      'src/app/(dashboard)/agente/page.tsx',
      'src/app/(dashboard)/configuracoes/page.tsx',
      'src/lib/dashboard.ts',
      'src/components/dashboard/catalog-panels.tsx',
      'src/components/DashboardShell.tsx',
    ];
    for (const f of files) {
      const src = read(f);
      for (const legacy of ['/horarios', '/whatsapp?', '/whatsapp$', '/esteira', '/integracoes']) {
        const re = new RegExp(`(href=|href: )[\`'"]${legacy.replace('?', '\\?').replace('$', '')}`);
        if (re.test(src)) offenders.push(`${f} → ${legacy}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. GUARDAS DE SERVIDOR (regressão: ninguém remove a checagem)
// ═══════════════════════════════════════════════════════════════
describe('guardas de servidor (regressão)', () => {
  function guardCalls(file: string): string[] {
    const src = read(file);
    return [...src.matchAll(/requireBusiness\(([\s\S]*?)\)\s*;/g)].map((m) => m[1]);
  }

  it('cada API do painel exige a permissão declarada em API_GUARDS', () => {
    expect(API_GUARDS.length).toBeGreaterThanOrEqual(20);
    for (const g of API_GUARDS) {
      expect(existsSync(path.join(root, g.file)), `${g.file} não existe`).toBe(true);
      const calls = guardCalls(g.file);
      expect(calls.length, `${g.file} precisa chamar requireBusiness`).toBeGreaterThan(0);
      const perms = Array.isArray(g.permission) ? g.permission : [g.permission];
      for (const p of perms) {
        const found = calls.some((c) => c.includes(`'${p}'`));
        expect(found, `${g.route} deve exigir '${p}'`).toBe(true);
      }
    }
  });

  it('as portas que faltavam no mapa de guardas estão declaradas', () => {
    const routes = API_GUARDS.map((g) => g.route);
    for (const expected of ['/api/integrations', '/api/integrations/events', '/api/conversations', '/api/reviews']) {
      expect(routes, `${expected} fora de API_GUARDS`).toContain(expected);
    }
  });

  it('leitura compartilhada e tarefas continuam multi-permissão', () => {
    const get = API_GUARDS.find((g) => g.route === '/api/catalog/get');
    expect(Array.isArray(get?.permission)).toBe(true);
    const tasks = API_GUARDS.find((g) => g.route === '/api/tasks');
    expect(tasks?.permission).toEqual(['leads', 'agenda', 'clientes', 'config']);
  });

  it('overview exige dashboard e bookings exige agenda', () => {
    expect(API_GUARDS.find((g) => g.route === '/api/overview')?.permission).toBe('dashboard');
    expect(API_GUARDS.find((g) => g.route === '/api/bookings')?.permission).toBe('agenda');
  });

  it('esconder porta do menu NÃO remove guarda: toda porta tem área e permissão', () => {
    for (const r of PANEL_ROUTES) {
      expect(permissionsForRoute(r).length).toBeGreaterThan(0);
      // destinos fora do menu continuam exigindo permissão no servidor
      if (r.sidebar === false) expect(panelAccess(r.href, emptyPanelContext()).state).toBe('denied');
    }
  });

  it('a lista de portas acessíveis nunca cresce por acidente', () => {
    // Regressão de arquitetura: adicionar destino ao painel exige explicar aqui.
    expect(allowedPanelRoutes(ctx()).map((r) => r.href)).toEqual([
      '/dashboard',
      '/agenda', '/profissionais', '/disponibilidade',
      '/conversas', '/agente', '/tarefas',
      '/clientes', '/funil',
      '/servicos',
      '/campanhas', '/automacoes', '/canais',
      '/resultados', '/organizacao', '/execucoes',
      '/pagina',
      '/equipe', '/recursos', '/configuracoes',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// A1.2 · BLOCO 2 — navegação e permissões das portas reorganizadas
// ═══════════════════════════════════════════════════════════════
describe('A1.2 B2 — permissões das portas reorganizadas', () => {
  it('Funil exige leads; Clientes sozinha não abre o funil', () => {
    expect(panelAccess('/funil', ctx({ permissions: { leads: true } })).state).toBe('allow');
    expect(panelAccess('/funil', ctx({ permissions: { clientes: true } })).state).toBe('denied');
    expect(panelAccess('/funil', ctx({ permissions: { clientes: true, leads: false } })).reason).toBe('permission');
  });

  it('Configurações/Canais/Automações/Execuções exigem config; Conversas exige whatsapp; Tarefas aceita o conjunto operacional', () => {
    expect(panelAccess('/configuracoes', ctx({ permissions: { config: true } })).state).toBe('allow');
    expect(panelAccess('/configuracoes', ctx({ permissions: { clientes: true } })).state).toBe('denied');
    expect(panelAccess('/canais', ctx({ permissions: { config: true } })).state).toBe('allow');
    expect(panelAccess('/canais', ctx({ permissions: { whatsapp: true } })).state).toBe('denied');
    expect(panelAccess('/automacoes', ctx({ permissions: { config: true } })).state).toBe('allow');
    expect(panelAccess('/execucoes', ctx({ permissions: { config: true } })).state).toBe('allow');
    expect(panelAccess('/execucoes', ctx({ permissions: { leads: true } })).state).toBe('denied');
    expect(panelAccess('/conversas', ctx({ permissions: { whatsapp: true } })).state).toBe('allow');
    expect(panelAccess('/conversas', ctx({ permissions: { clientes: true } })).state).toBe('denied');
    // Tarefas: qualquer permissão operacional satisfaz (array = qualquer uma)
    expect(panelAccess('/tarefas', ctx({ permissions: { agenda: true } })).state).toBe('allow');
    expect(panelAccess('/tarefas', ctx({ permissions: { leads: true } })).state).toBe('allow');
    expect(panelAccess('/tarefas', ctx({ permissions: { pagina: true } })).state).toBe('denied');
  });

  it('F1 — a rota de leads não escreve mais estado por LeadStatus (só converte e delega)', () => {
    const leadsApi = read('src/app/api/leads/route.ts');
    // O padrão antigo (l.status = X; l.stageId = X) não existe mais…
    expect(leadsApi).not.toMatch(/l\.stageId = to/);
    expect(leadsApi).not.toMatch(/l\.status = to/);
    expect(leadsApi).not.toMatch(/LEAD_FLOW/);
    // …e a entrada legada passa pela conversão explícita + mecanismo oficial
    expect(leadsApi).toMatch(/isLegacyLeadStatus\(status\)/);
    expect(leadsApi).toMatch(/stageForLegacyStatus\(pipelineNow, status\)/);
    expect(leadsApi).toMatch(/moveLeadStage\(d, \{/);
    expect(leadsApi).toMatch(/normalizeLeadStageId\(pipelineNow, l\)/);
  });

  it('F3 — filtros de leitura comparam pela etapa normalizada (painel e API externa)', () => {
    const leadsApi = read('src/app/api/leads/route.ts');
    expect(leadsApi).toMatch(/normalizeLeadStageId\(pipeline, l\) === target/);
    const ext = read('src/app/api/external/leads/route.ts');
    expect(ext).toMatch(/normalizeLeadStageId\(pipeline, l\) === target/);
    expect(ext).not.toMatch(/\(l\.stageId \|\| l\.status\) === stageId/);
  });

  it('guards de servidor das APIs do funil/pipeline cobrem a operação e a configuração', () => {
    const leads = API_GUARDS.find((g) => g.route === '/api/leads');
    expect(leads?.permission).toBe('leads');
    const pipeline = API_GUARDS.find((g) => g.route === '/api/pipeline');
    expect(pipeline?.permission).toEqual(['leads', 'config']);
    // a escrita do pipeline continua exigindo config no código da rota
    const pipelineApi = read('src/app/api/pipeline/route.ts');
    expect(pipelineApi).toMatch(/requireBusiness\(req, businessId, 'config'\)/);
    // e a escrita de lead continua exigindo leads
    const leadsApi = read('src/app/api/leads/route.ts');
    expect(leadsApi).toMatch(/requireBusiness\(req, businessId, 'leads'\)/);
  });
});

describe('A1.2 B2 — navegação: portas canônicas, tabs e redirects', () => {
  it('/funil é a porta única do kanban; ?view=esteira antigo continua redirecionando', () => {
    // Uma única implementação do kanban — nada de segunda máquina em Clientes
    const clientes = read('src/app/(dashboard)/clientes/page.tsx');
    expect(clientes).not.toMatch(/EsteiraView/);
    expect(clientes).toMatch(/router\.replace\(`\/funil/); // redirect do link antigo
    const funil = read('src/app/(dashboard)/funil/page.tsx');
    expect(funil).toMatch(/<EsteiraView \/>/);
    // o redirecionamento preserva a unidade
    expect(clientes).toMatch(/router\.replace\(`\/funil\$\{businessId \? `\?b=\$\{businessId\}` : ''\}`\)/);
  });

  it('Conversas: estado vazio honesto + CTA para Canais (conexão não mora mais aqui)', () => {
    const conversas = read('src/app/(dashboard)/conversas/page.tsx');
    expect(conversas).toMatch(/Nenhuma conversa ainda/);
    expect(conversas).toMatch(/Conectar canal/);
    expect(conversas).toMatch(/\/canais\?tab=canais/);
    // conversa não conecta canal: só Canais conecta
    expect(conversas).not.toMatch(/action: 'connect'/);
  });

  it('Disponibilidade mantém os atalhos contextuais de Oferta (Serviços e Profissionais)', () => {
    const disp = read('src/app/(dashboard)/disponibilidade/page.tsx');
    expect(disp).toMatch(/CatalogCrossLinks businessId=\{businessId\} current="\/disponibilidade"/);
    // os atalhos vêm do catálogo (seção Oferta) — renomear lá atualiza aqui
    const panels = read('src/components/dashboard/catalog-panels.tsx');
    expect(panels).toMatch(/panelRoutesIn\('oferta'\)/);
    expect(panels).toMatch(/'\/disponibilidade': 'quando atende'/);
  });

  it('Execuções vive em Análise/Resultados e consome as execuções existentes (sem motor novo)', () => {
    expect(panelRouteFor('/execucoes')?.section).toBe('resultados');
    const runs = read('src/components/dashboard/RunsView.tsx');
    expect(runs).toMatch(/\/api\/automations\?businessId=/); // MESMA leitura de antes
    expect(runs).not.toMatch(/\/api\/executions/);           // nenhuma API nova de executor
    // Automações continua na seção Crescimento (configuração/orquestração)
    expect(panelRouteFor('/automacoes')?.section).toBe('crescimento');
  });
});
