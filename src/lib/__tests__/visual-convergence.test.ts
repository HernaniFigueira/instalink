import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PANEL_SECTIONS, PANEL_ROUTES } from '../panel';
import { ATTENTION_MARK_CLS, ATTENTION_RING_CLS, BOOKING_BLOCK, toneCls, type Tone } from '../status';
import { sectionAccent, SECTION_ACCENT, SECTION_THEME, sectionTheme } from '../panel';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

/**
 * Remove comentários de linha e de bloco (e comentários JSX) antes de auditar.
 *
 * Por quê: a régua de white label é sobre o que o LOJISTA VÊ. Um comentário
 * interno que menciona o nome do produto é documentação legítima — e a tarefa
 * pede explicitamente para não apagar nomes internos de código sem necessidade.
 * Sem isso o teste passaria a exigir apagar comentário, que não é o requisito.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}
const exists = (rel: string) => {
  try { read(rel); return true; } catch { return false; }
};

/** Rotas do painel autenticado, a partir do catálogo (fonte única). */
const ROUTE_FILES = PANEL_ROUTES
  .map((r) => `src/app/(dashboard)${r.href === '/dashboard' ? '/dashboard' : r.href}/page.tsx`)
  .filter(exists);

/**
 * Fonte efetiva de uma rota: o `page.tsx` MAIS a *View que ela delega.
 * Várias rotas são wrappers finos (`/tarefas` → `<TasksView />`), então auditar
 * só o arquivo da rota acusaria falsamente a falta de um cabeçalho que existe.
 *
 * Só os componentes `*View` entram: eles SÃO o corpo da página. Puxar qualquer
 * import seria errado — todo mundo importa `AccessNotice`, que tem um `<h1>`
 * próprio no aviso de 403, e isso contaminaria a auditoria de cabeçalho.
 */
function routeSource(rel: string): string {
  const own = read(rel);
  const parts = [own];
  for (const m of own.matchAll(/from '@\/components\/dashboard\/([A-Za-z0-9_-]+View)'/g)) {
    const dep = `src/components/dashboard/${m[1]}.tsx`;
    if (exists(dep)) parts.push(read(dep));
  }
  return parts.join('\n');
}

/**
 * Rotas cujo cabeçalho é deliberadamente próprio (e por quê).
 *
 * A convergência pede UM padrão — não pede que layouts diferentes finjam ser
 * iguais. Estas telas têm uma barra de contexto que não é título de seção:
 *   • /dashboard    → o título é o NOME DA EMPRESA (identidade do workspace);
 *   • /organizacao  → o título é o NOME DA ORGANIZAÇÃO;
 *   • /agenda       → tela full-width: toolbar densa de navegação de período;
 *   • /conversas    → painel dividido (lista + conversa), com título de painel;
 *   • /pagina       → breadcrumb do negócio + estado de publicação.
 * Em todas, a tipografia já usa os tokens do design system — o que a régua
 * combate é `<h1>` com classe ad-hoc convivendo com PageHeader, e isso não é
 * o caso aqui.
 */
const OWN_HEADER_ROUTES = ['/dashboard', '/organizacao', '/agenda', '/conversas', '/pagina'];

/** Componentes compartilhados do painel (tudo que as rotas importam daqui). */
const COMPONENT_FILES = readdirSync(path.join(root, 'src/components/dashboard'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => `src/components/dashboard/${f}`);

const PANEL_FILES = [...ROUTE_FILES, ...COMPONENT_FILES, 'src/components/DashboardShell.tsx', 'src/components/ui.tsx'];

// ═══════════════════════════════════════════════════════════════
// A3.3 CONVERGÊNCIA (ponto 17) — REGRESSÃO VISUAL POR CÓDIGO-FONTE
// ═══════════════════════════════════════════════════════════════
// O painel convergiu para UM design system. Estes testes existem para a
// convergência não regredir na próxima tela nova: eles leem o fonte e travam as
// regras visuais que foram acordadas. Não são snapshot de pixel (frágil e sem
// jsdom no projeto) — são invariantes de código, que falham apontando o arquivo.
//
// Cada `it` nomeia a regra e lista os arquivos que a violam, para o erro ser
// acionável em vez de um diff ilegível.

describe('A3.3 — nenhum CTA primário preto no painel', () => {
  it('nenhum arquivo do painel pinta ação primária de preto', () => {
    // `bg-zinc-900`/`bg-black` eram o primário antigo. Preto continua válido
    // para TEXTO e OVERLAY — por isso a régua aqui é a classe de fundo solta,
    // e o overlay foi tokenizado em `var(--overlay)`.
    const offenders = PANEL_FILES.filter((f) => /bg-zinc-900|bg-zinc-800|bg-black\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('overlays de modal/drawer usam o token, não opacidade avulsa', () => {
    const loose = PANEL_FILES.filter((f) => /bg-black\/\d+/.test(read(f)));
    expect(loose).toEqual([]);
  });

  it('o design system oferece primário brand (para onde o CTA deve ir)', () => {
    const ui = read('src/components/ui.tsx');
    // Se alguém apagar o variant primary, a migração não tem destino — o teste
    // falha antes que alguém volte a improvisar um botão preto.
    expect(ui).toMatch(/primary:\s*\n?\s*'bg-\[var\(--brand\)\]/);
    expect(ui).toMatch(/shadow-brand/);
  });
});

describe('A3.3 — superfícies e cores vêm de token', () => {
  it('nenhum componente do painel carrega hex próprio', () => {
    // Regra da tarefa: "sem novos hex em componentes". Hex só mora em
    // globals.css (definição de token).
    const offenders = [...ROUTE_FILES, ...COMPONENT_FILES, 'src/components/DashboardShell.tsx']
      .filter((f) => /#[0-9a-fA-F]{6}\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('tokens de acento usados pelo painel existem em globals.css', () => {
    const css = read('src/app/globals.css');
    const used = new Set<string>();
    for (const f of PANEL_FILES) {
      for (const m of read(f).matchAll(/var\((--[a-z0-9-]+)\)/g)) used.add(m[1]);
    }
    const missing = [...used].filter((t) => !css.includes(`${t}:`));
    expect(missing).toEqual([]);
  });
});

describe('A3.3 — StatusBadge é suave, nunca bloco saturado', () => {
  const TONES: Tone[] = ['amber', 'orange', 'yellow', 'emerald', 'blue', 'zinc', 'red', 'purple'];

  it('nenhum tom renderiza fundo sólido 500/600/700 nem texto branco', () => {
    for (const tone of TONES) {
      const cls = toneCls(tone);
      expect(cls, tone).not.toMatch(/bg-[a-z]+-(500|600|700)\b/);
      expect(cls, tone).not.toMatch(/text-white/);
      expect(cls, tone).toMatch(/var\(--/);
    }
  });

  it('todo tom continua tendo fundo, texto e borda (selo legível)', () => {
    for (const tone of TONES) {
      const cls = toneCls(tone);
      expect(cls, tone).toMatch(/bg-/);
      expect(cls, tone).toMatch(/text-/);
      expect(cls, tone).toMatch(/border-/);
    }
  });

  it('tons diferentes não colapsam na mesma cor', () => {
    const classes = new Set(TONES.map((t) => toneCls(t)));
    expect(classes.size).toBeGreaterThanOrEqual(6);
  });

  it('o marcador de "precisa de fechamento" é discreto (rail fino, não ring grosso)', () => {
    expect(ATTENTION_RING_CLS).toMatch(/ring-1/);
    expect(ATTENTION_RING_CLS).not.toMatch(/ring-2/);
    expect(ATTENTION_RING_CLS).toMatch(/var\(--attention-border\)/);
    expect(ATTENTION_MARK_CLS).toMatch(/var\(--attention-mark-fg\)/);
  });

  it('a régua de estado da agenda segue a mesma família de cor', () => {
    // Harmonização pedida no ponto 5: o selo e o bloco da agenda não podem
    // divergir (um suave, outro gritando).
    for (const cls of Object.values(BOOKING_BLOCK)) {
      expect(cls).not.toMatch(/bg-[a-z]+-(500|600|700)\b/);
    }
  });
});

describe('A3.3 — white label no painel autenticado', () => {
  it('o shell não renderiza o nome do produto em lugar nenhum', () => {
    const shell = stripComments(read('src/components/DashboardShell.tsx'));
    // Marcas antigas: iniciais "IL", wordmark, fallback de nome/role e rodapé
    // "InstaLink.app". Tudo saiu — a identidade visível é a da EMPRESA.
    expect(shell).not.toMatch(/InstaLink|GoDoutor/);
    expect(shell).not.toMatch(/>\s*IL\s*</);
    expect(shell).not.toMatch(/InstaLink\.app/);
  });





  it('nenhuma rota do painel escreve o nome do produto na tela', () => {
    const offenders = ROUTE_FILES.filter((f) => /InstaLink|GoDoutor/.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });
});

describe('A3.3 — personalização de cor do painel saiu da UI', () => {
  it('Configurações não oferece mais "Aparência" nem "Identidade do painel"', () => {
    const cfg = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(cfg).not.toMatch(/\['aparencia', 'Aparência'\]/);
    expect(cfg).not.toMatch(/Identidade do painel/i);
    expect(cfg).not.toMatch(/NAV_PRESETS/);
    expect(cfg).not.toMatch(/navColor/);
    expect(cfg).not.toMatch(/aparência do painel/i);
  });

  it('o dado antigo continua ARMAZENADO (sem migração destrutiva)', () => {
    // Compatibilidade de armazenamento: o campo segue no schema e os helpers
    // legados continuam existindo para sanitizar/ler dado antigo. Isso é
    // diferente de APLICAR a cor ao painel — ver teste seguinte.
    const appearance = read('src/lib/appearance.ts');
    expect(appearance).toMatch(/navColorOf/);
    expect(appearance).toMatch(/NAV_PRESETS/);
    expect(appearance).toMatch(/sanitizeAppearance/);
    const types = read('src/lib/types.ts');
    expect(types).toMatch(/navColor/);
  });

  it('REGRESSÃO: o DashboardShell NÃO aplica o navColor da unidade ao painel', () => {
    // Este é o ponto que importa. Remover a aba "Aparência" da UI não basta:
    // enquanto o shell injetasse `navTokenStyle(business?.appearance?.navColor)`
    // no container, qualquer unidade com cor legada persistida continuava
    // tematizando a sidebar — contradizendo "painel com UM design system".
    //
    // A régua é ampla de propósito: pega a leitura direta, a chamada com o
    // business como argumento e o campo no tipo local do shell.
    // Com comentários removidos: o shell documenta DE PROPÓSITO o que foi
    // retirado ("aqui já existiu style={navTokenStyle(business?.appearance?
    // .navColor)}"), e auditar o texto do comentário produziria falso positivo.
    // O que importa é o código executável — como no teste de white label.
    const shell = stripComments(read('src/components/DashboardShell.tsx'));

    expect(shell).not.toMatch(/appearance\?\.navColor/);
    expect(shell).not.toMatch(/navColorOf\(/);
    expect(shell).not.toMatch(/navTokenStyle\(\s*business/);
    expect(shell).not.toMatch(/appearance\?\s*:\s*\{\s*navColor/);

    // Nenhuma injeção inline de token de navegação a partir do business.
    expect(shell).not.toMatch(/style=\{navTokenStyle\([^)]+\)\}/);

    // A aparência da navegação vem de globals.css (:root), que é onde os
    // tokens padrão já estão definidos — fonte única, igual para toda empresa.
    const css = read('src/app/globals.css');
    for (const token of ['--il-nav', '--il-nav-fg', '--il-nav-active', '--il-nav-active-fg', '--il-nav-cta']) {
      expect(css, token).toMatch(new RegExp(`${token}:`));
    }
  });

  it('nenhuma outra tela do painel lê navColor para montar a aparência', () => {
    // Impede o mesmo erro por outro caminho (um layout novo, um provider…).
    const offenders = PANEL_FILES.filter((f) => /navColorOf\(|navTokenStyle\(\s*business/.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });
});

describe('A3.3 — avatar único para pessoas', () => {
  it('existe um componente Avatar e ele é o padrão (foto ou iniciais)', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).toMatch(/export function Avatar/);
    expect(ui).toMatch(/rounded-md/);
  });

  /**
   * Telas que listam PESSOAS. É nelas que a inicial-de-nome desenhada na mão era
   * duplicada (Profissionais/Equipe/Agenda tinham cada uma o seu círculo).
   */
  const PERSON_SCREENS = [
    'src/app/(dashboard)/equipe/page.tsx',
    'src/app/(dashboard)/clientes/page.tsx',
    'src/components/dashboard/catalog-panels.tsx', // TeamEditor = lista de profissionais
    'src/components/dashboard/ClientProfileDrawer.tsx',
  ];

  it('nenhuma tela de pessoas desenha avatar na mão — todas usam <Avatar>', () => {
    const offenders = PERSON_SCREENS.filter((f) => {
      const src = read(f);
      return /\.name\s*(\?\?[^)]*)?\.slice\(0,\s*1\)/.test(src) || !/<Avatar/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('thumbnails do catálogo preservam tokens; logo proporcional é verificado no browser', () => {
    // Ponto 9/10: são OUTROS conceitos (não são Avatar de pessoa), mas não podem
    // viver com classe ad-hoc — mesmo `rounded-md` e cores de token.
    const THUMBNAILS = [
      ['src/app/(dashboard)/servicos/page.tsx', /rounded-md bg-\[var\(--surface-2\)\] border border-\[var\(--border\)\]/],
      ['src/app/(dashboard)/produtos/page.tsx', /rounded-md bg-\[var\(--surface-2\)\][^"]*border border-\[var\(--border\)\]/],
    ] as const;
    for (const [rel, re] of THUMBNAILS) {
      expect(read(rel), rel).toMatch(re);
    }
    // E nenhum thumbnail pode continuar com a classe ad-hoc antiga.
    for (const rel of ['src/app/(dashboard)/servicos/page.tsx', 'src/app/(dashboard)/produtos/page.tsx']) {
      expect(read(rel), rel).not.toMatch(/rounded-md bg-zinc-100/);
    }
  });

  it('Profissionais, Equipe e Clientes importam o Avatar compartilhado', () => {
    for (const rel of ['src/app/(dashboard)/profissionais/page.tsx', 'src/app/(dashboard)/clientes/page.tsx']) {
      const usesAvatar = /Avatar/.test(read(rel)) || /TeamEditor/.test(read(rel));
      expect(usesAvatar, rel).toBe(true);
    }
    // TeamEditor (Profissionais) usa o mesmo componente — não o círculo manual.
    expect(read('src/components/dashboard/catalog-panels.tsx')).toMatch(/<Avatar/);
    expect(read('src/app/(dashboard)/equipe/page.tsx')).toMatch(/<Avatar/);
  });
});

describe('A3.3 — páginas migradas usam os primitivos compartilhados', () => {
  it('toda rota do catálogo tem cabeçalho do design system (PageHeader)', () => {
    // Uma tela não pode ficar com H1 solto enquanto a vizinha usa PageHeader —
    // foi exatamente essa inconsistência que a convergência corrigiu.
    const offenders = ROUTE_FILES.filter(
      (f) => !OWN_HEADER_ROUTES.some((h) => f.includes(`${h}/page.tsx`)) && !/PageHeader/.test(routeSource(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('nenhuma rota usa <h1> próprio — quem titula a página é o PageHeader', () => {
    // PageHeader já renderiza o <h1> (com o mesmo peso/tamanho em toda tela).
    // Um <h1> avulso por rota é como a tipografia voltava a divergir.
    //
    // Exceções declaradas: telas cujo título é o NOME DE UMA ENTIDADE e não o
    // nome da seção (Dashboard mostra a empresa, Organização mostra a
    // organização, Conversas titula os painéis de um layout dividido). Nesses
    // casos o h1 é semântico e o PageHeader não se aplica.
    const offenders = ROUTE_FILES.filter(
      (f) => !OWN_HEADER_ROUTES.some((h) => f.includes(`${h}/page.tsx`)) && /<h1\b/.test(routeSource(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('caixas de mensagem usam Notice, não parágrafo preto/vermelho sólido', () => {
    const offenders = PANEL_FILES.filter((f) => /<p className="[^"]*bg-(zinc-900|red-600)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('o botão liga/desliga é o Switch do design system (nada de toggle manual)', () => {
    const recursos = read('src/app/(dashboard)/recursos/page.tsx');
    expect(recursos).toMatch(/<Switch/);
    // O toggle antigo media w-14 h-8 e pintava a borda do card de verde.
    expect(recursos).not.toMatch(/w-14 h-8/);
    expect(recursos).not.toMatch(/border-emerald-200/);
    expect(recursos).toMatch(/<Badge/);
  });

  it('estado vazio usa EmptyState compartilhado', () => {
    const users = PANEL_FILES.filter((f) => /<EmptyState/.test(read(f)));
    expect(users.length).toBeGreaterThanOrEqual(3);
  });
});

describe('A3.3 — seleção não é estado de sucesso', () => {
  it('personalidade e objetivo do Assistente usam lilac, não verde', () => {
    const agente = read('src/app/(dashboard)/agente/page.tsx');
    // Verde fica reservado a ativo/conectado/concluído; preferência é lilac.
    expect(agente).toMatch(/agent\.tone === t\.id \? '[^']*--lilac/);
    expect(agente).not.toMatch(/agent\.tone === t\.id \? '[^']*emerald/);
    expect(agente).not.toMatch(/on \? '[^']*emerald/);
  });

  it('papel de membro e chip selecionado usam brand-soft, não preto', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toMatch(/drawer\.role === r\.id \? '[^']*--brand-soft/);
    expect(equipe).not.toMatch(/drawer\.role === r\.id \? '[^']*bg-zinc-900/);
  });
});

describe('A3.3/A3.4 — cor por contexto de seção', () => {
  it('toda seção do catálogo tem acento definido e tokenizado', () => {
    for (const sec of PANEL_SECTIONS) {
      const accent = SECTION_ACCENT[sec.id];
      expect(accent, sec.id).toBeTruthy();
      expect(accent, sec.id).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it('A3.4 — o tema da seção governa TAMBÉM o item ativo (nunca azul fixo)', () => {
    // A regressão que este teste protege: a seleção forçava
    // `--il-nav-active-fg` (azul) em TODAS as seções, apagando a família de
    // cor exatamente quando ela orientava o usuário.
    for (const sec of PANEL_SECTIONS) {
      const t = SECTION_THEME[sec.id];
      expect(t, `seção ${sec.id} sem tema`).toBeTruthy();
      for (const token of [t.accent, t.activeBg, t.activeFg]) {
        expect(token, sec.id).toMatch(/^var\(--[a-z0-9-]+\)$/);
      }
    }
    // Seções de famílias diferentes NÃO compartilham o mesmo fundo ativo.
    expect(SECTION_THEME.pessoas.activeBg).not.toBe(SECTION_THEME.oferta.activeBg);
    expect(SECTION_THEME.crescimento.accent).toBe('var(--warning)');
    expect(SECTION_THEME.resultados.accent).toBe('var(--success)');
    expect(sectionTheme(undefined).activeBg).toBe('var(--surface-3)');
    expect(sectionTheme('nao-existe' as never).activeFg).toBe('var(--text)');
  });

  it('seção desconhecida cai em neutro (nunca quebra a renderização)', () => {
    expect(sectionAccent(undefined)).toBe('var(--text-muted)');
    expect(sectionAccent('nao-existe' as never)).toBe('var(--text-muted)');
  });



  it('as famílias de cor de contexto existem como token', () => {
    const css = read('src/app/globals.css');
    for (const token of ['--teal', '--lilac', '--warning', '--success', '--brand']) {
      expect(css, token).toMatch(new RegExp(`${token}:`));
    }
  });
});

// D360 identity/current-page/collapse semantics: WorkspaceNavigation.test.tsx + Chromium.

describe('A3.3 — Resultados é gráfico, e honesto', () => {
  it('a matemática dos gráficos é pura e vive em lib (testável)', () => {
    expect(exists('src/lib/insights-charts.ts')).toBe(true);
    expect(exists('src/lib/__tests__/insights-charts.test.ts')).toBe(true);
  });

  it('Resultados mostra distribuição de estados, funil, comparação e origem', () => {
    const view = read('src/components/dashboard/results-view.tsx');
    expect(view).toMatch(/<StatusMixBar/);
    expect(view).toMatch(/FunnelView/);
    expect(view).toMatch(/rankBars\(/);
    expect(view).toMatch(/originBars\(/);
  });

  it('não há série temporal inventada nem biblioteca de gráfico pesada', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const lib of ['recharts', 'chart.js', 'd3', 'nivo', 'victory', 'visx', 'apexcharts', 'echarts']) {
      expect(deps[lib], lib).toBeUndefined();
    }
  });

  it('cada gráfico tem legenda em texto (cor nunca é o único indicador)', () => {
    const view = read('src/components/dashboard/results-view.tsx');
    // Barra segmentada: aria-label + legenda com números.
    expect(view).toMatch(/aria-label=\{visible\.map/);
    expect(view).toMatch(/leads recebidos/);
    expect(view).toMatch(/concluídos/);
  });
});
