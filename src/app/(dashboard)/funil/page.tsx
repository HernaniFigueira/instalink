'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { EsteiraView } from '@/components/dashboard/EsteiraView';

// ═══════════════════════════════════════════════════════════════
// FUNIL — as oportunidades por etapa
// Era /esteira: rota existia, mas não tinha porta no menu (só se chegava por
// link dentro de Clientes). Agora é destino declarado do catálogo, na seção
// Pessoas. "Funil" é o vocabulário do produto; "esteira" fica apenas no nome
// interno do componente/API (nenhuma regra de estágio mudou).
// ═══════════════════════════════════════════════════════════════
export default function FunilPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const { denied } = useAreaLoad('Funil');

  if (denied) return <AccessDenied area="Funil" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-zinc-900">Funil</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Acompanhe as oportunidades por etapa, encaminhe para a secretaria e agende atendimentos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/clientes?b=${businessId}`}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700"
          >
            Ver Lista de Clientes
          </Link>
        </div>
      </div>

      <EsteiraView />
    </div>
  );
}
