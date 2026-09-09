'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { saveToken, saveCustomerToken } from '@/lib/client-auth';

export default function RecuperarPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Suspense fallback={<p className="text-sm text-zinc-400">Carregando…</p>}>
          <RecuperarForm />
        </Suspense>
      </div>
    </main>
  );
}

function RecuperarForm() {
  const router = useRouter();
  const params = useSearchParams();
  const kind = params.get('kind') === 'customer' ? 'customer' : 'user';
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const input = 'w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500';
  const base = kind === 'user' ? '/api/auth' : '/api/customer';
  const minLen = kind === 'user' ? 6 : 4;

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await fetch(`${base}/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível enviar.');
      if (data.sent === false) {
        setInfo('Recebemos seu pedido, mas o envio automático de e-mails ainda não está ativo. Fale com o suporte do InstaLink.');
      } else {
        setInfo('Se existir uma conta com este e-mail, enviamos o link de redefinição. Confira sua caixa de entrada (e o spam).');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < minLen) { setError(`A senha precisa de ao menos ${minLen} caracteres.`); return; }
    if (password !== password2) { setError('As senhas não conferem.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${base}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível redefinir.');
      if (kind === 'user') {
        saveToken(data.token);
        router.push('/dashboard');
        router.refresh();
      } else {
        saveCustomerToken(data.token);
        window.dispatchEvent(new CustomEvent('il:auth-changed'));
        setDone(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold">Senha criada!</h1>
        <p className="text-sm text-zinc-400 mt-2">Você já está logado. Volte para a página para continuar.</p>
        <button onClick={() => router.back()} className="mt-6 w-full font-bold bg-emerald-500 text-zinc-950 py-3 rounded-xl hover:bg-emerald-400">
          Voltar para a página
        </button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold">{token ? 'Criar nova senha' : 'Esqueci minha senha'}</h1>
      <p className="text-sm text-zinc-400 mt-1">
        {token ? 'Escolha uma nova senha para sua conta.' : 'Informe seu e-mail para receber o link de redefinição.'}
      </p>
      {token ? (
        <form onSubmit={resetPassword} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="pw1">Nova senha</label>
            <input id="pw1" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
              className={input} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="pw2">Confirmar senha</label>
            <input id="pw2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)}
              className={input} placeholder="••••••••" />
          </div>
          {error && <p className="text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
          <button disabled={loading} className="w-full font-bold bg-emerald-500 text-zinc-950 py-3 rounded-xl hover:bg-emerald-400 disabled:opacity-50">
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </form>
      ) : (
        <form onSubmit={requestLink} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="email">E-mail da conta</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className={input} placeholder="voce@seudominio.com" />
          </div>
          {error && <p className="text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
          {info && <p className="text-sm font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">{info}</p>}
          <button disabled={loading} className="w-full font-bold bg-emerald-500 text-zinc-950 py-3 rounded-xl hover:bg-emerald-400 disabled:opacity-50">
            {loading ? 'Enviando…' : 'Enviar link'}
          </button>
        </form>
      )}
      <p className="text-sm text-zinc-400 mt-6 text-center">
        <Link href={kind === 'user' ? '/login' : '/'} className="font-semibold text-emerald-400 hover:text-emerald-300">
          {kind === 'user' ? 'Voltar ao login' : 'Voltar ao início'}
        </Link>
      </p>
    </>
  );
}
