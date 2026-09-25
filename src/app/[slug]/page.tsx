import { BlockView, AboutView } from '@/components/public/ClinicContent';
import type { Metadata } from 'next';
import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicData } from '@/lib/public';
import { ThemeStyle } from '@/components/ThemeStyle';
import { Track } from '@/components/public/widgets';
import { money, waLink } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { ConciergeIsland } from '@/components/public/widgets2';
import { BottomBar } from '@/components/public/BottomBar';
import type { NavActionItem } from '@/components/public/menu';
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

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const data = await getPublicData(params.slug);
  if (!data) return { title: 'Página não encontrada — instalink.app' };
  const { business } = data;
  return {
    title: `${business.name} — instalink.app`,
    description: business.description || `Visite ${business.name} no instalink.app`,
    openGraph: {
      title: business.name,
      description: business.description || undefined,
      type: 'website',
      locale: 'pt_BR',
      siteName: 'instalink.app',
      ...(business.logo && business.logo.startsWith('http') ? { images: [business.logo] } : {}),
    },
  };
}

export default async function PublicPage({ params }: { params: { slug: string } }) {
  const data = await getPublicData(params.slug);
  if (!data || data.notFound) notFound();
  const { business, page, categories, products, options, optionValues, services, serviceCategories, professionals, reviews, isOwnerPreview, openNow } = data;

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

  // ── Navegação (menu configurável v2: âncoras + links externos) ──
  const aboutOk = isFeatureEnabled(business, 'about')
    && !!(business.about?.enabled && (business.about.title || business.about.text || business.about.image));
  const canBook = canBookPublic(business, services);
  const faqBlock = blocks.find((b) => b.type === 'faq');
  const hasFaq = !!faqBlock && visibleFaqItems(faqBlock.settings?.items).length > 0;
  const testiBlock = blocks.find((b) => b.type === 'testimonials');
  const testiItems: Array<{ name?: string; text?: string }> = Array.isArray(testiBlock?.settings?.items) ? testiBlock!.settings.items : [];
  const showWhatsapp = whatsappVisible(business);
  const socialLinks = availableSocialLinks(business);

  // Resolução ÚNICA (lib/nav.ts): configuração do lojista (nome/tipo/destino/
  // ordem/ativo) ∩ o que existe de verdade na página — âncora de seção vazia
  // ou rede não configurada não entra no menu.
  const NAV_ICON: Record<string, string> = {
    about: 'store', services: 'service', highlights: 'star', professionals: 'users',
    gallery: 'image', reviews: 'star', faq: 'chat', contact: 'pin', directions: 'pin',
    instagram: 'instagram', tiktok: 'music', facebook: 'facebook', youtube: 'youtube',
    linkedin: 'linkedin', site: 'external',
  };
  const navItems: NavActionItem[] = resolvedNavItems({
    business, blocks: allBlocks, services, products, reviews,
    hasFaq, hasTestimonialItems: testiItems.some((t) => t?.text),
    professionals,
  }).map((item) => ({
    id: item.id,
    label: item.label,
    icon: NAV_ICON[item.id] || 'pin',
    action: item.type === 'anchor'
      ? { kind: 'scroll', target: item.target }
      : { kind: 'link', url: item.target },
  }));

  // ── Agente de atendimento (configuração persistida da empresa) ──
  const agent = data.agent;
  const agentOn = agentActive(business as unknown as Business, agent);

  const btnStyle = business && page.theme.buttonStyle !== 'solid' ? ` il-style-${page.theme.buttonStyle}` : '';
  // CTA PRINCIPAL ÚNICO (regra do produto): o bloco "Ação principal" mora no
  // hero — nunca aparece repetido fora dele. O primeiro bloco cta define o
  // texto/destino do botão principal; o resto da página não repete o botão
  // (a barra inferior é o acesso persistente à conversão).
  const primaryCta = blocks.find((b) => b.type === 'cta');
  return (
    <main className={`il-page min-h-screen${btnStyle}`}>
      <ThemeStyle theme={page.theme} />
      <Track businessId={business.id} />

      {isOwnerPreview && (
        <div className="bg-amber-400 text-amber-950 text-center text-xs font-bold py-2 px-4">
          <span className="inline-flex items-center gap-1.5 justify-center"><Icon n="eye" size={14} /> Pré-visualização — sua página ainda não está publicada.</span> {/* A1.2 · Bloco 3: navegação interna via Link (sem recarregar a aplicação). */}
          <Link href="/pagina" className="underline">Publicar agora</Link>
        </div>
      )}

      {/* Capa/perfil full-bleed (ZERO margem no hero) — encosta topo+laterais;
          o card branco e o resto da página ficam no container de leitura. */}
      {profileIdx >= 0 && (
        <div className="w-full" data-public-hero="true">
          <BlockView
            block={blocks[profileIdx]}
            business={business}
            agent={agentOn ? { name: agent.name, greeting: renderGreeting(agent, business.name), enabled: agent.enabled } : null}
            catalog={{ categories, products, options, optionValues, services, serviceCategories, professionals, reviews }}
            extras={{
              canBook, socialLinks, showWhatsapp,
              openNow,
              primaryCta: primaryCta
                ? {
                    id: primaryCta.id,
                    label: String(primaryCta.settings?.label || 'Agendar horário'),
                    target: String(primaryCta.settings?.target || ''),
                  }
                : null,
            }}
          />
        </div>
      )}

      <div
        className="clinic-content mx-auto w-full max-w-[900px] px-5 sm:px-8 space-y-10"
        style={{ paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {blocks.map((block, i) => (
          block.type === 'profile' ? null : (
          <Fragment key={block.id}>
            <BlockView
              block={block}
              business={business}
              agent={agentOn ? { name: agent.name, greeting: renderGreeting(agent, business.name), enabled: agent.enabled } : null}
              catalog={{ categories, products, options, optionValues, services, serviceCategories, professionals, reviews }}
              extras={{
                canBook, socialLinks, showWhatsapp,
                openNow,
                primaryCta: primaryCta
                  ? {
                      id: primaryCta.id,
                      label: String(primaryCta.settings?.label || 'Agendar horário'),
                      target: String(primaryCta.settings?.target || ''),
                    }
                  : null,
              }}
            />
          </Fragment>
          )
        ))}
        {aboutOk && <AboutView about={business.about} />}

        {/* White label: a marca do NEGÓCIO manda; o GoDoutor fica discreto. */}
        <footer className="text-center pt-2 pb-1">
          {/* A1.2 · Bloco 3: link interno do rodapé via Link (navegação do Next,
              sem reload) — é interno ao app, não link externo. */}
          <Link href="/" className="il-muted text-[10px] font-medium opacity-70 hover:opacity-100 hover:underline">
            Feito com GoDoutor
          </Link>
        </footer>
      </div>

      <BottomBar business={business} navItems={navItems} canBook={canBook} />
      <SheetHost
        business={business}
        services={services}
        professionals={professionals}
      />
    </main>
  );
}
