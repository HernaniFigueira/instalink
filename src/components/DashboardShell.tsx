'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { clearToken } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { AccessDenied, ForbiddenToasts, PanelHomeProvider } from '@/components/dashboard/AccessNotice';
import {
  activePanelPath, activePanelRoute, firstAllowedPath, panelAccess, panelNavigation,
  routeRequiresBusiness, PANEL_ROUTES, type PanelRouteDef,
} from '@/lib/panel';
import { isSessionExpired } from '@/lib/http';
import type { BusinessMode, FeatureId, PermissionId } from '@/lib/types';
import { requiresActiveBusiness } from '@/lib/business-context';
import { mayLeaveEditor } from '@/components/dashboard/useUnsavedChanges';
import { WorkspaceContext } from '@/components/dashboard/WorkspaceContext';
import { ConversationsDock } from '@/components/dashboard/ConversationsDock';
import { WorkspaceNavigation } from '@/components/dashboard/WorkspaceNavigation';
import { WorkspaceTopbar } from '@/components/dashboard/WorkspaceTopbar';
import { useWorkspaceAlerts } from '@/components/dashboard/NotificationsBell';
import { buildNavSearchItems } from '@/lib/nav-search';
import { roleLabel } from '@/lib/role-labels';
import {
  routeAreaColor, routeBreadcrumb, switchUnitHref, workspaceAreas,
} from '@/lib/workspace-navigation';

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
  const [user, setUser] = useState<{ name: string; email?: string; role?: string } | null>(null);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [organizations,setOrganizations] = useState<Array<{id:string;name:string;canManage:boolean}>>([]);
  const [isMaster, setIsMaster] = useState(false);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [contextError, setContextError] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('il-side-v2') === 'mini'; } catch { return false; }
  });
  const lastContextAt = useRef(0);
  // Etapa A: o drawer de navegação móvel pertence ao shell porque quem o abre
  // é o botão de menu da TOPBAR (a busca e o menu saíram da sidebar).
  const [mobileNav, setMobileNav] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const loadContext = useCallback(() => {
    setContextError(false);
    // SOMENTE 401 (sessão inexistente/expirada/inválida) inicia o fluxo de
    // login. Qualquer outro status mantém o usuário dentro do painel.
    fetch('/api/auth/me')
      .then(async (r) => {
        if (!r.ok) {
          if (isSessionExpired(r.status)) router.replace('/login?session=expired');
          else setContextError(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (!d.user) { router.replace('/login?session=expired'); return; }
        setIsMaster(!!d.isMaster);
        setSupport(d.support || null);
        // Master da plataforma sem SupportSession ativo vai para /master
        // (área própria). Com suporte ativo, permanece no painel da unidade.
        if (d.isMaster && !d.support && !d.businesses?.length) {
          router.replace('/master');
          return;
        }
        if (!d.businesses?.length && !d.organizations?.some((o: {canManage:boolean})=>o.canManage)) { router.replace('/onboarding'); return; }
        setOrganizations(d.organizations || []);
        if (!d.businesses?.length && pathname !== '/organizacao') router.replace(`/organizacao?organization=${d.organizations[0].id}`);
        setUser(d.user);
        setBusinesses(d.businesses);
        setReady(true);
        lastContextAt.current = Date.now();
      })
      .catch(() => setContextError(true));
  }, [router]);

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
  // `il:business-refresh` (toggle de módulo, mudança de equipe).
  useEffect(() => {
    if (!ready) return;
    if (Date.now() - lastContextAt.current > 5000) loadContext();
  }, [ready, pathname, loadContext]);
  useEffect(() => {
    const fn = () => loadContext();
    window.addEventListener('il:business-refresh', fn);
    return () => window.removeEventListener('il:business-refresh', fn);
  }, [loadContext]);

  // Unidade ativa: só rotas que PRECISAM de unidade (o catálogo diz quais)
  // recebem o `?b=`. Os demais parâmetros da URL são preservados — trocar de
  // unidade ou chegar sem `?b=` nunca derruba `?tab=`, `?organization=`, etc.
  useEffect(() => {
    if (!ready || businesses.length === 0) return;
    if (!requiresActiveBusiness(pathname)) return;
    const b = params.get('b');
    if (businesses.some((x) => x.id === b)) return;
    const qs = new URLSearchParams(params.toString());
    qs.set('b', businesses[0].id);
    router.replace(`${pathname}?${qs.toString()}`);
  }, [ready, businesses, params, pathname, router]);

  const activePath = activePanelPath(pathname);
  const activeRoute = activePanelRoute(pathname);

  // ── Notificações reais (Etapa A) ────────────────────────────────────────
  // Hook declarado ANTES de qualquer early return (regra de hooks do React).
  // O id vem do ?b= válido ou da primeira unidade; na visão de organização o
  // painel some (não há unidade ativa para ler pendências).
  const provisionalBiz = params.get('b') && businesses.some((b) => b.id === params.get('b'))
    ? params.get('b')!
    : businesses[0]?.id || '';
  const alertsBiz = activePath === '/organizacao' ? '' : provisionalBiz;
  const alerts = useWorkspaceAlerts(alertsBiz, alertsBiz ? `?b=${alertsBiz}` : '');

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
    const target = routeRequiresBusiness(pathname) ? pathname : '/dashboard';
    router.push(switchUnitHref(target, new URLSearchParams(params.toString()), id));
  }
  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem('il-side-v2', c ? 'full' : 'mini'); } catch {}
      return !c;
    });
  }
  async function logout() {
    if (!mayLeaveEditor()) return;
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    clearToken();
    window.location.assign('/login');
  }

  if (contextError && !ready) return <div className="il-platform p-8" role="alert"><h1>Não foi possível carregar sua clínica</h1><p>Confira sua conexão e tente novamente. Sua sessão foi preservada.</p><button className="il-control mt-4" onClick={loadContext}>Tentar novamente</button></div>;
  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-[var(--bg)] lg:flex" aria-label="Carregando painel">
        <div className="hidden lg:flex w-[248px] shrink-0 flex-col bg-white border-r border-[var(--border)] p-3 gap-2">
          <div className="h-9 w-32 bg-zinc-100 animate-pulse mb-2" />
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-7 bg-zinc-100 animate-pulse" />)}
        </div>
        <div className="flex-1 min-w-0"><div className="px-6 lg:px-8 py-6"><PageSkeleton /></div></div>
      </div>
    );
  }

  const organization = organizations.find(o=>o.id === params.get('organization')) || organizations.find(o=>o.id === businesses.find(b=>b.id===params.get('b'))?.organizationId) || organizations[0];
  const business: Biz = (activePath === '/organizacao' ? businesses.find(b=>b.organizationId===organization?.id) : businesses.find(b=>b.id===params.get('b')) || businesses[0]) || {id:'',slug:'',name:organization?.name || 'Organização',organizationId:organization?.id,modes:[],features:{},published:false};
  const modes = business?.modes || [];
  const features = business?.features || {};
  const permissions: Partial<Record<PermissionId, boolean>> = business?.permissions || {};
  // Navegação e guarda de rota vêm da fonte única (lib/panel.ts).
  const panelCtx = { permissions, modes, features: features as Partial<Record<FeatureId, boolean>> };
  const nav = panelNavigation(panelCtx);
  if (!business.id) nav.allowed = organization?.canManage ? PANEL_ROUTES.filter(r=>r.href==='/organizacao') : [];
  const access = panelAccess(pathname, panelCtx);
  const q = business ? `?b=${business.id}` : '';
  // BUSCA DE NAVEGAÇÃO (ponto 2): a fonte é `nav.allowed` — o MESMO cálculo de
  // permissão que monta o menu. Nenhum destino extra entra aqui, então a busca
  // não tem como revelar (nem levar a) uma tela que o usuário não alcança.
  // A regra de busca fica em lib/nav-search.ts (pura e testada).
  // ── Breadcrumb + notificações (Etapa A) ─────────────────────────────────
  // O breadcrumb é projeção da MESMA partição que monta o menu: nunca cita área
  // que o usuário não alcança. As notificações vêm de /api/overview (dado real).
  const areas = workspaceAreas(nav.allowed);
  const crumb = routeBreadcrumb(activePath, areas);
  const unitRole = business.role && business.role !== 'OWNER'
    ? `${roleLabel(business.role)}${business.readOnly ? ' · somente leitura' : ''}`
    : undefined;

  // Dashboard fica sempre no topo, sem seção; demais itens agrupados.
  // A Agenda é o ambiente operacional: chrome mínimo para a grade ocupar a
  // viewport (menos padding, sem rodapé). As demais telas não mudam.
  const isAgenda = activePath === '/agenda';
  // Largura é política do CATÁLOGO (campo `width`), não uma lista à parte:
  // telas densas (grade, kanban, tabela, colunas) usam a largura toda;
  // formulários e listas de coluna única ficam em 960px de leitura.
  const isFullWidth = activeRoute?.width === 'full';
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
        '--area-color': crumb.area?.color || routeAreaColor(activePath, areas),
        '--sidebar-w': collapsed ? 'var(--sidebar-w-mini)' : undefined,
      } as React.CSSProperties}
      className="il-platform workspace-shell min-h-screen bg-[var(--bg)]"
    >
      <a href="#workspace-content" className="workspace-skip">Ir para o conteúdo</a>

      {/* `nav={nav}`: a navegação continua vindo do catálogo (lib/panel.ts) —
          o shell não tem lista própria de destinos. Sidebar primeiro: ela
          ocupa top:0→bottom:0 e a topbar vive na coluna da direita. */}
      <WorkspaceNavigation nav={nav}
        activePath={activePath} unit={business}
        collapsed={collapsed} onCollapse={toggle}
        mobileOpen={mobileNav} onMobileOpen={setMobileNav}
      />

      <div className="workspace-main-col">
      <WorkspaceTopbar
        group={crumb.group}
        page={activeRoute?.label || 'Painel'}
        query={q}
        searchItems={buildNavSearchItems(nav, q)}
        activePath={activePath}
        alerts={alerts}
        user={{ ...user, role: unitRole || user.role }}
        unit={business}
        units={businesses}
        overview={activePath === '/organizacao'}
        canOverview={nav.allowed.some((i) => i.href === '/organizacao')}
        canTeam={nav.allowed.some((i) => i.href === '/equipe')}
        canConfig={nav.allowed.some((i) => i.href === '/configuracoes')}
        isMaster={isMaster}
        onUnit={switchBiz}
        onLogout={logout}
        onOpenNav={() => setMobileNav(true)}
        canCreate={nav.allowed.map((i) => i.href).filter((h) => ['/agenda', '/clientes', '/tarefas', '/servicos'].includes(h))}
      />

      {nav.allowed.some(i => i.href === '/conversas') && activePath !== '/conversas' && activePath !== '/organizacao' && <ConversationsDock key={business.id} businessId={business.id}/>}
      <main ref={mainRef} id="workspace-content" tabIndex={-1} className="workspace-content flex-1 min-w-0 bg-[var(--bg)]">
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
        <div key={business.id} className={cn(isAgenda ? 'agenda-page-gutter' : 'px-4 lg:px-8 py-6', !isFullWidth && 'max-w-[960px]')}>
          {/* Breadcrumb de CONTEXTO no conteúdo (o branding vive na sidebar e o
              nome da clínica, uma vez, no seletor de unidade da topbar). */}
          <nav aria-label="Breadcrumb" className="ws-crumbs--content">
            {activePath !== fallbackHref && homeHref && (
              <>
                <Link href={homeHref}>Início</Link>
                <I n="chevronRight" size={12} aria-hidden="true" />
              </>
            )}
            {crumb.group && (
              <>
                <span>{crumb.group}</span>
                <I n="chevronRight" size={12} aria-hidden="true" />
              </>
            )}
            <span aria-current="page">{activeRoute?.label || 'Painel'}</span>
          </nav>
          {isMaster && !support && (
            <p className="mb-4 text-xs font-semibold text-[var(--warning-fg)] bg-[var(--warning-bg)] border border-[var(--warning-border)] rounded-md px-3 py-2 inline-flex items-center gap-2 shadow-xs">
              <I n="shield" size={14} /> Você é master — <Link href="/master" className="underline font-semibold">/master</Link>
            </p>
          )}
          {/* Hierarquia (item 4 do briefing): o papel de quem está logado era
              um parágrafo permanente no miolo de TODA tela. A informação não
              foi removida — mora na topbar, ao lado do nome, onde pertence. */}
          {business?.agendaScope === 'own' && (
            // Honestidade com quem atende: a agenda mostrada é SÓ a dele.
            // (A restrição é do servidor — aqui só avisamos.)
            <p className="mb-4 text-xs font-semibold text-[var(--text)] bg-white border border-[var(--border)] rounded-md px-3 py-2 inline-flex items-center gap-2 shadow-xs">
              <I n="idcard" size={14} />
              Você vê <strong>somente a sua agenda</strong>{business.professionalName ? ` (${business.professionalName})` : ''}. Os clientes da unidade continuam disponíveis em Clientes.
            </p>
          )}
          {business?.agendaScope === 'none' && (
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
        </div>
        {!isAgenda && business.id && (
          <footer className="px-4 lg:px-8 py-4 border-t border-[var(--border)] mt-8">
            <p className="text-[11px] text-[var(--text-faint)] text-center">{business.name} · <a href={`/${business.slug}`} target="_blank" rel="noreferrer" className="underline font-semibold text-[var(--text-muted)]">página pública /{business.slug}</a></p>
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
