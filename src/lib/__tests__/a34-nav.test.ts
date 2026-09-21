// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 1 — NAVEGAÇÃO E COERÊNCIA VISUAL
// ═══════════════════════════════════════════════════════════════
// Regressões do que esta entrega MUDA no menu (e do que ela se recusa a mexer):
//   • "Dashboard" → "Início" na LINGUAGEM, sem tocar em rota/permissão;
//   • a nova ordem das seções (Início · Operação · Pessoas · Oferta ·
//     Crescimento · Resultados · Presença · Administração);
//   • Profissionais/Disponibilidade em Operação; Pedidos em Operação com gate
//     de MÓDULO; Execuções fora da sidebar, alcançável por atalho contextual;
//   • "Outros destinos" não existe mais;
//   • item ativo usa a cor DA SEÇÃO (ícone, rail e fundo soft) — nunca azul
//     forçado em todas as seções.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PANEL_ROUTES, PANEL_SECTIONS, SECTION_THEME, panelNavigation, panelRoutesIn, panelRouteFor,
  sectionTheme, type PanelContext,
} from '../panel';
import { PERMISSIONS } from '../permissions';
import { AREA_LABELS } from '../http';
import { buildNavSearchItems, searchNav } from '../nav-search';
import type { PermissionId } from '../types';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
/** Código sem comentários: só o que o usuário pode LER conta nesta regressão. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

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

describe('A3.4 · NAV — "Dashboard" virou "Início" na interface', () => {
  it('a porta /dashboard se chama Início', () => {
    expect(panelRouteFor('/dashboard')?.label).toBe('Início');
  });

  it('ROTA e PERMISSÃO continuam `dashboard` (nenhuma renomeação desnecessária)', () => {
    // Link salvo, permissão gravada por unidade e API não mudam por rótulo.
    expect(panelRouteFor('/dashboard')?.href).toBe('/dashboard');
    expect(panelRouteFor('/dashboard')?.permission).toBe('dashboard');
    expect(panelRouteFor('/dashboard')?.area).toBe('dashboard');
    const file = 'src/app/(dashboard)/dashboard/page.tsx';
    expect(existsSync(path.join(root, file))).toBe(true);
  });

  it('o rótulo mudou em TODA a linguagem visível: menu, busca, permissões e áreas', () => {
    expect(PERMISSIONS.find((p) => p.id === 'dashboard')?.label).toBe('Início');
    expect(AREA_LABELS.dashboard).toBe('Início');
    const nav = panelNavigation(ctx());
    const item = buildNavSearchItems(nav, '?b=x').find((i) => i.path === '/dashboard');
    expect(item?.label).toBe('Início');
    const found = searchNav(buildNavSearchItems(nav, '?b=x'), 'inicio');
    expect(found[0].path).toBe('/dashboard');
  });

  it('nenhum texto visível do painel ainda chama a tela de "Dashboard"', () => {
    const files = [
      'src/app/(dashboard)/dashboard/page.tsx',
      'src/app/(dashboard)/equipe/page.tsx',
      'src/app/(dashboard)/pagina/page.tsx',
      'src/components/DashboardShell.tsx',
    ];
    for (const f of files) {
      // Comentários podem citar o nome histórico; o que não pode é aparecer
      // como rótulo em string de UI.
      const visible = stripComments(read(f));
      expect(visible, f).not.toMatch(/['"`>]Dashboard['"`<]/);
    }
  });
});

describe('A3.4 · NAV — seções e ordem nova', () => {
  it('as 8 seções na ordem aprovada', () => {
    expect(PANEL_SECTIONS.map((s) => s.label)).toEqual([
      'Início', 'Operação', 'Pessoas', 'Oferta', 'Crescimento', 'Resultados', 'Presença', 'Administração',
    ]);
  });

  it('Profissionais e Disponibilidade estão em OPERAÇÃO (não mais em Oferta)', () => {
    expect(panelRoutesIn('operacao').map((r) => r.href)).toEqual([
      '/agenda', '/profissionais', '/disponibilidade', '/conversas', '/agente', '/tarefas', '/pedidos',
    ]);
    expect(panelRoutesIn('oferta').map((r) => r.href)).toEqual(['/servicos', '/produtos']);
  });

  it('Pedidos aparece em Operação SOMENTE com o módulo de pedidos ativo', () => {
    const comModulo = panelNavigation(ctx({ modes: ['bookings', 'orders'] }));
    const pedidos = comModulo.sections.find((s) => s.id === 'operacao')?.items.map((r) => r.href) || [];
    expect(pedidos).toContain('/pedidos');

    const semModulo = panelNavigation(ctx({ modes: ['bookings'] }));
    expect(semModulo.sidebar.map((r) => r.href)).not.toContain('/pedidos');
    expect(semModulo.sections.some((s) => s.items.some((i) => i.href === '/pedidos'))).toBe(false);
  });

  it('Execuções NÃO aparece na sidebar — e continua acessível por atalho contextual', () => {
    const nav = panelNavigation(ctx());
    expect(nav.sidebar.map((r) => r.href)).not.toContain('/execucoes');
    expect(nav.more.map((r) => r.href)).toEqual(['/execucoes']);
    // O atalho vive dentro de Automações (fonte: URLs diretas do painel).
    const automations = read('src/components/dashboard/AutomationsView.tsx');
    expect(automations).toMatch(/\/execucoes/);
  });

  it('"Outros destinos" e o grupo `nav.more` não existem mais na interface', () => {
    const shell = stripComments(read('src/components/DashboardShell.tsx'));
    expect(shell).not.toMatch(/Outros destinos/);
    expect(shell).not.toMatch(/nav\.more/);
  });
});

// Legacy theme helpers stay compatible; the D360 workspace selection is tested in DOM/browser.
describe('A3.4 · NAV — compatibilidade dos temas legados', () => {


  it('cada seção tem fundo ativo próprio (não existe "azul para tudo")', () => {
    const bags = PANEL_SECTIONS.map((s) => SECTION_THEME[s.id].activeBg);
    // Pelo menos 5 famílias distintas de fundo: azul, teal, lilás, âmbar,
    // verde, neutro — a seleção conta a mesma história do ícone.
    expect(new Set(bags).size).toBeGreaterThanOrEqual(5);
    expect(SECTION_THEME.pessoas.activeBg).toBe('var(--teal-bg)');
    expect(SECTION_THEME.oferta.activeBg).toBe('var(--lilac-bg)');
    expect(SECTION_THEME.crescimento.activeBg).toBe('var(--warning-bg)');
    expect(SECTION_THEME.resultados.activeBg).toBe('var(--success-bg)');
  });

  it('seção desconhecida cai em neutro (nunca quebra a renderização)', () => {
    expect(sectionTheme(undefined).accent).toBe('var(--text-muted)');
    expect(sectionTheme('nao-existe' as never).activeBg).toBe('var(--surface-3)');
  });

  it('toda seção do catálogo tem tema completo e tokenizado', () => {
    for (const sec of PANEL_SECTIONS) {
      const t = SECTION_THEME[sec.id];
      expect(t, sec.id).toBeTruthy();
      for (const token of [t.accent, t.activeBg, t.activeFg]) {
        expect(token, sec.id).toMatch(/^var\(--[a-z0-9-]+\)$/);
      }
    }
    // Toda porta do catálogo aponta para uma seção que existe no tema.
    for (const r of PANEL_ROUTES) {
      expect(r.section, `${r.href} sem seção`).toBeTruthy();
      expect(SECTION_THEME[r.section!], `${r.href} em seção sem tema`).toBeTruthy();
    }
  });
});
