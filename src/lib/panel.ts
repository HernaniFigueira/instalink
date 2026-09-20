// ═══════════════════════════════════════════════════════════════
// PAINEL — CATÁLOGO ÚNICO DE DESTINOS · permissões · visibilidade
// ═══════════════════════════════════════════════════════════════
// A1.2 · Bloco 1. Este arquivo é a ÚNICA lista de destinos do painel.
// Sidebar (desktop e mobile), largura do conteúdo, guarda de rota no
// cliente, rótulos de 403, requisito de unidade ativa e o mapa de rotas
// legadas são PROJEÇÕES daqui — nenhum deles decide o que existe.
//
// Regras do catálogo:
//   • UMA porta principal por conceito: cada destino aparece uma única vez.
//   • `sidebar: false` NÃO é o antigo `hidden`. O destino continua declarado,
//     acessível, rotulado e alcançável por atalho contextual; apenas não ocupa
//     linha no menu. A régua é FREQUÊNCIA de uso, não importância.
//   • Toda rota do painel nasce aqui. Rota fora do catálogo é rota sem porta.
//   • Esconder item de menu é UX; a segurança continua no servidor
//     (lib/access.ts) e em API_GUARDS — regressão coberta por teste.
//
// Módulo PURE (sem I/O/DOM) para ser testável e reutilizável.
import type { BusinessMode, FeatureId, PermissionId } from './types';
import { areaLabel } from './http';

// ── Seções canônicas ───────────────────────────────────────────
export type PanelSectionId =
  | 'inicio'
  | 'operacao'
  | 'pessoas'
  | 'oferta'
  | 'crescimento'
  | 'resultados'
  | 'presenca'
  | 'administracao';

export interface PanelSectionDef {
  id: PanelSectionId;
  label: string;
  /**
   * true = a seção fica fora da sequência rolável do menu (o shell decide o
   * lugar). NENHUMA seção usa isso hoje.
   *
   * A3.3 — decisão: Administração voltou para o MENU PRINCIPAL. O rodapé fixo
   * existia para manter Configurações à vista em 1280×768, mas criava duas
   * barras com comportamentos diferentes ("parte fixa, parte rolável") e o
   * usuário não entendia por que só aquele grupo estava preso. O problema
   * original foi resolvido de outro jeito: menu mais compacto, controle de
   * recolher no topo e rodapé reservado para QUEM está logado. A marca fica
   * disponível para uma necessidade real futura, não como decoração.
   */
  footer?: boolean;
}

/**
 * Ordem canônica das seções = ordem de uso: o que se abre toda hora primeiro,
 * o que se ajusta uma vez por mês por último.
 *
 * A3.4 — REORGANIZAÇÃO (decisão de produto, não estética):
 *   • "Início" virou SEÇÃO de uma porta (`/dashboard`). Antes o item primário
 *     flutuava sem título; com o menu crescendo ele ficava sem contexto. A
 *     linguagem de interface mudou de "Dashboard" para "Início" — a ROTA
 *     (`/dashboard`) e a PERMISSÃO (`dashboard`) continuam iguais de propósito:
 *     renomear rota/API/schema por causa de rótulo quebraria links, permissões
 *     gravadas e integrações sem entregar nada ao usuário.
 *   • PROFISSIONAIS e DISPONIBILIDADE saíram de "Oferta" e foram para
 *     "Operação". A régua é quem usa a tela: quem ATENDE mexe nos profissionais
 *     e nos horários no dia a dia, junto com a Agenda. "Oferta" fica com o que
 *     se anuncia (Serviços, Produtos).
 *   • PEDIDOS entrou em "Operação" e voltou a poder aparecer no menu — porém
 *     SOMENTE quando o módulo de pedidos estiver ativo (`modes: ['orders']`).
 *     Módulo desligado = porta inexistente para quem não tem o módulo.
 */
export const PANEL_SECTIONS: PanelSectionDef[] = [
  { id: 'inicio', label: 'Início' },
  { id: 'operacao', label: 'Operação' },
  { id: 'pessoas', label: 'Pessoas' },
  { id: 'oferta', label: 'Oferta' },
  { id: 'crescimento', label: 'Crescimento' },
  { id: 'resultados', label: 'Resultados' },
  { id: 'presenca', label: 'Presença' },
  { id: 'administracao', label: 'Administração' },
];

/**
 * Seções fora da sequência rolável do menu (hoje: nenhuma). Mantido como
 * projeção do catálogo para o shell honrar a marca sem decidir por conta.
 */
export const FOOTER_SECTIONS: PanelSectionId[] = PANEL_SECTIONS.filter((s) => s.footer).map((s) => s.id);

export function panelSection(id: PanelSectionId): PanelSectionDef | undefined {
  return PANEL_SECTIONS.find((s) => s.id === id);
}

/**
 * A3.4 — TEMA POR SEÇÃO (fonte ÚNICA de cor de contexto e de seleção).
 *
 * Antes existia só `SECTION_ACCENT` (a cor do ÍCONE) e o item ativo era
 * forçado em BRAND azul (`--il-nav-active-fg`) qualquer que fosse a seção: ao
 * clicar em Clientes (teal) ou Serviços (lilás), o rail, o texto e o fundo
 * viravam azul — a família de cor desaparecia exatamente quando o usuário
 * precisava dela para se localizar.
 *
 * Agora cada seção declara o SEU conjunto:
 *   accent   → cor do ícone (sempre, ativo ou não) e do rail de seleção;
 *   activeBg → fundo suave da seção quando o item está ativo;
 *   activeFg → texto do item ativo, na mesma família.
 *
 * Regra que não muda: a cor aparece no ícone, no rail fino e no fundo suave —
 * nunca pintando o menu inteiro. E o estado ativo nunca depende SÓ da cor: o
 * rail lateral e o `aria-current` continuam lá para quem não distingue cor.
 */
export interface SectionTheme {
  /** Cor da família: ícone (sempre) e rail do item ativo. */
  accent: string;
  /** Fundo do item ativo — versão muito suave da família. */
  activeBg: string;
  /** Texto do item ativo, legível sobre `activeBg`. */
  activeFg: string;
}

export const SECTION_THEME: Record<PanelSectionId, SectionTheme> = {
  // Início/Operação/Presença: azul da marca (o "agora" do dia).
  inicio: { accent: 'var(--brand)', activeBg: 'var(--brand-soft)', activeFg: 'var(--brand-fg)' },
  operacao: { accent: 'var(--brand)', activeBg: 'var(--brand-soft)', activeFg: 'var(--brand-fg)' },
  // Pessoas: teal (gente).
  pessoas: { accent: 'var(--teal)', activeBg: 'var(--teal-bg)', activeFg: 'var(--teal-fg)' },
  // Oferta: lilás (catálogo/vitrine).
  oferta: { accent: 'var(--lilac)', activeBg: 'var(--lilac-bg)', activeFg: 'var(--lilac-fg)' },
  // Crescimento: âmbar (campanhas/automação) — atenção, não alarme.
  crescimento: { accent: 'var(--warning)', activeBg: 'var(--warning-bg)', activeFg: 'var(--warning-fg)' },
  // Resultados: verde (números que fecham).
  resultados: { accent: 'var(--success)', activeBg: 'var(--success-bg)', activeFg: 'var(--success-fg)' },
  presenca: { accent: 'var(--brand)', activeBg: 'var(--brand-soft)', activeFg: 'var(--brand-fg)' },
  // Administração: azul frio/neutro de propósito (ajuste raro, sem destaque).
  administracao: { accent: 'var(--text-muted)', activeBg: 'var(--surface-3)', activeFg: 'var(--text)' },
};

/** Acento de contexto de uma seção (compatibilidade: usado em ícones/atalhos). */
export const SECTION_ACCENT: Record<PanelSectionId, string> = Object.fromEntries(
  (Object.keys(SECTION_THEME) as PanelSectionId[]).map((id) => [id, SECTION_THEME[id].accent]),
) as Record<PanelSectionId, string>;

const FALLBACK_THEME: SectionTheme = { accent: 'var(--text-muted)', activeBg: 'var(--surface-3)', activeFg: 'var(--text)' };

/** Tema completo de uma seção, com fallback neutro para id desconhecido. */
export function sectionTheme(id: PanelSectionId | undefined): SectionTheme {
  if (!id) return FALLBACK_THEME;
  return SECTION_THEME[id] ?? FALLBACK_THEME;
}

/** Acento de uma seção, com fallback neutro para id desconhecido. */
export function sectionAccent(id: PanelSectionId | undefined): string {
  return sectionTheme(id).accent;
}

/** Destinos de uma seção, na ordem do catálogo (independente de contexto). */
export function panelRoutesIn(section: PanelSectionId): PanelRouteDef[] {
  return PANEL_ROUTES.filter((r) => r.section === section);
}

// ── Definição de destino ───────────────────────────────────────
export interface PanelRouteDef {
  href: string;
  label: string;
  /**
   * O que o usuário encontra ali. NUNCA vazia: é o texto do tooltip, do
   * atalho contextual e (futuramente) da busca. Descrição boa é a que responde
   * "para que serve isto?" na palavra de quem opera, não na de quem construiu.
   */
  description: string;
  icon: string;
  /** Seção canônica. Ausente apenas no item primário (Dashboard). */
  section?: PanelSectionId;
  /**
   * Permissão exigida. Array = "qualquer uma satisfaz" — a MESMA semântica de
   * `requireBusiness(...)` no servidor e de API_GUARDS abaixo.
   */
  permission: PermissionId | PermissionId[];
  /** Só existe quando ALGUM destes módulos comerciais estiver ativo. */
  modes?: BusinessMode[];
  /** Só existe quando ALGUM destes módulos opcionais estiver ativo. */
  features?: FeatureId[];
  /** Chave de área para mensagens de permissão (lib/http). */
  area?: string;
  /**
   * false = destino declarado que não ocupa linha no menu (uso esporádico ou
   * legado). Continua acessível por URL e por atalho contextual.
   * Default: true.
   */
  sidebar?: boolean;
  /**
   * 'full'     = telas densas (grade, calendário, kanban, tabela, colunas
   *              múltiplas) — aproveitam a largura disponível;
   * 'contained'= formulários e listas de coluna única — 960px de leitura.
   * Default: 'contained'.
   */
  width?: 'full' | 'contained';
  /**
   * false = a rota não exige unidade ativa no `?b=` (visão de organização).
   * Default: true.
   */
  requiresBusiness?: boolean;
}

// ── CATÁLOGO ───────────────────────────────────────────────────
// Ordem do array = ordem da navegação. Nada aqui é decorativo: cada entrada
// existe porque há uma porta real (rota) e uma pergunta de negócio que ela
// responde.
//
// PROFISSIONAIS × EQUIPE (conceitos separados, nunca misturados):
//   • /profissionais = quem REALIZA os atendimentos (serviços, agenda própria);
//   • /equipe        = quem tem LOGIN e permissões (dono, recepcionista…).
//
// DISPONIBILIDADE × REGRAS DE RESERVA (separadas no Bloco 2):
//   • /disponibilidade = QUANDO pode atender (janela semanal, dias especiais);
//   • Configurações → aba Agenda = COMO o cliente pode reservar (antecedência,
//     cancelamento, horizonte, buffer, distribuição) — edita, não linka.
//
// CONVERSAS × CANAIS:
//   • /conversas = operação diária (inbox);
//   • /canais    = conexão do canal, fontes de lead e integrações técnicas.
export const PANEL_ROUTES: PanelRouteDef[] = [
  {
    // RÓTULO "Início" (A3.4) — a ROTA segue `/dashboard` e a PERMISSÃO segue
    // `dashboard`: renomear rota/API/schema por causa de linguagem de interface
    // quebraria links salvos, permissões gravadas e integrações, sem entregar
    // nada a quem opera. O que o lojista lê é o que mudou.
    href: '/dashboard', label: 'Início', icon: 'home', section: 'inicio',
    permission: 'dashboard', area: 'dashboard',
    description: 'Visão do dia: o que precisa de atenção, o que está marcado e os números do período.',
    width: 'full',
  },

  // ── Operação: onde o dia acontece ──
  {
    href: '/agenda', label: 'Agenda', icon: 'calendar', section: 'operacao',
    modes: ['bookings'], permission: 'agenda', area: 'agenda',
    description: 'O que está marcado, com quem, e o que ainda precisa ser fechado.',
    width: 'full',
  },
  {
    // A3.4: entrou em Operação. Quem ATENDE ajusta quem atende no dia a dia —
    // profissional e agenda são a mesma conversa, não catálogo de vitrine.
    href: '/profissionais', label: 'Profissionais', icon: 'idcard', section: 'operacao',
    modes: ['services', 'bookings'], permission: 'catalogo', area: 'profissionais',
    description: 'Quem realiza os atendimentos, com quais serviços, acesso ao sistema e agenda própria.',
    width: 'full',
  },
  {
    // A3.4: entrou em Operação, junto de Agenda e Profissionais.
    // Era "/horarios". "Disponibilidade" é o que a tela É: quando a casa e cada
    // profissional podem atender (janela semanal + dias especiais).
    href: '/disponibilidade', label: 'Disponibilidade', icon: 'clock', section: 'operacao',
    modes: ['services', 'bookings'], permission: 'catalogo', area: 'disponibilidade',
    description: 'Quando a casa e cada profissional podem atender, inclusive dias especiais.',
    width: 'full',
  },
  {
    // Era "/whatsapp". Renomeado porque a tela é o INBOX (operação diária); a
    // conexão do canal é outra tarefa e mora em Canais & Integrações.
    href: '/conversas', label: 'Conversas', icon: 'inbox', section: 'operacao',
    permission: 'whatsapp', area: 'conversas',
    description: 'As conversas com os seus clientes em um só lugar, com o histórico de cada um.',
    width: 'full',
  },
  {
    href: '/agente', label: 'Assistente', icon: 'spark', section: 'operacao',
    permission: 'agente', area: 'agente',
    description: 'O assistente que responde por você no site e no WhatsApp, com os dados do negócio.',
  },
  {
    // Era a 5ª aba de /automacoes. Tarefa é fila de trabalho da equipe — uso
    // diário, portanto Operação. O motor que CRIA tarefas continua em Automações.
    href: '/tarefas', label: 'Tarefas', icon: 'tasks', section: 'operacao',
    permission: ['clientes', 'agenda', 'leads', 'config'], area: 'tarefas',
    description: 'O que ficou combinado, com quem e com qual prazo — inclusive o que já venceu.',
  },
  {
    // A3.4: deixou de ser `sidebar: false` e passou para Operação — o histórico
    // de pedidos é operação do negócio que vende, não "outro destino".
    // Continua aparecendo SOMENTE quando o módulo de pedidos existe
    // (`modes: ['orders']`): sem o módulo, a porta não existe para o usuário.
    href: '/pedidos', label: 'Pedidos', icon: 'receipt', section: 'operacao',
    modes: ['orders'], permission: 'pedidos', area: 'pedidos',
    description: 'Pedidos recebidos pela página, com status, itens e histórico de cada cliente.',
    width: 'full',
  },

  // ── Pessoas: quem está do outro lado ──
  {
    href: '/clientes', label: 'Clientes', icon: 'users', section: 'pessoas',
    permission: 'clientes', area: 'clientes',
    description: 'As pessoas do outro lado: histórico 360, notas, consentimento e novo atendimento.',
    width: 'full',
  },
  {
    // Era "/esteira" (rota sem porta no menu) e também uma visão dentro de
    // /clientes. Uma porta só: o funil de oportunidades.
    href: '/funil', label: 'Funil', icon: 'funnel', section: 'pessoas',
    permission: 'leads', area: 'funil',
    description: 'As oportunidades por etapa, do primeiro contato ao atendimento agendado.',
    width: 'full',
  },

  // ── Oferta: o que eu ofereço e vendo ──
  {
    href: '/servicos', label: 'Serviços', icon: 'service', section: 'oferta',
    modes: ['services', 'bookings'], permission: 'catalogo', area: 'servicos',
    description: 'O que você oferece, com preço, duração e quem realiza.',
    width: 'full',
  },
  {
    href: '/produtos', label: 'Produtos', icon: 'bag', section: 'oferta',
    modes: ['products', 'orders'], permission: 'catalogo', area: 'catalogo',
    description: 'A vitrine de produtos exibida na sua página pública, com preço e foto.',
    width: 'full',
  },

  // ── Crescimento: de onde vem gente e o que trabalha sozinho ──
  {
    href: '/campanhas', label: 'Campanhas', icon: 'megaphone', section: 'crescimento',
    permission: 'campanhas', area: 'campanhas',
    description: 'Mensagens para quem deu consentimento, com público e histórico de envio.',
    width: 'full',
  },
  {
    href: '/automacoes', label: 'Automações', icon: 'bolt', section: 'crescimento',
    permission: 'config', area: 'automations',
    description: 'Quando acontecer X, se Y, o sistema faz Z sozinho — sem ninguém lembrar.',
  },
  {
    // Porta única que substitui três: a rota /integracoes, a aba "Integrações"
    // e a aba "Canais" de Configurações. Três seções nomeadas e exclusivas:
    // CANAIS (por onde se fala) · FONTES (de onde o lead chega) ·
    // INTEGRAÇÕES (por onde os dados viajam, com direção declarada).
    href: '/canais', label: 'Canais & Integrações', icon: 'plugs', section: 'crescimento',
    permission: 'config', area: 'canais',
    description: 'Por onde o cliente fala com você (WhatsApp, redes sociais), de onde ele chega e como outros sistemas se conectam.',
  },

  // ── Resultados: como está indo ──
  {
    href: '/resultados', label: 'Resultados', icon: 'chart', section: 'resultados',
    permission: 'financeiro', area: 'resultados',
    description: 'Os números do período com comparação, por serviço, profissional e origem.',
    width: 'full',
  },
  {
    // Antes só existia atrás do seletor de unidade — e o seletor só aparece com
    // 2+ unidades, o que tornava impossível criar a segunda. Porta real.
    href: '/organizacao', label: 'Organização', icon: 'buildings', section: 'resultados',
    permission: 'config', area: 'organizacao', requiresBusiness: false,
    description: 'As suas unidades juntas: consolidado do período, troca de unidade e criação de nova.',
    width: 'full',
  },
  {
    // Era a 4ª aba de /automacoes. Observar o sistema funcionando é visita
    // deliberada (diagnóstico), não passagem diária: destino declarado, fora
    // do menu, alcançável por URL e pelo atalho contextual dentro de
    // Automações ("Ver histórico de execuções").
    //
    // A3.4: NÃO existe mais o grupo "Outros destinos" na barra — destino com
    // `sidebar: false` vive do atalho contextual de quem o usa, não de uma
    // segunda lista com comportamento diferente dentro do mesmo menu.
    href: '/execucoes', label: 'Execuções', icon: 'history', section: 'resultados',
    permission: 'config', area: 'execucoes', sidebar: false,
    description: 'O que as automações fizeram — e, quando falharam, o que aconteceu e o que fazer.',
  },

  // ── Presença: a porta pública ──
  {
    href: '/pagina', label: 'Página', icon: 'link', section: 'presenca',
    permission: 'pagina', area: 'pagina',
    description: 'O editor da sua página pública: blocos, navegação, visual, avaliações e publicação.',
  },

  // ── Administração: rodapé fixo ──
  {
    href: '/equipe', label: 'Equipe', icon: 'shield', section: 'administracao',
    permission: 'equipe', area: 'equipe',
    description: 'Quem tem login, com qual papel, o que enxerga e o vínculo com o profissional.',
    width: 'full',
  },
  {
    href: '/recursos', label: 'Recursos', icon: 'toggle', section: 'administracao',
    permission: 'config', area: 'recursos',
    description: 'Quais módulos da empresa estão ligados. Desativar oculta na hora e não apaga nada.',
  },
  {
    href: '/configuracoes', label: 'Configurações', icon: 'settings', section: 'administracao',
    permission: 'config', area: 'config',
    description: 'Dados do negócio, regras de reserva e aparência do painel.',
  },
];

/** Rotas legadas → canônicas (A1.2 §5). Fonte única dos redirects: o
 *  `next.config.js` declara exatamente este mapa, e um teste confere as duas
 *  pontas. Query strings (`?b=`, `?period=`, `?organization=`) são preservadas
 *  pelo Next automaticamente. */
export const LEGACY_ROUTES: Array<{ from: string; to: string }> = [
  { from: '/horarios', to: '/disponibilidade' },
  { from: '/whatsapp', to: '/conversas' },
  { from: '/esteira', to: '/funil' },
  { from: '/integracoes', to: '/canais?tab=integracoes' },
];

/** Rotas que usam a largura toda — derivado do catálogo (sem lista paralela). */
export const FULL_WIDTH_PATHS = PANEL_ROUTES
  .filter((r) => r.width === 'full')
  .map((r) => r.href);

export interface PanelContext {
  permissions: Partial<Record<PermissionId, boolean>>;
  modes: BusinessMode[];
  features: Partial<Record<FeatureId, boolean>>;
}

export function emptyPanelContext(): PanelContext {
  return { permissions: {}, modes: [], features: {} };
}

// ── Resolução de caminho ───────────────────────────────────────
export function normalizePanelPath(pathname: string): string {
  return String(pathname || '').replace(/\/+$/, '') || '/';
}

/** Destino exato do catálogo ('/agenda/' resolve; '/agenda/123' não). */
export function panelRouteFor(pathname: string): PanelRouteDef | undefined {
  const clean = normalizePanelPath(pathname);
  return PANEL_ROUTES.find((r) => r.href === clean);
}

/**
 * Caminho ativo por ANCESTRALIDADE: '/clientes/123' → '/clientes'.
 * O prefixo MAIS LONGO vence, então duas portas nunca ficam ativas ao mesmo
 * tempo. '' quando nada no catálogo corresponde.
 */
export function activePanelPath(pathname: string): string {
  const clean = normalizePanelPath(pathname);
  if (PANEL_ROUTES.some((r) => r.href === clean)) return clean;
  let best = '';
  for (const r of PANEL_ROUTES) {
    if (clean.startsWith(`${r.href}/`) && r.href.length > best.length) best = r.href;
  }
  return best;
}

/** Destino ativo (exato ou ancestral) — usado por sidebar e guarda de rota. */
export function activePanelRoute(pathname: string): PanelRouteDef | undefined {
  const active = activePanelPath(pathname);
  return active ? PANEL_ROUTES.find((r) => r.href === active) : undefined;
}

/** Permissões de um destino, sempre como lista. */
export function permissionsForRoute(route: PanelRouteDef): PermissionId[] {
  return Array.isArray(route.permission) ? route.permission : [route.permission];
}

/** Primeira permissão do caminho ('' = rota sem guarda própria). */
export function permissionForPath(pathname: string): PermissionId | '' {
  const route = activePanelRoute(pathname);
  return route ? permissionsForRoute(route)[0] : '';
}

/** A rota exige uma unidade ativa no `?b=`? (visão de organização não exige) */
export function routeRequiresBusiness(pathname: string): boolean {
  return activePanelRoute(pathname)?.requiresBusiness !== false;
}

function hasMode(route: PanelRouteDef, ctx: PanelContext): boolean {
  if (!route.modes) return true;
  const modes = ctx.modes || [];
  return route.modes.some((m) => modes.includes(m));
}

function hasFeature(route: PanelRouteDef, ctx: PanelContext): boolean {
  if (!route.features) return true;
  const features = ctx.features || {};
  return route.features.some((f) => (features as Record<string, boolean>)[f] === true);
}

export function hasPermission(permission: PermissionId, ctx: PanelContext): boolean {
  return (ctx.permissions || {})[permission] === true;
}

/** "Qualquer uma satisfaz" — mesma semântica de `requireBusiness` no servidor. */
export function hasAnyPermission(permissions: PermissionId[], ctx: PanelContext): boolean {
  return permissions.some((p) => hasPermission(p, ctx));
}

/** Destino ACESSÍVEL para este contexto (permissão ∩ módulos). Ignora `sidebar`. */
export function isPanelRouteAllowed(route: PanelRouteDef, ctx: PanelContext): boolean {
  return hasAnyPermission(permissionsForRoute(route), ctx) && hasMode(route, ctx) && hasFeature(route, ctx);
}

/**
 * Destino VISÍVEL NA NAVEGAÇÃO (acessível e com linha no menu).
 * Destinos com `sidebar: false` continuam acessíveis por URL e por atalho
 * contextual — `panelAccess` não usa este filtro.
 */
export function isPanelRouteVisible(route: PanelRouteDef, ctx: PanelContext): boolean {
  return route.sidebar !== false && isPanelRouteAllowed(route, ctx);
}

/** Todos os destinos acessíveis (menu ou não), na ordem do catálogo. */
export function allowedPanelRoutes(ctx: PanelContext): PanelRouteDef[] {
  return PANEL_ROUTES.filter((r) => isPanelRouteAllowed(r, ctx));
}

/** Destinos que aparecem no menu (desktop e pills do mobile). */
export function visiblePanelRoutes(ctx: PanelContext): PanelRouteDef[] {
  return PANEL_ROUTES.filter((r) => isPanelRouteVisible(r, ctx));
}

export interface PanelSection {
  id: PanelSectionId;
  label: string;
  /** true = renderizar no rodapé fixo da sidebar. */
  footer: boolean;
  items: PanelRouteDef[];
}

export interface PanelNavigation {
  /** Dashboard (ou null quando o perfil não o tem). */
  primary: PanelRouteDef | null;
  /** Seções da área que rola, na ordem canônica, sem seções vazias. */
  sections: PanelSection[];
  /** Seções do rodapé fixo (Administração). */
  footerSections: PanelSection[];
  /** Tudo que vai para o menu (primário + seções + rodapé), em ordem. */
  sidebar: PanelRouteDef[];
  /** Destinos acessíveis fora do menu (`sidebar: false`) — atalhos/hub. */
  more: PanelRouteDef[];
  /** Todos os destinos acessíveis (menu ou não). */
  allowed: PanelRouteDef[];
  /** Sinônimo de `allowed` (compatibilidade com consumidores antigos). */
  all: PanelRouteDef[];
}

/** Projeção do catálogo para este contexto. Nenhum componente decide nada. */
export function panelNavigation(ctx: PanelContext): PanelNavigation {
  const allowed = allowedPanelRoutes(ctx);
  const sidebar = allowed.filter((r) => r.sidebar !== false);
  const more = allowed.filter((r) => r.sidebar === false);
  const primary = sidebar.find((r) => !r.section) || null;

  const grouped = new Map<PanelSectionId, PanelRouteDef[]>();
  for (const item of sidebar) {
    if (!item.section) continue;
    if (!grouped.has(item.section)) grouped.set(item.section, []);
    grouped.get(item.section)!.push(item);
  }

  const sections: PanelSection[] = [];
  const footerSections: PanelSection[] = [];
  for (const def of PANEL_SECTIONS) {
    const items = grouped.get(def.id);
    if (!items || items.length === 0) continue;
    const section: PanelSection = { id: def.id, label: def.label, footer: !!def.footer, items };
    if (def.footer) footerSections.push(section);
    else sections.push(section);
  }

  return { primary, sections, footerSections, sidebar, more, allowed, all: allowed };
}

export type PanelAccessState = 'allow' | 'denied' | 'unknown';

export interface PanelAccess {
  state: PanelAccessState;
  route?: PanelRouteDef;
  /** Rótulo da área para a mensagem de 403 (vazio quando desconhecida). */
  area: string;
  /** Motivo da negativa (permissão ausente ou módulo desativado). */
  reason: 'permission' | 'module' | '';
}

/**
 * Acesso do usuário à rota atual do painel — por ancestralidade, então
 * '/clientes/123' herda a guarda de '/clientes'.
 *  - 'allow'   → renderiza a tela;
 *  - 'denied'  → renderiza o aviso de 403 amigável (usuário continua logado);
 *  - 'unknown' → rota fora do catálogo (ex.: /onboarding) → sem guarda aqui.
 */
export function panelAccess(pathname: string, ctx: PanelContext): PanelAccess {
  const route = activePanelRoute(pathname);
  if (!route) return { state: 'unknown', area: '', reason: '' };
  if (!hasAnyPermission(permissionsForRoute(route), ctx)) {
    return { state: 'denied', route, area: areaLabel(route.area), reason: 'permission' };
  }
  if (!hasMode(route, ctx) || !hasFeature(route, ctx)) {
    return { state: 'denied', route, area: areaLabel(route.area), reason: 'module' };
  }
  return { state: 'allow', route, area: areaLabel(route.area), reason: '' };
}

/**
 * Primeira rota permitida — usada para nunca deixar o usuário sem destino
 * quando ele não tem `dashboard` (ex.: VIEWER com agenda liberada).
 * Prefere um destino que esteja NO MENU; se o perfil só tiver destinos fora do
 * menu (ex.: apenas Pedidos legado), usa o primeiro acessível. '' só quando
 * nada é permitido.
 */
export function firstAllowedPath(ctx: PanelContext): string {
  const { sidebar, allowed } = panelNavigation(ctx);
  return sidebar[0]?.href || allowed[0]?.href || '';
}

// ── Guardas de servidor esperados por área ────────────────────
// Mapa declarativo: cada API do painel e a permissão que ela DEVE exigir em
// `requireBusiness(...)`. Coberto por teste de regressão (panel.test.ts), que
// lê o código-fonte das rotas — assim ninguém remove a guarda por engano.
//
// A1.2 · Bloco 1: catálogo alinhado com os guards que JÁ EXISTEM no código
// (/api/integrations, /api/integrations/events, /api/conversations,
// /api/reviews). Nenhum guard real foi removido ou alterado — a lista apenas
// passou a documentar o que o servidor já faz.
export const API_GUARDS: Array<{ route: string; file: string; permission: PermissionId | PermissionId[]; area: string }> = [
  { route: '/api/overview', file: 'src/app/api/overview/route.ts', permission: 'dashboard', area: 'dashboard' },
  { route: '/api/team', file: 'src/app/api/team/route.ts', permission: 'equipe', area: 'equipe' },
  { route: '/api/businesses/:id', file: 'src/app/api/businesses/[id]/route.ts', permission: 'config', area: 'config' },
  { route: '/api/bookings', file: 'src/app/api/bookings/route.ts', permission: 'agenda', area: 'agenda' },
  // Conexão do canal: a porta é Canais & Integrações (a operação fica em /conversas).
  { route: '/api/whatsapp/providers/evolution', file: 'src/app/api/whatsapp/providers/evolution/route.ts', permission: 'whatsapp', area: 'canais' },
  { route: '/api/whatsapp', file: 'src/app/api/whatsapp/route.ts', permission: 'whatsapp', area: 'canais' },
  // Conversas (inbox): leitura e envio exigem a mesma permissão do canal.
  { route: '/api/conversations', file: 'src/app/api/conversations/route.ts', permission: 'whatsapp', area: 'conversas' },
  { route: '/api/catalog', file: 'src/app/api/catalog/route.ts', permission: 'catalogo', area: 'catalogo' },
  { route: '/api/campaigns', file: 'src/app/api/campaigns/route.ts', permission: 'campanhas', area: 'campanhas' },
  { route: '/api/agent', file: 'src/app/api/agent/route.ts', permission: 'agente', area: 'agente' },
  { route: '/api/pages', file: 'src/app/api/pages/route.ts', permission: 'pagina', area: 'pagina' },
  // Avaliações da página pública: mesma permissão do editor.
  { route: '/api/reviews', file: 'src/app/api/reviews/route.ts', permission: 'pagina', area: 'pagina' },
  { route: '/api/analytics', file: 'src/app/api/analytics/route.ts', permission: 'financeiro', area: 'resultados' },
  // Resultados/inteligência (P2): indicadores reais por unidade. A visão
  // consolidada da organização reutiliza a MESMA permissão, unidade por
  // unidade (nunca agrega unidade sem acesso).
  { route: '/api/results', file: 'src/app/api/results/route.ts', permission: 'financeiro', area: 'resultados' },
  { route: '/api/orders', file: 'src/app/api/orders/route.ts', permission: 'pedidos', area: 'pedidos' },
  { route: '/api/people360', file: 'src/app/api/people360/route.ts', permission: 'clientes', area: 'clientes' },
  { route: '/api/contacts', file: 'src/app/api/contacts/route.ts', permission: 'clientes', area: 'clientes' },
  { route: '/api/leads', file: 'src/app/api/leads/route.ts', permission: 'leads', area: 'clientes' },
  // Leitura de catálogo é compartilhada (serviços/profissionais alimentam
  // agenda, clientes e pedidos) — a ESCRITA continua em 'catalogo'.
  {
    route: '/api/catalog/get',
    file: 'src/app/api/catalog/get/route.ts',
    permission: ['catalogo', 'agenda', 'clientes', 'pedidos', 'config', 'pagina'],
    area: 'catalogo',
  },
  // P3/P6 — funil, canais, fontes e integrações
  { route: '/api/integrations', file: 'src/app/api/integrations/route.ts', permission: 'config', area: 'canais' },
  { route: '/api/integrations/events', file: 'src/app/api/integrations/events/route.ts', permission: 'config', area: 'canais' },
  { route: '/api/integrations/keys', file: 'src/app/api/integrations/keys/route.ts', permission: 'config', area: 'canais' },
  { route: '/api/integrations/webhooks', file: 'src/app/api/integrations/webhooks/route.ts', permission: 'config', area: 'canais' },
  { route: '/api/pipeline', file: 'src/app/api/pipeline/route.ts', permission: ['leads', 'config'], area: 'funil' },
  { route: '/api/leads/:id/book', file: 'src/app/api/leads/[id]/book/route.ts', permission: 'agenda', area: 'agenda' },
  // P4 — motor de automações (config = dono/admin da unidade; tarefas são
  // operacionais e podem ser vistas por quem opera funil/agenda/clientes).
  { route: '/api/automations', file: 'src/app/api/automations/route.ts', permission: 'config', area: 'automations' },
  { route: '/api/automations/:id', file: 'src/app/api/automations/[id]/route.ts', permission: 'config', area: 'execucoes' },
  { route: '/api/tasks', file: 'src/app/api/tasks/route.ts', permission: ['leads', 'agenda', 'clientes', 'config'], area: 'tarefas' },
  // P5 — propostas de IA (mesma permissão do editor: a IA não publica sozinha).
  { route: '/api/ai/automations', file: 'src/app/api/ai/automations/route.ts', permission: 'config', area: 'automations' },
];
