'use client';
// /admin é o caminho legado da área Master.
// Redireciona para /master (camada definitiva da plataforma).
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { PageSkeleton } from '@/components/ui';

const MAP: Record<string, string> = {
  '/admin': '/master',
  '/admin/auditoria': '/master/atividade',
};

export default function AdminLegacyLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith('/admin/empresas/')) {
      const id = pathname.split('/')[3];
      router.replace(id ? `/master/unidades/${id}` : '/master/unidades');
      return;
    }
    router.replace(MAP[pathname] || '/master');
  }, [router, pathname]);

  return <PageSkeleton />;
}
