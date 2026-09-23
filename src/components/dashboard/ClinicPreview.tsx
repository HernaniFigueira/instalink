'use client';
import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComponentProps } from 'react';
import type { Business, Page } from '@/lib/types';
import { BlockView, AboutView } from '@/components/public/ClinicContent';
import { ThemeStyle } from '@/components/ThemeStyle';
import { toPublicBusiness } from '@/lib/public-business';
import { canBook, visibleBlocks, whatsappVisible, isFeatureEnabled } from '@/lib/features';
import { BottomBarView } from '@/components/public/BottomBar';
import { bottomBarItems } from '@/lib/bottombar';
import { visibleFaqItems } from '@/lib/faq';
import { availableSocialLinks, resolvedNavItems } from '@/lib/nav';

type Catalog = ComponentProps<typeof BlockView>['catalog'];
export function ClinicPreview({ business, page, catalog }: { business: Business; page: Page; catalog: Catalog }) {
  const [wide, setWide] = useState(false);
  const [menu, setMenu] = useState(false);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const publicBusiness = toPublicBusiness(business);
  const blocks = visibleBlocks(publicBusiness, [...page.blocks].sort((a,b) => a.order - b.order));
  const nav = resolvedNavItems({ business: publicBusiness, blocks: page.blocks, services: catalog.services, products: catalog.products, professionals: catalog.professionals, reviews: catalog.reviews, hasFaq: blocks.some(b => b.type === 'faq' && visibleFaqItems(b.settings?.items).length > 0), hasTestimonialItems: blocks.some(b => b.type === 'testimonials' && Array.isArray(b.settings?.items) && b.settings.items.some((i: any) => i.text)) });
  const cta = blocks.find(b => b.type === 'cta');
  const about = publicBusiness.about;
  const aboutVisible = isFeatureEnabled(publicBusiness, 'about') && about.enabled && !!(about.title || about.text || about.image);
  return <section className="bg-white border border-[var(--border)] rounded-lg p-4 mt-4">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-3"><div><h2 className="font-semibold text-sm">Prévia das alterações</h2><p className="text-xs text-[var(--text-muted)] mt-1">Conteúdo real em edição, sem salvar ou fazer reservas. Ações desativadas nesta prévia.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={menu} onClick={() => setMenu(!menu)} className="il-control px-3 rounded-md border">Ver menu</button><button type="button" data-preview-device="mobile" aria-pressed={!wide} onClick={() => setWide(false)} className="il-control px-3 rounded-md border">Celular</button><button type="button" data-preview-device="desktop" aria-pressed={wide} onClick={() => setWide(true)} className="il-control px-3 rounded-md border">Desktop</button></div>
    </div>
    <div className="overflow-x-auto bg-[var(--surface-3)] rounded-lg p-2">
      <iframe title="Prévia local da página em edição" sandbox="allow-same-origin" srcDoc="<!doctype html><html lang='pt-BR'><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body></body></html>"
        style={{ width: wide ? 1000 : 390, maxWidth: wide ? undefined : '100%', height: 600, border: 0, margin: '0 auto', display: 'block' }}
        onLoad={event => { const doc = event.currentTarget.contentDocument; if (!doc) return;
          doc.documentElement.className = document.documentElement.className;
          document.querySelectorAll('style,link[rel="stylesheet"]').forEach(node => doc.head.appendChild(node.cloneNode(true)));
          setBody(doc.body);
        }} />
      {body && createPortal(<main className={`il-page min-h-screen${page.theme.buttonStyle !== 'solid' ? ` il-style-${page.theme.buttonStyle}` : ''}`} ref={el => { if (el) el.inert = true; }}>
        <ThemeStyle theme={page.theme} />
        <div className="clinic-content mx-auto w-full max-w-[900px] px-5 sm:px-8 pt-6 sm:pt-10 pb-24 space-y-10">
          {blocks.map(block => <Fragment key={block.id}><BlockView block={block} business={publicBusiness} agent={null} catalog={catalog}
            extras={{ canBook: canBook(publicBusiness, catalog.services), showWhatsapp: whatsappVisible(publicBusiness), socialLinks: availableSocialLinks(publicBusiness), primaryCta: cta ? { id: cta.id, label: String(cta.settings?.label || 'Agendar atendimento'), target: String(cta.settings?.target || '') } : null }} />
            {block.type === 'profile' && aboutVisible && <AboutView about={about} />}</Fragment>)}
          {!blocks.some(b => b.type === 'profile') && aboutVisible && <AboutView about={about} />}
        </div>
        {menu && <aside aria-label="Menu nesta prévia" className="fixed inset-x-3 bottom-20 z-40 il-card p-5"><h2 className="font-bold mb-3">Menu</h2><ul className="space-y-3">{nav.map(item => <li key={item.id}>{item.label}</li>)}</ul>{!nav.length && <p className="il-muted">Nenhuma seção preenchida no menu.</p>}</aside>}
        <BottomBarView items={bottomBarItems({canBook:canBook(publicBusiness,catalog.services),whatsapp:whatsappVisible(publicBusiness)})} menuOpen={menu}/>
      </main>, body)}
    </div>
  </section>;
}
