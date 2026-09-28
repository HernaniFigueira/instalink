import type { PanelRouteDef } from './panel';

// ═══════════════════════════════════════════════════════════════
// WORKSPACE NAVIGATION — GoDoutor Product/UX Revolution 2.0
// ═══════════════════════════════════════════════════════════════
// APRESENTAÇÃO ONLY. Rotas, permissões, módulos e ordem canônica continuam
// sendo propriedade exclusiva de `lib/panel.ts`. Este arquivo projeta o
// catálogo em uma arquitetura de informação compreensível.
//
// PROBLEMA QUE ESTE ARQUIVO RESOLVE
//   O painel tinha 22 destinos técnicos distribuídos em 8 seções com 4 grupos,
//   cada grupo com uma cor diferente. Quem abre o sistema pela primeira vez não
//   sabe por onde começar, e quem usa todo dia atravessa o menu inteiro para
//   chegar na Agenda. O objetivo aqui é o oposto: POUCAS PORTAS, DOIS NÍVEIS.
//
//   Antes: 22 portas em 8 seções coloridas.
//   Agora: 4 portas do dia a dia + 4 portas estruturais (+ Página), e a cor
//   deixa de dizer "qual área" para significar só ESTADO (sucesso, atenção…).
//
// A PARTIÇÃO CONTINUA TOTAL E AUDITÁVEL
//   • WORKSPACE_AREAS     → todo destino do catálogo aparece exatamente UMA
//                           vez. É o invariante que os testes de autorização
//                           verificam: a navegação nunca expande nem perde
//                           rota, e nunca revela o que o usuário não alcança.
//   • WORKSPACE_SECTIONS  → como a sidebar EXIBE as áreas (rótulo + entradas).
//
// Uma área `flat: true` vira links diretos na sidebar. Sem `flat`, vira um
// botão de grupo que abre a SEGUNDA COLUNA CONTEXTUAL — é assim que "Clínica"
// reúne Serviços/Profissionais/Disponibilidade/Equipe sem unificar NENHUM
// modelo de dados (Professional e User/Member continuam separados).
//
// O menu NÃO é decidido por papel: é decidido pelas PERMISSÕES EFETIVAS. Uma
// secretária sem `catalogo`/`equipe`/`config` simplesmente não alcança o grupo
// "Clínica" e o grupo "Configurações" — o grupo inteiro desaparece, sem lista
// paralela de "o que a secretária pode ver".
//
// ITENS QUE SAÍRAM DA SIDEBAR (sem serem apagados — ver lib/panel.ts):
//   /funil      → Clientes → Oportunidades (aba de /clientes + porta própria)
//   /tarefas    → Pendências contextualizadas (Visão geral, cliente, conversa)
//   /execucoes  → diagnóstico dentro de Automações
//   /recursos   → capacidades dentro de Configurações
//   /perfil     → menu da conta ("Meu perfil", para TODO usuário autenticado)
//   /organizacao→ só existe quando há MULTIUNIDADE de verdade.

export type WorkspaceAreaId =
  | 'principal' | 'clinica' | 'presenca' | 'automacao' | 'gestao' | 'ajustes' | 'mais';

export interface WorkspaceAreaDef {
  id: WorkspaceAreaId;
  /** Rótulo do grupo (título da segunda coluna contextual). */
  label: string;
  icon: string;
  /**
   * Cor de contexto — token CSS, nunca hex. Na 2.0 existe UMA cor de
   * identidade (a marca) e o neutro: grupo estrutural não compete com o
   * conteúdo por atenção.
   */
  color: string;
  routes: readonly string[];
}

export const WORKSPACE_AREAS: WorkspaceAreaDef[] = [
  {
    // As quatro portas do dia a dia: o que se abre TODA vez que se liga o
    // computador. São links diretos, sem segundo nível.
    id: 'principal', label: 'Operação', icon: 'home', color: 'var(--brand)',
    // `/tarefas` (Pendências) e `/perfil` (Meu perfil) vivem AQUI porque
    // pertencem ao dia a dia de quem usa — não a um grupo estrutural.
    // GODOUTOR final: Pendências voltou À LINHA do menu (permissão real — a
    // recepção resolve pendências o dia todo). `/perfil` continua fora da
    // linha (menu da conta), mas ter dono evita a rede de segurança "Mais"
    // que fazia o breadcrumb mentir ("Visão geral > Mais > Pendências").
    routes: ['/dashboard', '/agenda', '/conversas', '/clientes', '/tarefas', '/perfil'],
  },
  {
    // Quem a clínica é por dentro: o que oferece, quem atende, quando atende e
    // quem entra no sistema. Perguntas que se respondem UMA vez (e se ajustam
    // de vez em quando) — por isso vivem atrás de uma porta, não soltas no
    // menu. `/produtos` e `/pedidos` só existem quando o módulo está ativo.
    id: 'clinica', label: 'Clínica', icon: 'grid', color: 'var(--brand)',
    routes: ['/estrutura', '/servicos', '/profissionais', '/disponibilidade', '/equipe', '/produtos', '/pedidos'],
  },
  {
    id: 'presenca', label: 'Página', icon: 'link', color: 'var(--brand)',
    routes: ['/pagina'],
  },
  {
    // O que trabalha sozinho: assistente, automações, follow-up e campanhas.
    // Execuções NÃO está aqui (é diagnóstico, vive dentro de Automações).
    id: 'automacao', label: 'Automação', icon: 'spark', color: 'var(--brand)',
    // O mesmo vale para `/execucoes`: é o diagnóstico DENTRO de Automações,
    // por isso a área dona é esta (breadcrumb "Visão geral > Automação >
    // Execuções") e não a rede de segurança.
    routes: ['/agente', '/automacoes', '/followup', '/campanhas', '/execucoes'],
  },
  {
    // Como está indo: números, dinheiro e alcance comercial.
    id: 'gestao', label: 'Gestão', icon: 'chart', color: 'var(--brand)',
    // GODOUTOR final: Oportunidades (/funil) entrou no menu para quem tem
    // 'leads' — dentro de Gestão, nunca como CRM central.
    routes: ['/resultados', '/financeiro', '/funil'],
  },
  {
    // Configuração da casa e conexões técnicas (WhatsApp, integrações).
    id: 'ajustes', label: 'Configurações', icon: 'settings', color: 'var(--text-muted)',
    routes: ['/configuracoes', '/canais', '/recursos', '/organizacao'],
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
 *
 * `multiUnit` é uma decisão de APRESENTAÇÃO (a loja tem mais de uma unidade?).
 * Ela nunca esconde um destino ACESSÍVEL por URL: só decide se "Organização"
 * ocupa uma linha no menu. Unidade única não precisa pensar em organização.
 */
export function workspaceAreas(allowed: PanelRouteDef[], opts: { multiUnit?: boolean } = {}): WorkspaceArea[] {
  const pool = opts.multiUnit
    ? allowed
    : allowed.filter((route) => route.href !== '/organizacao');
  const areas: WorkspaceArea[] = WORKSPACE_AREAS.map((area) => ({
    ...area,
    items: pool.filter((route) => area.routes.includes(route.href)),
  }));
  const grouped = new Set(areas.flatMap((a) => a.items.map((i) => i.href)));
  const rest = pool.filter((i) => !grouped.has(i.href));
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
 *
 *   OPERAÇÃO         Visão geral · Agenda · Conversas · Clientes        (links)
 *   CLÍNICA          Clínica (grupo) · Página                            (portas)
 *   ADMINISTRAÇÃO    Automação (grupo) · Gestão (grupo) · Configurações (grupo)
 *
 * Exatamente QUATRO grupos abrem a segunda coluna. O resto é link direto.
 * Nenhuma seção vazia é renderizada, e nenhuma porta existe se o usuário não
 * tem permissão para NADA dentro dela.
 */
export const WORKSPACE_SECTIONS: WorkspaceSectionDef[] = [
  { id: 'sec-operacao', label: 'Operação', entries: [{ area: 'principal', flat: true }] },
  { id: 'sec-clinica', label: 'Clínica', entries: [{ area: 'clinica' }, { area: 'presenca', flat: true }] },
  {
    id: 'sec-administracao', label: 'Administração',
    entries: [{ area: 'automacao' }, { area: 'gestao' }, { area: 'ajustes' }],
  },
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
   * (segunda coluna): `/servicos` → "Clínica / Serviços". Área plana não repete
   * o próprio nome como nível extra — senão o breadcrumb vira ruído.
   */
  group?: string;
}

/** Breadcrumb contextual de um destino (a topbar consome; nada é hardcodado). */
export function routeBreadcrumb(activePath: string, areas: WorkspaceArea[]): RouteBreadcrumb {
  const area = areaOfRoute(activePath, areas);
  if (!area) return {};
  // A rede de segurança "Mais" NUNCA aparece como nível de breadcrumb: ela é
  // um detalhe de implementação (destino novo ainda sem área), não um lugar
  // que o usuário reconheça no menu. Sem isso, uma rota esquecida lia
  // "Visão geral > Mais > …" — um degrau que não existe em lugar nenhum.
  if (area.id === 'mais') return { area };
  const flat = workspaceSections(areas).some(
    (section) => section.groups.some((g) => g.flat && g.area.id === area.id),
  );
  return { area, group: flat ? undefined : area.label };
}

/**
 * Cor de contexto de uma rota → token da família (fonte única: WORKSPACE_AREAS).
 * O shell injeta o resultado em `--area-color`. Na 2.0 todas as áreas apontam
 * para a marca ou para o neutro: a cor do contexto é UM realce discreto, não um
 * arco-íris — quem carrega significado é o estado (verde/âmbar/vermelho).
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
