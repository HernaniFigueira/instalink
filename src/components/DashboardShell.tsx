'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { clearToken } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import { PageSkeleton } from '@/components/ui';
import type { BusinessMode, FeatureId, PermissionId } from '@/lib/types';

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
}

interface SupportInfo {
  id: string;
  businessId: string;
  mode: 'view' | 'admin';
  reason: string;
  expiresAt: string;
}

function Svg({ size = 18, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>),
  receipt: (<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M8 7h8" /><path d="M8 11h8" /><path d="M8 15h5" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="M8 17V9" /><path d="M13 17V5" /><path d="M18 17v-8" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.24.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.27.4-1.51 1Z" /></>),
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
  collapse: (<><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></>),
  expand: (<><path d="m13 17 5-5-5-5" /><path d="m6 17 5-5-5-5" /></>),
  external: (<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  spark: (<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />),
  whatsapp: (<path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.2-.8 1-.9 1.2-.3.2-.6.1-1.3-.5-2.4-1.5a9 9 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.6l.5-.5.3-.5-.3-1.5c-.2-.6-.6-.5-.7-.5h-.6c-.2 0-.5.1-.8.4a3.4 3.4 0 0 0-1 2.5c0 1.5 1 2.9 1.2 3.1.1.2 2 3.2 5 4.5a12 12 0 0 0 3.5.6c1.1-.1 1.8-.7 2-1.4l.2-1.4c-.1-.1-.3-.2-.6-.3M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2" />),
  megaphone: (<><path d="m3 11 18-6v14L3 13z" /><path d="M7 12v6a2 2 0 0 0 4 0" /></>),
  inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  toggle: (<><rect x="1" y="7" width="22" height="10" rx="5" /><circle cx="16" cy="12" r="3" /></>),
  shield: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>),
};

function I({ n, size = 18 }: { n: string; size?: number }) {
  return <Svg size={size}>{PATHS[n]}</Svg>;
}

// Menu = permissão REAL ∩ módulos. API revalida no servidor.
const ALL_ITEMS: Array<{
  href: string; label: string; icon: string;
  section?: string;
  modes?: BusinessMode[]; features?: FeatureId[]; permission?: PermissionId;
}> = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home', permission: 'dashboard' },
  // Operacional
  { href: '/agenda', label: 'Agenda', icon: 'calendar', section: 'Operacional', modes: ['bookings'], permission: 'agenda' },
  { href: '/clientes', label: 'Clientes', icon: 'users', section: 'Operacional', permission: 'clientes' },
  { href: '/pedidos', label: 'Pedidos', icon: 'receipt', section: 'Operacional', modes: ['orders', 'products'], permission: 'pedidos' },
  // Catálogo
  { href: '/produtos', label: 'Produtos', icon: 'cart', section: 'Catálogo', modes: ['products', 'orders'], permission: 'catalogo' },
  { href: '/servicos', label: 'Serviços', icon: 'scissors', section: 'Catálogo', modes: ['services', 'bookings'], permission: 'catalogo' },
  // Atendimento
  { href: '/whatsapp', label: 'WhatsApp', icon: 'whatsapp', section: 'Atendimento', permission: 'whatsapp' },
  { href: '/agente', label: 'Agente', icon: 'spark', section: 'Atendimento', permission: 'agente' },
  // Gestão
  { href: '/resultados', label: 'Resultados', icon: 'chart', section: 'Gestão', permission: 'financeiro' },
  { href: '/campanhas', label: 'Campanhas', icon: 'megaphone', section: 'Gestão', permission: 'campanhas' },
  { href: '/pagina', label: 'Página', icon: 'link', section: 'Gestão', permission: 'pagina' },
  // Administração
  { href: '/recursos', label: 'Recursos', icon: 'toggle', section: 'Administração', permission: 'config' },
  { href: '/equipe', label: 'Equipe', icon: 'users', section: 'Administração', permission: 'equipe' },
  { href: '/configuracoes', label: 'Configurações', icon: 'settings', section: 'Administração', permission: 'config' },
];

const FULL_WIDTH_PATHS = ['/dashboard', '/agenda', '/resultados', '/clientes', '/whatsapp', '/campanhas', '/servicos', '/pedidos', '/equipe'];

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

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) { router.replace('/login?session=expired'); return; }
        setIsMaster(!!d.isMaster);
        setSupport(d.support || null);
        if (!d.businesses?.length) { router.replace('/onboarding'); return; }
        setUser(d.user);
        setBusinesses(d.businesses);
        setReady(true);
      })
      .catch(() => router.replace('/login?session=expired'));
  }, [router]);

  useEffect(() => {
    if (!ready || businesses.length === 0) return;
    const b = params.get('b');
    if (!businesses.some((x) => x.id === b)) router.replace(`${pathname}?b=${businesses[0].id}`);
  }, [ready, businesses, params, pathname, router]);

  function switchBiz(id: string) { router.push(`${pathname}?b=${id}`); }
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
  const modes = business?.modes || [];
  const features = business?.features || {};
  const permissions: Partial<Record<PermissionId, boolean>> = business?.permissions || {};
  const items = ALL_ITEMS.filter((i) => {
    if (i.permission && permissions[i.permission] !== true) return false;
    if (i.modes && !i.modes.some((m) => modes.includes(m))) return false;
    if (i.features && !i.features.some((f) => (features as any)[f] === true)) return false;
    return true;
  });
  const q = business ? `?b=${business.id}` : '';
  const ROLE_LABEL: Record<string, string> = {
    OWNER: 'Proprietário', ADMIN: 'Administrador', SECRETARIA: 'Secretária',
    ATENDENTE: 'Atendente', VENDEDOR: 'Vendedor', VIEWER: 'Visualizador', MASTER: 'Suporte InstaLink',
  };

  // Agrupar por seção para renderização com rótulos
  const sections: Array<{ label: string; items: typeof items }> = [];
  // Dashboard fica sempre no topo sem seção
  const dashboardItem = items.find((i) => i.href === '/dashboard');
  const otherItems = items.filter((i) => i.href !== '/dashboard');
  const grouped = new Map<string, typeof items>();
  for (const it of otherItems) {
    const s = it.section || 'Outros';
    if (!grouped.has(s)) grouped.set(s, []);
    grouped.get(s)!.push(it);
  }
  for (const [label, list] of grouped) sections.push({ label, items: list });

  return (
    <div className="min-h-screen bg-[#f8f8f8] lg:flex">
      {/* Sidebar desktop - workspace navigation */}
      <aside className={cn(
        'hidden lg:flex shrink-0 flex-col bg-white border-r border-zinc-200 sticky top-0 h-screen transition-all duration-200',
        collapsed ? 'w-[68px]' : 'w-[240px]',
      )}>
        {/* Identidade da empresa - bloco compacto (workspace first) */}
        <div className={cn('border-b border-zinc-200', collapsed ? 'px-2 py-4 flex justify-center' : 'px-4 py-4')}>
          {collapsed ? (
            business.logo ? (
              <a href={`/${business.slug}`} target="_blank" title={business.name} className="w-9 h-9 rounded-lg overflow-hidden border border-zinc-200 flex items-center justify-center bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
              </a>
            ) : (
              <a href={`/${business.slug}`} target="_blank" title={business.name}
                className="w-9 h-9 rounded-lg bg-zinc-900 text-white flex items-center justify-center text-sm font-bold">
                {business.name.slice(0, 1).toUpperCase()}
              </a>
            )
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg overflow-hidden bg-zinc-900 text-white flex items-center justify-center font-bold shrink-0 border border-zinc-200">
                {business.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
                ) : business.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-none truncate text-zinc-900">{business.name}</p>
                <a href={`/${business.slug}`} target="_blank" className="text-[11px] text-zinc-500 hover:text-zinc-700 inline-flex items-center gap-1 leading-none mt-1">
                  Ver site <I n="external" size={10} />
                </a>
              </div>
            </div>
          )}
        </div>

        {!collapsed && businesses.length > 1 && (
          <div className="px-3 py-2 border-b border-zinc-100">
            <select value={business?.id || ''} onChange={(e) => switchBiz(e.target.value)} aria-label="Trocar de negócio"
              className="w-full bg-zinc-50 border border-zinc-200 text-xs font-medium rounded-md px-2 py-1.5">
              {businesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        )}

        {isMaster && (
          <div className={cn('py-2 border-b border-zinc-100', collapsed ? 'px-2' : 'px-3')}>
            <Link href="/admin" title="Plataforma"
              className={cn('flex items-center text-xs font-semibold border rounded-md py-1.5 bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
                collapsed ? 'justify-center px-0' : 'gap-2 px-2.5')}>
              <I n="shield" size={16} /> {!collapsed && 'Plataforma'}
            </Link>
          </div>
        )}

        <nav className={cn('flex-1 overflow-y-auto py-3', collapsed ? 'px-1.5 space-y-0.5' : 'px-2.5')}>
          {dashboardItem && (
            <Link href={`${dashboardItem.href}${q}`} title={collapsed ? dashboardItem.label : undefined}
              className={cn('flex items-center text-[13px] font-medium rounded-md h-8 hover:bg-zinc-50',
                collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                pathname === dashboardItem.href ? 'bg-zinc-900 text-white hover:bg-zinc-900' : 'text-zinc-700')}>
              <I n={dashboardItem.icon} size={18} /> {!collapsed && dashboardItem.label}
            </Link>
          )}
          {!collapsed && dashboardItem && <div className="h-px bg-zinc-200 my-3 mx-1" />}
          {sections.map((sec) => (
            <div key={sec.label} className={cn(collapsed ? 'mt-2' : 'mt-4 first:mt-2')}>
              {!collapsed && <p className="px-2.5 mb-1.5 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">{sec.label}</p>}
              {collapsed && <div className="h-px bg-zinc-100 mx-1 my-2" />}
              <div className="space-y-0.5">
                {sec.items.map((i) => (
                  <Link key={i.href} href={`${i.href}${q}`} title={collapsed ? i.label : undefined}
                    className={cn('flex items-center text-[13px] rounded-md h-8 transition-colors',
                      collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                      pathname === i.href ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900')}>
                    <I n={i.icon} size={18} /> {!collapsed && <span className="truncate">{i.label}</span>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn('border-t border-zinc-200 mt-auto', collapsed ? 'p-2 space-y-1' : 'p-3')}>
          {!collapsed && <p className="text-xs text-zinc-500 truncate px-2 mb-2 font-medium">{user.name}</p>}
          <button onClick={toggle} title={collapsed ? 'Expandir' : 'Recolher'}
            className={cn('w-full flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 rounded-md h-8 hover:bg-zinc-50',
              collapsed ? 'justify-center' : 'gap-2.5 px-2.5')}>
            <I n={collapsed ? 'expand' : 'collapse'} size={16} /> {!collapsed && 'Recolher'}
          </button>
          <button onClick={logout} title={collapsed ? 'Sair' : undefined}
            className={cn('w-full flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 rounded-md h-8 hover:bg-zinc-50',
              collapsed ? 'justify-center' : 'gap-2.5 px-2.5')}>
            <I n="logout" size={16} /> {!collapsed && 'Sair'}
          </button>
          {!collapsed && <p className="text-[10px] text-zinc-400 text-center mt-3 px-2">powered by InstaLink.app</p>}
        </div>
      </aside>

      {/* Mobile topbar */}
      <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-zinc-200">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-md overflow-hidden bg-zinc-900 text-white flex items-center justify-center font-bold text-sm shrink-0 border border-zinc-200">
              {business.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
              ) : (business?.name || 'I').slice(0, 1).toUpperCase()}
            </span>
            {businesses.length > 1 ? (
              <select value={business?.id || ''} onChange={(e) => switchBiz(e.target.value)} aria-label="Trocar de negócio"
                className="bg-zinc-50 border border-zinc-200 text-xs font-semibold rounded-md px-2 py-1.5 max-w-[160px] truncate">
                {businesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            ) : (
              <span className="font-semibold text-sm truncate text-zinc-900">{business?.name || 'InstaLink'}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {business && <a href={`/${business.slug}`} target="_blank" className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md">Ver site</a>}
            <button onClick={logout} className="bg-zinc-50 border border-zinc-200 p-2 rounded-md" aria-label="Sair"><I n="logout" size={14} /></button>
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2.5 no-scrollbar">
          {items.map((i) => (
            <Link key={i.href} href={`${i.href}${q}`}
              className={cn('shrink-0 text-xs font-medium border rounded-full px-3 py-1.5 inline-flex items-center gap-1.5',
                pathname === i.href ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600')}>
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
            <button onClick={async () => { await fetch('/api/admin/support', { method: 'DELETE' }).catch(() => {}); window.location.assign('/admin'); }} className="ml-auto underline underline-offset-2">Sair do modo suporte</button>
          </div>
        )}
        <div className={cn('px-4 lg:px-8 py-6', !FULL_WIDTH_PATHS.includes(pathname) && 'max-w-[960px]')}>
          {user?.role === 'master' && !support && (
            <p className="mb-4 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-flex items-center gap-2">
              <I n="shield" size={14} /> Você é master — <Link href="/admin" className="underline font-semibold">/admin</Link>
            </p>
          )}
          {business && business.role && business.role !== 'OWNER' && (
            <p className="mb-4 text-xs text-zinc-500">Você está como <strong className="text-zinc-700">{ROLE_LABEL[business.role] || business.role}</strong>{business.readOnly ? ' · somente leitura' : ''}</p>
          )}
          {children}
        </div>
        <footer className="px-4 lg:px-8 py-4 border-t border-zinc-200 mt-8">
          <p className="text-[11px] text-zinc-400 text-center">InstaLink.app — plataforma para o seu negócio · <a href={`/${business.slug}`} target="_blank" className="underline">/{business.slug}</a></p>
        </footer>
      </main>
    </div>
  );
}
