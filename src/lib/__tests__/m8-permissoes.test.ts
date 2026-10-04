// ═══════════════════════════════════════════════════════════════
// PERMISSÕES — matrizes preservadas (§26–28) + menu como projeção
// Fixtures: OWNER / SECRETARIA / ATENDENTE / PROFISSIONAL.
//
//   SECRETARIA   = agenda, clientes, leads, whatsapp (Recepção — preset PR #46: sem Visão geral/Pedidos)
//   ATENDENTE    = dashboard, agenda, clientes, whatsapp
//   PROFISSIONAL = dashboard, agenda, clientes, atendimento
//
// Travas: não unificar papéis; NÃO conceder 'atendimento' (evolução clínica)
// à Secretária; o menu do painel é a PROJEÇÃO das permissões efetivas —
// nenhuma rota aparece sem permissão correspondente.
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { permissionsFor, ROLES } from '../permissions';
import {
  PANEL_ROUTES, allowedPanelRoutes, permissionsForRoute, visiblePanelRoutes, type PanelContext,
} from '../panel';
import type { MemberRole, PermissionId } from '../types';

// ── Fixtures: permissões efetivas de cada papel ──
const ALL: PermissionId[] = ROLES.find((r) => r.id === 'OWNER')!.permissions.slice();
const FIXTURES: Array<{ role: MemberRole; matrix: PermissionId[] }> = [
  {
    role: 'SECRETARIA',
    matrix: ['agenda', 'clientes', 'whatsapp'],
  },
  {
    role: 'ATENDENTE',
    matrix: ['dashboard', 'agenda', 'clientes', 'whatsapp'],
  },
  {
    role: 'PROFISSIONAL',
    matrix: ['dashboard', 'agenda', 'clientes', 'atendimento'],
  },
  {
    role: 'OWNER',
    matrix: ALL,
  },
];

function ctxOf(matrix: PermissionId[]): PanelContext {
  const permissions: Partial<Record<PermissionId, boolean>> = {};
  for (const p of matrix) permissions[p] = true;
  // Módulos comerciais plenos para as rotas que dependem de modo
  return { permissions, modes: ['services', 'bookings', 'orders', 'products'], features: {} };
}

describe('§26–28 · matrizes de permissão (fixtures OWNER/SECRETARIA/ATENDENTE/PROFISSIONAL)', () => {
  it('SECRETARIA (Recepção) = agenda/clientes/whatsapp (Oportunidades somente por override)', () => {
    expect(permissionsFor('SECRETARIA')).toMatchObject(
      Object.fromEntries(FIXTURES[0].matrix.map((p) => [p, true])),
    );
    // e SÓ isso (nada além da matriz)
    for (const p of ['leads', 'dashboard', 'pedidos', 'catalogo', 'pagina', 'agente', 'campanhas', 'equipe', 'config', 'financeiro', 'admin', 'atendimento'] as PermissionId[]) {
      expect(permissionsFor('SECRETARIA')[p], p).toBe(false);
    }
  });

  it('ATENDENTE = dashboard/agenda/clientes/whatsapp (sem leads/pedidos)', () => {
    const perms = permissionsFor('ATENDENTE');
    for (const p of FIXTURES[1].matrix) expect(perms[p], p).toBe(true);
    for (const p of ['leads', 'pedidos', 'atendimento', 'config', 'equipe'] as PermissionId[]) {
      expect(perms[p], p).toBe(false);
    }
  });

  it('PROFISSIONAL = dashboard/agenda/clientes/atendimento (evolução clínica)', () => {
    const perms = permissionsFor('PROFISSIONAL');
    for (const p of FIXTURES[2].matrix) expect(perms[p], p).toBe(true);
    expect(perms.atendimento).toBe(true);
    for (const p of ['leads', 'pedidos', 'whatsapp', 'config'] as PermissionId[]) {
      expect(perms[p], p).toBe(false);
    }
  });

  it('NUNCA conceder atendimento à Secretária (nem por override implícito)', () => {
    expect(permissionsFor('SECRETARIA').atendimento).toBe(false);
    // override individual explícito pode ajustar o padrão, mas o PADRÃO nunca
    expect(permissionsFor('SECRETARIA', { atendimento: true }).atendimento).toBe(true);
  });

  it('os papéis não são unificados: matrizes pairwise diferentes', () => {
    const s = JSON.stringify(permissionsFor('SECRETARIA'));
    const a = JSON.stringify(permissionsFor('ATENDENTE'));
    const p = JSON.stringify(permissionsFor('PROFISSIONAL'));
    expect(new Set([s, a, p]).size).toBe(3);
  });
});

describe('menu = projeção das permissões efetivas', () => {
  it.each(FIXTURES.map((f) => [f.role, f] as const))('%s: nenhuma rota sem permissão aparece no menu', (_role, f) => {
    const ctx = ctxOf(f.matrix);
    const visible = visiblePanelRoutes(ctx);
    expect(visible.length).toBeGreaterThan(0);
    for (const route of visible) {
      const needed = permissionsForRoute(route);
      const ok = needed.length === 0 || needed.some((p) => f.matrix.includes(p));
      expect(ok, `${route.href} exige ${needed.join('/')}`).toBe(true);
    }
  });

  it('SECRETARIA: vê as áreas operacionais e NÃO vê config/equipe/financeiro', () => {
    const visible = visiblePanelRoutes(ctxOf(FIXTURES[0].matrix)).map((r) => r.href);
    expect(visible).toEqual(expect.arrayContaining(['/agenda', '/clientes', '/tarefas', '/conversas']));
    expect(visible).not.toContain('/funil');
    // Recepção pré-F1: sem Oportunidades, Pedidos nem Visão geral por padrão
    expect(visible).not.toContain('/pedidos');
    expect(visible).not.toContain('/dashboard');
    expect(visible).not.toEqual(expect.arrayContaining(['/equipe']));
    expect(visible.some((h) => h.startsWith('/config'))).toBe(false);
    expect(visible.some((h) => h.startsWith('/financeiro'))).toBe(false);
  });

  it('ATENDENTE: sem oportunidades (leads) e sem pedidos', () => {
    const visible = visiblePanelRoutes(ctxOf(FIXTURES[1].matrix)).map((r) => r.href);
    expect(visible).toEqual(expect.arrayContaining(['/agenda', '/clientes', '/conversas']));
    expect(visible).not.toEqual(expect.arrayContaining(['/funil']));
    expect(visible).not.toEqual(expect.arrayContaining(['/pedidos']));
  });

  it('PROFISSIONAL: vê o atendimento (evolução) e nada de operação de balcão além do básico', () => {
    const visible = visiblePanelRoutes(ctxOf(FIXTURES[2].matrix)).map((r) => r.href);
    expect(visible).toEqual(expect.arrayContaining(['/agenda', '/clientes']));
    // oportunidades (funil/leads) não entram
    expect(visible).not.toEqual(expect.arrayContaining(['/funil']));
  });

  it('OWNER: acessível = catálogo inteiro; menu = os que têm linha (sidebar)', () => {
    const ctx = ctxOf(FIXTURES[3].matrix);
    expect(allowedPanelRoutes(ctx).length).toBe(PANEL_ROUTES.length);
    const visible = visiblePanelRoutes(ctx);
    // as rotas fora do menu são as de sidebar:false — acessíveis por URL
    expect(visible.length).toBeLessThan(PANEL_ROUTES.length);
    expect(visible.length).toBeGreaterThan(0);
  });
});
