import type { PanelRouteDef } from './panel';

// ═══════════════════════════════════════════════════════════════
// WORKSPACE NAVIGATION — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// APRESENTAÇÃO ONLY. Rotas, permissões, módulos e ordem canônica continuam
// sendo propriedade exclusiva de `lib/panel.ts`. Este arquivo apenas projeta o
// catálogo em uma arquitetura de informação compreensível.
//
// DOIS níveis, e só dois:
//   • WORKSPACE_AREAS  → PARTIÇÃO total dos destinos (todo destino aparece
//                        exatamente uma vez). É o que os testes de autorização
//                        verificam: a navegação nunca expande nem perde rota.
//   • WORKSPACE_SECTIONS → como a sidebar EXIBE essas áreas (seção + entradas).
//
// Uma área com `flat: true` vira links diretos na sidebar. Sem `flat`, vira um
// botão de grupo que abre a SEGUNDA COLUNA CONTEXTUAL — é assim que "Estrutura
// da clínica" reúne Serviços/Profissionais/Disponibilidade/Equipe sem unificar
// NENHUM modelo de dados (Professional e User/Member continuam separados).
//
// COR TEM SIGNIFICADO (nunca decorativa). Cada área declara o token da família
// que a descreve; nenhum hex é escrito aqui:
//   azul vivo (--brand)     → operação do dia (Início, Agenda, Estrutura)
//   cyan (--cyan)           → relacionamento/comunicação (Clientes, Conversas)
//   cyan profundo           → presença pública (Página)
//   verde-limão (--lime-fg) → comercial (Funil, Pedidos)
//   laranja profundo        → atenção/prazos (Tarefas)
//   roxo elétrico (--violet)→ inteligência/automação
//   verde estado (--success)→ resultados (Gestão)
//   neutro (--text-muted)   → administração rara (Ajustes)
//   coral (--danger)        → perigo/cancelamento (reservado; nunca em nav)

export type WorkspaceAreaId =
  | 'principal' | 'estrutura' | 'operacao' | 'comercial'
  | 'presenca' | 'inteligencia' | 'gestao' | 'ajustes' | 'mais';

export interface WorkspaceAreaDef {
  id: WorkspaceAreaId;
  /** Rótulo do grupo (é o título da segunda coluna contextual). */
  label: string;
  icon: string;
  /** Token de cor da família — resolvido por CSS, nunca hex aqui. */
  color: string;
  routes: readonly string[];
}

export const WORKSPACE_AREAS: WorkspaceAreaDef[] = [
  {
    id: 'principal', label: 'Principal', icon: 'home', color: 'var(--brand)',
    routes: ['/dashboard', '/agenda', '/clientes', '/conversas'],
  },
  {
    // Serviços, Profissionais, Horários/Disponibilidade e Equipe/acessos são a
    // MESMA pergunta do usuário ("quem atende o quê, quando, com qual acesso")
    // — agrupados na experiência, separados no modelo.
    id: 'estrutura', label: 'Estrutura da clínica', icon: 'grid', color: 'var(--brand)',
    routes: ['/estrutura', '/servicos', '/profissionais', '/disponibilidade', '/equipe', '/produtos'],
  },
  {
    id: 'operacao', label: 'Operação', icon: 'tasks', color: 'var(--orange-deep)',
    routes: ['/tarefas', '/pedidos'],
  },
  {
    id: 'comercial', label: 'Comercial', icon: 'funnel', color: 'var(--lime-fg)',
    routes: ['/funil'],
  },
  {
    id: 'presenca', label: 'Presença', icon: 'link', color: 'var(--cyan-strong)',
    routes: ['/pagina'],
  },
  {
    id: 'inteligencia', label: 'Automação', icon: 'spark', color: 'var(--violet)',
    routes: ['/automacoes', '/followup', '/agente', '/campanhas', '/execucoes'],
  },
  {
    id: 'gestao', label: 'Gestão', icon: 'chart', color: 'var(--success)',
    routes: ['/resultados', '/financeiro', '/organizacao'],
  },
  {
    id: 'ajustes', label: 'Ajustes', icon: 'settings', color: 'var(--text-muted)',
    routes: ['/configuracoes', '/recursos', '/canais', '/perfil'],
  },
];

/** Rede de segurança: destino novo no catálogo nunca fica sem porta no menu. */
const FALLBACK_AREA: WorkspaceAreaDef = {
  id: 'mais', label: 'Mais', icon: 'grid', color: 'var(--text-muted)', routes: [],
};

export interface WorkspaceArea extends WorkspaceAreaDef {
  items: PanelRouteDef[];
}

/**
 * PROJEÇÃO AUTORIZADA: recebe os destinos já filtrados por permissão/módulo e
 * devolve a partição por área. Não decide o que existe — apenas agrupa.
 * Todo item de `allowed` aparece exatamente uma vez (contrato testado).
 */
export function workspaceAreas(allowed: PanelRouteDef[]): WorkspaceArea[] {
  const areas: WorkspaceArea[] = WORKSPACE_AREAS.map((area) => ({
    ...area,
    items: allowed.filter((route) => area.routes.includes(route.href)),
  }));
  const grouped = new Set(areas.flatMap((a) => a.items.map((i) => i.href)));
  const rest = allowed.filter((i) => !grouped.has(i.href));
  if (rest.length) areas.push({ ...FALLBACK_AREA, items: rest });
  return areas.filter((area) => area.items.length > 0);
}

// ── Exibição da sidebar ────────────────────────────────────────
export interface WorkspaceSectionEntry {
  area: WorkspaceAreaId;
  /** true = os destinos da área viram links diretos (sem segunda coluna). */
  flat?: boolean;
}

export interface WorkspaceSectionDef {
  id: string;
  label: string;
  entries: WorkspaceSectionEntry[];
}

/**
 * Arquitetura de informação da sidebar (a que o usuário lê):
 *   Principal · Operação · Comercial · Presença · Inteligência · Administração
 *
 * Regra anti-"lista infinita": só 4 grupos abrem segunda coluna (Estrutura da
 * clínica, Automação, Gestão, Ajustes). O resto é link direto.
 */
export const WORKSPACE_SECTIONS: WorkspaceSectionDef[] = [
  { id: 'sec-principal', label: 'Principal', entries: [{ area: 'principal', flat: true }] },
  { id: 'sec-operacao', label: 'Operação', entries: [{ area: 'estrutura' }, { area: 'operacao', flat: true }] },
  { id: 'sec-comercial', label: 'Comercial', entries: [{ area: 'comercial', flat: true }] },
  { id: 'sec-presenca', label: 'Presença', entries: [{ area: 'presenca', flat: true }] },
  { id: 'sec-inteligencia', label: 'Inteligência', entries: [{ area: 'inteligencia' }] },
  { id: 'sec-administracao', label: 'Administração', entries: [{ area: 'gestao' }, { area: 'ajustes' }] },
];

export interface WorkspaceSection extends WorkspaceSectionDef {
  /** Entradas já resolvidas contra os destinos autorizados. */
  groups: Array<{ area: WorkspaceArea; flat: boolean }>;
}

/**
 * Seções prontas para render: descarta entrada sem destino autorizado e seção
 * que ficou vazia. Uma área fora de qualquer seção (ex.: o fallback "Mais")
 * entra como grupo ao final — nada some do menu.
 */
export function workspaceSections(areas: WorkspaceArea[]): WorkspaceSection[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const sections = WORKSPACE_SECTIONS
    .map((section) => ({
      ...section,
      groups: section.entries
        .map((entry) => {
          const area = byId.get(entry.area);
          return area ? { area, flat: !!entry.flat } : null;
        })
        .filter((g): g is { area: WorkspaceArea; flat: boolean } => !!g),
    }))
    .filter((section) => section.groups.length > 0);
  const placed = new Set(sections.flatMap((s) => s.groups.map((g) => g.area.id)));
  const orphans = areas.filter((a) => !placed.has(a.id));
  if (orphans.length) {
    sections.push({
      id: 'sec-mais', label: 'Mais',
      entries: orphans.map((a) => ({ area: a.id })),
      groups: orphans.map((area) => ({ area, flat: area.items.length === 1 })),
    });
  }
  return sections;
}

/** Área dona de um destino (para breadcrumb, cor de contexto e segunda coluna). */
export function areaOfRoute(path: string, areas: WorkspaceArea[]): WorkspaceArea | undefined {
  return areas.find((a) => a.items.some((i) => i.href === path));
}

export interface RouteBreadcrumb {
  /** Área dona do destino (fonte da cor de contexto). */
  area?: WorkspaceArea;
  /**
   * Nível intermediário do breadcrumb. Existe SOMENTE quando a área é um grupo
   * (segunda coluna): `/agenda` → "Clínica / Agenda"; `/servicos` →
   * "Clínica / Estrutura da clínica / Serviços". Área plana não repete o próprio
   * nome como nível extra — senão o breadcrumb vira ruído.
   */
  group?: string;
}

/** Breadcrumb contextual de um destino (a topbar consome; nada é hardcodado). */
export function routeBreadcrumb(activePath: string, areas: WorkspaceArea[]): RouteBreadcrumb {
  const area = areaOfRoute(activePath, areas);
  if (!area) return {};
  const flat = workspaceSections(areas).some(
    (section) => section.groups.some((g) => g.flat && g.area.id === area.id),
  );
  return { area, group: flat ? undefined : area.label };
}

/**
 * Cor de contexto de uma rota → token da família (fonte única: WORKSPACE_AREAS).
 * O shell injeta o resultado em `--area-color`, e é dele que saem o rail do item
 * ativo, o ícone do cabeçalho da página e o marcador do breadcrumb.
 */
export function routeAreaColor(path: string, areas?: WorkspaceArea[]): string {
  const pool = areas || WORKSPACE_AREAS.map((a) => ({ ...a, items: [] as PanelRouteDef[] }));
  const direct = pool.find((a) => (a.routes as readonly string[]).includes(path));
  if (direct) return direct.color;
  return FALLBACK_AREA.color;
}

/** Only presentation filters cross units. Never carry entity IDs or text searches. */
export function switchUnitHref(pathname: string, params: URLSearchParams, businessId: string) {
  const next = new URLSearchParams({ b: businessId });
  const keys = pathname === '/agenda' ? ['data', 'view']
    : ['/pagina', '/configuracoes', '/canais'].includes(pathname) ? ['tab'] : [];
  for (const key of keys) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return `${pathname}?${next}`;
}
