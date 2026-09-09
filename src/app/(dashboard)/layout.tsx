import { Suspense } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import { PageSkeleton } from '@/components/ui';

// Layout fino no servidor: toda a autenticação do painel acontece no
// cliente (DashboardShell valida a sessão via /api/auth/me com cookie
// OU Bearer), então o painel abre mesmo com cookies bloqueados.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
          <p className="text-sm text-zinc-500">Carregando…</p>
        </div>
      }
    >
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
