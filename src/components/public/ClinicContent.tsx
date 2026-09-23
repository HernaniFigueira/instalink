import Link from 'next/link';
import { money, waLink } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { ConciergeIsland } from '@/components/public/widgets2';
import { CtaButton, QuoteTrigger, ServiceAgendarButton, SheetHost, Stars } from '@/components/public/customer';
import { ProductShowcase } from '@/components/public/showcase';
import { FaqAccordion } from '@/components/public/FaqAccordion';
import { visibleFaqItems } from '@/lib/faq';
import { availableSocialLinks, resolvedNavItems } from '@/lib/nav';
import { agentActive, renderGreeting } from '@/lib/agent';
import { priceVisible } from '@/lib/pricing';
import type { OpenStatus } from '@/lib/hours';
import {
  canBook as canBookPublic, isFeatureEnabled, productsVisible, servicesVisible, visibleBlocks,
  whatsappVisible,
} from '@/lib/features';
import type { Block, Business, PublicBusiness, Review } from '@/lib/types';

function initials(name: string): string {
  // Ignora conectivos de nome ("do", "da", "de"...): Barbearia do João → BJ,
  // não "BD". Duas letras bastam para o selo do hero.
  const words = name.split(/\s+/).filter((w) => w && w.length > 2 && !/^(do|da|de|das|dos|e)$/i.test(w));
  const pool = words.length ? words : name.split(/\s+/).filter(Boolean);
  return pool.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export function AboutView({ about }: { about: { title: string; text: string; image: string } }) {
  return (
    <section id="sobre" className="scroll-mt-20">
      {about.image ? (
        <img src={about.image} alt={about.title || 'Sobre'} loading="lazy"
          className="w-full h-48 sm:h-72 object-cover mb-4"
          style={{ borderRadius: 'calc(var(--il-radius) + 4px)' }} />
      ) : null}
      {about.title && <h2 className="text-[19px] font-extrabold tracking-tight leading-snug">{about.title}</h2>}
      {about.text && <p className="il-muted text-[15px] mt-2 whitespace-pre-line leading-relaxed">{about.text}</p>}
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

// Ícones públicos por rede/seção (hero e menu).
const NAV_ICON_PUBLIC: Record<string, string> = {
  instagram: 'instagram', tiktok: 'music', facebook: 'facebook', youtube: 'youtube',
  linkedin: 'linkedin', site: 'external',
};

// O botão principal mora no hero. Se o lojista configurou o bloco "Ação
// principal", o rótulo/destino dele é que valem; senão, o padrão do produto
// (Agendar atendimento) — sempre respeitando os módulos ativos.
function HeroCta({ business, cta }: {
  business: PublicBusiness;
  cta: { id: string; label: string; target: string } | null;
}) {
  return (
    <CtaButton
      business={business}
      label={cta?.label?.trim() || 'Agendar atendimento'}
      target={cta?.target || ''}
    />
  );
}

// Cabeçalho editorial uniforme das seções (título + subtítulo opcional).
function SectionHead({ title, subtitle, fallback }: { title?: string; subtitle?: string; fallback: string }) {
  const t = String(title || '').trim() || fallback;
  const st = String(subtitle || '').trim();
  return (
    <div className="mb-3">
      <h2 className="text-[19px] font-extrabold tracking-tight leading-snug">{t}</h2>
      {st ? <p className="il-muted text-[13px] mt-0.5 leading-snug">{st}</p> : null}
    </div>
  );
}

export function BlockView({ block, business, agent, catalog, extras }: {
  block: Block;
  business: PublicBusiness;
  agent: { name: string; greeting: string; enabled: boolean } | null;
  catalog: {
    categories: any[]; products: any[]; options: any[]; optionValues: any[];
    services: any[]; serviceCategories: any[]; professionals: any[]; reviews: Review[];
  };
  extras: {
    canBook: boolean;
    socialLinks: Array<{ id: string; label: string; url: string }>;
    showWhatsapp: boolean;
    /** A2-B5 (F3): "Aberto agora" calculado no servidor (Availability+exceptions). */
    openNow?: OpenStatus | null;
    /** O bloco cta absorvido pelo hero (CTA principal único). */
    primaryCta?: { id: string; label: string; target: string } | null;
  };
}) {
  const s = block.settings || {};

  switch (block.type) {
    case 'profile': {
      // A2-B5 (F3): status vem do servidor pela MESMA fonte da Agenda
      // (Availability + exceptions, fuso do negócio) — Business.hours não
      // é mais regra operacional aqui.
      const status = extras.openNow ?? null;
      return (
        <section className="pub-hero">
          {/* HOMOLOGAÇÃO · P1 — geometria padrão aprovada:
              CAPA full-width → conteúdo branco sobe com cantos superiores
              arredondados → avatar circular atravessa a transição. */}
          {business.cover ? (
            <div className="pub-hero__cover">
              <img src={business.cover} alt={`Foto de ${business.name}`} className="w-full h-52 sm:h-72 object-cover" />
            </div>
          ) : null}
          <div className={`pub-hero__sheet${business.cover ? ' pub-hero__sheet--overlap' : ''}`}>
            <div className={`flex justify-center ${business.cover ? 'relative z-10 -mt-11 sm:-mt-14' : 'pt-2'}`}>
              {business.logo
                ? <span className="pub-avatar pub-avatar--ring"><img src={business.logo} alt={`Logo de ${business.name}`} /></span>
                : <span className="pub-avatar pub-avatar--initials pub-avatar--ring" style={{ color: 'var(--il-primary)' }}>{initials(business.name)}</span>}
            </div>
            <div className="text-center mt-2.5">
              <h1 className="text-[30px] sm:text-[40px] leading-tight font-extrabold tracking-tight">{business.name}</h1>
              {business.description && <p className="il-muted text-sm mt-1.5 max-w-xl mx-auto leading-snug">{business.description}</p>}
              {(business.address || status) && (
                <div className="mt-2.5 flex items-center justify-center flex-wrap gap-1.5">
                  {business.address && (
                    <span className="il-card inline-flex items-center gap-1 text-[11px] font-semibold il-muted px-2.5 py-1">
                      <Icon n="pin" size={12} /> {business.address.split(',')[0]}
                    </span>
                  )}
                  {status && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
                      style={{
                        background: status.open ? 'rgba(34,197,94,0.12)' : 'color-mix(in srgb, var(--il-muted) 14%, transparent)',
                        color: status.open ? '#15803d' : 'var(--il-muted)',
                      }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.open ? '#22c55e' : 'var(--il-muted)' }} />
                      {status.label}
                    </span>
                  )}
                </div>
              )}
              {(extras.socialLinks.length > 0 || extras.showWhatsapp) && (
                <div className="mt-3 flex items-center justify-center flex-wrap gap-2">
                  {extras.socialLinks.map((l) => (
                    <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
                      aria-label={l.label} title={l.label}
                      className="il-muted w-9 h-9 flex items-center justify-center"
                      style={{ borderRadius: 'var(--il-radius)', border: '1px solid color-mix(in srgb, var(--il-muted) 24%, transparent)' }}>
                      <Icon n={NAV_ICON_PUBLIC[l.id] || 'external'} size={16} />
                    </a>
                  ))}
                  {/* WhatsApp entra aqui APENAS como rede social discreta; a ação
                      completa de conversa vive na barra inferior (sem botões
                      WhatsApp repetidos pela página). */}
                  {extras.showWhatsapp && (
                    <a href={waLink(business.whatsapp, `Olá! Vim pelo site da ${business.name}.`)} target="_blank" rel="noreferrer"
                      aria-label="WhatsApp" title="WhatsApp"
                      className="il-muted w-9 h-9 flex items-center justify-center"
                      style={{ borderRadius: 'var(--il-radius)', border: '1px solid color-mix(in srgb, var(--il-muted) 24%, transparent)' }}>
                      <Icon n="whatsapp" size={16} />
                    </a>
                  )}
                </div>
              )}
              {/* CTA PRINCIPAL: um único botão de conversão acima da dobra —
                  "Agendar atendimento" é o centro do produto (módulo manda). */}
              <div className="mt-4">
                <HeroCta business={business} cta={extras.primaryCta ?? null} />
              </div>
            </div>
          </div>
        </section>
      );
    }
    case 'cta': {
      // O bloco-CTA ativo mais próximo do topo É o CTA do hero — não é
      // renderizado de novo abaixo dele (regra: um único CTA principal).
      if (block.id === (extras.primaryCta?.id || '')) return null;
      return (
        <section className="il-card p-5 text-center">
          <p className="font-extrabold text-base mb-3">{s.title || s.label || 'Fale com a gente'}</p>
          <CtaButton business={business} label={s.label || 'Começar'} target={s.target || ''} />
        </section>
      );
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
      // Texto livre = seção editorial (tipografia + respiro), não uma caixa.
      return (
        <section>
          {s.title && <h2 className="text-[19px] font-extrabold tracking-tight leading-snug">{s.title}</h2>}
          {s.body && <p className="il-muted text-[15px] mt-2 whitespace-pre-line leading-relaxed">{s.body}</p>}
        </section>
      );
    }
    case 'image': {
      if (!s.url) return null;
      const img = <img src={s.url} alt={s.alt || business.name} loading="lazy" className="w-full object-cover" style={{ borderRadius: 'var(--il-radius)' }} />;
      return s.link ? <a href={s.link} target="_blank" rel="noreferrer" className="block">{img}</a> : <div>{img}</div>;
    }
    case 'gallery': {
      // Normalização defensiva: aceita strings e objetos {url} legados —
      // a galeria salva no editor SEMPRE encontra caminho até o <img>.
      const imgs: string[] = (Array.isArray(s.images) ? s.images : [])
        .map((x: any) => (typeof x === 'string' ? x : String(x?.url || '')))
        .filter(Boolean);
      if (imgs.length === 0) return null;
      return (
        <section id="espaco" className="scroll-mt-20">
          <SectionHead title={s.title} subtitle={s.subtitle} fallback="Conheça o espaço" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {imgs.slice(0, 6).map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer"
                aria-label={`Ampliar foto ${i + 1} de ${business.name}`}
                className="block overflow-hidden active:opacity-90"
                style={{ borderRadius: 'var(--il-radius)' }}>
                <img src={url} alt={`${business.name} — foto ${i + 1}`} loading="lazy" className="w-full h-32 object-cover transition-transform duration-300 hover:scale-[1.03]" />
              </a>
            ))}
          </div>
        </section>
      );
    }
    case 'professionals': {
      // Profissionais ATIVOS do negócio — quem realiza os atendimentos.
      const list = (catalog.professionals || []).filter((p: any) => p.active !== false);
      if (list.length === 0) return null;
      // Equipe leve: retrato + nome + função, sem card — as pessoas são o
      // conteúdo, não uma caixa em volta delas.
      return (
        <section id="profissionais" className="scroll-mt-20">
          <SectionHead title={s.title} subtitle={s.subtitle} fallback="Nossa equipe" />
          <div className="flex gap-5 overflow-x-auto pb-1 snap-x -mx-1 px-1">
            {list.map((p: any) => (
              <figure key={p.id} className="w-32 shrink-0 snap-start flex flex-col items-center text-center gap-2.5">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-zinc-100 flex items-center justify-center font-extrabold text-lg"
                  style={{
                    background: 'color-mix(in srgb, var(--il-primary) 12%, var(--il-surface))',
                    color: 'var(--il-primary)',
                    boxShadow: '0 0 0 3px var(--il-bg), 0 0 0 4.5px color-mix(in srgb, var(--il-muted) 20%, transparent)',
                  }}>
                  {p.photo ? <img src={p.photo} alt={p.name} loading="lazy" className="w-full h-full object-cover" /> : p.name.slice(0, 1).toUpperCase()}
                </div>
                <figcaption className="min-w-0 w-full break-words">
                  <p className="font-bold text-sm leading-tight break-words">{p.name}</p>
                  {p.role && <p className="il-muted text-xs mt-0.5 leading-tight">{p.role}</p>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      );
    }
    case 'highlights': {
      // Diferenciais — bloco EDITÁVEL (título + itens). Vazio não renderiza.
      const items: Array<{ icon?: string; title?: string; text?: string }> = Array.isArray(s.items) ? s.items : [];
      const filled = items.filter((x) => String(x?.title || '').trim());
      if (filled.length === 0) return null;
      // Diferenciais como lista editorial (ícone + tipografia + espaço) —
      // sem caixas em volta de cada item.
      return (
        <section id="diferenciais" className="scroll-mt-20">
          <SectionHead title={s.title} subtitle={s.subtitle} fallback="Por que escolher a gente" />
          <div className="space-y-4">
            {filled.map((x, i) => (
              <div key={i} className="flex items-start gap-3.5">
                <span className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center mt-0.5"
                  style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}>
                  <Icon n={x.icon || 'checkCircle'} size={17} />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-sm leading-tight">{x.title}</p>
                  {x.text && <p className="il-muted text-xs mt-1 leading-snug">{x.text}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case 'products': {
      // Módulo desativado nunca renderiza (mesmo com bloco legado habilitado).
      // VITRINE (não e-commerce): produtos com CTA "Tenho interesse" → WhatsApp
      // do negócio. Carrinho/checkout saíram da experiência; o título legado
      // salvo no bloco continua sendo usado se existir.
      if (!productsVisible(business, catalog.products)) return null;
      return (
        <ProductShowcase
          business={business}
          products={catalog.products}
          categories={catalog.categories}
          title={s.title || 'Vitrine'}
          subtitle={s.subtitle}
        />
      );
    }
    case 'services': {
      const list = catalog.services;
      if (list.length === 0) return null;
      const grouped = catalog.serviceCategories.length > 0;
      // Agenda ligada ⇒ botão Agendar por serviço (módulo, não apresentação).
      const canBook = canBookPublic(business, list);
      const divider = 'color-mix(in srgb, var(--il-muted) 16%, transparent)';
      // LISTA EDITORIAL (padrão): linhas com espaço e divisores — nunca uma
      // pilha de caixas. O modo CARROSSEL (muitos serviços) continua visual:
      // ali o card ajuda (foto grande), por isso é o único que o mantém.
      const card = (sv: any, wide: boolean) => wide ? (
        <div key={sv.id} className="il-card p-4 w-60 shrink-0 snap-start flex flex-col gap-2.5">
          {sv.image ? <img src={sv.image} alt={sv.name} loading="lazy" className="w-full h-28 object-cover" style={{ borderRadius: 'var(--il-radius)' }} /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-bold flex items-center gap-1.5">{sv.name} {sv.featured && <Icon n="star" size={13} className="shrink-0 text-amber-500" />}</p>
            {sv.description && <p className="il-muted text-xs truncate">{sv.description}</p>}
            {/* Duração não é pública; preço só quando o serviço libera (showPrice). */}
          </div>
          <div className="flex items-center justify-between gap-2 w-full">
            {priceVisible(sv) && <p className="font-extrabold il-accent">{money(sv.price)}</p>}
            {canBook && sv.bookable !== false && (
              <ServiceAgendarButton serviceId={sv.id} serviceName={sv.name} />
            )}
          </div>
        </div>
      ) : (
        <div key={sv.id} className="flex justify-between items-center gap-3 py-3.5 first:pt-1 last:pb-0 border-b last:border-b-0" style={{ borderColor: divider }}>
          {sv.image ? <img src={sv.image} alt={sv.name} loading="lazy" className="w-14 h-14 object-cover shrink-0" style={{ borderRadius: 'calc(var(--il-radius) - 2px)' }} /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-bold flex items-center gap-1.5">{sv.name} {sv.featured && <Icon n="star" size={13} className="shrink-0 text-amber-500" />}</p>
            {sv.description && <p className="il-muted text-xs truncate">{sv.description}</p>}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            {priceVisible(sv) && <p className="font-extrabold il-accent">{money(sv.price)}</p>}
            {canBook && sv.bookable !== false && (
              <ServiceAgendarButton serviceId={sv.id} serviceName={sv.name} />
            )}
          </div>
        </div>
      );
      const carousel = !grouped && list.length >= 5;
      return (
        <section id="servicos" className="scroll-mt-20">
          <SectionHead title={s.title} subtitle={s.subtitle} fallback="Serviços" />
          {carousel ? (
            <div className="flex gap-2.5 overflow-x-auto pb-1 snap-x -mx-1 px-1">
              {list.map((sv: any) => card(sv, true))}
            </div>
          ) : grouped ? (
            <div>
              {catalog.serviceCategories.map((cat: any) => {
                const items = list.filter((x: any) => x.categoryId === cat.id);
                if (items.length === 0) return null;
                return (
                  <div key={cat.id} className="mt-5 first:mt-0">
                    <p className="text-xs font-extrabold uppercase tracking-wider il-muted pb-1">{cat.name}</p>
                    {items.map((sv: any) => card(sv, false))}
                  </div>
                );
              })}
              {list.filter((x: any) => !x.categoryId).map((sv: any) => card(sv, false))}
            </div>
          ) : (
            <div>
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
      // Fundo sutil em vez de card com borda — mais leve, mesma leitura.
      const card = 'w-[82%] xs:w-72 sm:w-72 shrink-0 snap-start p-4 flex flex-col';
      const cardStyle = {
        background: 'color-mix(in srgb, var(--il-muted) 7%, transparent)',
        borderRadius: 'var(--il-radius)',
      };
      return (
        <section id="avaliacoes" className="scroll-mt-20">
          <SectionHead title={s.title} subtitle={s.subtitle} fallback="O que dizem por aí" />
          <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory" role="list" aria-label="Avaliações">
            {dyn.length > 0 ? (
              dyn.map((r) => (
                <figure key={r.id} role="listitem" className={card} style={cardStyle}>
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
                <figure key={i} role="listitem" className={card} style={cardStyle}>
                  <blockquote className="text-sm line-clamp-4">“{t.text}”</blockquote>
                  {t.name && <figcaption className="il-muted text-xs font-bold mt-auto pt-2 truncate">— {t.name}</figcaption>}
                </figure>
              ))
            )}
          </div>
          {business.googleUrl && (
            <a href={business.googleUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 font-bold text-sm mt-3 px-4 py-2 il-accent"
              style={{ borderRadius: 'var(--il-radius)', border: '1px solid color-mix(in srgb, var(--il-primary) 30%, transparent)' }}>
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
          <SectionHead title={s.title} subtitle={s.subtitle} fallback="Dúvidas frequentes" />
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
          <SectionHead title={s.title} subtitle={s.subtitle} fallback="Onde estamos" />
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
    case 'whatsapp': return null; // a barra inferior é o ponto único do WhatsApp
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
