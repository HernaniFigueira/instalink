import { A, EmptyState, PageHeader } from '@/components/ui';
import type { BlockedLegacySurface } from '@/lib/legacy-surfaces';

/**
 * Estado único das telas operacionais legadas com GODOUTOR_LEGACY_PAGES OFF
 * (CORREÇÃO FINAL da convergência): honesto sobre o que aconteceu (nada foi
 * apagado), com saída segura para o produto clínico. Não é 404, não é
 * "negócio não encontrado", não é tela operacional pela metade.
 */
export function LegacySurfaceBlocked({ surface }: { surface: BlockedLegacySurface }) {
  return (
    <div className="px-4 py-5 lg:px-6">
      <PageHeader title={surface.title} hint="Modo legado desligado (GODOUTOR_LEGACY_PAGES) — dados preservados." />
      <div className="mt-4">
        <EmptyState
          icon="alert"
          title={surface.title}
          hint={surface.hint}
          action={<A href={surface.href} variant="primary" className="text-sm">{surface.hrefLabel}</A>}
        />
      </div>
    </div>
  );
}
