'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';

const PASSWORD_MIN_LENGTH = 8;

type FormValues = {
  email: string;
  name: string;
  password: string;
  confirmPassword: string;
};

export default function SetupMasterPage() {
  const [state, setState] = useState<'checking' | 'ready' | 'locked' | 'unauthorized'>('checking');
  const [values, setValues] = useState<FormValues>({ email: '', name: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/setup-master')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (response.status === 410) {
          setState('locked');
          return;
        }
        if (response.status === 401 || response.status === 403) {
          setState('unauthorized');
          setError(data.error || 'Entre com uma conta Owner ou Admin para continuar.');
          return;
        }
        if (!response.ok || data.available !== true) {
          setState('locked');
          return;
        }
        setState('ready');
      })
      .catch(() => {
        setState('unauthorized');
        setError('Não foi possível verificar o estado do bootstrap.');
      });
  }, []);

  function update(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (values.password.length < PASSWORD_MIN_LENGTH) {
      setError(`A senha precisa de ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (values.password !== values.confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/setup-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 410) {
        setState('locked');
        throw new Error('O bootstrap do primeiro Master já foi concluído.');
      }
      if (!response.ok) throw new Error(data.error || 'Não foi possível criar o Master.');
      setState('locked');
      setSuccess('Master criado com sucesso. O bootstrap agora está bloqueado.');
      setValues({ email: '', name: '', password: '', confirmPassword: '' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o Master.');
    } finally {
      setBusy(false);
    }
  }

  const disabled = state !== 'ready' || busy;

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/login" className="text-sm text-zinc-400 hover:text-white">← Voltar ao login</Link>
        <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl sm:p-8">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-amber-950">
              <Icon n="shield" size={20} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Configuração protegida</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Primeiro Master</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-400">Cria somente a conta de plataforma. Nenhuma clínica, organização ou associação será criada.</p>
            </div>
          </div>

          {state === 'checking' && <p className="mt-6 rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-300">Verificando se o bootstrap ainda está disponível…</p>}
          {state === 'locked' && <p role="status" className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">O bootstrap do primeiro Master está bloqueado porque já existe um Master.</p>}
          {state === 'unauthorized' && <p role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error || 'Somente uma conta Owner ou Admin autenticada pode executar este bootstrap.'}</p>}
          {error && state === 'ready' && <p role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          {success && <p role="status" className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{success}</p>}

          <form onSubmit={submit} className="mt-6 space-y-4" autoComplete="off">
            <div>
              <label htmlFor="setup-master-email" className="mb-1.5 block text-sm font-medium text-zinc-300">E-mail do Master</label>
              <input id="setup-master-email" type="email" required value={values.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" disabled={disabled}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50" placeholder="master@seudominio.com" />
            </div>
            <div>
              <label htmlFor="setup-master-name" className="mb-1.5 block text-sm font-medium text-zinc-300">Nome</label>
              <input id="setup-master-name" type="text" required value={values.name} onChange={(event) => update('name', event.target.value)} autoComplete="name" disabled={disabled}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50" placeholder="Nome do responsável pela plataforma" />
            </div>
            <PasswordField id="setup-master-password" label="Senha" value={values.password} visible={showPassword} disabled={disabled} onChange={(value) => update('password', value)} onToggle={() => setShowPassword((current) => !current)} />
            <PasswordField id="setup-master-confirm-password" label="Confirmar senha" value={values.confirmPassword} visible={showConfirmPassword} disabled={disabled} onChange={(value) => update('confirmPassword', value)} onToggle={() => setShowConfirmPassword((current) => !current)} />
            <p className="text-xs text-zinc-500">A senha precisa ter ao menos {PASSWORD_MIN_LENGTH} caracteres.</p>
            <button type="submit" disabled={disabled} className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-extrabold text-amber-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? 'Criando Master…' : 'Criar primeiro Master'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function PasswordField({
  id,
  label,
  value,
  visible,
  disabled,
  onChange,
  onToggle,
}: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-zinc-300">{label}</label>
      <div className="relative">
        <input id={id} type={visible ? 'text' : 'password'} required minLength={PASSWORD_MIN_LENGTH} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" disabled={disabled}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-3 pr-12 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50" />
        <button type="button" onClick={onToggle} disabled={disabled} aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`} title={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
          <Icon n="eye" size={17} />
        </button>
      </div>
    </div>
  );
}
