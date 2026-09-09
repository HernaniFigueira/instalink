import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicData } from '@/lib/public';
import { ThemeStyle } from '@/components/ThemeStyle';
import { Track } from '@/components/public/widgets';
import { money, waLink } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { ConciergeIsland, WaFloat } from '@/components/public/widgets2';
import { CtaButton, ProductsTrigger, QuoteTrigger, ServiceAgendarButton, SheetHost, Stars } from '@/components/public/customer';
import { PageMenu, type MenuItem } from '@/components/public/menu';
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

  const blocks = [...page.blocks].sort((a, b) => a.order - b.order).filter((b) => b.enabled);
  const hasWhatsappBlock = blocks.some((b) => b.type === 'whatsapp');
  const food = business.niche === 'alimentacao';
  const menuItems: MenuItem[] = [
    ...(blocks.some((b) => b.type === 'services') && services.length > 0 ? [{ id: 'services' as const, label: 'Serviços' }] : []),
    ...(business.modes.includes('bookings') && services.some((sv: any) => sv.bookable) ? [{ id: 'booking' as const, label: 'Agendar' }] : []),
    ...(((business.modes.includes('products') || business.modes.includes('orders')) && products.length > 0 && blocks.some((b) => b.type === 'products'))
      ? [{ id: 'products' as const, label: food ? 'Cardápio' : 'Loja' }] : []),
    ...(business.modes.includes('quote') && blocks.some((b) => b.type === 'quote') ? [{ id: 'quote' as const, label: 'Orçamento' }] : []),
    ...(blocks.some((b) => b.type === 'testimonials') ? [{ id: 'reviews' as const, label: 'Avaliações' }] : []),
    ...(business.mapsUrl && blocks.some((b) => b.type === 'location') ? [{ id: 'contact' as const, label: 'Contato' }] : []),
  ];

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

      <div className="mx-auto w-full max-w-md px-4 pb-28 pt-4 space-y-5">
        <div className="sticky top-3 z-30">
          <PageMenu items={menuItems} />
        </div>
        {blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            business={business}
            catalog={{ categories, products, options, optionValues, services, serviceCategories, professionals, reviews }}
          />
        ))}

        <footer className="text-center pt-4">
          <a href="/" className="il-muted text-xs font-semibold hover:underline">
            Feito com InstaLink.app
          </a>
        </footer>
      </div>

      {hasWhatsappBlock && business.whatsapp && <WaFloat business={business} label="Falar no WhatsApp" />}
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

function BlockView({ block, business, catalog }: {
  block: Block;
  business: PublicBusiness;
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
              {business.whatsapp && (
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
      if (!business.modes.includes('products') && !business.modes.includes('orders')) return null;
      if (catalog.products.length === 0) return null;
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
      const canBook = business.modes.includes('bookings');
      const card = (sv: any, wide: boolean) => (
        <div key={sv.id} className={wide ? 'il-card p-4 w-60 shrink-0 snap-start flex flex-col gap-2.5' : 'il-card p-4 flex justify-between items-center gap-3'}>
          {sv.image ? <img src={sv.image} alt={sv.name} loading="lazy" className={wide ? 'w-full h-28 object-cover' : 'w-16 h-16 rounded-xl object-cover shrink-0'} style={{ borderRadius: 'var(--il-radius)' }} /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-bold flex items-center gap-1.5">{sv.name} {sv.featured && <Icon n="star" size={13} className="shrink-0 text-amber-500" />}</p>
            {sv.description && <p className="il-muted text-xs truncate">{sv.description}</p>}
            <p className="il-muted text-xs mt-0.5 flex items-center gap-1"><Icon n="clock" size={13} /> {sv.durationMin} min</p>
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
      return (
        <section id="avaliacoes" className="scroll-mt-20">
          <h2 className="text-xl font-extrabold tracking-tight mb-3">{s.title || 'O que dizem por aí'}</h2>
          {dyn.length > 0 ? (
            <div className="space-y-2.5">
              {dyn.slice(0, 4).map((r) => (
                <figure key={r.id} className="il-card p-4">
                  <Stars value={r.rating} />
                  {r.text ? <blockquote className="text-sm mt-1.5">“{r.text}”</blockquote> : null}
                  <figcaption className="flex items-center gap-1.5 mt-1.5">
                    <span className="il-muted text-xs font-bold">— {r.customerName}</span>
                    {r.source === 'google' && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full il-chip">Google</span>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.filter((t) => t.text).map((t, i) => (
                <figure key={i} className="il-card p-4">
                  <blockquote className="text-sm">“{t.text}”</blockquote>
                  {t.name && <figcaption className="il-muted text-xs font-bold mt-1.5">— {t.name}</figcaption>}
                </figure>
              ))}
            </div>
          )}
          {business.googleUrl && (
            <a href={business.googleUrl} target="_blank" rel="noreferrer" className="il-card block text-center font-bold py-3 mt-2.5 text-sm">
              Avaliar no Google
            </a>
          )}
        </section>
      );
    }
    case 'faq': {
      const items: Array<{ q: string; a: string }> = Array.isArray(s.items) ? s.items : [];
      if (items.length === 0) return null;
      return (
        <section>
          <h2 className="text-xl font-extrabold tracking-tight mb-3">{s.title || 'Dúvidas frequentes'}</h2>
          <div className="space-y-2">
            {items.filter((f) => f.q).map((f, i) => (
              <details key={i} className="il-card p-4">
                <summary className="font-bold text-sm cursor-pointer">{f.q}</summary>
                <p className="il-muted text-sm mt-1.5">{f.a}</p>
              </details>
            ))}
          </div>
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
      return <QuoteTrigger title={s.title || 'Solicite um orçamento'} />;
    }
    case 'concierge': {
      return <ConciergeIsland business={business} title={s.title || 'Precisa de ajuda?'} />;
    }
    default:
      // ('contact' aposentado: linhas legadas caem aqui e não renderizam)
      return null;
  }
}
