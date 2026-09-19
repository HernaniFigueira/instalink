// Fechamento A3.3 (ponto 2) — busca de navegação.
// O botão de busca da sidebar não pode ser decorativo: procura no catálogo REAL
// (label + descrição), respeita permissão e leva para a rota com ?b= certo.
import { describe, expect, it } from 'vitest';
import { panelNavigation } from '../panel';
import { buildNavSearchItems, fold, navSearchHref, searchNav } from '../nav-search';
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

const UNIT = '?b=biz-clinica';
const items = () => buildNavSearchItems(panelNavigation(ctx()), UNIT);

describe('busca de navegação — casa com o que o usuário digita', () => {
  // Os exemplos do briefing, contra o catálogo REAL. Em português o singular
  // não é substring do plural ("configuração" ⊄ "Configurações"), então a
  // busca casa por radical — é exatamente isso que estes testes travam.
  const casos: Array<[string, string]> = [
    ['agenda', '/agenda'],
    ['cliente', '/clientes'],
    ['whatsapp', '/canais'],
    ['automação', '/automacoes'],
    ['configuração', '/configuracoes'],
  ];

  for (const [query, esperado] of casos) {
    it(`"${query}" acha ${esperado}`, () => {
      const found = searchNav(items(), query);
      expect(found.length, `busca "${query}" não achou nada`).toBeGreaterThan(0);
      expect(found.map((i) => i.path)).toContain(esperado);
    });
  }

  it('o rótulo vence a descrição: "cliente" abre em Clientes, não em Conversas', () => {
    expect(searchNav(items(), 'cliente')[0].path).toBe('/clientes');
  });

  it('ignora acento e caixa ("CONFIGURACAO" = "Configurações")', () => {
    expect(fold('Configuração')).toBe('configuracao');
    const found = searchNav(items(), 'CONFIGURACAO');
    expect(found.map((i) => i.path)).toContain('/configuracoes');
  });

  it('busca também pela DESCRIÇÃO, não só pelo nome', () => {
    // "aparência" está na descrição de Configurações e não no rótulo.
    const found = searchNav(items(), 'aparência');
    expect(found.map((i) => i.path)).toContain('/configuracoes');
  });

  it('busca com duas palavras exige as duas (E, não OU)', () => {
    const duas = searchNav(items(), 'regras reserva');
    expect(duas.map((i) => i.path)).toContain('/configuracoes');
    expect(searchNav(items(), 'regras zzzz-inexistente')).toEqual([]);
  });

  it('traz a tela atual primeiro', () => {
    const found = searchNav(items(), 'a', '/clientes');
    expect(found[0].path).toBe('/clientes');
  });

  it('query vazia lista tudo (o popover serve de índice)', () => {
    expect(searchNav(items(), '').length).toBe(items().length);
  });

  it('nada encontrado devolve lista vazia, não erro', () => {
    expect(searchNav(items(), 'zzzz-nao-existe')).toEqual([]);
  });
});

describe('busca de navegação — respeita permissão (não vaza destino)', () => {
  it('a fonte é o nav permitido: mesmo tamanho, mesmos destinos', () => {
    const nav = panelNavigation(ctx());
    const built = buildNavSearchItems(nav, UNIT);
    expect(built.map((i) => i.path).sort()).toEqual(nav.allowed.map((r) => r.href).sort());
  });

  it('sem permissão de WhatsApp, Conversas some da busca', () => {
    const semWhats = buildNavSearchItems(
      panelNavigation(ctx({ permissions: { ...Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true])), whatsapp: false } })),
      UNIT,
    );
    expect(semWhats.map((i) => i.path)).not.toContain('/conversas');
    expect(searchNav(semWhats, 'conversas')).toEqual([]);
  });

  it('sem permissão de config, Canais e Automações somem da busca', () => {
    const semConfig = buildNavSearchItems(
      panelNavigation(ctx({ permissions: { ...Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true])), config: false } })),
      UNIT,
    );
    const paths = semConfig.map((i) => i.path);
    expect(paths).not.toContain('/canais');
    expect(paths).not.toContain('/automacoes');
  });

  it('quem não administra não acha Configurações nem Equipe', () => {
    const restrito = buildNavSearchItems(
      panelNavigation(ctx({ permissions: { ...Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true])), config: false, admin: false, equipe: false } })),
      UNIT,
    );
    const paths = restrito.map((i) => i.path);
    expect(paths).not.toContain('/configuracoes');
    expect(paths).not.toContain('/equipe');
  });
});

describe('busca de navegação — leva para a rota real', () => {
  it('preserva o ?b= da unidade nas rotas que exigem unidade', () => {
    const agenda = items().find((i) => i.path === '/agenda');
    expect(agenda?.href).toBe(`/agenda${UNIT}`);
  });

  it('rota que não exige unidade não recebe ?b=', () => {
    const nav = panelNavigation(ctx());
    const semUnidade = nav.allowed.find((r) => r.requiresBusiness === false);
    expect(semUnidade, 'o catálogo tem ao menos uma rota sem unidade').toBeTruthy();
    expect(navSearchHref(semUnidade!, UNIT)).toBe(semUnidade!.href);
  });

  it('cada resultado carrega ícone e seção para a apresentação', () => {
    for (const item of items()) {
      expect(item.icon).toBeTruthy();
      expect(item.section).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });
});
