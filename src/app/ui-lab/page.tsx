import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { UiLab, type LabFont } from '@/components/ui-lab/UiLab';

// UI Lab CANÔNICA — rota interna de revisão visual. Não aparece na navegação
// do produto, não é indexável e só responde fora de produção ou quando
// `GODOUTOR_UI_LAB=1` (ambiente de QA). Usa os primitives reais de
// `src/components/ui.tsx`: nada de mock visual paralelo.
export const metadata: Metadata = { title: 'UI Lab (interno)', robots: { index: false, follow: false } };

// Dinâmica: o gate (`GODOUTOR_UI_LAB`) é lido em runtime, não no build.
export const dynamic = 'force-dynamic';

const FONTS: LabFont[] = ['barlow', 'inter', 'geist'];

export default function UiLabPage({ searchParams }: { searchParams: { font?: string } }) {
  if (process.env.NODE_ENV === 'production' && process.env.GODOUTOR_UI_LAB !== '1') notFound();
  const font = (FONTS as string[]).includes(searchParams.font || '') ? (searchParams.font as LabFont) : 'barlow';
  return <UiLab font={font} />;
}
