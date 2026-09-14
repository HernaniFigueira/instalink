'use client';
// ═══════════════════════════════════════════════════════════════
// PRODUTOS = VITRINE (não é e-commerce)
// ═══════════════════════════════════════════════════════════════
// Cadastro mínimo e honesto: foto, nome, descrição, preço, categoria,
// ativo/oculto e destaque. A conversão acontece no WhatsApp do negócio com
// mensagem contextualizada ("Tenho interesse no produto X"). NÃO existe — e
// não deve voltar a existir nesta UI — carrinho, checkout, pagamento,
// entrega, adicionais, sabores, ingredientes, variações ou pedido interno.
// A ativação/desativação do módulo é única: Recursos da empresa
// (lib/features.ts). Desativar nunca apaga produtos.
//
// Estruturas legadas (options/optionValues) continuam no banco para
// compatibilidade de dados; elas apenas não são mais apresentadas aqui.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Category, Product } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { Icon } from '@/components/icons';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { showcasePriceCents } from '@/lib/showcase';

function cents(v: string): number {
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function reais(c: number): string {
  return (c / 100).toFixed(2).replace('.', ',');
}

export default function ProdutosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);

  // 403 → aviso amigável (sessão preservada), nunca lista "carregando" para sempre.
  const { denied, report } = useAreaLoad('Produtos');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Produtos' });
    if (!report(res)) { setLoaded(true); return; }
    const d = res.data || {};
    setCats((d.categories || []).filter((c: Category) => c.kind === 'product'));
    setProducts(d.products || []);
    setLoaded(true);
  }, [businessId, report]);

  useEffect(() => { load(); }, [load]);

  async function call(action: string, payload: Record<string, any>) {
    setMsg('');
    const res = await apiSend<any>('/api/catalog', 'POST', { businessId, action, ...payload }, { scope: 'action', area: 'Produtos' });
    const data = res.data;
    if (!res.ok) throw new Error(res.message);
    load();
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2500);
    return data;
  }

  async function toggleActive(p: Product) {
    await call('product.save', {
      id: p.id, name: p.name, description: p.description, image: p.image,
      price: p.price, promoPrice: p.promoPrice || 0, categoryId: p.categoryId,
      active: !p.active, featured: p.featured,
    }).catch((e) => setMsg(e.message));
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Vitrine de produtos</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Produtos exibidos na sua página com CTA “Tenho interesse” direto no WhatsApp. Sem carrinho, sem checkout.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCat(!showCat)} className="text-sm font-medium bg-white border border-zinc-200 px-3.5 py-2 rounded-md hover:bg-zinc-50">+ Categoria</button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="text-sm font-semibold bg-zinc-900 text-white px-3.5 py-2 rounded-md hover:bg-zinc-700">+ Produto</button>
        </div>
      </div>

      {msg && <p className="mb-3 text-sm font-medium bg-zinc-900 text-white rounded-md px-3 py-2">{msg}</p>}

      {showCat && (
        <form onSubmit={(e) => { e.preventDefault(); call('category.save', { name: catName, kind: 'product' }).then(() => { setCatName(''); setShowCat(false); }).catch((err) => setMsg(err.message)); }}
          className="mb-3 bg-white border border-zinc-200 rounded-md p-3 flex gap-2">
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Nome da categoria (ex: Skincare, Kits, Cuidados em casa)"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" autoFocus />
          <button className="text-sm font-semibold bg-zinc-900 text-white px-3.5 py-2 rounded-md">Salvar</button>
        </form>
      )}

      {denied ? <AccessDenied area="Produtos" /> : !loaded ? <ListSkeleton rows={4} /> : products.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-md text-center py-12 px-6">
          <div className="mx-auto w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="bag" size={20} /></div>
          <h3 className="font-semibold text-sm mt-3">Sua vitrine está vazia</h3>
          <p className="text-sm text-zinc-500 mt-1">Cadastre um produto (ex: pomada, sérum, kit de cuidados). Quem se interessar fala com você no WhatsApp.</p>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="mt-4 text-sm font-semibold bg-zinc-900 text-white px-4 py-2 rounded-md">Adicionar produto</button>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200">
          <div className="hidden sm:grid grid-cols-[1fr_140px_110px_150px_80px] gap-3 px-4 py-2 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide uppercase text-zinc-500">
            <span>Produto</span><span>Categoria</span><span>Preço</span><span>Situação</span><span className="text-right">Ações</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {products.map((p) => {
              const cat = cats.find((c) => c.id === p.categoryId);
              const price = showcasePriceCents(p);
              return (
                <div key={p.id} className={cn('flex sm:grid sm:grid-cols-[1fr_140px_110px_150px_80px] items-center gap-3 px-4 py-3', !p.active && 'opacity-60')}>
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center font-bold text-zinc-500 overflow-hidden shrink-0 border border-zinc-200">
                      {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : p.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        {p.featured && <Icon n="star" size={12} className="text-amber-500 shrink-0" />}
                      </span>
                      {p.description && <span className="block text-xs text-zinc-500 truncate sm:hidden">{p.description}</span>}
                      <span className="hidden sm:block text-xs text-zinc-500 truncate">{p.description}</span>
                    </span>
                  </span>
                  <span className="hidden sm:block text-xs text-zinc-500 truncate">{cat?.name || 'Sem categoria'}</span>
                  <span className="hidden sm:block text-sm font-medium">{price > 0 ? `R$ ${reais(price)}` : '—'}</span>
                  <span className="hidden sm:flex items-center gap-1.5">
                    <button onClick={() => toggleActive(p)} role="switch" aria-checked={p.active}
                      className={cn('text-xs font-medium px-2 py-1 rounded-md border', p.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-50 text-zinc-500 border-zinc-200')}>
                      {p.active ? 'Visível na página' : 'Oculto'}
                    </button>
                  </span>
                  <span className="flex justify-end items-center gap-1.5 text-xs shrink-0">
                    <button onClick={() => { setEditing(p); setShowForm(true); }} className="font-medium bg-white border border-zinc-200 px-2.5 py-1.5 rounded-md hover:bg-zinc-50">Editar</button>
                    <button onClick={() => { if (confirm(`Excluir "${p.name}"?`)) call('product.delete', { id: p.id }).catch((e) => setMsg(e.message)); }}
                      className="text-red-500 px-2 py-1.5 hover:bg-red-50 rounded-md inline-flex" aria-label="Excluir"><Icon n="x" size={13} /></button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cats.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Categorias</p>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <span key={c.id} className="text-xs font-medium bg-white border border-zinc-200 rounded-full px-3 py-1.5 flex items-center gap-2">
                {c.name}
                <button onClick={() => { if (confirm(`Excluir categoria "${c.name}"?`)) call('category.delete', { id: c.id }).catch((e) => setMsg(e.message)); }}
                  className="text-red-400 hover:text-red-600 inline-flex" aria-label="Excluir"><Icon n="x" size={12} /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400 mt-4">
        A vitrine aparece na página pública enquanto o módulo <strong>Produtos</strong> estiver ativo em{' '}
        <Link href={`/recursos?b=${businessId}`} className="underline hover:text-zinc-600">Recursos da empresa</Link>.
        Desativar não apaga nada.
      </p>

      {showForm && (
        <ProductForm
          product={editing} cats={cats} businessId={businessId}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={async (payload) => { await call('product.save', payload); setShowForm(false); setEditing(null); }}
        />
      )}
    </>
  );
}

// Cadastro MÍNIMO da vitrine: foto, nome, descrição, preço, categoria,
// ativo/oculto e destaque. Nada de opções/adicionais/variações.
function ProductForm({ product, cats, businessId, onClose, onSave }: {
  product: Product | null;
  cats: Category[];
  businessId: string;
  onClose: () => void;
  onSave: (p: Record<string, any>) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [image, setImage] = useState(product?.image || '');
  const [price, setPrice] = useState(product ? reais(product.price) : '');
  const [categoryId, setCategoryId] = useState(product?.categoryId || '');
  const [active, setActive] = useState(product?.active !== false);
  const [featured, setFeatured] = useState(!!product?.featured);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSave({
        id: product?.id, name, description, image,
        // promoPrice é campo legado (não aparece mais no formulário): ao editar,
        // o valor existente é preservado — nada é zerado por conveniência de UI.
        price: cents(price), promoPrice: product?.promoPrice || 0, categoryId, active, featured,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-lg p-6 max-h-[92vh] overflow-y-auto space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">{product ? 'Editar produto' : 'Novo produto da vitrine'}</h3>
          <button type="button" onClick={onClose} className="font-bold text-zinc-400 px-2 inline-flex" aria-label="Fechar"><Icon n="x" size={16} /></button>
        </div>
        <ImageUpload label="FOTO DO PRODUTO" value={image} onChange={(url) => setImage(url)} businessId={businessId} />
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Nome *" autoFocus />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={input} rows={2} placeholder="Descrição (opcional)" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-semibold text-zinc-500">PREÇO (R$)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={input + ' mt-1'} placeholder="89,90" inputMode="decimal" /></label>
          <label className="block"><span className="text-xs font-semibold text-zinc-500">CATEGORIA</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input + ' mt-1'}>
              <option value="">Sem categoria</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Visível na vitrine</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Destaque <Icon n="star" size={14} className="text-amber-500" /></label>
        </div>
        <p className="text-[11px] text-zinc-400 leading-snug">Na página pública, o visitante toca em “Tenho interesse” e abre o WhatsApp do negócio com o nome (e o preço, se houver) já escritos. Nenhum pedido é gerado.</p>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button disabled={loading || !name.trim()} className="w-full font-semibold bg-zinc-900 text-white py-2.5 rounded-md disabled:opacity-50">{loading ? 'Salvando…' : 'Salvar produto'}</button>
      </form>
    </div>
  );
}
