'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BLOCK_DEFS } from '@/lib/templates';
import { THEME_PRESETS, matchingPreset, presetById } from '@/lib/themes';
import { cn } from '@/lib/utils';
import type { Block, BlockType, Business, Page, Theme } from '@/lib/types';
import { PageSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { readFaqItems, visibleFaqItems, type FaqItem } from '@/lib/faq';

export default function PaginaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [business, setBusiness] = useState<Business | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [tab, setTab] = useState<'blocks' | 'theme' | 'publish'>('blocks');
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [rvCounts, setRvCounts] = useState({ pending: 0, published: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/reviews?businessId=${businessId}&manage=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.counts) setRvCounts(d.counts); })
      .catch(() => {});
    fetch(`/api/pages?businessId=${businessId}`)
      .then((r) => r.json())
      .then((d) => { setBusiness(d.business); setPage(d.page); });
  }, [businessId]);

  async function save(patch: { blocks?: Block[]; theme?: Theme; presetId?: string; published?: boolean; slug?: string }) {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/pages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('Alterações salvas.');
      if (patch.published !== undefined && business) setBusiness({ ...business, published: patch.published });
      if (patch.slug && business) setBusiness({ ...business, slug: patch.slug });
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  }

  function updateBlocks(blocks: Block[], persist = true) {
    if (!page) return;
    const next = { ...page, blocks: blocks.map((b, i) => ({ ...b, order: i })) };
    setPage(next);
    if (persist) save({ blocks: next.blocks });
  }

  if (!business || !page) return <PageSkeleton />;

  const blocks = [...page.blocks].sort((a, b) => a.order - b.order);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Minha página</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {business.published ? <><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 align-middle" /> Publicada</> : <><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 align-middle" /> Rascunho</>} ·{' '}
            <a href={`/${business.slug}`} target="_blank" className="text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1">instalink.app/{business.slug} <Icon n="external" size={12} /></a>
          </p>
        </div>
        <a href={`/${business.slug}`} target="_blank" className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl hover:bg-zinc-700 inline-flex items-center gap-2">
          <Icon n="eye" size={16} /> Ver como o cliente vê
        </a>
      </div>

      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-xl px-4 py-3">{msg}</p>}

      <div className="flex gap-2 mb-5">
        {([['blocks', 'Blocos'], ['theme', 'Visual'], ['publish', 'Publicar']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('text-sm font-bold px-4 py-2.5 rounded-xl', tab === id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'blocks' && (
        <div className="grid lg:grid-cols-[1fr_280px] gap-4 items-start">
          <div className="space-y-2.5">
            {blocks.map((b, i) => (
              <div key={b.id} className={cn('bg-white border rounded-2xl p-4', !b.enabled && 'opacity-60')}>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-1">
                    <button disabled={i === 0} onClick={() => { const n = [...blocks]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; updateBlocks(n); }}
                      className="text-zinc-400 hover:text-zinc-900 disabled:opacity-20 px-1 inline-flex" aria-label="Subir"><Icon n="chevU" size={12} /></button>
                    <button disabled={i === blocks.length - 1} onClick={() => { const n = [...blocks]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; updateBlocks(n); }}
                      className="text-zinc-400 hover:text-zinc-900 disabled:opacity-20 px-1 inline-flex" aria-label="Descer"><Icon n="chevD" size={12} /></button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                      {BLOCK_DEFS[b.type]?.label || b.type}
                      {blockIsEmpty(b, rvCounts) && (
                        <span className="text-[10px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Falta preencher</span>
                      )}
                      {b.type === 'testimonials' && rvCounts.pending > 0 && (
                        <span className="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{rvCounts.pending} para aprovar</span>
                      )}
                      {b.type === 'testimonials' && rvCounts.published > 0 && (
                        <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">{rvCounts.published} no ar</span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">{BLOCK_DEFS[b.type]?.hint}</p>
                  </div>
                  <button onClick={() => setEditing(editing === b.id ? null : b.id)}
                    className="text-xs font-bold bg-zinc-100 px-3 py-1.5 rounded-lg hover:bg-zinc-200">Editar</button>
                  <button onClick={() => updateBlocks(blocks.map((x) => (x.id === b.id ? { ...x, enabled: !x.enabled } : x)))}
                    className={cn('text-xs font-bold px-3 py-1.5 rounded-lg', b.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-500')}>
                    {b.enabled ? 'Ativo' : 'Oculto'}
                  </button>
                  {b.type !== 'profile' && (
                    <button onClick={() => { if (confirm('Remover este bloco?')) updateBlocks(blocks.filter((x) => x.id !== b.id)); }}
                      className="text-xs font-bold text-red-500 px-2 py-1.5 hover:bg-red-50 rounded-lg inline-flex" aria-label="Remover"><Icon n="x" size={12} /></button>
                  )}
                </div>
                {editing === b.id && (
                  <div className="mt-3 pt-3 border-t border-zinc-100">
                    <BlockSettings
                      block={b}
                      businessId={businessId}
                      onChange={(settings) => {
                        const n = blocks.map((x) => (x.id === b.id ? { ...x, settings } : x));
                        setPage({ ...page, blocks: n });
                      }}
                      onSave={() => { save({ blocks: page.blocks }); setEditing(null); }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="bg-white border border-zinc-200 rounded-2xl p-4 lg:sticky lg:top-4">
            <p className="font-bold text-sm mb-1">Adicionar bloco</p>
            <p className="text-xs text-zinc-500 mb-3">Liberdade controlada: só o que converte.</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(BLOCK_DEFS) as BlockType[]).filter((t) => t !== 'profile').map((t) => (
                <button key={t} onClick={() => updateBlocks([...blocks, { id: `b-${Date.now()}-${t}`, type: t, order: blocks.length, enabled: true, settings: {} }])}
                  className="text-xs font-bold bg-zinc-100 hover:bg-zinc-900 hover:text-white px-3 py-2 rounded-lg transition-colors">
                  + {BLOCK_DEFS[t]?.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'theme' && <ThemeEditor theme={page.theme} presetId={page.presetId || ''} onChange={(theme, presetId) => { setPage({ ...page, theme, presetId }); }} onSave={() => save({ theme: page.theme, presetId: page.presetId || '' })} saving={saving} />}

      {tab === 'publish' && (
        <PublishTab business={business} businessId={businessId} onSlug={(slug) => save({ slug })} onPublish={(published) => save({ published })} />
      )}
    </>
  );
}

// Blocos de conteúdo que aparecem na demo: chip "Falta preencher" quando vazios.
function blockIsEmpty(b: Block, rvCounts: { pending: number; published: number }): boolean {
  const s = b.settings || {};
  switch (b.type) {
    case 'text': return !(s.title || s.body);
    case 'image': return !s.url;
    case 'gallery': return !Array.isArray(s.images) || s.images.length === 0;
    case 'buttons': return !Array.isArray(s.buttons) || s.buttons.length === 0;
    case 'faq': return visibleFaqItems(s.items).length === 0;
    case 'testimonials': {
      const staticEmpty = !Array.isArray(s.items) || s.items.filter((t: any) => t.text).length === 0;
      return staticEmpty && rvCounts.published === 0;
    }
    default: return false;
  }
}

function BlockSettings({ block, businessId, onChange, onSave }: { block: Block; businessId: string; onChange: (s: Record<string, any>) => void; onSave: () => void }) {
  const s = block.settings || {};
  const set = (k: string, v: any) => onChange({ ...s, [k]: v });
  const input = 'w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="space-y-3">
      {['cta', 'products', 'services', 'booking', 'contact', 'quote', 'concierge'].includes(block.type) && (
        <label className="block">
          <span className="text-xs font-bold text-zinc-500">{block.type === 'cta' ? 'TEXTO DO BOTÃO' : 'TÍTULO'}</span>
          <input value={block.type === 'cta' ? s.label || '' : s.title || ''} onChange={(e) => set(block.type === 'cta' ? 'label' : 'title', e.target.value)}
            className={input + ' mt-1'} placeholder={block.type === 'cta' ? 'Ex: Pedir agora' : 'Título da seção'} />
        </label>
      )}
      {block.type === 'cta' && (
        <label className="block">
          <span className="text-xs font-bold text-zinc-500">DESTINO DO BOTÃO</span>
          <select value={s.target || 'auto'} onChange={(e) => set('target', e.target.value === 'auto' ? '' : e.target.value)}
            className={input + ' mt-1'}>
            <option value="auto">Automático (pelo texto)</option>
            <option value="booking">Agendamento</option>
            <option value="products">Pedidos / produtos</option>
            <option value="quote">Orçamento</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
      )}
      {block.type === 'text' && (
        <>
          <input value={s.title || ''} onChange={(e) => set('title', e.target.value)} className={input} placeholder="Título" />
          <textarea value={s.body || ''} onChange={(e) => set('body', e.target.value)} className={input} rows={4} placeholder="Texto…" />
        </>
      )}
      {block.type === 'image' && (
        <>
          <input value={s.url || ''} onChange={(e) => set('url', e.target.value)} className={input} placeholder="URL da imagem (https://…)" />
          <input value={s.link || ''} onChange={(e) => set('link', e.target.value)} className={input} placeholder="Link ao clicar (opcional)" />
        </>
      )}
      {block.type === 'gallery' && (
        <>
          <input value={s.title || ''} onChange={(e) => set('title', e.target.value)} className={input} placeholder="Título (opcional)" />
          <textarea value={(s.images || []).join('\n')} onChange={(e) => set('images', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
            className={input} rows={4} placeholder="Uma URL de imagem por linha" />
        </>
      )}
      {block.type === 'buttons' && (
        <textarea value={(s.buttons || []).map((b: any) => `${b.label || ''} | ${b.url || ''}`).join('\n')}
          onChange={(e) => set('buttons', e.target.value.split('\n').map((line) => { const [label, url] = line.split('|').map((x) => (x || '').trim()); return { label, url }; }).filter((b) => b.label))}
          className={input} rows={4} placeholder={'Instagram | https://instagram.com/...\nSite | https://...'} />
      )}
      {block.type === 'testimonials' && (
        <>
          <ReviewsEditor businessId={businessId} />
          <p className="text-xs font-bold text-zinc-500 pt-1">DEPOIMENTOS FIXOS (aparecem só se nenhuma avaliação estiver publicada)</p>
          <input value={s.title || ''} onChange={(e) => set('title', e.target.value)} className={input} placeholder="Título (opcional)" />
          <textarea value={(s.items || []).map((t: any) => `${t.name || ''} | ${t.text || ''}`).join('\n')}
            onChange={(e) => set('items', e.target.value.split('\n').map((line) => { const [name, text] = line.split('|').map((x) => (x || '').trim()); return { name, text }; }).filter((t) => t.text))}
            className={input} rows={4} placeholder={'Maria | Melhor corte da cidade!\nJoão | Atendimento nota 10'} />
        </>
      )}
      {block.type === 'faq' && (
        <>
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">TÍTULO DA SEÇÃO (OPCIONAL)</span>
            <input value={s.title || ''} onChange={(e) => set('title', e.target.value)} className={input + ' mt-1'} placeholder="Ex: Dúvidas frequentes" />
          </label>
          <FaqEditor items={s.items} onChange={(items) => set('items', items)} inputClass={input} />
        </>
      )}
      {['profile', 'location', 'whatsapp'].includes(block.type) && (
        <p className="text-xs text-zinc-500">Este bloco usa os dados do negócio automaticamente (nome, logo, endereço, WhatsApp). Ajuste em <strong>Configurações</strong>.</p>
      )}
      <button onClick={onSave} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2 rounded-xl hover:bg-zinc-700">Salvar bloco</button>
    </div>
  );
}

function FaqEditor({ items: rawItems, onChange, inputClass }: {
  items: unknown;
  onChange: (items: FaqItem[]) => void;
  inputClass: string;
}) {
  const savedItems = readFaqItems(rawItems);
  const items = savedItems.length > 0 ? savedItems : [{ q: '', a: '' }];

  function updateItem(index: number, field: keyof FaqItem, value: string) {
    onChange(items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-zinc-700">Pergunta {index + 1}</p>
            {savedItems.length > 0 && (
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-xs font-bold text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
                aria-label={`Remover pergunta ${index + 1}`}
              >
                Remover
              </button>
            )}
          </div>
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">PERGUNTA</span>
            <input
              value={item.q}
              onChange={(event) => updateItem(index, 'q', event.target.value)}
              className={inputClass + ' mt-1'}
              placeholder="Ex: Qual o horário de atendimento?"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-zinc-500">RESPOSTA</span>
            <textarea
              value={item.a}
              onChange={(event) => updateItem(index, 'a', event.target.value)}
              className={inputClass + ' mt-1'}
              rows={3}
              placeholder="Ex: Atendemos de segunda a sábado, das 8h às 18h."
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { q: '', a: '' }])}
        className="text-sm font-bold bg-zinc-100 text-zinc-700 px-4 py-2 rounded-xl hover:bg-zinc-200"
      >
        + Adicionar pergunta
      </button>
    </div>
  );
}

// Avaliações reais: clientes avaliam após pedido/agendamento, o dono
// publica ou oculta (igual ao FAQ). Google: link + importação opcional.
function ReviewsEditor({ businessId }: { businessId: string }) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [google, setGoogle] = useState({ googleUrl: '', googlePlaceId: '', hasKey: false });
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const input = 'w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  function load() {
    fetch(`/api/reviews?businessId=${businessId}&manage=1`)
      .then((r) => r.json())
      .then((d) => {
        setReviews(d.reviews || []);
        if (d.google) setGoogle(d.google);
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessId]);

  async function setStatus(id: string, status: string) {
    setActing(id);
    await fetch('/api/reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, status }),
    });
    setActing('');
    load();
  }

  async function remove(id: string) {
    if (!confirm('Excluir esta avaliação?')) return;
    await fetch(`/api/reviews?businessId=${businessId}&id=${id}`, { method: 'DELETE' });
    load();
  }

  async function saveGoogle() {
    setMsg('');
    setActing('google');
    const payload: Record<string, string> = { googleUrl: google.googleUrl, googlePlaceId: google.googlePlaceId };
    if (key.trim()) payload.googleApiKey = key.trim();
    const res = await fetch(`/api/businesses/${businessId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setActing('');
    if (res.ok) { setMsg('Dados do Google salvos.'); setKey(''); load(); }
    else setMsg('Não foi possível salvar.');
  }

  async function importGoogle() {
    setMsg('');
    setActing('import');
    const res = await fetch('/api/reviews/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId }),
    });
    const data = await res.json();
    setActing('');
    setMsg(data.error || (data.imported > 0 ? `${data.imported} nova(s) do Google aguardando aprovação.` : 'Nada novo para importar.'));
    load();
  }

  const pending = reviews.filter((r) => r.status === 'pending');
  const published = reviews.filter((r) => r.status === 'published');
  const hidden = reviews.filter((r) => r.status === 'hidden');

  function row(r: any) {
    return (
      <div key={r.id} className="border border-zinc-200 rounded-xl p-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-extrabold text-amber-600">
            <Icon n="star" size={13} /> {r.rating}/5
          </span>
          <span className="text-xs font-bold">{r.customerName}</span>
          {r.source === 'google' && (
            <span className="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">Google</span>
          )}
        </div>
        {r.text && <p className="text-sm text-zinc-600 mt-1">“{r.text}”</p>}
        <div className="flex gap-2 mt-2">
          {r.status !== 'published' && (
            <button disabled={acting === r.id} onClick={() => setStatus(r.id, 'published')}
              className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              Publicar
            </button>
          )}
          {r.status !== 'hidden' && (
            <button disabled={acting === r.id} onClick={() => setStatus(r.id, 'hidden')}
              className="text-xs font-bold bg-zinc-100 px-3 py-1.5 rounded-lg hover:bg-zinc-200 disabled:opacity-50">
              Ocultar
            </button>
          )}
          {r.status === 'hidden' && (
            <button disabled={acting === r.id} onClick={() => setStatus(r.id, 'pending')}
              className="text-xs font-bold bg-zinc-100 px-3 py-1.5 rounded-lg hover:bg-zinc-200 disabled:opacity-50">
              Reavaliar
            </button>
          )}
          <button onClick={() => remove(r.id)}
            className="text-xs font-bold text-red-500 px-2 py-1.5 hover:bg-red-50 rounded-lg">
            Excluir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 space-y-3">
      <p className="text-xs font-bold text-zinc-500">AVALIAÇÕES DOS CLIENTES (vão para a página ao publicar — máx. 4 no ar)</p>
      {loading ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nenhuma ainda. Quando um cliente receber o pedido ou concluir um agendamento, ele é convidado a avaliar — e cai aqui para você aprovar.
        </p>
      ) : (
        <div className="space-y-2">
          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-extrabold text-blue-700">AGUARDANDO APROVAÇÃO ({pending.length})</p>
              {pending.map(row)}
            </div>
          )}
          {published.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-extrabold text-emerald-700">NO AR ({published.length})</p>
              {published.map(row)}
            </div>
          )}
          {hidden.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-extrabold text-zinc-500">OCULTAS ({hidden.length})</p>
              {hidden.map(row)}
            </div>
          )}
        </div>
      )}
      <div className="pt-1 space-y-2 border-t border-zinc-200">
        <p className="text-xs font-bold text-zinc-500 pt-2">GOOGLE (opcional)</p>
        <input value={google.googleUrl} onChange={(e) => setGoogle({ ...google, googleUrl: e.target.value })}
          className={input} placeholder="Link “avaliar no Google” (Perfil da Empresa > Compartilhar)" />
        <div className="grid grid-cols-2 gap-2">
          <input value={google.googlePlaceId} onChange={(e) => setGoogle({ ...google, googlePlaceId: e.target.value })}
            className={input} placeholder="Place ID (p/ importar)" />
          <input value={key} onChange={(e) => setKey(e.target.value)} type="password"
            className={input} placeholder={google.hasKey ? 'Chave salva (trocar?)' : 'Chave Places API'} />
        </div>
        <div className="flex gap-2">
          <button disabled={acting === 'google'} onClick={saveGoogle}
            className="text-xs font-bold bg-zinc-900 text-white px-3 py-2 rounded-lg hover:bg-zinc-700 disabled:opacity-50">
            Salvar Google
          </button>
          <button disabled={acting === 'import'} onClick={importGoogle}
            className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg hover:bg-zinc-200 disabled:opacity-50">
            {acting === 'import' ? 'Importando…' : 'Importar do Google'}
          </button>
        </div>
        {msg && <p className="text-xs font-semibold text-zinc-600">{msg}</p>}
      </div>
    </div>
  );
}

function ThemeEditor({ theme, presetId, onChange, onSave, saving }: {
  theme: Theme;
  presetId: string;
  onChange: (t: Theme, presetId: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const set = (k: keyof Theme, v: any) => onChange({ ...theme, [k]: v }, presetId);
  const match = matchingPreset(theme);
  const baseName = presetId ? presetById(presetId).name : '';
  const colors: Array<[keyof Theme, string]> = [
    ['primary', 'Cor principal'], ['secondary', 'Cor de apoio'], ['background', 'Fundo'],
    ['surface', 'Cards'], ['text', 'Texto'], ['muted', 'Texto suave'],
  ];
  const fonts: Array<[Theme['font'], string]> = [
    ['inter', 'Moderna (Inter)'], ['sora', 'Destaque (Sora)'], ['rounded', 'Amigável (Nunito)'],
    ['serif', 'Elegante (Playfair)'], ['space', 'Urbana (Space)'], ['mono', 'Técnica (Mono)'],
  ];
  return (
    <div className="space-y-4">
      <div className="bg-white border border-zinc-200 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <p className="font-bold text-sm">Modelos prontos</p>
          {match ? (
            <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full inline-flex items-center gap-1">
              {presetById(match).name} aplicado <Icon n="check" size={12} />
            </span>
          ) : (
            <span className="text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1 rounded-full">
              Personalizado{baseName ? ` (base: ${baseName})` : ''}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mb-4">Escolha uma combinação fechada de cores, fonte e formato — depois ajuste o que quiser abaixo.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {THEME_PRESETS.map((p) => (
            <button key={p.id} onClick={() => onChange({ ...p.theme }, p.id)}
              className={cn('text-left rounded-xl border-2 p-1.5 transition-all hover:-translate-y-0.5', match === p.id ? 'border-zinc-900' : 'border-transparent hover:border-zinc-200')}
              aria-label={`Aplicar modelo ${p.name}`}>
              <span className="block rounded-lg overflow-hidden border border-black/10" style={{ background: p.theme.background }}>
                <span className="block p-2">
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full shrink-0" style={{ background: `linear-gradient(135deg, ${p.theme.primary}, ${p.theme.secondary})` }} />
                    <span className="flex-1 space-y-1">
                      <span className="block h-1.5 rounded-full w-3/4" style={{ background: p.theme.text }} />
                      <span className="block h-1.5 rounded-full w-1/2" style={{ background: p.theme.muted }} />
                    </span>
                  </span>
                  <span className="block mt-2 h-6" style={{ background: p.theme.primary, borderRadius: Math.min(p.theme.radius, 8) }} />
                </span>
              </span>
              <span className="block text-xs font-bold mt-1.5 px-0.5">{p.name}</span>
              <span className="block text-[11px] text-zinc-500 px-0.5 leading-tight">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <details className="bg-white border border-zinc-200 rounded-2xl p-5" open={!match}>
          <summary className="font-bold text-sm cursor-pointer">Ajustar cores e detalhes</summary>
          <div className="grid grid-cols-2 gap-4 mt-4">
            {colors.map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-xs font-bold text-zinc-500">{label.toUpperCase()}</span>
                <span className="mt-1 flex items-center gap-2">
                  <input type="color" value={theme[key] as string} onChange={(e) => set(key, e.target.value)} className="w-10 h-10 rounded-lg border border-zinc-200 bg-white p-1 shrink-0" />
                  <input value={theme[key] as string} onChange={(e) => set(key, e.target.value)} className="w-full min-w-0 rounded-xl border border-zinc-300 px-2.5 py-1.5 text-xs font-mono" />
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <label className="block">
              <span className="text-xs font-bold text-zinc-500">CANTOS</span>
              <input type="range" min={0} max={28} value={theme.radius} onChange={(e) => set('radius', Number(e.target.value))} className="w-full mt-2" />
              <span className="text-xs text-zinc-500">{theme.radius}px</span>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-zinc-500">TIPOGRAFIA</span>
              <select value={theme.font} onChange={(e) => set('font', e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 px-2 py-2 text-sm">
                {fonts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-zinc-500">BOTÕES</span>
              <select value={theme.buttonStyle} onChange={(e) => set('buttonStyle', e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 px-2 py-2 text-sm">
                <option value="solid">Cheio</option>
                <option value="soft">Suave</option>
                <option value="outline">Contorno</option>
              </select>
            </label>
          </div>
          <button onClick={onSave} disabled={saving} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-xl hover:bg-zinc-700 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar visual'}
          </button>
        </details>
        <div className="rounded-2xl p-5" style={{ background: theme.background, color: theme.text }}>
          <p className="text-xs font-bold opacity-60 mb-3">PRÉVIA AO VIVO</p>
          <div className="text-center mb-3">
            <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center font-black"
              style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`, color: '#fff' }}>SN</div>
            <p className="font-extrabold mt-2">Seu negócio</p>
            <p className="text-xs" style={{ color: theme.muted }}>Prévia com as cores escolhidas</p>
          </div>
          <div className="p-4" style={{ background: theme.surface, borderRadius: theme.radius, border: '1px solid rgba(0,0,0,0.08)' }}>
            <p className="font-extrabold text-sm">Card de exemplo</p>
            <p className="text-sm" style={{ color: theme.muted }}>Assim ficam os textos e cards.</p>
            <div className="mt-3 font-bold text-center py-3 text-sm" style={{ background: theme.buttonStyle === 'solid' ? theme.primary : 'transparent', color: theme.buttonStyle === 'solid' ? '#fff' : theme.primary, borderRadius: theme.radius, border: theme.buttonStyle === 'solid' ? 'none' : `2px solid ${theme.primary}` }}>Botão principal</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublishTab({ business, onSlug, onPublish }: { business: Business; businessId: string; onSlug: (slug: string) => void; onPublish: (p: boolean) => void }) {
  const [slug, setSlug] = useState(business.slug);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-4">
        <div>
          <p className="font-bold text-sm">Status</p>
          <p className="text-sm text-zinc-500 mt-0.5">{business.published ? <><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 align-middle" /> Sua página está no ar.</> : <><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 align-middle" /> Sua página está como rascunho (só você vê).</>}</p>
          <button onClick={() => onPublish(!business.published)}
            className={cn('mt-3 text-sm font-bold px-5 py-2.5 rounded-xl', business.published ? 'bg-zinc-100 hover:bg-zinc-200' : 'bg-emerald-600 text-white hover:bg-emerald-500')}>
            {business.published ? 'Despublicar' : 'Publicar página'}
          </button>
        </div>
        <div>
          <p className="font-bold text-sm">Endereço</p>
          <div className="mt-1.5 flex gap-2">
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              className="flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-mono" />
            <button onClick={() => onSlug(slug)} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl">Salvar</button>
          </div>
          <p className="text-xs text-zinc-500 mt-1">instalink.app/{slug}</p>
        </div>
      </div>
      <div className="bg-white border border-zinc-200 rounded-2xl p-5 text-center">
        <p className="font-bold text-sm">QR Code da sua página</p>
        <p className="text-xs text-zinc-500 mb-3">Imprima e cole no balcão, cardápio ou vitrine.</p>
        <img src={`/api/qr?text=${encodeURIComponent(`${origin}/${business.slug}`)}`} alt="QR Code da página"
          className="mx-auto w-48 h-48 rounded-2xl border border-zinc-200" />
        <a href={`/api/qr?text=${encodeURIComponent(`${origin}/${business.slug}`)}`} download={`qr-${business.slug}.png`}
          className="inline-block mt-3 text-sm font-bold bg-zinc-100 px-4 py-2 rounded-xl hover:bg-zinc-200">Baixar QR</a>
      </div>
    </div>
  );
}
