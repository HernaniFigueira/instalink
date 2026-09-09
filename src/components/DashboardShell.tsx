'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { clearToken } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import { PageSkeleton } from '@/components/ui';
import type { BusinessMode } from '@/lib/types';

interface Biz {
  id: string;
  slug: string;
  name: string;
  modes: BusinessMode[];
  published: boolean;
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
};

function I({ n, size = 20 }: { n: string; size?: number }) {
  return <Svg size={size}>{PATHS[n]}</Svg>;
}

const ALL_ITEMS: Array<{ href: string; label: string; icon: string; modes?: BusinessMode[] }> = [
  { href: '/dashboard', label: 'Início', icon: 'home' },
  { href: '/pagina', label: 'Minha página', icon: 'link' },
  { href: '/produtos', label: 'Produtos', icon: 'cart', modes: ['products', 'orders'] },
  { href: '/servicos', label: 'Serviços', icon: 'scissors', modes: ['services', 'bookings'] },
  { href: '/agenda', label: 'Agenda', icon: 'calendar', modes: ['bookings'] },
  { href: '/pedidos', label: 'Pedidos', icon: 'receipt', modes: ['orders', 'products'] },
  { href: '/clientes', label: 'Clientes', icon: 'users' },
  { href: '/resultados', label: 'Resultados', icon: 'chart' },
  { href: '/configuracoes', label: 'Configurações', icon: 'settings' },
];

// Shell do painel 100% no cliente: a sessão é validada via /api/auth/me
// (cookie OU Bearer), então funciona mesmo com cookies bloqueados.
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
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
        if (!d.businesses?.length) { router.replace('/onboarding'); return; }
        setUser(d.user);
        setBusinesses(d.businesses);
        setReady(true);
      })
      .catch(() => router.replace('/login?session=expired'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <PageSkeleton />
          </div>
        </div>
      </div>
    );
  }

  const business = businesses.find((b) => b.id === params.get('b')) || businesses[0];
  const modes = business?.modes || [];
  const items = ALL_ITEMS.filter((i) => !i.modes || i.modes.some((m) => modes.includes(m)));
  const q = business ? `?b=${business.id}` : '';

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
          <Link href={`/dashboard${q}`} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-zinc-950 text-sm">IL</div>
            <span className="font-bold text-sm">{business?.name || 'InstaLink'}</span>
          </Link>
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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
