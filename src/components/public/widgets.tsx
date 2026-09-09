'use client';
import { useEffect, useMemo, useState } from 'react';
import { closeSheet, openSheet } from './sheet-bus';
import { useCustomerForm } from './use-customer-form';
import { Icon } from '@/components/icons';
import type { Business, PublicBusiness, Category, Product, ProductOption, ProductOptionValue, Professional, Service } from '@/lib/types';
import { money, waLink } from '@/lib/utils';

// Re-exportados para os demais widgets do cliente.
// (Código de servidor NUNCA deve importar helpers deste módulo 'use client';
//  deve importar direto de @/lib/utils.)
export { money, waLink };

// ── helpers ────────────────────────────────────────────────

function visitorId(): string {
  try {
    let v = localStorage.getItem('il-vid');
    if (!v) {
      v = 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('il-vid', v);
    }
    return v;
  } catch {
    return '';
  }
}

export function trackEvent(businessId: string, type: string, meta: Record<string, any> = {}) {
  try {
    const vid = visitorId();
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, type, path: window.location.pathname, meta: { ...meta, vid } }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* noop */ }
}

export function Track({ businessId }: { businessId: string }) {
  useEffect(() => {
    // 1 page_view por sessão (evita 1 escrita por visita).
    try {
      const key = `il-pv-${businessId}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* sem storage: registra mesmo assim */ }
    trackEvent(businessId, 'page_view');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);
  return null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-extrabold tracking-tight mb-3">{children}</h2>;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// ── CATÁLOGO + CARRINHO + CHECKOUT ─────────────────────────
interface CartItem {
  key: string;
  productId: string;
  qty: number;
  options: Array<{ optionId: string; valueIds: string[] }>;
  note: string;
}

export function CatalogIsland({ business, products, categories, options, values, bare }: {
  business: PublicBusiness;
  products: Product[];
  categories: Category[];
  options: ProductOption[];
  values: ProductOptionValue[];
  bare?: boolean;
}) {
  const [cat, setCat] = useState<string>('');
  const [open, setOpen] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(`il-cart-${business.id}`) || '[]'); } catch { return []; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(`il-cart-${business.id}`, JSON.stringify(cart)); } catch { /* noop */ }
  }, [cart, business.id]);

  const filtered = useMemo(() => {
    const list = cat ? products.filter((p) => p.categoryId === cat) : products;
    return list;
  }, [cat, products]);

  const basePrice = (p: Product) => (p.promoPrice > 0 ? p.promoPrice : p.price);

  function unitFor(item: CartItem): number {
    const p = products.find((x) => x.id === item.productId);
    if (!p) return 0;
    let unit = basePrice(p);
    for (const sel of item.options) {
      for (const vid of sel.valueIds) {
        const v = values.find((x) => x.id === vid);
        if (v) unit += v.priceDelta;
      }
    }
    return unit;
  }

  const total = cart.reduce((s, i) => s + unitFor(i) * i.qty, 0);
  const count = cart.reduce((s, i) => s + i.qty, 0);

  if (products.length === 0) return null;

  return (
    <div id="produtos" className="scroll-mt-20">
      {!bare && <SectionTitle>{business.niche === 'alimentacao' ? 'Cardápio' : 'Produtos'}</SectionTitle>}

      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
          <button onClick={() => setCat('')}
            className={`shrink-0 text-sm font-bold px-4 py-2 rounded-full border ${cat === '' ? 'il-chip-active border-transparent' : 'il-card'}`}>
            Todos
          </button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={`shrink-0 text-sm font-bold px-4 py-2 rounded-full border ${cat === c.id ? 'il-chip-active border-transparent' : 'il-card'}`}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((p) => (
          <button key={p.id} onClick={() => { setOpen(p); trackEvent(business.id, 'product_view', { productId: p.id }); }}
            className="il-card w-full text-left p-3.5 flex gap-3 items-center active:scale-[0.99] transition-transform">
            <div className="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center font-extrabold text-lg overflow-hidden"
              style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}>
              {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" loading="lazy" /> : initials(p.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate flex items-center gap-1.5">{p.name} {p.featured && <Icon n="star" size={13} className="shrink-0 text-amber-500" />}</p>
              {p.description && <p className="il-muted text-xs truncate">{p.description}</p>}
              <p className="mt-1 font-extrabold il-accent">
                {money(basePrice(p))}
                {p.promoPrice > 0 && <span className="il-muted text-xs line-through font-normal ml-2">{money(p.price)}</span>}
              </p>
            </div>
            <span className="il-btn text-sm font-bold px-4 py-2 shrink-0">Ver</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="il-muted text-sm text-center py-6">Nenhum item nesta categoria.</p>}
      </div>

      {open && (
        <ProductModal
          business={business} product={open}
          options={options.filter((o) => o.productId === open.id)}
          values={values}
          onClose={() => setOpen(null)}
          onAdd={(item) => {
            setCart((c) => [...c, item]);
            trackEvent(business.id, 'product_add', { productId: open.id });
            if (cart.length === 0) trackEvent(business.id, 'cart_created');
            setOpen(null);
          }}
        />
      )}

      {count > 0 && !cartOpen && !checkout && (
        <button onClick={() => setCartOpen(true)}
          className="il-btn fixed bottom-5 left-1/2 -translate-x-1/2 z-40 font-extrabold px-6 py-3.5 shadow-2xl flex items-center gap-2">
          <Icon n="bag" size={18} /> Ver carrinho · {count} {count === 1 ? 'item' : 'itens'} · {money(total)}
        </button>
      )}

      {(cartOpen || checkout) && (
        <CartDrawer
          business={business} cart={cart} products={products} values={values}
          unitFor={unitFor} total={total} checkout={checkout}
          setCheckout={setCheckout}
          onClose={() => { setCartOpen(false); setCheckout(false); }}
          onQty={(key, d) => setCart((c) => c.map((i) => (i.key === key ? { ...i, qty: Math.max(1, Math.min(50, i.qty + d)) } : i)))}
          onRemove={(key) => setCart((c) => c.filter((i) => i.key !== key))}
          onDone={() => { setCart([]); setCartOpen(false); setCheckout(false); }}
        />
      )}
    </div>
  );
}

function ProductModal({ business, product, options, values, onClose, onAdd }: {
  business: PublicBusiness;
  product: Product;
  options: ProductOption[];
  values: ProductOptionValue[];
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const base = product.promoPrice > 0 ? product.promoPrice : product.price;

  function toggle(opt: ProductOption, valueId: string) {
    setSel((prev) => {
      const cur = prev[opt.id] || [];
      if (opt.multiple) {
        const next = cur.includes(valueId) ? cur.filter((v) => v !== valueId) : [...cur, valueId];
        if (opt.max > 0 && next.length > opt.max) return prev;
        return { ...prev, [opt.id]: next };
      }
      return { ...prev, [opt.id]: cur.includes(valueId) ? [] : [valueId] };
    });
  }

  const delta = Object.values(sel).flat().reduce((s, vid) => s + (values.find((v) => v.id === vid)?.priceDelta || 0), 0);

  function add() {
    setError('');
    for (const opt of options) {
      const picked = sel[opt.id] || [];
      if (opt.required && picked.length === 0) { setError(`Escolha: ${opt.name}.`); return; }
      if (picked.length < opt.min) { setError(`Escolha ao menos ${opt.min} em "${opt.name}".`); return; }
    }
    onAdd({
      key: `${product.id}-${Date.now()}`,
      productId: product.id, qty,
      options: Object.entries(sel).map(([optionId, valueIds]) => ({ optionId, valueIds })),
      note: note.slice(0, 200),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="il-page relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5" style={{ background: 'var(--il-surface)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold">{product.name}</h3>
            {product.description && <p className="il-muted text-sm mt-0.5">{product.description}</p>}
            <p className="mt-1.5 font-extrabold text-lg il-accent">{money(base)}
              {product.promoPrice > 0 && <span className="il-muted text-sm line-through font-normal ml-2">{money(product.price)}</span>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="il-card w-9 h-9 shrink-0 font-bold flex items-center justify-center"><Icon n="x" size={16} /></button>
        </div>

        {options.map((opt) => (
          <div key={opt.id} className="mt-5">
            <p className="font-bold text-sm">{opt.name} {opt.required && <span className="il-accent">*</span>}
              {opt.multiple && <span className="il-muted font-normal"> · escolha mais de um</span>}
            </p>
            <div className="mt-2 space-y-2">
              {values.filter((v) => v.optionId === opt.id).map((v) => {
                const active = (sel[opt.id] || []).includes(v.id);
                return (
                  <button key={v.id} onClick={() => toggle(opt, v.id)}
                    className={`w-full text-left text-sm font-medium px-4 py-2.5 border flex justify-between gap-2 ${active ? 'il-chip-active border-transparent' : 'il-card'}`}
                    style={{ borderRadius: 'var(--il-radius)' }}>
                    <span>{v.name}</span>
                    {v.priceDelta > 0 && <span className="font-bold">+{money(v.priceDelta)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-5">
          <label className="font-bold text-sm" htmlFor="obs">Observação</label>
          <input id="obs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: sem cebola"
            className="il-card mt-1.5 w-full text-sm px-4 py-2.5 outline-none" />
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}

        <div className="mt-5 flex items-center gap-3">
          <div className="il-card flex items-center gap-3 px-3 py-2">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="font-extrabold text-lg px-1" aria-label="Diminuir">−</button>
            <span className="font-extrabold min-w-[1.5rem] text-center">{qty}</span>
            <button onClick={() => setQty((q) => Math.min(50, q + 1))} className="font-extrabold text-lg px-1" aria-label="Aumentar">+</button>
          </div>
          <button onClick={add} className="il-btn flex-1 font-extrabold py-3.5">
            Adicionar · {money((base + delta) * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartDrawer({ business, cart, products, values, unitFor, total, checkout, setCheckout, onClose, onQty, onRemove, onDone }: {
  business: PublicBusiness;
  cart: CartItem[];
  products: Product[];
  values: ProductOptionValue[];
  unitFor: (i: CartItem) => number;
  total: number;
  checkout: boolean;
  setCheckout: (v: boolean) => void;
  onClose: () => void;
  onQty: (key: string, d: number) => void;
  onRemove: (key: string) => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<'delivery' | 'pickup'>('pickup');
  const [address, setAddress] = useState('');
  const [payment, setPayment] = useState(business.paymentMethods?.[0] || 'pix');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ code: string } | null>(null);
  const [pixKey, setPixKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useCustomerForm();

  const fee = type === 'delivery' ? (business.deliveryFee || 0) : 0;
  const grand = total + fee;
  const minOrder = business.minOrder || 0;
  const belowMin = minOrder > 0 && total < minOrder;

  useEffect(() => {
    if (checkout && payment === 'pix' && pixKey === null) {
      fetch(`/api/checkout-info?businessId=${business.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPixKey(d?.pixKey || ''))
        .catch(() => setPixKey(''));
    }
  }, [checkout, payment, business.id, pixKey]);

  const payLabels: Record<string, string> = { pix: 'PIX', card: 'Cartão', cash: 'Dinheiro', on_delivery: 'Na entrega' };

  function labelFor(item: CartItem): string {
    const names: string[] = [];
    for (const sel of item.options) {
      for (const vid of sel.valueIds) {
        const v = values.find((x) => x.id === vid);
        if (v) names.push(v.name);
      }
    }
    return names.join(', ');
  }

  function copyPix() {
    if (!pixKey) return;
    try {
      navigator.clipboard.writeText(pixKey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    } catch { /* noop */ }
  }

  async function submit() {
    setError('');
    if (!form.logged) {
      if (!form.name.trim()) { setError('Informe seu nome.'); return; }
      if (form.phone.replace(/\D/g, '').length < 10) { setError('Informe um WhatsApp válido.'); return; }
    }
    if (!(await form.ensure({ phone: true }))) { form.afterAuth(() => submit()); return; }
    setLoading(true);
    try {
      trackEvent(business.id, 'checkout_started');
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id, customerName: form.name, customerPhone: form.phone,
          type, customerAddress: address, payment, note, items: cart,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'login_required') {
          openSheet('auth', {});
          form.afterAuth(() => submit());
          return;
        }
        throw new Error(data.error);
      }
      setDone({ code: data.code });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="il-page relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5" style={{ background: 'var(--il-surface)' }}>
        {done ? (
          <div className="text-center py-8">
            <span className="inline-flex w-16 h-16 rounded-full items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="checkCircle" size={32} /></span>
            <h3 className="text-xl font-extrabold mt-3">Pedido {done.code} recebido!</h3>
            <p className="il-muted text-sm mt-1">Obrigado, {form.name.split(' ')[0]}! Acompanhe pelo WhatsApp.</p>
            <div className="mt-5 space-y-2">
              {business.whatsapp && (
                <a className="il-btn block font-extrabold py-3.5" target="_blank" rel="noreferrer"
                  href={waLink(business.whatsapp, `Olá! Fiz o pedido ${done.code} no site (${form.name}).`)}
                  onClick={() => trackEvent(business.id, 'whatsapp_click', { from: 'order_success' })}>
                  Enviar no WhatsApp
                </a>
              )}
              <button onClick={() => openSheet('account', {})} className="il-card w-full font-bold py-3 inline-flex items-center justify-center gap-2"><Icon n="receipt" size={17} /> Acompanhar pedido</button>
              <button onClick={() => { onDone(); closeSheet(); }} className="il-card w-full font-bold py-3">Voltar à página</button>
            </div>
          </div>
        ) : !checkout ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold flex items-center gap-2"><Icon n="bag" size={20} /> Seu pedido</h3>
              <button onClick={onClose} aria-label="Fechar" className="il-card w-9 h-9 font-bold flex items-center justify-center"><Icon n="x" size={16} /></button>
            </div>
            <div className="mt-4 space-y-3">
              {cart.map((item) => {
                const p = products.find((x) => x.id === item.productId);
                if (!p) return null;
                return (
                  <div key={item.key} className="il-card p-3">
                    <div className="flex justify-between gap-2">
                      <p className="font-bold text-sm">{p.name}</p>
                      <button onClick={() => onRemove(item.key)} className="il-muted text-xs underline" aria-label="Remover">remover</button>
                    </div>
                    {labelFor(item) && <p className="il-muted text-xs mt-0.5">{labelFor(item)}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <button onClick={() => onQty(item.key, -1)} className="il-card w-7 h-7 font-extrabold" aria-label="Diminuir">−</button>
                        <span className="font-extrabold text-sm">{item.qty}</span>
                        <button onClick={() => onQty(item.key, 1)} className="il-card w-7 h-7 font-extrabold" aria-label="Aumentar">+</button>
                      </div>
                      <p className="font-extrabold text-sm">{money(unitFor(item) * item.qty)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between font-extrabold text-lg">
              <span>Total</span><span className="il-accent">{money(total)}</span>
            </div>
            <button onClick={() => setCheckout(true)} className="il-btn w-full mt-3 font-extrabold py-3.5">Continuar</button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold">Finalizar pedido</h3>
              <button onClick={onClose} aria-label="Fechar" className="il-card w-9 h-9 font-bold flex items-center justify-center"><Icon n="x" size={16} /></button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setType('pickup')} className={`font-bold text-sm py-2.5 border ${type === 'pickup' ? 'il-chip-active border-transparent' : 'il-card'} inline-flex items-center justify-center gap-2`} style={{ borderRadius: 'var(--il-radius)' }}><Icon n="bag" size={16} /> Retirada</button>
                <button onClick={() => setType('delivery')} className={`font-bold text-sm py-2.5 border ${type === 'delivery' ? 'il-chip-active border-transparent' : 'il-card'} inline-flex items-center justify-center gap-2`} style={{ borderRadius: 'var(--il-radius)' }}><Icon n="truck" size={16} /> Entrega</button>
              </div>
              {form.logged ? (
                <div className="il-card px-4 py-3 flex items-center gap-2.5">
                  <Icon n="userCircle" size={20} className="shrink-0 il-muted" />
                  <p className="text-sm"><span className="font-bold">{form.customer?.name}</span> <span className="il-muted">· {form.customer?.phone}</span></p>
                </div>
              ) : (
                <>
                  <label className="block"><span className="text-xs font-bold il-muted">SEU NOME *</span>
                    <input value={form.name} onChange={(e) => form.setName(e.target.value)} placeholder="Como podemos te chamar?" autoComplete="name" className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
                  <label className="block"><span className="text-xs font-bold il-muted">WHATSAPP *</span>
                    <input value={form.phone} onChange={(e) => form.setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" autoComplete="tel" className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
                </>
              )}
              {type === 'delivery' && (
                <label className="block"><span className="text-xs font-bold il-muted">ENDEREÇO DE ENTREGA *</span>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, complemento" autoComplete="street-address" className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
              )}
              <div>
                <p className="text-xs font-bold il-muted mb-1.5">PAGAMENTO</p>
                <div className="flex flex-wrap gap-2">
                  {(business.paymentMethods?.length ? business.paymentMethods : ['pix']).map((m) => (
                    <button key={m} onClick={() => setPayment(m)}
                      className={`text-sm font-bold px-4 py-2 border ${payment === m ? 'il-chip-active border-transparent' : 'il-card'}`}
                      style={{ borderRadius: 'var(--il-radius)' }}>
                      {payLabels[m] || m}
                    </button>
                  ))}
                </div>
                {payment === 'pix' && pixKey !== null && (
                  <div className="mt-2">
                    {pixKey ? (
                      <button onClick={copyPix} className="il-card w-full text-left px-4 py-3 flex items-center justify-between gap-2">
                        <span className="min-w-0"><span className="block text-[11px] font-bold il-muted">CHAVE PIX · TOQUE PARA COPIAR</span>
                          <span className="block text-sm font-bold truncate">{pixKey}</span></span>
                        <span className="text-xs font-extrabold il-accent shrink-0">{copied ? 'Copiado!' : 'Copiar'}</span>
                      </button>
                    ) : (
                      <p className="il-muted text-xs">O pagamento via PIX é combinado no WhatsApp após o pedido.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="il-card px-4 py-3 space-y-1 text-sm">
                <p className="flex justify-between"><span className="il-muted">Subtotal</span><span className="font-bold">{money(total)}</span></p>
                {type === 'delivery' && (
                  <p className="flex justify-between"><span className="il-muted">Entrega</span><span className="font-bold">{fee > 0 ? money(fee) : 'a combinar'}</span></p>
                )}
                <p className="flex justify-between font-extrabold text-base pt-1"><span>Total</span><span className="il-accent">{money(grand)}</span></p>
              </div>
              {belowMin && <p className="text-sm font-semibold text-amber-600">Pedido mínimo de {money(minOrder)} — adicione mais itens.</p>}
              <label className="block"><span className="text-xs font-bold il-muted">OBSERVAÇÃO (OPCIONAL)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: sem cebola" className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
              {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
              <button onClick={submit} disabled={loading || belowMin} className="il-btn w-full font-extrabold py-3.5 disabled:opacity-50">
                {loading ? 'Enviando…' : `Confirmar pedido · ${money(grand)}`}
              </button>
              <button onClick={() => setCheckout(false)} className="w-full text-sm font-semibold il-muted inline-flex items-center justify-center gap-1"><Icon n="chevL" size={15} /> Voltar ao carrinho</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
