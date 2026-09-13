'use client';
// ÁREA DA PLATAFORMA (/admin) — separada do painel do proprietário.
// Só quem tem papel de master entra. O servidor revalida em cada API.
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
          <h1 className="font-extrabold text-xl mt-4">Área restrita</h1>
          <p className="text-sm text-zinc-500 mt-2">
            Esta área é exclusiva da equipe da plataforma. Sua conta não tem esse papel — se você acredita que isso é
            um engano, fale com o suporte.
          </p>
          <Link href="/dashboard" className="inline-block mt-5 text-sm font-bold bg-zinc-900 text-white px-5 py-3 rounded-xl">Voltar ao meu painel</Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="bg-zinc-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center gap-3">
          <Link href="/admin" className="font-extrabold tracking-tight flex items-center gap-2">
            <Icon n="shield" size={18} /> InstaLink · Plataforma
          </Link>
          <span className="text-[10px] font-extrabold bg-amber-400 text-amber-950 px-2 py-0.5 rounded-full">MASTER</span>
          <nav className="flex items-center gap-1 ml-2">
            <Link href="/admin" className={cn('text-xs font-bold px-3 py-2 rounded-lg', pathname === '/admin' ? 'bg-white/15' : 'text-zinc-300 hover:bg-white/10')}>Empresas</Link>
            <Link href="/admin/auditoria" className={cn('text-xs font-bold px-3 py-2 rounded-lg', pathname === '/admin/auditoria' ? 'bg-white/15' : 'text-zinc-300 hover:bg-white/10')}>Auditoria</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {support && (
              <span className="font-bold bg-amber-400 text-amber-950 px-2.5 py-1.5 rounded-lg">
                Em suporte {support.mode === 'view' ? '(somente leitura)' : '(administrativo)'}
              </span>
            )}
            <span className="text-zinc-400 hidden sm:inline">{email}</span>
            <Link href="/dashboard" className="font-bold bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg">Meu painel</Link>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
