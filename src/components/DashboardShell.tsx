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

// ── Ícones SVG minimalistas (traço, 24px) ────────────────────
function Svg({ size = 20, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
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
};

function I({ n, size = 20 }: { n: string; size?: number }) {
  return <Svg size={size}>{PATHS[n]}</Svg>;
}

// Menu = permissão REAL do membro ∩ módulos ligados. A API revalida a mesma
// permissão no servidor (esconder botão é UX, não é a proteção).
const ALL_ITEMS: Array<{
  href: string; label: string; icon: string;
  modes?: BusinessMode[]; features?: FeatureId[]; permission?: PermissionId;
}> = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home' },
  { href: '/agenda', label: 'Agenda', icon: 'calendar', modes: ['bookings'], permission: 'agenda' },
  { href: '/clientes', label: 'Clientes', icon: 'users', permission: 'clientes' },
  { href: '/produtos', label: 'Produtos', icon: 'cart', modes: ['products', 'orders'], permission: 'catalogo' },
  { href: '/servicos', label: 'Serviços', icon: 'scissors', modes: ['services', 'bookings'], permission: 'catalogo' },
  { href: '/pedidos', label: 'Pedidos', icon: 'receipt', modes: ['orders', 'products'], permission: 'pedidos' },
  { href: '/pagina', label: 'Página', icon: 'link', permission: 'pagina' },
  { href: '/recursos', label: 'Recursos', icon: 'toggle', permission: 'config' },
  { href: '/agente', label: 'Agente', icon: 'spark', permission: 'agente' },
  { href: '/whatsapp', label: 'WhatsApp', icon: 'whatsapp', permission: 'whatsapp' },
  { href: '/campanhas', label: 'Campanhas', icon: 'megaphone', permission: 'campanhas' },
  { href: '/equipe', label: 'Equipe', icon: 'users', permission: 'equipe' },
  { href: '/resultados', label: 'Resultados', icon: 'chart', permission: 'financeiro' },
  { href: '/configuracoes', label: 'Configurações', icon: 'settings', permission: 'config' },
];

// Telas que ocupam toda a largura útil (mini CRM); as demais mantêm
// largura confortável de leitura/formulário.
const FULL_WIDTH_PATHS = ['/dashboard', '/agenda', '/resultados', '/clientes', '/whatsapp', '/campanhas'];

// Shell do painel 100% no cliente: a sessão é validada via /api/auth/me
// (cookie OU Bearer), então funciona mesmo com cookies bloqueados.
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
    try {
      return localStorage.getItem('il-side') === 'mini';
    } catch {
      return false;
    }
  });

  // Navegação 100% SPA aqui: um reload integral apagaria o token em
  // memória e derrubaria quem está com storage/cookies restritos.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?b= ausente ou de outro dono → normaliza para um negócio próprio.
  useEffect(() => {
    if (!ready || businesses.length === 0) return;
    const b = params.get('b');
    if (!businesses.some((x) => x.id === b)) {
      router.replace(`${pathname}?b=${businesses[0].id}`);
    }
  }, [ready, businesses, params, pathname, router]);

  function switchBiz(id: string) {
    router.push(`${pathname}?b=${id}`);
  }

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem('il-side', c ? 'full' : 'mini');
      } catch {
        /* sem storage = não persiste, tudo bem */
      }
      return !c;
    });
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* even offline, sai localmente */
    }
    clearToken();
    window.location.assign('/login');
  }

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-zinc-50 lg:flex" aria-label="Carregando painel">
        <div className="hidden lg:flex w-64 shrink-0 flex-col gap-2 bg-zinc-950 p-4">
          <div className="h-9 w-32 rounded-xl bg-zinc-800 animate-pulse mb-4" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-zinc-900 animate-pulse" />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            <PageSkeleton />
          </div>
        </div>
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

  return (
    <div className="min-h-screen bg-zinc-50 lg:flex">
      {/* Sidebar desktop (colapsável para ícones) */}
      <aside className={cn(
        'hidden lg:flex shrink-0 flex-col bg-zinc-950 text-white min-h-screen sticky top-0 h-screen transition-all duration-200',
        collapsed ? 'w-[76px]' : 'w-64',
      )}>
        <div className={cn('flex items-center py-6', collapsed ? 'justify-center px-3' : 'gap-2 px-6')}>
          <Link href={`/dashboard${q}`} className="flex items-center gap-2" title="InstaLink.app">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-zinc-950 shrink-0">IL</div>
            {!collapsed && <span className="font-bold">InstaLink<span className="text-emerald-400">.app</span></span>}
          </Link>
        </div>
        {business && !collapsed && (
          <div className="mx-4 mb-4 rounded-2xl bg-zinc-900 border border-zinc-800 p-3.5">
            <p className="text-xs text-zinc-400">Negócio atual</p>
            <p className="font-bold text-sm truncate">{business.name}</p>
            <a href={`/${business.slug}`} target="_blank" className="text-xs text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1">
              instalink.app/{business.slug} <I n="external" size={12} />
            </a>
          </div>
        )}
        {business && collapsed && (
          <div className="mx-auto mb-4">
            <a href={`/${business.slug}`} target="_blank" title={`${business.name} — ver página`}
              className="w-11 h-11 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center font-black text-emerald-400">
              {business.name.slice(0, 1).toUpperCase()}
            </a>
          </div>
        )}
        {isMaster && (
          <div className={cn('mb-3', collapsed ? 'px-2.5' : 'px-3')}>
            <Link href="/admin" title="Área da plataforma"
              className={cn(
                'flex items-center rounded-xl py-2.5 text-sm font-bold border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3.5',
              )}>
              <I n="shield" />
              {!collapsed && 'Plataforma'}
            </Link>
          </div>
        )}
        <nav className={cn('flex-1 space-y-1 overflow-y-auto', collapsed ? 'px-2.5' : 'px-3')}>
          {items.map((i) => (
            <Link key={i.href} href={`${i.href}${q}`} title={collapsed ? i.label : undefined}
              className={cn(
                'flex items-center rounded-xl py-2.5 text-sm font-medium hover:bg-zinc-900 hover:text-white',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3.5',
                pathname === i.href ? 'bg-zinc-900 text-white' : 'text-zinc-300',
              )}>
              <I n={i.icon} />
              {!collapsed && i.label}
            </Link>
          ))}
        </nav>
        <div className={cn('border-t border-zinc-900', collapsed ? 'p-2.5 space-y-1' : 'p-4')}>
          {!collapsed && <p className="text-xs text-zinc-400 truncate px-2 mb-2">{user.name}</p>}
          <button onClick={toggle} title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={cn(
              'w-full flex items-center text-sm font-medium text-zinc-300 hover:text-white rounded-xl py-2.5 hover:bg-zinc-900',
              collapsed ? 'justify-center' : 'gap-3 px-3.5',
            )}>
            <I n={collapsed ? 'expand' : 'collapse'} />
            {!collapsed && 'Recolher'}
          </button>
          <button onClick={logout} title={collapsed ? 'Sair' : undefined}
            className={cn(
              'w-full flex items-center text-sm font-medium text-zinc-300 hover:text-white rounded-xl py-2.5 hover:bg-zinc-900',
              collapsed ? 'justify-center' : 'gap-3 px-3.5',
            )}>
            <I n="logout" />
            {!collapsed && 'Sair'}
          </button>
        </div>
      </aside>

      {/* Mobile topbar */}
      <div className="lg:hidden sticky top-0 z-40 bg-zinc-950 text-white">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 min-w-0">
            <Link href={`/dashboard${q}`} className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-zinc-950 text-sm shrink-0">IL</Link>
            {businesses.length > 1 ? (
              <select value={business?.id || ''} onChange={(e) => switchBiz(e.target.value)} aria-label="Trocar de negócio"
                className="bg-zinc-900 border border-zinc-800 text-xs font-bold rounded-lg px-2 py-1.5 max-w-[150px]">
                {businesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            ) : (
              <span className="font-bold text-sm truncate">{business?.name || 'InstaLink'}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {business && (
              <a href={`/${business.slug}`} target="_blank" className="text-xs font-bold bg-emerald-500 text-zinc-950 px-3 py-1.5 rounded-lg">Ver página</a>
            )}
            <button onClick={logout} className="bg-zinc-900 border border-zinc-800 p-2 rounded-lg" aria-label="Sair" title="Sair"><I n="logout" size={14} /></button>
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
          {items.map((i) => (
            <Link key={i.href} href={`${i.href}${q}`}
              className={cn(
                'shrink-0 text-xs font-semibold border rounded-full px-3.5 py-2 inline-flex items-center gap-1.5',
                pathname === i.href ? 'bg-emerald-500 border-emerald-500 text-zinc-950' : 'bg-zinc-900 border-zinc-800',
              )}>
              <I n={i.icon} size={14} /> {i.label}
            </Link>
          ))}
        </nav>
      </div>

      <main className="flex-1 min-w-0">
        {/* Modo suporte do master: explícito, temporário e somente leitura. */}
        {support && (
          <div className={cn(
            'px-4 sm:px-6 lg:px-8 py-3 text-sm font-bold flex flex-wrap items-center gap-x-3 gap-y-2',
            support.mode === 'view' ? 'bg-amber-400 text-amber-950' : 'bg-red-600 text-white',
          )}>
            <span className="inline-flex items-center gap-1.5">
              <I n="shield" size={16} />
              {support.mode === 'view' ? 'Modo suporte — somente leitura' : 'Modo administrativo (suporte)'}
            </span>
            <span className="font-semibold opacity-90">
              Empresa: {business?.name} · expira {new Date(support.expiresAt).toISOString().slice(11, 16)} UTC
            </span>
            <button onClick={async () => {
              await fetch('/api/admin/support', { method: 'DELETE' }).catch(() => {});
              window.location.assign('/admin');
            }} className="ml-auto underline">
              Sair do modo suporte
            </button>
          </div>
        )}
        {/* Dashboard/Agenda/Resultados usam toda a largura útil; telas de
            formulário/lista mantêm largura confortável (max-w-5xl). */}
        <div className={cn(
          'px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8',
          !FULL_WIDTH_PATHS.includes(pathname) && 'max-w-5xl mx-auto',
        )}>
          {user?.role === 'master' && !support && (
            <p className="mb-4 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2 inline-flex items-center gap-2">
              <I n="shield" size={14} /> Você é master da plataforma — acesse <Link href="/admin" className="underline">/admin</Link> para o painel de empresas.
            </p>
          )}
          {business && business.role && business.role !== 'OWNER' && (
            <p className="mb-4 text-xs font-semibold text-zinc-500">
              Você está nesta empresa como <strong>{ROLE_LABEL[business.role] || business.role}</strong>
              {business.readOnly ? ' · somente leitura' : ''} — a navegação mostra apenas o que você pode usar.
            </p>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
