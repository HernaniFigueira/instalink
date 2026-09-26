'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { EsteiraView } from '@/components/dashboard/EsteiraView';
import { Button, PageHeader } from '@/components/ui';

// ═══════════════════════════════════════════════════════════════
// FUNIL — as oportunidades por etapa
// Era /esteira: rota existia, mas não tinha porta no menu (só se chegava por
// link dentro de Clientes). Agora é destino declarado do catálogo, na seção
// Pessoas. "Funil" é o vocabulário do produto; "esteira" fica apenas no nome
// interno do componente/API (nenhuma regra de estágio mudou).
// ═══════════════════════════════════════════════════════════════
// 2.0: a PORTA se chama "Oportunidades" na interface. A rota (`/funil`), a
// permissão (`leads`) e o componente (`EsteiraView`) seguem com os nomes
// originais de propósito — renomear por rótulo quebraria links e permissões.
export default function FunilPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const { denied } = useAreaLoad('Oportunidades');

  if (denied) return <AccessDenied area="Oportunidades" />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="funnel"
        title="Oportunidades"
        hint="Acompanhe as oportunidades por etapa, encaminhe para a secretaria e agende atendimentos."
        action={<Link href={`/clientes?b=${businessId}`}><Button variant="secondary" size="sm">Ver lista de clientes</Button></Link>}
      />

      <EsteiraView />
    </div>
  );
}
