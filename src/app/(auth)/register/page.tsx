'use client';
import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { saveToken } from '@/lib/client-auth';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível criar sua conta.');
      if (!data.token) {
        throw new Error('Conta criada, mas não recebemos a sessão. Entre com seu e-mail e senha.');
      }
      saveToken(data.token);
      const me = await fetch('/api/auth/me');
      if (!me.ok) {
        throw new Error('Conta criada, mas não conseguimos manter a sessão. Entre com seu e-mail e senha.');
      }
      router.push('/onboarding');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Crie sua conta</h1>
      <p className="text-sm text-zinc-400 mt-1">Grátis para começar. Sem cartão. Depois, criar o negócio leva um minuto.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="name">Seu nome</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Como podemos te chamar?" />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="email">E-mail</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="voce@seudominio.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="password">Senha</label>
          <input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Mínimo 6 caracteres" />
        </div>
        {error && <p className="text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
        <button disabled={loading} className="w-full font-bold bg-emerald-500 text-zinc-950 py-3 rounded-xl hover:bg-emerald-400 disabled:opacity-50">
          {loading ? 'Criando…' : 'Criar conta grátis'}
        </button>
      </form>
      <p className="text-sm text-zinc-400 mt-6 text-center">
        Já tem conta? <Link href="/login" className="font-semibold text-emerald-400 hover:text-emerald-300">Entrar</Link>
      </p>
    </>
  );
}
