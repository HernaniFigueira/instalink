// ═══════════════════════════════════════════════════════════════
// A1.2 · BLOCO 4 — CONSOLIDAÇÃO FINAL DO DASHBOARD (regressão)
// ═══════════════════════════════════════════════════════════════
// Cobre: região de atenção (dados existentes, link só com permissão),
// mapa de portas por permissão, estrutura canônica da página, grade 12
// colunas sem overflow, remoção de duplicações e estados vazios honestos.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dashboardAttention, dashboardLinks } from '../dashboard';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('B4.6 — atenção com dados existentes (nunca inventados)', () => {
  it('sem dado, não existe item de atenção', () => {
    expect(dashboardAttention({
      closures: 0, leadsNew: 0, tasksOverdue: 0,
      permissions: { agenda: true, leads: true, tasks: true },
    })).toEqual([]);
  });

  it('só entra o que tem contagem real; ordem de leitura: agenda → leads → tarefas', () => {
    const items = dashboardAttention({
      closures: 2, leadsNew: 5, tasksOverdue: 1,
      permissions: { agenda: true, leads: true, tasks: true },
    });
    expect(items.map((i) => i.id)).toEqual(['closures', 'leadsNew', 'tasksOverdue']);
    expect(items.map((i) => i.count)).toEqual([2, 5, 1]);
  });

  it('link contextual só quando o usuário PODE abrir a rota', () => {
    const noPerms = dashboardAttention({
      closures: 3, leadsNew: 4, tasksOverdue: 2,
      permissions: { agenda: false, leads: false, tasks: false },
    });
    expect(noPerms.map((i) => i.href)).toEqual([null, null, null]);
    const withAgenda = dashboardAttention({
      closures: 3, leadsNew: 0, tasksOverdue: 0,
      permissions: { agenda: true, leads: false, tasks: false },
    });
    expect(withAgenda[0]).toMatchObject({ id: 'closures', href: '/agenda' });
  });
});

describe('B4 — portas da Dashboard saem do mapa de permissões (nunca chute)', () => {
  it('permissão → porta correta (mesmo catálogo de lib/panel.ts)', () => {
    const l = dashboardLinks({ agenda: true, leads: true, financeiro: true, config: true, whatsapp: true, clientes: true, pedidos: true, catalogo: true, pagina: true });
    expect(l).toMatchObject({
      agenda: true, funil: true, resultados: true, canais: true,
      configuracoes: true, conversas: true, clientes: true, pedidos: true,
      produtos: true, pagina: true,
    });
  });

  it('sem permissão, nenhuma porta abre (linha vira texto, não 403)', () => {
    const allFalse = Object.values(dashboardLinks({}));
    expect(allFalse.every((v) => v === false)).toBe(true);
  });
});

describe('B4.1/B4.2 — estrutura canônica e sem duplicações', () => {
  const page = read('src/app/(dashboard)/dashboard/page.tsx');

  // Visual Fidelity Pass: a ORDEM de leitura aprovada no mockup é
  // Atenção → Hoje (KPIs) → Onde agir + Período → Próximos/Conversas → Recentes.
  // A intenção do guard continua a mesma: uma ordem canônica única, sem blocos
  // soltos competindo — só os marcadores acompanharam o layout aprovado.
  it('ordem canônica: Atenção → Hoje → Onde agir/Período → Próximos → Recentes', () => {
    // Marcadores do JSX renderizado (não dos comentários de cabeçalho).
    const atencao = page.indexOf('aria-label="Itens que precisam de atenção"');
    const hoje = page.indexOf('>Hoje</h3>');
    const ondeAgir = page.indexOf('{hasWhereToAct ? (');
    const periodo = page.indexOf('>Período <span');
    const proximos = page.indexOf('>Próximos atendimentos</h3>');
    const recentes = page.indexOf('>Atividade recente</h3>');
    for (const [k, v] of Object.entries({ atencao, hoje, ondeAgir, periodo, proximos, recentes })) {
      expect(v, `marcador ${k} ausente`).toBeGreaterThan(-1);
    }
    expect(atencao).toBeLessThan(hoje);
    expect(hoje).toBeLessThan(ondeAgir);
    expect(ondeAgir).toBeLessThan(periodo);
    expect(periodo).toBeLessThan(proximos);
    expect(proximos).toBeLessThan(recentes);
  });

  it('bloco "Próxima ação" foi removido (o checklist segue em Onde agir)', () => {
    expect(page).not.toMatch(/Próxima ação:/);
    expect(page).not.toMatch(/Fazer agora/);
    expect(page).toMatch(/Comece por aqui/);
  });

  it('título "Dashboard" e context.areas saíram (o shell já dá o contexto)', () => {
    expect(page).not.toMatch(/<h2[^>]*>Dashboard<\/h2>/);
    expect(page).not.toMatch(/areas\.join/);
  });

  it('sem blocos competindo de métricas: Receita/Resultados/Página/Movimento são subseções do Período', () => {
    // Não há mais <h3> próprios para esses blocos fora do Período…
    const h3s = [...page.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1].trim());
    expect(h3s).not.toContain('Movimento');
    expect(h3s).not.toContain('Resultados');
    // …e as subseções carregam a JANELA no rótulo (honestidade, sem nova fórmula).
    expect(page).toMatch(/Resultados · \{results\.periodLabel\}/);
    expect(page).toMatch(/Página · no período/);
    expect(page).toMatch(/Movimento · desde o início/);
  });

  it('nenhuma fórmula nova: mesmas origens de dados (revenueDetail/results/pageStats/totals)', () => {
    expect(page).toMatch(/revenueDetail\?\.bookings/);
    expect(page).toMatch(/revenueDetail\?\.orders/);
    expect(page).toMatch(/ComparisonBadge metric=\{it\}/);
    expect(page).toMatch(/\{pageStats\?\.views \?\? 0\}/);
    expect(page).toMatch(/\{totals\.uniqueVisitors\}/);
    expect(page).toMatch(/NO_DATA_MESSAGE/);
  });
});

describe('B4.4 — grade coerente de 12 colunas (sem overflow horizontal)', () => {
  const page = read('src/app/(dashboard)/dashboard/page.tsx');

  it('a linha principal usa lg:grid-cols-12 com composição 5 + 7', () => {
    expect(page).toMatch(/lg:grid-cols-12/);
    const spans = [...page.matchAll(/lg:col-span-(\d+)/g)].map((m) => Number(m[1]));
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) expect(s, 'nenhum span passa de 12').toBeLessThanOrEqual(12);
    expect([...new Set(spans)].sort((a, b) => a - b)).toEqual([5, 7]);
    // A tentativa antiga (equivalente a 15 colunas: 4+5+3+3) não volta.
    expect(spans.filter((s) => s === 3).length).toBe(0);
  });

  it('seções internas empilham antes do desktop (390px sem espremer texto)', () => {
    expect(page).toMatch(/grid-cols-2 sm:grid-cols-4/); // KPIs de Página/Movimento/Resultados
    expect(page).toMatch(/grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6/); // Hoje (KPIs empilham no mobile)
    expect(page).not.toMatch(/w-\[(?:[89]\d\d|\d{4})px\]/); // nenhuma largura fixa grande
  });

  it('linhas de lista são clicáveis QUANDO há permissão (B4.5) e texto quando não', () => {
    expect(page).toMatch(/function ListRow/);
    expect(page).toMatch(/allowed=\{links\.agenda === true\}/);
    expect(page).toMatch(/allowed=\{links\.pedidos === true\}/);
    expect(page).toMatch(/allowed=\{links\.funil === true\}/);
    // checklist: linha INTEIRA é um único link (sem segundo link "Fazer")
    expect(page).toMatch(/Fazer →/);
    expect(page).not.toMatch(/<Link href=\{c\.href\} className=\{c\.done/); // não regressou ao padrão antigo
  });
});

describe('B4.7 — Onde agir: só ações existentes', () => {
  const page = read('src/app/(dashboard)/dashboard/page.tsx');

  it('conectar canal aparece só sem conexão E com permissão da porta /canais', () => {
    expect(page).toMatch(/showConnectChannel = !!whatsapp && !canalConnected && links\.canais === true/);
    expect(page).toMatch(/\/canais\?tab=canais/);
  });

  it('sem checklist pendente e canal ok, a área não existe (nada inventado)', () => {
    expect(page).toMatch(/const hasWhereToAct = showSetup \|\| showConnectChannel;/);
    expect(page).toMatch(/\{hasWhereToAct \? \(/);
  });

  it('não cria Radar/scoring/recomendação por IA', () => {
    expect(page).not.toMatch(/[Rr]adar|scoring|recomenda/);
  });
});

describe('B4.9 — estados vazios honestos', () => {
  const page = read('src/app/(dashboard)/dashboard/page.tsx');

  it('listas vazias e ausência de permissão são explícitas, sem dinheiro fabricado', () => {
    expect(page).not.toMatch(/\{money\(0\)\}/); // no hard-coded zero: only authorized server metrics
    expect(page).toMatch(/Nenhum atendimento futuro\./);
    expect(page).toMatch(/Nenhuma atividade ainda\./);
    expect(page).toMatch(/Nenhum pedido ainda\./);
    expect(page).toMatch(/Sem acesso financeiro\./);
  });

  it('nenhum CTA para funcionalidade inexistente', () => {
    expect(page).not.toMatch(/Em breve/i);
    expect(page).not.toMatch(/href="\/[a-z-]+"[^>]*>(?:Radar|Distribui|Financeiro real)/);
  });
});

describe('B4 (servidor) — payload da Dashboard consolida sem mudar regra', () => {
  const route = read('src/app/api/overview/route.ts');

  it('payload entrega attention/links/tasksSummary e não tem mais `areas`', () => {
    expect(route).toMatch(/const attention = dashboardAttention\(/);
    expect(route).toMatch(/const links = dashboardLinks\(guard\.ctx\.permissions\)/);
    expect(route).toMatch(/\n\s+attention,\n\s+links,\n\s+tasksSummary,/);
    expect(route).not.toMatch(/areas: context\.areas/);
  });

  it('tarefas vencidas vêm da MESMA engine (lib/automation/tasks), com permissão', () => {
    expect(route).toMatch(/import \{ summarizeTasks \} from '@\/lib\/automation\/tasks'/);
    expect(route).toMatch(/TASKS_PERMS: PermissionId\[\] = \['leads', 'agenda', 'clientes', 'config'\]/);
    expect(route).toMatch(/canTasks \? summarizeTasks\(db, bId, today\) : null/);
  });

  it('nenhum sistema novo de alerta/notificação/scheduler', () => {
    expect(route).not.toMatch(/scheduler|cron.*attention|notify/i);
  });
});
