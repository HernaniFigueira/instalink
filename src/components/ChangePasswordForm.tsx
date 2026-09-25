'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';

const PASSWORD_MIN_LENGTH = 8;

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmPassword';

const FIELD_LABELS: Record<PasswordField, string> = {
  currentPassword: 'Senha atual',
  newPassword: 'Nova senha',
  confirmPassword: 'Confirmar nova senha',
};

export function ChangePasswordForm({ standalone = false }: { standalone?: boolean }) {
  const [values, setValues] = useState<Record<PasswordField, string>>({
    currentPassword: '', newPassword: '', confirmPassword: '',
  });
  const [visible, setVisible] = useState<Record<PasswordField, boolean>>({
    currentPassword: false, newPassword: false, confirmPassword: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function set(field: PasswordField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    if (values.newPassword !== values.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }
    if (values.newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`A nova senha precisa de ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível alterar a senha.');
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage('Senha alterada com sucesso');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="alterar-senha" className={standalone
      ? 'w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm'
      : 'rounded-lg border border-[var(--border)] bg-white p-5'}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-fg)]">
          <Icon n="lock" size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Alterar senha</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Use uma senha com pelo menos {PASSWORD_MIN_LENGTH} caracteres.</p>
        </div>
      </div>

      {message && <p role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="mt-4 space-y-3" autoComplete="off">
        {(Object.keys(FIELD_LABELS) as PasswordField[]).map((field) => {
          const id = `change-${field}`;
          const isVisible = visible[field];
          return (
            <div key={field}>
              <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">{FIELD_LABELS[field]}</label>
              <div className="relative">
                <input
                  id={id}
                  type={isVisible ? 'text' : 'password'}
                  required
                  minLength={field === 'currentPassword' ? undefined : PASSWORD_MIN_LENGTH}
                  autoComplete={field === 'currentPassword' ? 'current-password' : 'new-password'}
                  value={values[field]}
                  onChange={(event) => set(field, event.target.value)}
                  className="il-field-control w-full pr-11"
                />
                <button
                  type="button"
                  onClick={() => setVisible((current) => ({ ...current, [field]: !current[field] }))}
                  aria-label={`${isVisible ? 'Ocultar' : 'Mostrar'} ${FIELD_LABELS[field].toLowerCase()}`}
                  title={`${isVisible ? 'Ocultar' : 'Mostrar'} ${FIELD_LABELS[field].toLowerCase()}`}
                  className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <Icon n="eye" size={16} />
                </button>
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3 pt-2">
          {standalone && <Link href="/login" className="text-xs font-semibold text-[var(--brand-fg)] hover:underline">Voltar ao login</Link>}
          <button type="submit" disabled={busy} className="il-control il-control--md ml-auto rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-strong)] disabled:opacity-50">
            {busy ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </div>
      </form>
    </section>
  );
}
