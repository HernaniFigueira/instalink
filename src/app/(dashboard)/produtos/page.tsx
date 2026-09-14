'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { Category, Product, ProductOption, ProductOptionValue } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { Icon } from '@/components/icons';

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
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [values, setValues] = useState<ProductOptionValue[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [optFor, setOptFor] = useState<Product | null>(null);

  // 403 → aviso amigável (sessão preservada), nunca lista "carregando" para sempre.
  const { denied, report } = useAreaLoad('Produtos');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Produtos' });
    if (!report(res)) { setLoaded(true); return; }
    const d = res.data || {};
    setCats((d.categories || []).filter((c: Category) => c.kind === 'product'));
    setProducts(d.products || []);
    setOptions(d.options || []);
    setValues(d.optionValues || []);
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

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
          <p className="text-sm text-zinc-500 mt-1">Seu catálogo com variações, opções e adicionais.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCat(!showCat)} className="text-sm font-bold bg-white border border-zinc-200 px-4 py-2.5 rounded-xl hover:bg-zinc-50">+ Categoria</button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl hover:bg-zinc-700">+ Produto</button>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-xl px-4 py-3">{msg}</p>}

      {showCat && (
        <form onSubmit={(e) => { e.preventDefault(); call('category.save', { name: catName, kind: 'product' }).then(() => { setCatName(''); setShowCat(false); }).catch((err) => setMsg(err.message)); }}
          className="mb-4 bg-white border border-zinc-200 rounded-2xl p-4 flex gap-2">
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Nome da categoria (ex: Hambúrgueres)"
            className="flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm" autoFocus />
          <button className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl">Salvar</button>
        </form>
      )}

      {denied ? <AccessDenied area="Produtos" /> : !loaded ? <ListSkeleton rows={4} /> : products.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl text-center py-14 px-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="bag" size={24} /></div>
          <h3 className="font-bold mt-3">Você ainda não possui produtos</h3>
          <p className="text-sm text-zinc-500 mt-1">Adicione seu primeiro produto para começar a vender.</p>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-xl">Adicionar produto</button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {products.map((p) => {
            const cat = cats.find((c) => c.id === p.categoryId);
            const opts = options.filter((o) => o.productId === p.id);
            return (
              <div key={p.id} className={cn('bg-white border border-zinc-200 rounded-2xl p-4', !p.active && 'opacity-60')}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-zinc-100 flex items-center justify-center font-extrabold text-zinc-500 overflow-hidden shrink-0">
                    {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : p.name.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{p.name} {p.featured && <Icon n="star" size={13} className="inline -mt-1 text-amber-500" />} {!p.active && <span className="text-xs text-zinc-400">(inativo)</span>}</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {cat?.name || 'Sem categoria'} · R$ {reais(p.promoPrice > 0 ? p.promoPrice : p.price)}
                      {p.promoPrice > 0 && <span className="line-through ml-1">R$ {reais(p.price)}</span>}
                      {opts.length > 0 && <span> · {opts.length} opção(ões)</span>}
                    </p>
                  </div>
                  <button onClick={() => setOptFor(p)} className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg hover:bg-zinc-200">Opções</button>
                  <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg hover:bg-zinc-200">Editar</button>
                  <button onClick={() => { if (confirm(`Excluir "${p.name}"?`)) call('product.delete', { id: p.id }).catch((e) => setMsg(e.message)); }}
                    className="text-xs font-bold text-red-500 px-2 py-2 hover:bg-red-50 rounded-lg inline-flex"><Icon n="x" size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cats.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Categorias</p>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <span key={c.id} className="text-xs font-bold bg-white border border-zinc-200 rounded-full px-3 py-1.5 flex items-center gap-2">
                {c.name}
                <button onClick={() => { if (confirm(`Excluir categoria "${c.name}"?`)) call('category.delete', { id: c.id }).catch((e) => setMsg(e.message)); }}
                  className="text-red-400 hover:text-red-600 inline-flex" aria-label="Excluir"><Icon n="x" size={12} /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <ProductForm
          product={editing} cats={cats}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={async (payload) => { await call('product.save', payload); setShowForm(false); setEditing(null); }}
        />
      )}

      {optFor && (
        <OptionsEditor
          product={optFor}
          options={options.filter((o) => o.productId === optFor.id)}
          values={values}
          onClose={() => setOptFor(null)}
          onSave={async (payload) => { await call('option.save', payload); }}
          onDelete={async (id) => { await call('option.delete', { id }); }}
        />
      )}
    </>
  );
}

function ProductForm({ product, cats, onClose, onSave }: {
  product: Product | null;
  cats: Category[];
  onClose: () => void;
  onSave: (p: Record<string, any>) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [image, setImage] = useState(product?.image || '');
  const [price, setPrice] = useState(product ? reais(product.price) : '');
  const [promo, setPromo] = useState(product?.promoPrice ? reais(product.promoPrice) : '');
  const [categoryId, setCategoryId] = useState(product?.categoryId || '');
  const [active, setActive] = useState(product?.active !== false);
  const [featured, setFeatured] = useState(!!product?.featured);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const input = 'w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSave({ id: product?.id, name, description, image, price: cents(price), promoPrice: promo ? cents(promo) : 0, categoryId, active, featured });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">{product ? 'Editar produto' : 'Novo produto'}</h3>
          <button type="button" onClick={onClose} className="font-bold text-zinc-400 px-2 inline-flex"><Icon n="x" size={16} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Nome *" autoFocus />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={input} rows={2} placeholder="Descrição (opcional)" />
        <input value={image} onChange={(e) => setImage(e.target.value)} className={input} placeholder="URL da foto (opcional)" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-bold text-zinc-500">PREÇO (R$) *</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={input + ' mt-1'} placeholder="29,90" inputMode="decimal" /></label>
          <label className="block"><span className="text-xs font-bold text-zinc-500">PROMOÇÃO (R$)</span>
            <input value={promo} onChange={(e) => setPromo(e.target.value)} className={input + ' mt-1'} placeholder="—" inputMode="decimal" /></label>
        </div>
        <label className="block"><span className="text-xs font-bold text-zinc-500">CATEGORIA</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input + ' mt-1'}>
            <option value="">Sem categoria</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Ativo</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Destaque <Icon n="star" size={14} className="text-amber-500" /></label>
        </div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button disabled={loading} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-xl disabled:opacity-50">{loading ? 'Salvando…' : 'Salvar produto'}</button>
      </form>
    </div>
  );
}

function OptionsEditor({ product, options, values, onClose, onSave, onDelete }: {
  product: Product;
  options: ProductOption[];
  values: ProductOptionValue[];
  onClose: () => void;
  onSave: (p: Record<string, any>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [required, setRequired] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [lines, setLines] = useState('');
  const [error, setError] = useState('');
  const input = 'w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const parsed = lines.split('\n').map((line) => {
        const [n, v] = line.split('|').map((x) => (x || '').trim());
        return { name: n, priceDelta: v ? cents(v) : 0 };
      }).filter((v) => v.name);
      if (parsed.length === 0) throw new Error('Adicione ao menos um valor (ex: Brioche).');
      await onSave({ productId: product.id, name, required, multiple, values: parsed });
      setName(''); setLines(''); setRequired(false); setMultiple(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg">Opções de {product.name}</h3>
          <button onClick={onClose} className="font-bold text-zinc-400 px-2 inline-flex"><Icon n="x" size={16} /></button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Ex: “Escolha o pão” → Tradicional, Brioche · “Adicionais” → Bacon +R$5</p>

        {options.length > 0 && (
          <div className="space-y-2 mb-5">
            {options.map((o) => (
              <div key={o.id} className="border border-zinc-200 rounded-xl p-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{o.name} {o.required && <span className="text-emerald-700 text-xs">· obrigatória</span>} {o.multiple && <span className="text-xs text-zinc-400">· múltipla</span>}</p>
                  <p className="text-xs text-zinc-500">{values.filter((v) => v.optionId === o.id).map((v) => `${v.name}${v.priceDelta > 0 ? ` (+R$ ${reais(v.priceDelta)})` : ''}`).join(' · ')}</p>
                </div>
                <button onClick={() => { if (confirm('Excluir esta opção?')) onDelete(o.id).catch((e) => setError(e.message)); }}
                  className="text-xs font-bold text-red-500 px-2 py-1 hover:bg-red-50 rounded-lg inline-flex"><Icon n="x" size={13} /></button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3 border-t border-zinc-100 pt-4">
          <p className="text-sm font-bold">Nova opção</p>
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Nome da opção (ex: Tamanho, Adicionais)" />
          <textarea value={lines} onChange={(e) => setLines(e.target.value)} className={input} rows={4}
            placeholder={'Um valor por linha. Use | para adicional:\nTradicional\nBrioche\nBacon | 5,00\nQueijo | 4,00'} />
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Obrigatória</label>
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Múltipla escolha</label>
          </div>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button className="w-full font-bold bg-zinc-900 text-white py-3 rounded-xl">Adicionar opção</button>
        </form>
      </div>
    </div>
  );
}
