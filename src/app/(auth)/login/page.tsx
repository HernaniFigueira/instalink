'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { saveToken } from '@/lib/client-auth';

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">Carregando…</p>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const expired = params.get('session') === 'expired';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível entrar.');
      // Confirma que o navegador manteve a sessão ANTES de navegar.
      // Se o cookie foi bloqueado, avisa com clareza em vez de travar.
      if (!data.token) {
        throw new Error('Não recebemos a sessão do servidor. Tente novamente.');
      }
      saveToken(data.token);
      const me = await fetch('/api/auth/me');
      if (!me.ok) {
        throw new Error('Entramos na sua conta, mas não conseguimos manter a sessão neste navegador. Tente recarregar a página e entrar de novo.');
      }
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Bem-vindo de volta</h1>
      <p className="text-sm text-zinc-400 mt-1">Acesse o painel do seu negócio.</p>
      {expired && (
        <p className="mt-4 text-sm font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
          Sua sessão expirou. Entre novamente para continuar de onde parou.
        </p>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="email">E-mail</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="voce@seudominio.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="password">Senha</label>
          <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="••••••••" />
        </div>
        {error && <p className="text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
        <button disabled={loading} className="w-full font-bold bg-emerald-500 text-zinc-950 py-3 rounded-xl hover:bg-emerald-400 disabled:opacity-50">
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="text-sm text-zinc-400 mt-4 text-center">
        <Link href="/recuperar?kind=user" className="font-semibold text-emerald-400 hover:text-emerald-300">Esqueci minha senha</Link>
      </p>
      <p className="text-sm text-zinc-400 mt-3 text-center">
        Ainda não tem conta? <Link href="/register" className="font-semibold text-emerald-400 hover:text-emerald-300">Criar grátis</Link>
      </p>
    </>
  );
}
