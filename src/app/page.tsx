import Link from 'next/link';
import { THEME_PRESETS } from '@/lib/themes';
import { Icon } from '@/components/icons';

const ICONS: Record<string, React.ReactNode> = {
  link: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  cart: (<><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>),
  chat: (<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  spark: (<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />),
  chart: (<><path d="M3 3v18h18" /><path d="M8 17V9" /><path d="M13 17V5" /><path d="M18 17v-8" /></>),
  check: (<path d="M20 6 9 17l-5-5" />),
  qr: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h4v4h-7z" /></>),
};

function I({ n, size = 22 }: { n: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {ICONS[n]}
    </svg>
  );
}

const FEATURES = [
  { icon: 'link', title: 'Página que vende', text: 'Perfil, catálogo, agenda e botões — montada em blocos, sem designer.' },
  { icon: 'cart', title: 'Pedidos organizados', text: 'Carrinho, entrega ou retirada, pagamento e painel de pedidos.' },
  { icon: 'calendar', title: 'Agenda sem planilha', text: 'Serviços, profissionais e horários. O cliente agenda sozinho.' },
  { icon: 'chat', title: 'WhatsApp no fluxo', text: 'Botão flutuante e mensagens prontas em cada pedido e agendamento.' },
  { icon: 'spark', title: 'Concierge IA', text: 'Guia o visitante até comprar, agendar ou pedir orçamento.' },
  { icon: 'qr', title: 'QR + resultados', text: 'QR da página para o balcão e painel simples de visitas e vendas.' },
];

const FAQS = [
  { q: 'É grátis mesmo?', a: 'Sim. Você cria a página, recebe pedidos e agendamentos sem pagar nada e sem cartão. Recursos avançados (Pro) chegam depois — quem está dentro desde já garante condições especiais.' },
  { q: 'Preciso de site ou domínio?', a: 'Não. Sua página vive em instalink.app/seunegocio e já funciona no celular, pronta para o link da bio do Instagram e TikTok.' },
  { q: 'Meu cliente precisa baixar app?', a: 'Não. Tudo abre no navegador: ele cria a conta em segundos, pede, agenda e acompanha os próprios pedidos na área “Minha conta”.' },
  { q: 'Serve para o meu tipo de negócio?', a: 'Se você vende produtos, serviços, horários ou orçamentos — sim. Restaurantes, salões, barbearias, lojas, clínicas, pet shops e profissionais autônomos usam os mesmos blocos.' },
  { q: 'Como recebo os pedidos?', a: 'No painel, na hora — e com mensagem pronta para confirmar no WhatsApp. Pedidos, agenda e clientes ficam organizados num lugar só.' },
];

function PhoneMock() {
  return (
    <div className="mx-auto w-[270px] rounded-[2.6rem] border-[10px] border-zinc-800 bg-[#120a0b] p-4 shadow-[0_30px_80px_-20px_rgba(163,230,53,0.25)] rotate-2">
      <div className="mx-auto mb-3 h-5 w-24 rounded-full bg-zinc-800" />
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-lime-300 to-blue-600 font-black text-[#120a0b]">BH</div>
        <div className="mx-auto mt-2 h-3.5 w-28 rounded-full bg-zinc-100" />
        <div className="mx-auto mt-1.5 h-2.5 w-20 rounded-full bg-zinc-600" />
      </div>
      <div className="mt-3 rounded-2xl bg-lime-300 py-2.5 text-center text-xs font-black uppercase tracking-wide text-[#120a0b]">
        Pedir agora
      </div>
      <div className="mt-2 space-y-2">
        {['X-Bacon · R$ 29,90', 'X-Tudo · R$ 34,90'].map((t) => (
          <div key={t} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2.5">
            <div className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br from-orange-400 to-amber-300" />
            <div className="h-2.5 flex-1 rounded-full bg-zinc-600" />
            <div className="rounded-lg bg-lime-300 px-2 py-1 text-[10px] font-black text-[#120a0b]">Ver</div>
          </div>
        ))}
      </div>
      <p className="sr-only">Prévia de página criada no InstaLink</p>
    </div>
  );
}

export default function Landing() {
  return (
    <main className="min-h-screen bg-[#0e090b] text-white overflow-x-hidden">
      {/* ── topo ── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime-300 font-black text-[#120a0b]">IL</div>
          <span className="font-display text-lg font-bold tracking-tight">InstaLink<span className="text-lime-300">.app</span></span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-semibold text-zinc-400 md:flex">
          <a href="#recursos" className="hover:text-white">Recursos</a>
          <a href="#modelos" className="hover:text-white">Modelos</a>
          <a href="#duvidas" className="hover:text-white">Dúvidas</a>
        </nav>
        <nav className="flex items-center gap-2.5">
          <Link href="/login" className="px-3 py-2 text-sm font-semibold text-zinc-300 hover:text-white">Entrar</Link>
          <Link href="/register" className="rounded-xl bg-lime-300 px-4 py-2.5 text-sm font-bold text-[#120a0b] hover:bg-lime-200">
            Criar grátis
          </Link>
        </nav>
      </header>

      {/* ── hero ── */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-14 pt-10 lg:grid-cols-[1.15fr_0.85fr] lg:pt-16">
        <div className="text-center lg:text-left">
          <p className="inline-flex items-center gap-2 rounded-full border border-lime-300/25 bg-lime-300/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-lime-200">
            <I n="spark" size={14} /> Novo · Conta do cliente + Agendamento rápido
          </p>
          <h1 className="font-display mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Seu negócio inteiro<br />em <span className="text-lime-300">um link</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-zinc-400 lg:mx-0">
            O Instagram e o TikTok mandam o cliente. O InstaLink vende, agenda,
            organiza e mede — tudo a partir do link da bio.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start sm:justify-center">
            <Link href="/register" className="w-full rounded-2xl bg-lime-300 px-8 py-4 text-center text-base font-bold text-[#120a0b] hover:bg-lime-200 sm:w-auto">
              Criar minha página grátis
            </Link>
            <Link href="/burgerhouse" className="w-full rounded-2xl border border-zinc-700 px-8 py-4 text-center text-base font-semibold hover:bg-zinc-900 sm:w-auto">
              Ver demonstração
            </Link>
          </div>
          <p className="mt-4 text-xs text-zinc-500">Sem cartão · Pronto em 5 minutos · Cancele quando quiser</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold lg:justify-start">
            <span className="text-zinc-500">Experimente ao vivo:</span>
            <Link href="/burgerhouse" className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 py-1.5 hover:border-lime-300/40 hover:text-lime-200 inline-flex items-center gap-1.5"><Icon n="bag" size={14} /> Hamburgueria</Link>
            <Link href="/barbeariadojoao" className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 py-1.5 hover:border-lime-300/40 hover:text-lime-200 inline-flex items-center gap-1.5"><Icon n="scissors" size={14} /> Barbearia</Link>
          </div>
        </div>
        <PhoneMock />
      </section>

      {/* ── canais ── */}
      <section className="border-y border-white/5 bg-white/[0.02]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-5 text-sm font-semibold text-zinc-400">
          <span className="text-xs uppercase tracking-widest text-zinc-600">Feito para quem vende pelo</span>
          <span>Instagram</span><span>TikTok</span><span>WhatsApp</span><span>Google</span>
        </div>
      </section>

      {/* ── recursos ── */}
      <section id="recursos" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16">
        <p className="text-center text-xs font-bold uppercase tracking-widest text-lime-300">Tudo num lugar só</p>
        <h2 className="font-display mx-auto mt-3 max-w-2xl text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
          Do primeiro clique ao pedido pago
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-lime-300/30">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-300/15 text-lime-300">
                <I n={f.icon} />
              </div>
              <h3 className="mt-4 font-bold">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── modelos ── */}
      <section id="modelos" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-16">
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-900 to-[#171017] p-8 sm:p-12">
          <div className="grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-lime-300">Design pronto</p>
              <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Modelos prontos.<br />Sua cara em 1 clique.
              </h2>
              <p className="mt-3 text-zinc-400">
                Escolha uma combinação fechada de cores, fonte e formato — depois
                ajuste qualquer cor. Sem designer, sem adivinhação.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm font-medium text-zinc-300">
                {['8 modelos para todos os estilos', 'Prévia ao vivo antes de salvar', 'Troque quando quiser, sem refazer a página'].map((t) => (
                  <li key={t} className="flex items-center gap-2.5">
                    <span className="text-lime-300"><I n="check" size={16} /></span>{t}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="mt-6 inline-block rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-zinc-950 hover:bg-zinc-200">
                Testar os modelos grátis
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {THEME_PRESETS.map((p) => (
                <div key={p.id} className="overflow-hidden rounded-2xl border border-white/10" title={`${p.name} — ${p.hint}`}>
                  <div className="p-2.5" style={{ background: p.theme.background }}>
                    <div className="flex items-center gap-1.5">
                      <div className="h-5 w-5 shrink-0 rounded-full" style={{ background: `linear-gradient(135deg, ${p.theme.primary}, ${p.theme.secondary})` }} />
                      <div className="flex-1 space-y-1">
                        <div className="h-1.5 w-3/4 rounded-full" style={{ background: p.theme.text }} />
                        <div className="h-1.5 w-1/2 rounded-full" style={{ background: p.theme.muted }} />
                      </div>
                    </div>
                    <div className="mt-2 h-6" style={{ background: p.theme.primary, borderRadius: Math.min(p.theme.radius, 8) }} />
                  </div>
                  <p className="bg-black/30 px-2.5 py-1.5 text-[11px] font-bold">{p.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── como funciona ── */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <h2 className="font-display text-center text-3xl font-extrabold tracking-tight sm:text-4xl">No ar em 3 passos</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { n: '1', t: 'Conte do seu negócio', d: 'Nome, WhatsApp, o que você vende e se atende com hora marcada. Leva 2 minutos.' },
            { n: '2', t: 'Aplique um modelo', d: 'Escolha o visual pronto, monte catálogo ou serviços e veja a prévia na hora.' },
            { n: '3', t: 'Compartilhe e venda', d: 'Publique, coloque o link na bio, imprima o QR — e receba pedido e agendamento.' },
          ].map((s) => (
            <div key={s.n} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="font-display text-4xl font-extrabold text-lime-300">{s.n}</div>
              <h3 className="mt-3 font-bold">{s.t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── dúvidas ── */}
      <section id="duvidas" className="mx-auto max-w-3xl scroll-mt-20 px-5 pb-16">
        <h2 className="font-display text-center text-3xl font-extrabold tracking-tight sm:text-4xl">Dúvidas frequentes</h2>
        <div className="mt-8 space-y-2.5">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <summary className="cursor-pointer text-sm font-bold">{f.q}</summary>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="rounded-[2rem] bg-lime-300 p-8 text-center text-[#120a0b] sm:p-14">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            Entre pelo Instagram.<br />Saia com pedido, agendamento ou lead.
          </h2>
          <Link href="/register" className="mt-8 inline-block rounded-2xl bg-[#120a0b] px-10 py-4 font-bold text-white hover:bg-zinc-800">
            Começar agora — é grátis
          </Link>
          <p className="mt-3 text-xs font-semibold opacity-60">Sem cartão · Pronto em 5 minutos</p>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-xs text-zinc-500 sm:flex-row">
          <span>© 2026 InstaLink.app — Seu negócio inteiro em um link</span>
          <span className="flex gap-5 font-semibold">
            <Link href="/login" className="hover:text-white">Entrar</Link>
            <Link href="/register" className="hover:text-white">Criar conta</Link>
            <Link href="/burgerhouse" className="hover:text-white">Demonstração</Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
