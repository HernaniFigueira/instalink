'use client';
// ÁREA MASTER DA PLATAFORMA (/master)
// Menu próprio — NÃO reutiliza o menu do cliente (DashboardShell).
// O servidor revalida em cada API via requireMaster.
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

const NAV: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/master', label: 'Visão geral', exact: true },
  { href: '/master/organizacoes', label: 'Organizações' },
  { href: '/master/unidades', label: 'Unidades' },
  { href: '/master/usuarios', label: 'Usuários' },
  { href: '/master/atividade', label: 'Atividade' },
  { href: '/master/suporte', label: 'Suporte' },
  { href: '/master/masters', label: 'Masters' },
];

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [email, setEmail] = useState('');
  const [support, setSupport] = useState<{ businessId: string; mode: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) { router.replace('/login'); return; }
        if (!d.isMaster) { setState('denied'); return; }
        setEmail(d.user.email);
        setSupport(d.support || null);
        setState('ok');
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  if (state === 'checking') return <PageSkeleton />;
  if (state === 'denied') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-zinc-100">
        <div className="bg-white rounded-3xl border border-zinc-200 p-8 max-w-md text-center">
          <span className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto"><Icon n="shield" size={26} /></span>
          <h1 className="font-extrabold text-xl mt-4">Área restrita da plataforma</h1>
          <p className="text-sm text-zinc-500 mt-2">
            Esta área é exclusiva da conta Master do GoDoutor. Owner, Admin ou membro de Organization
            não têm acesso. O servidor rejeita qualquer chamada às APIs /api/master/*.
          </p>
          <Link href="/dashboard" className="inline-block mt-5 text-sm font-bold bg-zinc-900 text-white px-5 py-3 rounded-xl">Voltar ao painel</Link>
        </div>
      </main>
    );
  }

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="bg-zinc-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center gap-3">
          <Link href="/master" className="font-extrabold tracking-tight flex items-center gap-2">
            <Icon n="shield" size={18} /> GoDoutor · Master
          </Link>
          <span className="text-[10px] font-extrabold bg-amber-400 text-amber-950 px-2 py-0.5 rounded-full">PLATAFORMA</span>
          <nav className="flex items-center gap-0.5 ml-1 flex-wrap">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'text-xs font-bold px-2.5 py-2 rounded-lg',
                  isActive(item.href, item.exact) ? 'bg-white/15 text-white' : 'text-zinc-400 hover:bg-white/10 hover:text-white',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {support && (
              <span className="font-bold bg-amber-400 text-amber-950 px-2.5 py-1.5 rounded-lg">
                Em suporte {support.mode === 'view' ? '(leitura)' : '(admin)'}
              </span>
            )}
            <span className="text-zinc-400 hidden sm:inline">{email}</span>
            <Link href="/alterar-senha" className="font-bold bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg" aria-label="Alterar senha">
              <Icon n="lock" size={15} /> <span className="hidden sm:inline">Alterar senha</span>
            </Link>
            <Link href="/login" onClick={async (e) => {
              e.preventDefault();
              try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
              window.location.assign('/login');
            }} className="font-bold bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg">Sair</Link>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
