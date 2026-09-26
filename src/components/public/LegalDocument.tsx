import type { ReactNode } from 'react';
import Link from 'next/link';

export type LegalSection = {
  id: string;
  number: string;
  title: string;
  content: ReactNode;
};

function Section({ section }: { section: LegalSection }) {
  return (
    <section id={section.id} className="scroll-mt-28 border-t border-[#e7e6e0] pt-9 first:border-t-0 first:pt-0">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#6b5dd3]">{section.number}</p>
      <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-[#171827] sm:text-[1.7rem]">{section.title}</h2>
      <div className="mt-4 space-y-4 text-[0.98rem] leading-7 text-[#555568]">{section.content}</div>
    </section>
  );
}

export function LegalDocument({
  title,
  intro,
  notice,
  updatedAt,
  sections,
}: {
  title: string;
  intro: string;
  notice?: ReactNode;
  updatedAt: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#171827]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[#171827] focus:px-4 focus:py-3 focus:text-white">
        Ir para o conteúdo
      </a>

      <header className="border-b border-[#e7e6e0] bg-[#f7f7f4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="font-display text-lg font-extrabold tracking-[-0.05em] text-[#171827]" aria-label="GoDoutor, página inicial">
            Go<span className="text-[#6b5dd3]">Doutor</span>
          </Link>
          <Link href="/login" className="rounded-full border border-[#d9d8d1] px-4 py-2 text-sm font-semibold text-[#464657] transition hover:border-[#6b5dd3] hover:text-[#5c4ec2]">
            Acesso da equipe <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <div id="conteudo" className="mx-auto grid max-w-6xl gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[220px_minmax(0,720px)] lg:gap-20">
        <aside className="lg:sticky lg:top-8 lg:h-fit" aria-label="Índice do documento">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8c8b96]">Neste documento</p>
          <nav className="mt-4 grid gap-2 border-l border-[#deddd6] pl-4 text-sm text-[#6a6976]">
            {sections.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="py-1 transition hover:text-[#5c4ec2]">{section.number}. {section.title}</a>
            ))}
          </nav>
          <p className="mt-8 text-xs leading-5 text-[#8c8b96]">Última atualização<br /><strong className="font-semibold text-[#6a6976]">{updatedAt}</strong></p>
        </aside>

        <article className="max-w-3xl">
          <header className="mb-12">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#6b5dd3]">GoDoutor · transparência</p>
            <h1 className="max-w-2xl font-display text-4xl font-extrabold leading-[1.08] tracking-[-0.055em] text-[#171827] sm:text-6xl">{title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#626173]">{intro}</p>
            {notice && <div className="mt-7 rounded-2xl border border-[#ded9fa] bg-[#f0edff] px-5 py-4 text-sm leading-6 text-[#4f467f]">{notice}</div>}
          </header>

          <div className="space-y-12">
            {sections.map((section) => <Section key={section.id} section={section} />)}
          </div>

          <div className="mt-14 border-t border-[#e7e6e0] pt-7 text-sm leading-6 text-[#7a7985]">
            Esta página é pública e pode ser consultada sem login. Consulte também a <Link href="/politica-de-privacidade" className="font-semibold text-[#5c4ec2] underline decoration-[#c9c3f3] underline-offset-4 hover:text-[#4437a7]">Política de Privacidade</Link>.
          </div>
        </article>
      </div>

      <footer className="border-t border-[#e7e6e0] bg-white/45">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-[#777684] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p><span className="font-display font-bold text-[#29283a]">GoDoutor</span> · organização para clínicas e equipes.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Documentos legais">
            <Link href="/" className="hover:text-[#5c4ec2]">Início</Link>
            <Link href="/politica-de-privacidade" className="hover:text-[#5c4ec2]">Privacidade</Link>
            <Link href="/termos-de-servico" className="hover:text-[#5c4ec2]">Termos</Link>
            <Link href="/exclusao-de-dados" className="hover:text-[#5c4ec2]">Exclusão de dados</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
