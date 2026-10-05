'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { loadMe, resetSessionMeCache } from '@/lib/session-me';
import { clearToken } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { PageFrame, PageSkeleton } from '@/components/ui';
import { AccessDenied, ForbiddenToasts, PanelHomeProvider } from '@/components/dashboard/AccessNotice';
import {
  activePanelPath, activePanelRoute, firstAllowedPath, panelAccess, panelNavigation, pageTypeForPath,
  routeRequiresBusiness, PANEL_ROUTES, type PanelRouteDef,
} from '@/lib/panel';
import { isSessionExpired } from '@/lib/http';
import type { BusinessMode, FeatureId, PermissionId } from '@/lib/types';
import {
  businessContextNeedsCanonicalization, readLastBusinessId, rememberLastBusinessId,
  requiresActiveBusiness, resolveActiveBusinessId,
} from '@/lib/business-context';
import { mayLeaveEditor } from '@/components/dashboard/useUnsavedChanges';
import { WorkspaceContext } from '@/components/dashboard/WorkspaceContext';
import { ConversationsDock } from '@/components/dashboard/ConversationsDock';
import { DEFAULT_ACCENT_ID, findAccent, getNavAccent, type NavAccentId } from '@/lib/nav-accent';
import { WorkspaceNavigation } from '@/components/dashboard/WorkspaceNavigation';
import { WorkspaceTopbar } from '@/components/dashboard/WorkspaceTopbar';
import { HelpCenter } from '@/components/dashboard/HelpCenter';
import { useWorkspaceAlerts } from '@/components/dashboard/NotificationsBell';
import { canLoadOverview } from '@/lib/overview';
import { buildNavSearchItems } from '@/lib/nav-search';
import { isHiddenLegacyNavRoute } from '@/lib/legacy-surfaces';
import { roleLabel } from '@/lib/role-labels';
import { switchUnitHref } from '@/lib/workspace-navigation';
import { isLegacyPagesEnabled } from '@/lib/product';

interface Biz {
  id: string;
  slug: string;
  name: string;
  logo?: string;
  cover?: string;
  modes: BusinessMode[];
  features: Partial<Record<FeatureId, boolean>>;
  published: boolean;
  role?: string;
  isOwner?: boolean;
  permissions?: Record<PermissionId, boolean>;
  readOnly?: boolean;
  organizationId?: string;
  /** Tipo da clínica (identidade: "Clínica veterinária"). Aditivo e opcional. */
  clinicType?: import('@/lib/types').ClinicType;
  /** Escopo do profissional: preenchido ⇒ este login vê só a própria agenda. */
  professionalId?: string;
  professionalName?: string;
  /** 'own' = agenda recortada pelo vínculo · 'none' = papel de atendimento
   *  ainda sem vínculo (o backend não devolve agenda de terceiros). */
  agendaScope?: 'all' | 'own' | 'none';
}

interface SupportInfo {
  id: string;
  businessId: string;
  mode: 'view' | 'admin';
  reason: string;
  expiresAt: string;
}

/** Unit context and access checks stay here; navigation is a presentation component. */
const I = Icon;
function hrefFor(item: PanelRouteDef, query: string) { return item.requiresBusiness === false ? item.href : `${item.href}${query}`; }

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email?: string; role?: string; photo?: string } | null>(null);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [organizations,setOrganizations] = useState<Array<{id:string;name:string;canManage:boolean}>>([]);
  const [isMaster, setIsMaster] = useState(false);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [contextError, setContextError] = useState(false);
  // P0 — a preferência de unidade é POR CONTA: guardamos o id JUNTO com o
  // usuário que o registrou. Numa troca de conta dentro da SPA (sem reload), a
  // preferência da conta anterior deixa de valer imediatamente — nunca decide
  // a unidade da conta nova.
  const [userId, setUserId] = useState('');
  const [remembered, setRemembered] = useState<{ userId: string; id: string }>({ userId: '', id: '' });
  const [collapsed, setCollapsed] = useState(() => {
    // Renome com migração (bloco 5 da correção): chave canônica
    // 'godoutor-side-v2'; a antiga 'il-side-v2' só é lida como fallback.
    // DS 1.0 · §13 — o RAIL RECOLHIDO é o padrão do shell (56–64px): a
    // preferência persistida continua mandando; sem preferência, começa
    // recolhida. O pin "Expandir navegação" empurra o conteúdo e é lembrado.
    try {
      const v = localStorage.getItem('godoutor-side-v2');
      if (v !== null) return v === 'mini';
      const legacy = localStorage.getItem('il-side-v2');
      return legacy !== null ? legacy === 'mini' : true;
    } catch { return true; }
  });
  /* Missão 6 — cor da navegação (Configurações → Aparência). */
  const [navAccent, setNavAccent] = useState<NavAccentId>(DEFAULT_ACCENT_ID);
  useEffect(() => {
    setNavAccent(getNavAccent());
    const sync = (e: Event) => setNavAccent((e as CustomEvent<NavAccentId>).detail);
    window.addEventListener('godoutor:nav-accent', sync);
    return () => window.removeEventListener('godoutor:nav-accent', sync);
  }, []);
  // §5/§6 — tema da clínica: os 5 tokens --accent* + os --il-nav* do preset
  // entram inline no shell (contrato B). Texto e semânticas não são tocados.
  const accentVars = findAccent(navAccent)?.vars || {};
  const lastContextAt = useRef(0);
  // Etapa A: o drawer de navegação móvel pertence ao shell porque quem o abre
  // é o botão de menu da TOPBAR (a busca e o menu saíram da sidebar).
  const [mobileNav, setMobileNav] = useState(false);
  // Central de ajuda: UMA instância no shell, aberta pela sidebar, pela topbar
  // e pelo menu da conta. Nada de três ajudas diferentes.
  const [helpOpen, setHelpOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const loadContext = useCallback((fresh = false) => {
    setContextError(false);
    // SOMENTE 401 (sessão inexistente/expirada/inválida) inicia o fluxo de
    // login. Qualquer outro status mantém o usuário dentro do painel.
    // `fresh` fura o TTL de 5s do loader compartilhado: é o sinal explícito de
    // "módulos/permissões mudaram agora" (toggle em Recursos/Equipe).
    loadMe({ fresh })
      .then((r) => {
        if (!r.ok) {
          if (isSessionExpired(r.status)) router.replace('/login?session=expired');
          else setContextError(true);
          return null;
        }
        return r.data;
      })
      .then((raw) => {
        // Corpo ilegível (parse) não é sessão expirada: mantém o usuário e
        // oferece "Tentar novamente", como antes.
        if (!raw) { setContextError(true); return; }
        // O loader é compartilhado (shell, unidade ativa, permissões) e devolve
        // o payload de forma genérica; aqui ele é lido com o contrato que o
        // shell realmente consome.
        const d = (raw || {}) as {
          user?: { id: string; name: string; email?: string; role?: string; photo?: string } | null;
          businesses?: Biz[];
          organizations?: Array<{ id: string; name: string; canManage: boolean }>;
          isMaster?: boolean;
          support?: SupportInfo | null;
        };
        if (!d.user) { router.replace('/login?session=expired'); return; }
        setIsMaster(!!d.isMaster);
        setSupport(d.support || null);
        // Master da plataforma sem SupportSession ativo vai para /master
        // (área própria). Com suporte ativo, permanece no painel da unidade.
        if (d.isMaster && !d.support && !d.businesses?.length) {
          router.replace('/master');
          return;
        }
        if (!d.businesses?.length && !d.organizations?.some((o) => o.canManage)) { router.replace('/onboarding'); return; }
        setOrganizations(d.organizations || []);
        if (!d.businesses?.length && pathname !== '/organizacao') router.replace(`/organizacao?organization=${d.organizations![0].id}`);
        setUser(d.user || null);
        setUserId(d.user.id);
        setBusinesses(d.businesses || []);
        setReady(true);
        lastContextAt.current = Date.now();
      })
      .catch(() => setContextError(true));
  }, [router]);

  // Preferência de unidade DA CONTA atual (reavaliada quando a identidade
  // muda): a chave é namespaced por usuário, então a conta nova não herda a
  // clínica escolhida pela conta anterior.
  useEffect(() => {
    if (!userId) return;
    setRemembered({ userId, id: readLastBusinessId(userId) });
  }, [userId]);

  const rememberedBusinessId = remembered.userId === userId ? remembered.id : '';

  useEffect(() => {
    // 401 (sessão inexistente/expirada/inválida) é o ÚNICO status que inicia
    // o fluxo de login; qualquer outro mantém o usuário dentro do painel.
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // REVALIDAÇÃO HONESTA DO CONTEXTO (auditoria §11): módulos e permissões
  // mudam em Recursos/Equipe sem recarregar a página. O cache antigo fazia a
  // GUARDA DO CLIENTE negrear acesso a áreas recém-ativadas (ex.: ligar
  // "Produtos" e /produtos responder "você não tem acesso"). Recarregamos o
  // contexto ao navegar, quando o cache tem >5s, e quando a tela dispara
  // `godoutor:business-refresh` (toggle de módulo, mudança de equipe).
  useEffect(() => {
    if (!ready) return;
    if (Date.now() - lastContextAt.current > 5000) loadContext();
  }, [ready, pathname, loadContext]);
  useEffect(() => {
    const fn = () => loadContext(true);
    window.addEventListener('godoutor:business-refresh', fn);
    return () => window.removeEventListener('godoutor:business-refresh', fn);
  }, [loadContext]);

  // Unidade ativa: NUNCA depende de businesses[0].
  // ?b= explícito → última unidade lembrada → única unidade. Com 2+ unidades
  // sem escolha válida, abre o seletor em vez de assumir um tenant pela ordem
  // do banco (causa raiz do login Andrioni → "Hamburguer Podrão").
  //
  // HISTÓRICO (P0, 2026-10): aquela primeira correção fechou só a decisão de
  // tenant pela ORDEM do array. O incidente tinha OUTROS caminhos, abertos na
  // CAMADA DE SESSÃO e corrigidos depois: (1) cookie antigo vencendo o Bearer
  // novo em `userFromRequestFromDB` — duas credenciais válidas de contas
  // diferentes resolviam para a conta anterior; (2) cache module-global do
  // `/api/auth/me` servindo o contexto da conta anterior dentro do TTL;
  // (3) `godoutor:last-business` global, decidindo unidade entre contas. A
  // preferência de unidade hoje é namespaced por usuário e o id guardado aqui
  // carrega o DONO junto — troca de conta não aplica a preferência antiga.
  useEffect(() => {
    if (!ready || businesses.length === 0) return;
    const requested = params.get('b');
    const resolved = resolveActiveBusinessId(requested, businesses, rememberedBusinessId);

    if (resolved) {
      if (rememberedBusinessId !== resolved) {
        rememberLastBusinessId(resolved, userId);
        setRemembered({ userId, id: resolved });
      }
      if (requiresActiveBusiness(pathname) && requested !== resolved) {
        const qs = new URLSearchParams(params.toString());
        qs.set('b', resolved);
        router.replace(`${pathname}?${qs.toString()}`);
      }
      return;
    }

    if (requiresActiveBusiness(pathname) && businesses.length > 1) {
      router.replace('/selecionar-clinica');
    }
  }, [ready, businesses, rememberedBusinessId, userId, params, pathname, router]);

  const activePath = activePanelPath(pathname);
  const activeRoute = activePanelRoute(pathname);

  // ── Notificações reais (Etapa A) ────────────────────────────────────────
  // Hook declarado ANTES de qualquer early return (regra de hooks do React).
  // O id vem do ?b= válido, da última unidade lembrada ou da única unidade.
  // Em contexto ambíguo fica vazio até a escolha explícita.
  const provisionalBiz = resolveActiveBusinessId(params.get('b'), businesses, rememberedBusinessId);
  const alertsBiz = activePath === '/organizacao' ? '' : provisionalBiz;
  // Sino: só lê o Overview quando a unidade ativa concede `dashboard` (e depois
  // que as permissões chegaram) — quem não tem Visão geral não gera chamada.
  const alertsPerms = businesses.find((b) => b.id === alertsBiz)?.permissions;
  const alertsAccess: 'allowed' | 'pending' | 'denied' = !ready ? 'pending' : canLoadOverview(ready, alertsPerms) ? 'allowed' : 'denied';
  const alerts = useWorkspaceAlerts(alertsBiz, alertsBiz ? `?b=${alertsBiz}` : '', alertsAccess);

  // ── Geometria do Workspace Sheet (Etapa B consome) ────────────────────────
  // O sheet NUNCA cobre sidebar/topbar. Em vez de calcular larguras no código
  // (recolher + segunda coluna contextual mudam isso), medimos onde o conteúdo
  // realmente começa e publicamos em `--sheet-left`. Sempre verdadeiro.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const apply = () => {
      const left = Math.max(0, Math.round(el.getBoundingClientRect().left));
      document.documentElement.style.setProperty('--sheet-left', `${left}px`);
    };
    apply();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    observer?.observe(el);
    window.addEventListener('resize', apply);
    return () => { observer?.disconnect(); window.removeEventListener('resize', apply); };
  });

  function switchBiz(id: string) {
    if (!mayLeaveEditor()) return;
    if (id === '__overview') { router.push(`/organizacao?organization=${business?.organizationId || ''}`); return; }
    if (id === '__add') { router.push(`/organizacao?organization=${business?.organizationId || ''}&add=1`); return; }
    // Em rota que não é de unidade (ex.: /organizacao) a troca leva ao painel.
    rememberLastBusinessId(id, userId);
    setRemembered({ userId, id });
    const target = routeRequiresBusiness(pathname) ? pathname : '/dashboard';
    router.push(switchUnitHref(target, new URLSearchParams(params.toString()), id));
  }
  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem('godoutor-side-v2', c ? 'full' : 'mini'); localStorage.removeItem('il-side-v2'); } catch {}
      return !c;
    });
  }
  async function logout() {
    if (!mayLeaveEditor()) return;
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    // Fronteira de identidade (P0): encerra a credencial local E o contexto
    // em cache — o próximo login não pode herdar nada desta conta (token,
    // cache/in-flight de /api/auth/me, unidade ativa). A preferência de
    // unidade fica onde está: ela é namespaced por usuário (business-context).
    clearToken();
    resetSessionMeCache();
    window.location.assign('/login');
  }

  if (contextError && !ready) return <div className="il-platform p-8" role="alert"><h1>Não foi possível carregar sua clínica</h1><p>Confira sua conexão e tente novamente. Sua sessão foi preservada.</p><button className="il-control mt-4" onClick={() => loadContext(true)}>Tentar novamente</button></div>;
  if (!ready || !user) {
    return (
      <div className="min-h-screen lg:flex" aria-label="Carregando painel">
        <div className="hidden lg:flex w-[248px] shrink-0 flex-col bg-white border-r border-[var(--border)] p-3 gap-2">
          <div className="h-9 w-32 bg-zinc-100 animate-pulse mb-2" />
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-7 bg-zinc-100 animate-pulse" />)}
        </div>
        <div className="flex-1 min-w-0"><div className="px-6 lg:px-8 py-6"><PageSkeleton /></div></div>
      </div>
    );
  }

  const activeBusinessId = resolveActiveBusinessId(params.get('b'), businesses, rememberedBusinessId);
  const organization = organizations.find(o=>o.id === params.get('organization')) || organizations.find(o=>o.id === businesses.find(b=>b.id===activeBusinessId)?.organizationId) || organizations[0];
  const legacyPagesEnabled = isLegacyPagesEnabled();
  const selectedBusiness = businesses.find(b=>b.id===activeBusinessId);
  const business: Biz = (activePath === '/organizacao'
    ? businesses.find(b=>b.organizationId===organization?.id)
    : selectedBusiness
  ) || {id:'',slug:'',name:organization?.name || 'Organização',organizationId:organization?.id,modes:[],features:{},published:false};
  if (requiresActiveBusiness(pathname) && businesses.length > 1 && !activeBusinessId) {
    return (
      <div className="min-h-screen lg:flex" aria-label="Selecionando clínica">
        <div className="hidden lg:flex w-[248px] shrink-0 flex-col bg-white border-r border-[var(--border)] p-3 gap-2">
          <div className="h-9 w-32 bg-zinc-100 animate-pulse mb-2" />
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-7 bg-zinc-100 animate-pulse" />)}
        </div>
        <div className="flex-1 min-w-0"><div className="px-6 lg:px-8 py-6"><PageSkeleton /></div></div>
      </div>
    );
  }

  // P2 — CONTEXTO DE TENANT HONESTO (a URL canônica vem antes do miolo).
  //
  // Um `?b=` que a conta NÃO alcança não é contexto, é lixo: o efeito acima já
  // resolve a unidade legítima e reescreve a URL (`router.replace`), mas as
  // TELAS de área leem o `?b=` da URL por conta própria. Se elas montassem
  // antes da canonicalização, pediriam dados de OUTRO tenant; o servidor
  // responderia 403 (isolamento correto) e a área exibiria "Seu perfil não
  // possui acesso" — mensagem ERRADA, porque o papel tem acesso à área: só o
  // id pedido não pertence à conta.
  //
  // Por isso o miolo não monta enquanto a URL não estiver canônica: o shell
  // mostra o esqueleto (mesmo estado de carregamento de sempre) e a área
  // carrega JÁ com a unidade legítima. Isto NÃO afrouxa autorização — a
  // negação real por permissão (`panelAccess`, 403 das APIs, `?b=` alheio
  // chamado direto na API) continua exatamente onde estava.
  if (requiresActiveBusiness(pathname) && businessContextNeedsCanonicalization(params.get('b'), activeBusinessId)) {
    return (
      <div className="min-h-screen lg:flex" aria-label="Carregando painel">
        <div className="hidden lg:flex w-[248px] shrink-0 flex-col bg-white border-r border-[var(--border)] p-3 gap-2">
          <div className="h-9 w-32 bg-zinc-100 animate-pulse mb-2" />
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-7 bg-zinc-100 animate-pulse" />)}
        </div>
        <div className="flex-1 min-w-0"><div className="px-6 lg:px-8 py-6"><PageSkeleton /></div></div>
      </div>
    );
  }

  const modes = business?.modes || [];
  const features = business?.features || {};
  const permissions: Partial<Record<PermissionId, boolean>> = business?.permissions || {};
  // Navegação e guarda de rota vêm da fonte única (lib/panel.ts).
  const panelCtx = { permissions, modes, features: features as Partial<Record<FeatureId, boolean>> };
  const nav = panelNavigation(panelCtx);
  if (!business.id) nav.allowed = organization?.canManage ? PANEL_ROUTES.filter(r=>r.href==='/organizacao') : [];
  // CORREÇÃO FINAL: com a flag OFF saem da navegação/busca a Página E as
  // superfícies operacionais comerciais (Produtos, Pedidos). Regra única em
  // lib/legacy-surfaces.ts (isHiddenLegacyNavRoute); nada é apagado.
  const operationalNav = { ...nav, allowed: nav.allowed.filter((route) => !isHiddenLegacyNavRoute(route.href, legacyPagesEnabled)) };
  const access = panelAccess(pathname, panelCtx);
  const q = business ? `?b=${business.id}` : '';
  // BUSCA DE NAVEGAÇÃO (ponto 2): a fonte é `nav.allowed` — o MESMO cálculo de
  // permissão que monta o menu. Nenhum destino extra entra aqui, então a busca
  // não tem como revelar (nem levar a) uma tela que o usuário não alcança.
  // A regra de busca fica em lib/nav-search.ts (pura e testada).
  // ── Contexto de área + notificações ─────────────────────────────────────
  // (O breadcrumb foi REMOVIDO do workspace pelo refino final — o cabeçalho da
  // página identifica a tela. A partição segue valendo para a cor da área.)
  // que o usuário não alcança. As notificações vêm de /api/overview (dado real).
  // Multiunidade REAL: só quando existe mais de uma unidade na conta. Sem isso
  // "Organização" não ocupa linha no menu (a porta continua acessível por URL).
  const multiUnit = businesses.length > 1;
  const unitRole = business.role && business.role !== 'OWNER'
    ? `${roleLabel(business.role)}${business.readOnly ? ' · somente leitura' : ''}`
    : undefined;

  // Dashboard fica sempre no topo, sem seção; demais itens agrupados.
  // A Agenda é o ambiente operacional: chrome mínimo para a grade ocupar a
  // viewport (menos padding, sem rodapé). As demais telas não mudam.
  const isAgenda = activePath === '/agenda';
  const isConversations = activePath === '/conversas';
  const standaloneConversation = isConversations && params.get('standalone') === '1';
  const conversationFocus = isConversations && (standaloneConversation || params.get('focus') === '1');
  // PageFrame recebe o contrato obrigatório do catálogo, inclusive detalhes
  // aninhados em /clientes/[id]. Largura e gutters não são escolhidos pela tela.
  const pageType = pageTypeForPath(pathname) || activeRoute?.pageType || 'workspace';
  // Sem permissão de dashboard (ex.: VIEWER com agenda liberada) o usuário
  // ainda precisa de um destino válido ao clicar em "Início" — e TODO 403
  // precisa de uma porta de volta (fornecida por contexto às telas).
  const fallbackHref = firstAllowedPath(panelCtx);
  const fallbackRoute = nav.allowed.find((r) => r.href === fallbackHref);
  const homeHref = fallbackHref ? hrefFor(fallbackRoute || { href: fallbackHref } as PanelRouteDef, q) : '';

  // Mobile: pills = menu; "Mais" = todas as seções + destinos fora do menu.

  return (
    // A3.3 CONVERGÊNCIA — o painel tem UM design system padrão: a aparência da
    // navegação vem dos tokens `--il-nav*` definidos em `globals.css` (:root),
    // e NÃO da cor da empresa.
    //
    // Aqui já existiu `style={navTokenStyle(business?.appearance?.navColor)}`,
    // que fazia uma unidade com `appearance.navColor` legado (salvo quando
    // Configurações tinha a aba "Aparência") tematizar a sidebar. Isso foi
    // removido de propósito: white label significa identificar a EMPRESA por
    // logo/nome, não pintar o painel administrativo com a cor dela.
    //
    // O dado antigo continua persistido (sem migração destrutiva) — só deixou
    // de ser APLICADO ao painel. A página pública segue com identidade própria
    // e independente (Page.theme).
    //
    // `PanelHomeProvider` entrega o destino de volta a qualquer 403 do painel
    // sem que cada tela precise calcular (ou chutar) o seu.
    <PanelHomeProvider home={homeHref}>
    <WorkspaceContext.Provider value={{ role: business.role, agendaScope: business.agendaScope }}>
    <div
      style={{
        '--sidebar-w': collapsed ? 'var(--sidebar-w-mini)' : undefined,
        ...accentVars,
      } as React.CSSProperties}
      data-nav-accent={navAccent}
      className={cn('il-platform workspace-shell min-h-screen', isAgenda && 'workspace-shell--fill', isConversations && 'workspace-shell--conversations', conversationFocus && 'workspace-shell--conversation-focus', standaloneConversation && 'workspace-shell--standalone')}
    >
      <a href="#workspace-content" className="workspace-skip">Ir para o conteúdo</a>

      {/* DS 1.0 · §12 — a TOP BAR é filha DIRETA do shell: ocupa 100% da
          largura, começa em x=0 e fica ACIMA da navegação (a sidebar começa
          abaixo dela). Geometria no CSS, por token — nada calculado à mão. */}
      {!conversationFocus && <WorkspaceTopbar
        page={activeRoute?.label || 'Painel'}
        query={q}
        searchItems={buildNavSearchItems(operationalNav, q)}
        activePath={activePath}
        businessId={business.id}
        legacyPagesEnabled={legacyPagesEnabled}
        alerts={alerts}
        user={{ ...user, role: unitRole || user.role }}
        unit={business}
        units={businesses}
        overview={activePath === '/organizacao'}
        canOverview={nav.allowed.some((i) => i.href === '/organizacao')}
        canConfig={nav.allowed.some((i) => i.href === '/configuracoes')}
        isMaster={isMaster}
        onUnit={switchBiz}
        onLogout={logout}
        onOpenNav={() => setMobileNav(true)}
        onOpenHelp={() => setHelpOpen(true)}
        canCreate={nav.allowed.map((i) => i.href).filter((h) => ['/agenda', '/clientes', '/tarefas', '/servicos', '/profissionais', '/financeiro'].includes(h))}
        canOpenConversations={nav.allowed.some((i) => i.href === '/conversas') && activePath !== '/conversas' && activePath !== '/organizacao'}
        vet={business.clinicType === 'veterinaria'}
      />}

      {/* `nav={nav}`: a navegação continua vindo do catálogo (lib/panel.ts) —
          o shell não tem lista própria de destinos. */}
      {/* A navegação vem DEPOIS da topbar (linha de baixo do shell). */}
      {!conversationFocus && <WorkspaceNavigation nav={nav}
        activePath={activePath} unit={business}
        units={businesses} multiUnit={multiUnit} onUnit={switchBiz}
        collapsed={collapsed} onCollapse={toggle}
        mobileOpen={mobileNav} onMobileOpen={setMobileNav}
        onHelp={() => setHelpOpen(true)}
      />}

      <div className="workspace-main-col">

      {!conversationFocus && <HelpCenter
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        query={q}
        nav={nav}
        businessId={business.id}
      />}

      {nav.allowed.some(i => i.href === '/conversas') && activePath !== '/conversas' && activePath !== '/organizacao' && <ConversationsDock key={business.id} businessId={business.id}/>}
      <main ref={mainRef} id="workspace-content" tabIndex={-1} className={cn('workspace-content flex-1 min-w-0', conversationFocus && 'workspace-content--focus')}>
        {support && (
          <div className={cn('px-4 lg:px-8 py-2.5 text-xs font-semibold flex flex-wrap items-center gap-x-3 gap-y-1 border-b',
            support.mode === 'view' ? 'bg-[var(--warning-bg)] text-[var(--warning-fg)] border-[var(--warning-border)]' : 'bg-[var(--danger)] text-white border-[var(--danger-strong)]')}>
            <span className="inline-flex items-center gap-1.5"><I n="shield" size={14} /> {support.mode === 'view' ? 'Modo suporte — somente leitura' : 'Modo administrativo'}</span>
            <span className="opacity-80">Empresa: {business?.name} · expira {new Date(support.expiresAt).toISOString().slice(11, 16)} UTC</span>
            <button onClick={async () => {
              await fetch('/api/master/support', { method: 'DELETE' }).catch(() => {});
              await fetch('/api/admin/support', { method: 'DELETE' }).catch(() => {});
              window.location.assign('/master');
            }} className="ml-auto underline underline-offset-2">Sair do modo suporte</button>
          </div>
        )}
        <PageFrame key={business.id} type={pageType} flush={isAgenda || isConversations}
          className={cn(isAgenda && 'agenda-page-gutter', isConversations && 'conversation-page-wrap')}>
          {/* CONTRATO DO REFINO FINAL — sem breadcrumb em NENHUMA tela do
              workspace: o cabeçalho da página (chip + título + subtítulo)
              identifica a tela. O contexto vive na sidebar/topbar. */}
          {!conversationFocus && isMaster && !support && (
            <p className="mb-4 text-xs font-semibold text-[var(--warning-fg)] bg-[var(--warning-bg)] border border-[var(--warning-border)] rounded-md px-3 py-2 inline-flex items-center gap-2 shadow-xs">
              <I n="shield" size={14} /> Você é master — <Link href="/master" className="underline font-semibold">/master</Link>
            </p>
          )}
          {/* Hierarquia (item 4 do briefing): o papel de quem está logado era
              um parágrafo permanente no miolo de TODA tela. A informação não
              foi removida — mora na topbar, ao lado do nome, onde pertence. */}
          {!conversationFocus && business?.agendaScope === 'own' && (
            // Honestidade com quem atende: a agenda mostrada é SÓ a dele.
            // (A restrição é do servidor — aqui só avisamos.)
            <p className="mb-4 text-xs font-semibold text-[var(--text)] bg-white border border-[var(--border)] rounded-md px-3 py-2 inline-flex items-center gap-2 shadow-xs">
              <I n="idcard" size={14} />
              Você vê <strong>somente a sua agenda</strong>{business.professionalName ? ` (${business.professionalName})` : ''}. Os clientes da unidade continuam disponíveis em Clientes.
            </p>
          )}
          {!conversationFocus && business?.agendaScope === 'none' && (
            // Vínculo ainda não configurado: a agenda fica vazia por segurança
            // (nunca a de todo mundo). O caminho para resolver é o Equipe.
            <p className="mb-4 text-xs font-semibold text-[var(--warning-fg)] bg-[var(--warning-bg)] border border-[var(--warning-border)] rounded-md px-3 py-2 inline-flex flex-wrap items-center gap-2 shadow-xs" role="status">
              <I n="alert" size={14} />
              Seu acesso de atendimento ainda <strong>não está vinculado a um profissional</strong>, então a agenda aparece vazia.
              Peça ao administrador para vincular em Equipe → “Profissional vinculado”.
            </p>
          )}
          {access.state === 'denied' && !(activePath === '/organizacao' && organization?.canManage) ? (
            // 403 AMIGÁVEL: o usuário continua logado e dentro do painel.
            // Nada aqui limpa token ou redireciona para /login.
            <AccessDenied
              area={access.area || access.route?.label}
              hint={access.reason === 'module'
                ? `O módulo “${access.route?.label}” não está ativo nesta empresa. Nada foi perdido: ao reativar em Recursos, a área volta com todo o conteúdo.`
                : undefined}
            />
          ) : children}
        </PageFrame>
        {!isAgenda && !isConversations && business.id && (
          <footer className="px-4 lg:px-8 py-4 border-t border-[var(--border)] mt-8">
            <p className="text-[11px] text-[var(--text-faint)] text-center">{business.name}{legacyPagesEnabled && <> · <a href={`/${business.slug}`} target="_blank" rel="noreferrer" className="underline font-semibold text-[var(--text-muted)]">página pública /{business.slug}</a></>}</p>
          </footer>
        )}
      </main>
      </div>

      {/* 403 de qualquer ação do painel → aviso amigável (sessão preservada). */}
      <ForbiddenToasts context={{ scope: 'action', area: access.area || activeRoute?.label }} />
    </div>
    </WorkspaceContext.Provider>
    </PanelHomeProvider>
  );
}
