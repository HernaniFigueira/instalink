'use client';
// ═══════════════════════════════════════════════════════════════
// VITRINE DE PRODUTOS (página pública) — NÃO é e-commerce
// ═══════════════════════════════════════════════════════════════
// Cada produto mostra foto, nome, descrição e preço (quando houver). A
// conversão é o botão "Tenho interesse", que abre o WhatsApp DO NEGÓCIO com
// mensagem contextualizada (nome do produto — e o preço, se existir).
// Nenhum pedido interno é criado: sem carrinho, sem checkout, sem options.
import { Icon } from '@/components/icons';
import type { Product, PublicBusiness } from '@/lib/types';
import { productInterestMessage, showcasePriceCents } from '@/lib/showcase';
import { money, waLink } from '@/lib/utils';
import { trackEvent } from './widgets';

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export function ProductShowcase({ business, products, categories, title, subtitle }: {
  business: PublicBusiness;
  products: Product[];
  categories: Array<{ id: string; name: string }>;
  title?: string;
  subtitle?: string;
}) {
  const active = products.filter((p) => p.active !== false);
  if (active.length === 0) return null;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name || '';
  const st = String(subtitle || '').trim();

  return (
    <section id="produtos" className="scroll-mt-20">
      <div className="mb-3">
        <h2 className="text-[19px] font-extrabold tracking-tight leading-snug">{title || 'Vitrine'}</h2>
        {st ? <p className="il-muted text-[13px] mt-0.5 leading-snug">{st}</p> : null}
      </div>
      {/* Grade EDITORIAL (não caixas): a foto é o protagonista — imagem em
          destaque com proporção constante, texto e preço em fluxo livre. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-5">
        {active.map((p) => {
          const price = showcasePriceCents(p);
          const href = business.whatsapp
            ? waLink(business.whatsapp, productInterestMessage(p))
            : '';
          return (
            <article key={p.id} className="flex flex-col">
              <div className="aspect-square overflow-hidden" style={{ borderRadius: 'calc(var(--il-radius) + 2px)' }}>
                {p.image ? (
                  <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 hover:scale-[1.04]" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xl font-extrabold"
                    style={{ background: 'color-mix(in srgb, var(--il-primary) 10%, transparent)', color: 'var(--il-primary)' }}>
                    {initials(p.name)}
                  </div>
                )}
              </div>
              <div className="pt-2.5 flex items-start justify-between gap-1.5">
                <p className="font-bold text-sm leading-tight line-clamp-2">{p.name}</p>
                {p.featured && <Icon n="star" size={12} className="text-amber-500 shrink-0 mt-0.5" />}
              </div>
              {p.description && <p className="il-muted text-xs line-clamp-2 mt-0.5">{p.description}</p>}
              <div className="mt-auto pt-1.5">
                {price > 0 ? (
                  <p className="font-extrabold il-accent text-sm">{money(price)}</p>
                ) : (
                  <p className="il-muted text-xs font-semibold">Sob consulta</p>
                )}
                {catName(p.categoryId) && <p className="il-muted text-[10px] font-bold uppercase tracking-wider mt-0.5">{catName(p.categoryId)}</p>}
              </div>
              {href ? (
                <a
                  href={href} target="_blank" rel="noreferrer"
                  onClick={() => trackEvent(business.id, 'whatsapp_click', { from: 'vitrine', productId: p.id, kind: 'product_interest' })}
                  className="il-btn block text-center text-xs font-extrabold px-3 py-2.5 mt-2"
                >
                  Tenho interesse
                </a>
              ) : (
                <p className="il-muted text-[10px] mt-2">Fale com o negócio para saber mais.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
