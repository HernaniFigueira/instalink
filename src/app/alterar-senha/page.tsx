'use client';

import Link from 'next/link';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';

export default function ChangePasswordPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <Link href="/dashboard" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800">← Voltar ao painel</Link>
        <div className="mb-4 mt-5">
          <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400">Conta</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">Segurança da conta</h1>
          <p className="mt-1 text-sm text-zinc-500">Atualize sua senha sem alterar os dados da clínica.</p>
        </div>
        <ChangePasswordForm standalone />
      </div>
    </main>
  );
}
