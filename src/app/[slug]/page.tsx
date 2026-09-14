import type { Metadata } from 'next';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { getPublicData } from '@/lib/public';
import { ThemeStyle } from '@/components/ThemeStyle';
import { Track } from '@/components/public/widgets';
import { money, waLink } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { ConciergeIsland } from '@/components/public/widgets2';
import { BottomBar } from '@/components/public/BottomBar';
import type { NavActionItem } from '@/components/public/menu';
import { CtaButton, ProductsTrigger, QuoteTrigger, ServiceAgendarButton, SheetHost, Stars } from '@/components/public/customer';
import { FaqAccordion } from '@/components/public/FaqAccordion';
import { visibleFaqItems } from '@/lib/faq';
import { NAV_ORDER, aboutVisible, publicNavIds } from '@/lib/nav';
import { agentActive, renderGreeting } from '@/lib/agent';
import {
  canBook as canBookPublic, isFeatureEnabled, productsVisible, servicesVisible, visibleBlocks,
  whatsappVisible,
} from '@/lib/features';
import type { Block, Business, PublicBusiness, Review } from '@/lib/types';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const data = await getPublicData(params.slug);
  if (!data) return { title: 'Página não encontrada — InstaLink.app' };
  const { business } = data;
  return {
    title: `${business.name} — InstaLink.app`,
    description: business.description || `Visite ${business.name} no InstaLink.app`,
    openGraph: {
      title: business.name,
      description: business.description || undefined,
      type: 'website',
      locale: 'pt_BR',
      siteName: 'InstaLink.app',
      ...(business.logo && business.logo.startsWith('http') ? { images: [business.logo] } : {}),
    },
  };
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export default async function PublicPage({ params }: { params: { slug: string } }) {
  const data = await getPublicData(params.slug);
  if (!data || data.notFound) notFound();
  const { business, page, categories, products, options, optionValues, services, serviceCategories, professionals, reviews, isOwnerPreview } = data;

  if ((data as any).notPublished) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
        <div className="text-center">
          <span className="inline-flex w-14 h-14 rounded-2xl bg-zinc-100 items-center justify-center text-zinc-400"><Icon n="store" size={28} /></span>
          <h1 className="mt-3 text-xl font-bold">{business.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">Esta página ainda não foi publicada.</p>
        </div>
      </main>
    );
  }

  // ── MÓDULOS MANDAM (fonte única: lib/features.ts) ──
  // A configuração da página só decide aparência/ordem/conteúdo: um bloco de
  // módulo desativado é descartado aqui, nunca no componente.
  const allBlocks = [...page.blocks].sort((a, b) => a.order - b.order);
  const blocks = visibleBlocks(business, allBlocks);
  const profileIdx = blocks.findIndex((b) => b.type === 'profile');

  // ── Navegação (menu configurável) + seção Sobre ──
  const aboutOk = isFeatureEnabled(business, 'about') && aboutVisible(business.about);
  const canBook = canBookPublic(business, services);
  const faqBlock = blocks.find((b) => b.type === 'faq');
  const hasFaq = !!faqBlock && visibleFaqItems(faqBlock.settings?.items).length > 0;
  const testiBlock = blocks.find((b) => b.type === 'testimonials');
  const testiItems: Array<{ name?: string; text?: string }> = Array.isArray(testiBlock?.settings?.items) ? testiBlock!.settings.items : [];
  const hasReviews = reviews.length > 0 || testiItems.some((t) => t?.text);
  const showWhatsapp = whatsappVisible(business);
  const instaUrl = business.instagram ? `https://instagram.com/${business.instagram.replace('@', '')}` : '';
  const tiktokUrl = business.tiktok ? `https://tiktok.com/@${business.tiktok.replace('@', '')}` : '';

  const available: Record<string, NavActionItem> = {};
  if (aboutOk) available.about = { id: 'about', label: 'Sobre a empresa', icon: 'store', action: { kind: 'scroll', target: '#sobre' } };
  if (blocks.some((b) => b.type === 'services') && servicesVisible(business, services)) available.services = { id: 'services', label: 'Serviços', icon: 'scissors', action: { kind: 'scroll', target: '#servicos' } };
  if (hasReviews) available.reviews = { id: 'reviews', label: 'Avaliações', icon: 'star', action: { kind: 'scroll', target: '#avaliacoes' } };
  if (hasFaq) available.faq = { id: 'faq', label: 'Dúvidas frequentes', icon: 'chat', action: { kind: 'scroll', target: '#faq' } };
  if (isFeatureEnabled(business, 'location') && business.mapsUrl) {
    available.directions = { id: 'directions', label: 'Como chegar', icon: 'pin', action: { kind: 'link', url: business.mapsUrl } };
    if (blocks.some((b) => b.type === 'location')) {
      available.contact = { id: 'contact', label: 'Contato', icon: 'pin', action: { kind: 'scroll', target: '#contato' } };
    }
  }
  if (instaUrl) available.instagram = { id: 'instagram', label: 'Instagram', icon: 'instagram', action: { kind: 'link', url: instaUrl } };
  if (tiktokUrl) available.tiktok = { id: 'tiktok', label: 'TikTok', icon: 'music', action: { kind: 'link', url: tiktokUrl } };

  // Explicito (dono configurou) ∩ disponível — ordem canônica preservada.
  const navIds = publicNavIds({
    business, blocks: allBlocks, services, products,
    reviews, hasFaq, hasTestimonialItems: testiItems.some((t) => t?.text),
  });
  const navItems = NAV_ORDER.filter((n) => navIds.includes(n.id) && available[n.id]).map((n) => available[n.id]);

  // ── Agente de atendimento (configuração persistida da empresa) ──
  const agent = data.agent;
  const agentOn = agentActive(business as unknown as Business, agent);

  const btnStyle = business && page.theme.buttonStyle !== 'solid' ? ` il-style-${page.theme.buttonStyle}` : '';
  return (
    <main className={`il-page min-h-screen${btnStyle}`}>
      <ThemeStyle theme={page.theme} />
      <Track businessId={business.id} />

      {isOwnerPreview && (
        <div className="bg-amber-400 text-amber-950 text-center text-xs font-bold py-2 px-4">
          <span className="inline-flex items-center gap-1.5 justify-center"><Icon n="eye" size={14} /> Pré-visualização — sua página ainda não está publicada.</span> <a href="/pagina" className="underline">Publicar agora</a>
        </div>
      )}

      <div className="mx-auto w-full max-w-md px-4 pb-36 pt-4 space-y-5">
        {blocks.map((block, i) => (
          <Fragment key={block.id}>
            <BlockView
              block={block}
              business={business}
              agent={agentOn ? { name: agent.name, greeting: renderGreeting(agent, business.name), enabled: agent.enabled } : null}
              catalog={{ categories, products, options, optionValues, services, serviceCategories, professionals, reviews }}
            />
            {i === profileIdx && aboutOk && <AboutView about={business.about} />}
          </Fragment>
        ))}
        {profileIdx < 0 && aboutOk && <AboutView about={business.about} />}

        <footer className="text-center pt-2">
          <a href="/" className="il-muted text-xs font-semibold hover:underline">
            Feito com InstaLink.app
          </a>
        </footer>
      </div>

      <BottomBar business={business} navItems={navItems} canBook={canBook} />
      <SheetHost
        business={business}
        products={products}
        categories={categories}
        options={options}
        values={optionValues}
        services={services}
        professionals={professionals}
      />
    </main>
  );
}

// Seção "Sobre a empresa" (título, texto e imagem opcional — configurável no painel).
function AboutView({ about }: { about: { title: string; text: string; image: string } }) {
  return (
    <section id="sobre" className="scroll-mt-20">
      <div className="il-card overflow-hidden">
        {about.image ? (
          <img src={about.image} alt={about.title || 'Sobre'} loading="lazy" className="w-full h-40 object-cover" />
        ) : null}
        <div className="p-5">
          {about.title && <h2 className="text-xl font-extrabold tracking-tight">{about.title}</h2>}
          {about.text && <p className="il-muted text-sm mt-1.5 whitespace-pre-line">{about.text}</p>}
        </div>
      </div>
    </section>
  );
}

// Embed do mapa: extrai a busca (?q=) do link salvo; cai para o endereço.
function mapsEmbedSrc(mapsUrl: string, address: string): string {
  try {
    const q = new URL(mapsUrl).searchParams.get('q') || new URL(mapsUrl).searchParams.get('query') || '';
    if (q) return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  } catch {
    /* link fora do padrão: tenta endereço, depois o link cru */
  }
  const fallback = address || mapsUrl;
  return `https://www.google.com/maps?q=${encodeURIComponent(fallback)}&output=embed`;
}

function BlockView({ block, business, agent, catalog }: {
  block: Block;
  business: PublicBusiness;
  agent: { name: string; greeting: string; enabled: boolean } | null;
  catalog: {
    categories: any[]; products: any[]; options: any[]; optionValues: any[];
    services: any[]; serviceCategories: any[]; professionals: any[]; reviews: Review[];
  };
}) {
  const s = block.settings || {};

  switch (block.type) {
    case 'profile': {
      return (
        <section className="text-center pt-2">
          {business.cover ? (
            <img src={business.cover} alt="" className="w-full h-32 object-cover mb-[-2.5rem]" style={{ borderRadius: 'var(--il-radius)' }} />
          ) : null}
          <div className="relative inline-block">
            <div className="w-24 h-24 mx-auto rounded-full overflow-hidden flex items-center justify-center text-3xl font-extrabold tracking-tight"
              style={{
                background: 'color-mix(in srgb, var(--il-primary) 14%, var(--il-surface))',
                color: 'var(--il-primary)',
                boxShadow: '0 0 0 3px var(--il-bg), 0 0 0 4px color-mix(in srgb, var(--il-primary) 35%, transparent)',
              }}>
              {business.logo ? <img src={business.logo} alt={business.name} className="w-full h-full object-cover" /> : initials(business.name)}
            </div>
          </div>
          <h1 className="mt-3 text-[26px] leading-tight font-extrabold tracking-tight">{business.name}</h1>
          {business.description && <p className="il-muted text-sm mt-1 max-w-xs mx-auto">{business.description}</p>}
          {business.address && (
            <p className="il-muted text-xs mt-2 flex items-center justify-center gap-1">
              <Icon n="pin" size={13} /> {business.address.split(',')[0]}
            </p>
          )}
          {(business.instagram || business.tiktok || business.whatsapp) && (
            <div className="mt-3 flex items-center justify-center gap-2.5">
              {business.instagram && (
                <a href={`https://instagram.com/${business.instagram.replace('@', '')}`} target="_blank" rel="noreferrer"
                  aria-label="Instagram" title="Instagram"
                  className="il-card w-10 h-10 flex items-center justify-center il-muted">
                  <Icon n="instagram" size={18} />
                </a>
              )}
              {business.tiktok && (
                <a href={`https://tiktok.com/@${business.tiktok.replace('@', '')}`} target="_blank" rel="noreferrer"
                  aria-label="TikTok" title="TikTok"
                  className="il-card w-10 h-10 flex items-center justify-center il-muted">
                  <Icon n="music" size={18} />
                </a>
              )}
              {whatsappVisible(business) && (
                <a href={waLink(business.whatsapp, `Olá! Vim pelo site da ${business.name}.`)} target="_blank" rel="noreferrer"
                  aria-label="WhatsApp" title="WhatsApp"
                  className="il-card w-10 h-10 flex items-center justify-center il-muted">
                  <Icon n="phone" size={18} />
                </a>
              )}
            </div>
          )}
        </section>
      );
    }
    case 'cta': {
      return <CtaButton business={business} label={s.label || 'Começar'} target={s.target || ''} />;
    }
    case 'buttons': {
      const btns: Array<{ label: string; url: string }> = Array.isArray(s.buttons) ? s.buttons : [];
      if (btns.length === 0) return null;
      return (
        <div className="space-y-2.5">
          {btns.filter((b) => b.label && b.url).map((b, i) => (
            <a key={i} href={b.url} target="_blank" rel="noreferrer"
              className="il-card block text-center font-bold py-3.5 active:scale-[0.99] transition-transform">
              {b.label}
            </a>
          ))}
        </div>
      );
    }
    case 'text': {
      if (!s.title && !s.body) return null;
      return (
        <section className="il-card p-5">
          {s.title && <h2 className="font-extrabold text-lg">{s.title}</h2>}
          {s.body && <p className="il-muted text-sm mt-1 whitespace-pre-line">{s.body}</p>}
        </section>
      );
    }
    case 'image': {
      if (!s.url) return null;
      const img = <img src={s.url} alt={s.alt || business.name} loading="lazy" className="w-full object-cover" style={{ borderRadius: 'var(--il-radius)' }} />;
      return s.link ? <a href={s.link} target="_blank" rel="noreferrer" className="block">{img}</a> : <div>{img}</div>;
    }
    case 'gallery': {
      const imgs: string[] = Array.isArray(s.images) ? s.images.filter(Boolean) : [];
      if (imgs.length === 0) return null;
      return (
        <section>
          {s.title && <h2 className="text-xl font-extrabold tracking-tight mb-3">{s.title}</h2>}
          <div className="grid grid-cols-2 gap-2.5">
            {imgs.slice(0, 6).map((url, i) => (
              <img key={i} src={url} alt={business.name} loading="lazy" className="w-full h-36 object-cover" style={{ borderRadius: 'var(--il-radius)' }} />
            ))}
          </div>
        </section>
      );
    }
    case 'products': {
      // Módulo desativado nunca renderiza (mesmo com bloco legado habilitado).
      if (!productsVisible(business, catalog.products)) return null;
      const f2 = business.niche === 'alimentacao';
      return (
        <ProductsTrigger
          title={s.title || (f2 ? 'Cardápio' : 'Produtos')}
          count={catalog.products.length}
          label={(s.title || (f2 ? 'Cardápio' : 'Produtos')).toLowerCase()}
        />
      );
    }
    case 'services': {
      const list = catalog.services;
      if (list.length === 0) return null;
      const grouped = catalog.serviceCategories.length > 0;
      // Agenda ligada ⇒ botão Agendar por serviço (módulo, não apresentação).
      const canBook = canBookPublic(business, list);
      const card = (sv: any, wide: boolean) => (
        <div key={sv.id} className={wide ? 'il-card p-4 w-60 shrink-0 snap-start flex flex-col gap-2.5' : 'il-card p-4 flex justify-between items-center gap-3'}>
          {sv.image ? <img src={sv.image} alt={sv.name} loading="lazy" className={wide ? 'w-full h-28 object-cover' : 'w-16 h-16 rounded-xl object-cover shrink-0'} style={{ borderRadius: 'var(--il-radius)' }} /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-bold flex items-center gap-1.5">{sv.name} {sv.featured && <Icon n="star" size={13} className="shrink-0 text-amber-500" />}</p>
            {sv.description && <p className="il-muted text-xs truncate">{sv.description}</p>}
            {/* Duração não é pública: o card mostra nome, descrição e preço. */}
          </div>
          <div className={wide ? 'flex items-center justify-between gap-2 w-full' : 'shrink-0 flex flex-col items-end gap-1.5'}>
            <p className="font-extrabold il-accent">{money(sv.price)}</p>
            {canBook && sv.bookable !== false && (
              <ServiceAgendarButton serviceId={sv.id} serviceName={sv.name} />
            )}
          </div>
        </div>
      );
      const carousel = !grouped && list.length >= 5;
      return (
        <section id="servicos" className="scroll-mt-20">
          <h2 className="text-xl font-extrabold tracking-tight mb-3">{s.title || 'Serviços'}</h2>
          {carousel ? (
            <div className="flex gap-2.5 overflow-x-auto pb-1 snap-x -mx-1 px-1">
              {list.map((sv: any) => card(sv, true))}
            </div>
          ) : grouped ? (
            <div className="space-y-2.5">
              {catalog.serviceCategories.map((cat: any) => {
                const items = list.filter((x: any) => x.categoryId === cat.id);
                if (items.length === 0) return null;
                return (
                  <div key={cat.id} className="space-y-2.5">
                    <p className="text-xs font-extrabold uppercase tracking-wider il-muted pt-1">{cat.name}</p>
                    {items.map((sv: any) => card(sv, false))}
                  </div>
                );
              })}
              {list.filter((x: any) => !x.categoryId).map((sv: any) => card(sv, false))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {list.map((sv: any) => card(sv, false))}
            </div>
          )}
        </section>
      );
    }
    case 'booking': {
      return null; // aposentado — CTA + menu Agendar + botão por serviço abrem o mesmo fluxo
    }
    case 'testimonials': {
      const items: Array<{ name: string; text: string }> = Array.isArray(s.items) ? s.items : [];
      const dyn = catalog.reviews || [];
      if (dyn.length === 0 && items.filter((t) => t.text).length === 0) return null;
      // Carrossel horizontal (desktop e mobile): reduz a rolagem vertical.
      const card = 'il-card w-[82%] xs:w-72 sm:w-72 shrink-0 snap-start p-4 flex flex-col';
      return (
        <section id="avaliacoes" className="scroll-mt-20">
          <h2 className="text-xl font-extrabold tracking-tight mb-3">{s.title || 'O que dizem por aí'}</h2>
          <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory" role="list" aria-label="Avaliações">
            {dyn.length > 0 ? (
              dyn.map((r) => (
                <figure key={r.id} role="listitem" className={card}>
                  <Stars value={r.rating} />
                  {r.text ? <blockquote className="text-sm mt-1.5 line-clamp-4">“{r.text}”</blockquote> : null}
                  <figcaption className="flex items-center gap-1.5 mt-auto pt-2">
                    <span className="il-muted text-xs font-bold truncate">— {r.customerName}</span>
                    {r.source === 'google' && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full il-chip shrink-0">Google</span>
                    )}
                  </figcaption>
                </figure>
              ))
            ) : (
              items.filter((t) => t.text).map((t, i) => (
                <figure key={i} role="listitem" className={card}>
                  <blockquote className="text-sm line-clamp-4">“{t.text}”</blockquote>
                  {t.name && <figcaption className="il-muted text-xs font-bold mt-auto pt-2 truncate">— {t.name}</figcaption>}
                </figure>
              ))
            )}
          </div>
          {business.googleUrl && (
            <a href={business.googleUrl} target="_blank" rel="noreferrer" className="il-card block text-center font-bold py-3 mt-2.5 text-sm">
              Avaliar no Google
            </a>
          )}
        </section>
      );
    }
    case 'faq': {
      const items = visibleFaqItems(s.items);
      if (items.length === 0) return null;
      return (
        <section id="faq" className="scroll-mt-20">
          <h2 className="text-xl font-extrabold tracking-tight mb-3">{s.title || 'Dúvidas frequentes'}</h2>
          <FaqAccordion items={items} />
        </section>
      );
    }
    case 'location': {
      // Só aparece com link do Maps salvo — e mostra o MAPA (o endereço já está no perfil).
      if (!business.mapsUrl) return null;
      const embedSrc = mapsEmbedSrc(business.mapsUrl, business.address);
      return (
        <section id="contato" className="scroll-mt-20">
          <h2 className="text-xl font-extrabold tracking-tight mb-3 flex items-center gap-2"><Icon n="pin" size={19} /> Onde estamos</h2>
          <div className="il-card overflow-hidden">
            <iframe
              title={`Mapa — ${business.name}`}
              src={embedSrc}
              className="w-full h-56 border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <a href={business.mapsUrl} target="_blank" rel="noreferrer" className="block text-center font-bold py-3 text-sm il-accent">
              Abrir no Google Maps
            </a>
          </div>
        </section>
      );
    }
    case 'instagram': {
      return null; // aposentado — sociais (só ícones) vivem no perfil
    }
    case 'whatsapp': return null; // renderizado como flutuante
    case 'quote': {
      if (!isFeatureEnabled(business, 'quote')) return null;
      return <QuoteTrigger title={s.title || 'Solicite um orçamento'} />;
    }
    case 'concierge': {
      // O assistente só aparece com módulo ligado E agente configurado/ativo.
      if (!agent) return null;
      return <ConciergeIsland business={business} agent={agent} title={s.title || 'Precisa de ajuda?'} />;
    }
    default:
      // ('contact' aposentado: linhas legadas caem aqui e não renderizam)
      return null;
  }
}
