'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { clearToken } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import { PageSkeleton } from '@/components/ui';
import { AccessDenied, ForbiddenToasts } from '@/components/dashboard/AccessNotice';
import {
  FULL_WIDTH_PATHS, firstAllowedPath, panelAccess, panelNavigation, panelRouteFor,
} from '@/lib/panel';
import { isSessionExpired } from '@/lib/http';
import type { BusinessMode, FeatureId, PermissionId } from '@/lib/types';
import { requiresActiveBusiness } from '@/lib/business-context';
import { unitsInSameOrganization } from '@/lib/organization';
import { navTokenStyle } from '@/lib/appearance';

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
  /** Identidade visual do Dashboard (P2) — acompanha a unidade selecionada. */
  appearance?: { navColor?: string };
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

// Glifos de marca (WhatsApp) existem apenas como forma sólida: com stroke
// ficam como contorno duplo ilegível (era o "ícone do WhatsApp ruim").
const FILL_ICONS = new Set(['whatsapp']);

function Svg({ size = 18, fill = false, children }: { size?: number; fill?: boolean; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  home: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>),
  link: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  cart: (<><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>),
  scissors: (<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.12 15.88" /><path d="M14.47 14.48 20 20" /><path d="M8.12 8.12 12 12" /></>),
  // Ícone neutro de serviço/atendimento (nada de tesoura/salão).
  service: (<><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M3 13h18" /></>),
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  bag: (<><path d="M6 7h12l1 13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>),
  receipt: (<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M8 7h8" /><path d="M8 11h8" /><path d="M8 15h5" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  // Profissionais (quem atende): crachá — distinto de Clientes (users).
  idcard: (<><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5.5 16a2.5 2.5 0 0 1 5 0" /><path d="M14 9h4" /><path d="M14 13h4" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="M8 17V9" /><path d="M13 17V5" /><path d="M18 17v-8" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.24.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.27.4-1.51 1Z" /></>),
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
  collapse: (<><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></>),
  expand: (<><path d="m13 17 5-5-5-5" /><path d="m6 17 5-5-5-5" /></>),
  external: (<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  spark: (<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />),
  // Glifo oficial do WhatsApp (renderizado em FILL — ver FILL_ICONS).
  whatsapp: (<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />),
  megaphone: (<><path d="m3 11 18-6v14L3 13z" /><path d="M7 12v6a2 2 0 0 0 4 0" /></>),
  inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  toggle: (<><rect x="1" y="7" width="22" height="10" rx="5" /><circle cx="16" cy="12" r="3" /></>),
  shield: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>),
  lock: (<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
};

function I({ n, size = 18 }: { n: string; size?: number }) {
  return <Svg size={size} fill={FILL_ICONS.has(n)}>{PATHS[n]}</Svg>;
}

// Menu = permissão REAL ∩ módulos, e guarda de rota no cliente.
// A fonte única é lib/panel.ts (mesma lista usada pelos testes de permissão):
//   • item só aparece com permissão e módulo ativos;
//   • acessar direto uma rota sem permissão mostra 403 AMIGÁVEL — nunca
//     logout (somente 401 inicia fluxo de login; ver lib/http.ts).

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; role?: string } | null>(null);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [isMaster, setIsMaster] = useState(false);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('il-side') === 'mini'; } catch { return false; }
  });
  const lastContextAt = useRef(0);

  const loadContext = useCallback(() => {
    // SOMENTE 401 (sessão inexistente/expirada/inválida) inicia o fluxo de
    // login. Qualquer outro status mantém o usuário dentro do painel.
    fetch('/api/auth/me')
      .then(async (r) => {
        if (!r.ok) {
          if (isSessionExpired(r.status)) router.replace('/login?session=expired');
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
        if (!d.businesses?.length) { router.replace('/onboarding'); return; }
        setUser(d.user);
        setBusinesses(d.businesses);
        setReady(true);
        lastContextAt.current = Date.now();
      })
      .catch(() => { /* falha de rede não é sessão inválida: não desloga */ });
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

  useEffect(() => {
    if (!ready || businesses.length === 0) return;
    const b = params.get('b');
    if (requiresActiveBusiness(pathname) && !businesses.some((x) => x.id === b)) router.replace(`${pathname}?b=${businesses[0].id}`);
  }, [ready, businesses, params, pathname, router]);

  function switchBiz(id: string) {
    if (id === '__overview') { router.push(`/organizacao?organization=${business?.organizationId || ''}`); return; }
    if (id === '__add') { router.push(`/organizacao?organization=${business?.organizationId || ''}&add=1`); return; }
    router.push(`${pathname === '/organizacao' ? '/dashboard' : pathname}?b=${id}`);
  }
  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem('il-side', c ? 'full' : 'mini'); } catch {}
      return !c;
    });
  }
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    clearToken();
    window.location.assign('/login');
  }

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-[#fcfcfc] lg:flex" aria-label="Carregando painel">
        <div className="hidden lg:flex w-[240px] shrink-0 flex-col bg-white border-r border-zinc-200 p-3 gap-2">
          <div className="h-9 w-32 bg-zinc-100 animate-pulse mb-2" />
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-7 bg-zinc-100 animate-pulse" />)}
        </div>
        <div className="flex-1 min-w-0"><div className="px-6 lg:px-8 py-6"><PageSkeleton /></div></div>
      </div>
    );
  }

  const business = businesses.find((b) => b.id === params.get('b')) || businesses[0];
  const organizationUnits = unitsInSameOrganization(business, businesses);
  const otherBusinesses = businesses.filter((x) => x.organizationId !== business?.organizationId);
  const modes = business?.modes || [];
  const features = business?.features || {};
  const permissions: Partial<Record<PermissionId, boolean>> = business?.permissions || {};
  // Navegação e guarda de rota vêm da fonte única (lib/panel.ts).
  const panelCtx = { permissions, modes, features: features as Partial<Record<FeatureId, boolean>> };
  const nav = panelNavigation(panelCtx);
  const items = nav.all;
  const access = panelAccess(pathname, panelCtx);
  const q = business ? `?b=${business.id}` : '';
  const ROLE_LABEL: Record<string, string> = {
    OWNER: 'Proprietário', ADMIN: 'Administrador', SECRETARIA: 'Secretária',
    ATENDENTE: 'Atendente', VENDEDOR: 'Vendedor', VIEWER: 'Visualizador', MASTER: 'Suporte InstaLink',
    PROFISSIONAL: 'Profissional',
  };

  // Dashboard fica sempre no topo, sem seção; demais itens agrupados.
  const dashboardItem = nav.primary;
  const sections = nav.sections;
  // A Agenda é o ambiente operacional: chrome mínimo para a grade ocupar a
  // viewport (menos padding, sem rodapé). As demais telas não mudam.
  const isAgenda = pathname === '/agenda';
  // Sem permissão de dashboard (ex.: VIEWER com agenda liberada) o usuário
  // ainda precisa de um destino válido ao clicar em "Início".
  const fallbackHref = firstAllowedPath(panelCtx);

  return (
    // A identidade visual vive nos TOKENS (--il-nav*) injetados aqui, uma vez,
    // a partir da cor do Business ativo. Trocar de unidade troca a identidade;
    // nenhuma classe condicional por cor é espalhada pelo sistema.
    <div className="min-h-screen bg-[#f8f8f8] lg:flex" style={navTokenStyle(business?.appearance?.navColor)}>
      {/* Sidebar desktop - workspace navigation */}
      <aside className={cn(
        'hidden lg:flex shrink-0 flex-col bg-[var(--il-nav)] text-[var(--il-nav-fg)] border-r border-[var(--il-nav-border)] sticky top-0 h-screen transition-all duration-200',
        collapsed ? 'w-[68px]' : 'w-[240px]',
      )}>
        {/* Identidade da empresa - bloco compacto (workspace first) */}
        <div className={cn('border-b border-[var(--il-nav-border)]', collapsed ? 'px-2 py-4 flex justify-center' : 'px-4 py-4')}>
          {collapsed ? (
            business.logo ? (
              <a href={`/${business.slug}`} target="_blank" title={business.name} className="w-9 h-9 rounded-lg overflow-hidden border border-zinc-200 flex items-center justify-center bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
              </a>
            ) : (
              <a href={`/${business.slug}`} target="_blank" title={business.name}
                className="w-9 h-9 rounded-lg bg-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)] flex items-center justify-center text-sm font-bold">
                {business.name.slice(0, 1).toUpperCase()}
              </a>
            )
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg overflow-hidden bg-white text-zinc-900 flex items-center justify-center font-bold shrink-0 border border-[var(--il-nav-border)]">
                {business.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
                ) : business.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-none truncate text-[var(--il-nav-fg)]">{business.name}</p>
                <a href={`/${business.slug}`} target="_blank" className="text-[11px] text-[var(--il-nav-muted)] hover:text-[var(--il-nav-fg)] inline-flex items-center gap-1 leading-none mt-1">
                  Ver site <I n="external" size={10} />
                </a>
              </div>
            </div>
          )}
        </div>

        {!collapsed && businesses.length > 1 && (
          <div className="px-3 py-2 border-b border-[var(--il-nav-border)]">
            <select value={business?.id || ''} onChange={(e) => switchBiz(e.target.value)} aria-label="Trocar de negócio"
              className="w-full bg-black/10 text-[var(--il-nav-fg)] border border-[var(--il-nav-border)] text-xs font-medium rounded-md px-2 py-1.5 [&>option]:bg-white [&>option]:text-zinc-900">
              <option value="__overview">Visão geral da organização</option>
              <optgroup label="Unidades desta organização">{organizationUnits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
              {otherBusinesses.length > 0 && <optgroup label="Outras organizações">{otherBusinesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
              <option value="__add">+ Adicionar unidade</option>
            </select>
          </div>
        )}

        {isMaster && (
          <div className={cn('py-2 border-b border-[var(--il-nav-border)]', collapsed ? 'px-2' : 'px-3')}>
            <Link href="/master" title="Master da plataforma"
              className={cn('flex items-center text-xs font-semibold border rounded-md py-1.5 bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
                collapsed ? 'justify-center px-0' : 'gap-2 px-2.5')}>
              <I n="shield" size={16} /> {!collapsed && 'Master'}
            </Link>
          </div>
        )}

        <nav className={cn('flex-1 overflow-y-auto py-3 ws-scroll', collapsed ? 'px-1.5 space-y-0.5' : 'px-2.5')} aria-label="Navegação do painel">
          {dashboardItem && (
            <Link href={`${dashboardItem.href}${q}`} title={collapsed ? dashboardItem.label : undefined}
              aria-current={pathname === dashboardItem.href ? 'page' : undefined}
              className={cn('flex items-center text-[13px] font-medium rounded-md h-9 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset',
                collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                pathname === dashboardItem.href
                  ? 'bg-[var(--il-nav-active)] text-[var(--il-nav-active-fg)] shadow-sm'
                  : 'text-[var(--il-nav-fg)] hover:bg-[var(--il-nav-hover)]')}>
              <I n={dashboardItem.icon} size={18} /> {!collapsed && dashboardItem.label}
            </Link>
          )}
          {!collapsed && dashboardItem && <div className="h-px bg-[var(--il-nav-border)] my-3 mx-1" aria-hidden="true" />}
          {sections.map((sec) => (
            <div key={sec.label} className={cn(collapsed ? 'mt-1' : 'mt-4 first:mt-1')}>
              {!collapsed && <p className="px-2.5 mb-1 text-[10px] font-bold tracking-[0.08em] text-[var(--il-nav-muted)] uppercase">{sec.label}</p>}
              {collapsed && <div className="h-px bg-[var(--il-nav-border)] mx-1 my-1.5" aria-hidden="true" />}
              <div className="space-y-0.5">
                {sec.items.map((i) => {
                  const active = pathname === i.href;
                  return (
                    <Link key={i.href} href={`${i.href}${q}`} title={collapsed ? i.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn('flex items-center text-[13px] rounded-md h-9 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset',
                        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                        active
                          ? 'bg-[var(--il-nav-active)] text-[var(--il-nav-active-fg)] shadow-sm'
                          : 'text-[var(--il-nav-fg)] hover:bg-[var(--il-nav-hover)]')}>
                      <I n={i.icon} size={18} /> {!collapsed && <span className={cn('truncate', active && 'font-medium')}>{i.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn('border-t border-[var(--il-nav-border)] mt-auto', collapsed ? 'p-2 space-y-1' : 'p-3')}>
          {!collapsed && <p className="text-xs text-[var(--il-nav-muted)] truncate px-2 mb-2 font-medium">{user.name}</p>}
          <button onClick={toggle} title={collapsed ? 'Expandir' : 'Recolher'}
            className={cn('w-full flex items-center text-xs font-medium text-[var(--il-nav-muted)] hover:text-[var(--il-nav-fg)] rounded-md h-8 hover:bg-[var(--il-nav-hover)]',
              collapsed ? 'justify-center' : 'gap-2.5 px-2.5')}>
            <I n={collapsed ? 'expand' : 'collapse'} size={16} /> {!collapsed && 'Recolher'}
          </button>
          <button onClick={logout} title={collapsed ? 'Sair' : undefined}
            className={cn('w-full flex items-center text-xs font-medium text-[var(--il-nav-muted)] hover:text-[var(--il-nav-fg)] rounded-md h-8 hover:bg-[var(--il-nav-hover)]',
              collapsed ? 'justify-center' : 'gap-2.5 px-2.5')}>
            <I n="logout" size={16} /> {!collapsed && 'Sair'}
          </button>
          {!collapsed && <p className="text-[10px] text-[var(--il-nav-muted)] text-center mt-3 px-2">powered by InstaLink.app</p>}
        </div>
      </aside>

      {/* Mobile topbar */}
      <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-zinc-200">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-md overflow-hidden bg-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)] flex items-center justify-center font-bold text-sm shrink-0 border border-zinc-200">
              {business.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
              ) : (business?.name || 'I').slice(0, 1).toUpperCase()}
            </span>
            {businesses.length > 1 ? (
              <select value={business?.id || ''} onChange={(e) => switchBiz(e.target.value)} aria-label="Trocar de negócio"
                className="bg-zinc-50 border border-zinc-200 text-xs font-semibold rounded-md px-2 py-1.5 max-w-[160px] truncate">
                <option value="__overview">Visão geral da organização</option>
              <optgroup label="Unidades desta organização">{organizationUnits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
              {otherBusinesses.length > 0 && <optgroup label="Outras organizações">{otherBusinesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
              <option value="__add">+ Adicionar unidade</option>
              </select>
            ) : (
              <span className="font-semibold text-sm truncate text-zinc-900">{business?.name || 'InstaLink'}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {business && <a href={`/${business.slug}`} target="_blank" className="text-xs font-semibold bg-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)] px-3 py-1.5 rounded-md">Ver site</a>}
            <button onClick={logout} className="bg-zinc-50 border border-zinc-200 p-2 rounded-md" aria-label="Sair"><I n="logout" size={14} /></button>
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2.5 no-scrollbar">
          {items.map((i) => (
            <Link key={i.href} href={`${i.href}${q}`}
              className={cn('shrink-0 text-xs font-medium border rounded-full px-3 py-1.5 inline-flex items-center gap-1.5',
                pathname === i.href
                  ? 'bg-[var(--il-nav-cta)] border-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)]'
                  : 'bg-white border-zinc-200 text-zinc-600')}>
              <I n={i.icon} size={14} /> {i.label}
            </Link>
          ))}
        </nav>
      </div>

      <main className="flex-1 min-w-0 bg-[#f8f8f8]">
        {support && (
          <div className={cn('px-4 lg:px-8 py-2.5 text-xs font-semibold flex flex-wrap items-center gap-x-3 gap-y-1 border-b',
            support.mode === 'view' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-red-600 text-white border-red-700')}>
            <span className="inline-flex items-center gap-1.5"><I n="shield" size={14} /> {support.mode === 'view' ? 'Modo suporte — somente leitura' : 'Modo administrativo'}</span>
            <span className="opacity-80">Empresa: {business?.name} · expira {new Date(support.expiresAt).toISOString().slice(11, 16)} UTC</span>
            <button onClick={async () => {
              await fetch('/api/master/support', { method: 'DELETE' }).catch(() => {});
              await fetch('/api/admin/support', { method: 'DELETE' }).catch(() => {});
              window.location.assign('/master');
            }} className="ml-auto underline underline-offset-2">Sair do modo suporte</button>
          </div>
        )}
        <div className={cn(isAgenda ? 'px-2 sm:px-3 lg:px-4 py-3' : 'px-4 lg:px-8 py-6', !FULL_WIDTH_PATHS.includes(pathname) && 'max-w-[960px]')}>
          {isMaster && !support && (
            <p className="mb-4 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-flex items-center gap-2">
              <I n="shield" size={14} /> Você é master — <Link href="/master" className="underline font-semibold">/master</Link>
            </p>
          )}
          {business && business.role && business.role !== 'OWNER' && (
            <p className="mb-4 text-xs text-zinc-500">Você está como <strong className="text-zinc-700">{ROLE_LABEL[business.role] || business.role}</strong>{business.readOnly ? ' · somente leitura' : ''}</p>
          )}
          {business?.agendaScope === 'own' && (
            // Honestidade com quem atende: a agenda mostrada é SÓ a dele.
            // (A restrição é do servidor — aqui só avisamos.)
            <p className="mb-4 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-md px-3 py-2 inline-flex items-center gap-2">
              <I n="idcard" size={14} />
              Você vê <strong>somente a sua agenda</strong>{business.professionalName ? ` (${business.professionalName})` : ''}. Os clientes da unidade continuam disponíveis em Clientes.
            </p>
          )}
          {business?.agendaScope === 'none' && (
            // Vínculo ainda não configurado: a agenda fica vazia por segurança
            // (nunca a de todo mundo). O caminho para resolver é o Equipe.
            <p className="mb-4 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-flex flex-wrap items-center gap-2" role="status">
              <I n="alert" size={14} />
              Seu acesso de atendimento ainda <strong>não está vinculado a um profissional</strong>, então a agenda aparece vazia.
              Peça ao administrador para vincular em Equipe → “Profissional vinculado”.
            </p>
          )}
          {access.state === 'denied' ? (
            // 403 AMIGÁVEL: o usuário continua logado e dentro do painel.
            // Nada aqui limpa token ou redireciona para /login.
            <AccessDenied
              area={access.area || access.route?.label}
              hint={access.reason === 'module'
                ? `O módulo “${access.route?.label}” não está ativo nesta empresa. Nada foi perdido: ao reativar em Recursos, a área volta com todo o conteúdo.`
                : undefined}
              homeHref={fallbackHref ? `${fallbackHref}${q}` : undefined}
            />
          ) : children}
        </div>
        {!isAgenda && (
          <footer className="px-4 lg:px-8 py-4 border-t border-zinc-200 mt-8">
            <p className="text-[11px] text-zinc-400 text-center">InstaLink.app — plataforma para o seu negócio · <a href={`/${business.slug}`} target="_blank" className="underline">/{business.slug}</a></p>
          </footer>
        )}
      </main>

      {/* 403 de qualquer ação do painel → aviso amigável (sessão preservada). */}
      <ForbiddenToasts context={{ scope: 'action', area: access.area || panelRouteFor(pathname)?.label }} />
    </div>
  );
}
