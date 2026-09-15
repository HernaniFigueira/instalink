'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BLOCK_DEFS } from '@/lib/templates';
import { blockModuleGate } from '@/lib/features';
import { NAV_ANCHORS, availableNavIds } from '@/lib/nav';
import type { NavItemConfig, Professional, Service, Product } from '@/lib/types';
import { THEME_PRESETS, matchingPreset, presetById } from '@/lib/themes';
import { cn } from '@/lib/utils';
import type { Block, BlockType, Business, Page, Theme } from '@/lib/types';
import { PageSkeleton } from '@/components/ui';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { Icon } from '@/components/icons';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { readFaqItems, visibleFaqItems, type FaqItem } from '@/lib/faq';

export default function PaginaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [business, setBusiness] = useState<Business | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [tab, setTab] = useState<'blocks' | 'nav' | 'theme' | 'publish'>('blocks');
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [rvCounts, setRvCounts] = useState({ pending: 0, published: 0 });
  // Catálogo leve (para a aba Navegação calcular o que está disponível).
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [saving, setSaving] = useState(false);

  // 403 → aviso amigável (sessão preservada), nunca skeleton infinito.
  const { denied, failed, report } = useAreaLoad('Página');
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const rv = await apiGet<{ counts?: { pending: number; published: number } }>(
        `/api/reviews?businessId=${businessId}&manage=1`, { scope: 'area', area: 'Página' },
      );
      if (rv.ok && rv.data?.counts) setRvCounts(rv.data.counts);
      const res = await apiGet<{ business: Business; page: Page }>(
        `/api/pages?businessId=${businessId}`, { scope: 'area', area: 'Página' },
      );
      if (!report(res) || !res.data) return;
      setBusiness(res.data.business);
      setPage(res.data.page);
      // Catálogo: alimenta o cálculo de disponibilidade dos itens de menu
      // (seção vazia/módulo desligado nunca aparece no menu público).
      const cat = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Página' });
      if (cat.ok && cat.data) {
        setServices(cat.data.services || []);
        setProducts(cat.data.products || []);
        setProfessionals(cat.data.professionals || []);
      }
    })();
  }, [businessId, report, reloadTick]);

  async function save(patch: {
    blocks?: Block[]; theme?: Theme; presetId?: string; published?: boolean; slug?: string;
    // Navegação e "Sobre" vivem no editor da página (fonte única do que o
    // visitante vê). O estado continua sendo o MESMO do negócio (Business.nav/
    // navCustom/about) — a API de páginas apenas encaminha para lá.
    nav?: string[]; navCustom?: boolean; about?: Business['about'];
    navItems?: NavItemConfig[];
  }) {
    setSaving(true);
    setMsg('');
    try {
      const res = await apiSend<{ business?: Business; page?: Page }>('/api/pages', 'PUT', { businessId, ...patch }, { scope: 'action', area: 'Página' });
      if (!res.ok) throw new Error(res.message);
      // REVALIDAÇÃO HONESTA (auditoria §15): nada de assumir "salvo" pelo
      // toast. O servidor devolve o estado CANÔNICO recém-lido do banco e é
      // ELE que atualiza a tela — se não estiver lá, nada aparece salvo.
      if (res.data?.business) setBusiness(res.data.business);
      if (res.data?.page) setPage(res.data.page);
      setMsg(res.data?.page || res.data?.business ? 'Alterações salvas e confirmadas no servidor.' : 'Alterações salvas.');
    } catch (err: any) {
      setMsg(`Falha ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 4500);
    }
  }

  function updateBlocks(blocks: Block[], persist = true) {
    if (!page) return;
    const next = { ...page, blocks: blocks.map((b, i) => ({ ...b, order: i })) };
    setPage(next);
    if (persist) save({ blocks: next.blocks });
  }

  if (denied) return <AccessDenied area="Página" />;
  if (failed && !business) {
    // Nunca skeleton infinito: falhou, diz o que falhou e oferece ação.
    return (
      <div className="bg-white border border-zinc-200 rounded-lg px-4 py-10 text-center" role="alert">
        <span className="mx-auto w-10 h-10 rounded-md bg-red-50 border border-red-200 text-red-600 flex items-center justify-center"><Icon n="alert" size={18} /></span>
        <p className="text-sm font-medium text-zinc-700 mt-3">{failed}</p>
        <button onClick={() => { setBusiness(null); setPage(null); setReloadTick((t) => t + 1); }}
          className="mt-4 text-xs font-bold bg-zinc-900 text-white px-4 py-2 rounded-md">Tentar de novo</button>
      </div>
    );
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
      </div>

      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-md px-4 py-3">{msg}</p>}

      <div className="flex gap-2 mb-5">
        {([['blocks', 'Estrutura'], ['nav', 'Navegação'], ['theme', 'Visual'], ['publish', 'Publicar']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('text-sm font-bold px-4 py-2.5 rounded-md', tab === id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'nav' && (
        <PageNavTab
          business={business}
          businessId={businessId}
          blocks={blocks}
          services={services}
          products={products}
          professionals={professionals}
          reviewCount={rvCounts.published}
          onSaveNav={(navItems) => save({ navItems })}
          onAbout={(about) => save({ about } as any)}
        />
      )}

      {tab === 'blocks' && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-4 items-start">
          <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
              <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Ordem na página · {blocks.length} blocos</p>
              <p className="text-[11px] text-zinc-400 hidden sm:block">as setas definem a ordem de exibição</p>
            </div>
            <div className="divide-y divide-zinc-100">
              {blocks.map((b, i) => {
                const gate = blockModuleGate(business, b.type);
                return (
                  <div key={b.id} className={cn('px-3 py-2.5', !b.enabled && 'bg-zinc-50/60')}>
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 text-center text-[11px] font-bold text-zinc-400 tabular-nums shrink-0">{i + 1}</span>
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button disabled={i === 0} onClick={() => { const n = [...blocks]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; updateBlocks(n); }}
                          className="text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded p-0.5 disabled:opacity-20 disabled:hover:bg-transparent inline-flex" aria-label={`Mover ${BLOCK_DEFS[b.type]?.label || b.type} para cima`}><Icon n="chevU" size={12} /></button>
                        <button disabled={i === blocks.length - 1} onClick={() => { const n = [...blocks]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; updateBlocks(n); }}
                          className="text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded p-0.5 disabled:opacity-20 disabled:hover:bg-transparent inline-flex" aria-label={`Mover ${BLOCK_DEFS[b.type]?.label || b.type} para baixo`}><Icon n="chevD" size={12} /></button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                          <span className={cn(b.enabled ? 'text-zinc-900' : 'text-zinc-400')}>{BLOCK_DEFS[b.type]?.label || b.type}</span>
                          {blockIsEmpty(b, rvCounts) && (
                            <span className="text-[10px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Falta preencher</span>
                          )}
                          {gate && (
                            <span className="text-[10px] font-extrabold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full inline-flex items-center gap-1" title={`O módulo ${gate} está desligado — o bloco fica salvo, mas não aparece na página até o módulo voltar em Recursos.`}>
                              <Icon n="lock" size={9} /> módulo {gate} desligado
                            </span>
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
                        className={cn('text-xs font-bold px-3 py-1.5 rounded-lg min-w-[64px]', b.enabled ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200')}>
                        {b.enabled ? 'Ativo' : 'Oculto'}
                      </button>
                      {b.type !== 'profile' && (
                        <button onClick={() => { if (confirm('Remover este bloco?')) updateBlocks(blocks.filter((x) => (x.id !== b.id))); }}
                          className="text-xs font-bold text-red-500 px-2 py-1.5 hover:bg-red-50 rounded-lg inline-flex" aria-label="Remover bloco"><Icon n="x" size={12} /></button>
                      )}
                    </div>
                    {editing === b.id && (
                      <div className="mt-3 pt-3 border-t border-zinc-100">
                        <BlockSettings
                          block={b}
                          businessId={businessId}
                          business={business}
                          onChange={(settings) => {
                            const n = blocks.map((x) => (x.id === b.id ? { ...x, settings } : x));
                            setPage({ ...page, blocks: n });
                          }}
                          onSave={() => { save({ blocks: page.blocks }); setEditing(null); }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg p-4 lg:sticky lg:top-4">
            <p className="font-bold text-sm mb-1">Adicionar bloco</p>
            {/* Estrutura = o que existe e em que ordem. Cores/fonte ficam na aba Visual — nunca aqui. */}
            <p className="text-xs text-zinc-500 mb-3">Blocos de conversão seguem os módulos da empresa (Recursos). Agendamento e CTA já existem na página padrão.</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(BLOCK_DEFS) as BlockType[])
                .filter((t) => t !== 'profile' && t !== 'booking' && t !== 'quote')
                .map((t) => {
                  const gate = blockModuleGate(business, t);
                  return (
                    <button key={t} disabled={!!gate}
                      title={gate ? `Ative o módulo “${gate}” em Recursos para usar este bloco` : undefined}
                      onClick={() => updateBlocks([...blocks, { id: `b-${Date.now()}-${t}`, type: t, order: blocks.length, enabled: true, settings: {} }])}
                      className={cn('text-xs font-bold px-3 py-2 rounded-lg transition-colors',
                        gate ? 'bg-zinc-50 text-zinc-300 cursor-not-allowed' : 'bg-zinc-100 hover:bg-zinc-900 hover:text-white')}>
                      + {BLOCK_DEFS[t]?.label}
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {tab === 'theme' && (
        // Audito §16: a aba Visual usava só a coluna esquerda e empilhava o
        // preview embaixo. Agora é workspace: CONTROLES à esquerda, PREVIEW
        // DA PÁGINA REAL à direita (sticky, alto) — no desktop a área branca
        // deixa de ser desperdiçada. No mobile, o preview vem primeiro e o
        // controle acompanha, adaptando naturalmente.
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] gap-4 items-start">
          <div className="order-2 lg:order-1 space-y-4">
            <ThemeEditor theme={page.theme} presetId={page.presetId || ''} onChange={(theme, presetId) => { setPage({ ...page, theme, presetId }); }} onSave={() => save({ theme: page.theme, presetId: page.presetId || '' })} saving={saving} />
          </div>
          <div className="order-1 lg:order-2 lg:sticky lg:top-4 space-y-2">
            {/* Prévia da PÁGINA REAL mora na aba Visual: o lojista vê o
                resultado de verdade enquanto ajusta tema e cores. */}
            <PagePreview slug={business.slug} published={!!business.published} />
          </div>
        </div>
      )}

      {tab === 'publish' && (
        <PublishTab business={business} businessId={businessId} onSlug={(slug) => save({ slug })} onPublish={(published) => save({ published })} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// NAVEGAÇÃO DA PÁGINA — v2 (âncoras + links externos).
// Cada item tem nome, ordem e liga/desliga. A DISPONIBILIDADE vem do
// módulo/conteúdo real: item de seção vazia ou rede sem URL aparece
// desabilitado ("indisponível"), nunca some silenciosamente do menu do
// editor — e nunca vai para o ar apontando para nada.
// ═══════════════════════════════════════════════════════════════
function PageNavTab({ business, businessId, blocks, services, products, professionals, reviewCount, onSaveNav, onAbout }: {
  business: Business;
  businessId: string;
  blocks: Block[];
  services: Service[];
  products: Product[];
  professionals: Professional[];
  reviewCount: number;
  onSaveNav: (navItems: NavItemConfig[]) => void | Promise<void>;
  onAbout: (about: Business['about']) => void | Promise<void>;
}) {
  const about = business.about || { title: '', text: '', image: '', enabled: false };
  const [aboutDraft, setAboutDraft] = useState(about);
  useEffect(() => { setAboutDraft(about); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [business.about]);

  const auto = !Array.isArray(business.navItems) || business.navItems.length === 0;
  // Rascunho local: começa da configuração atual (ou do automático) e só
  // persiste quando o lojista salva — edição sem sustos.
  const [draft, setDraft] = useState<NavItemConfig[] | null>(null);
  useEffect(() => { setDraft(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(business.navItems)]);

  const hasFaq = blocks.some((b) => b.type === 'faq' && b.enabled !== false
    && Array.isArray(b.settings?.items) && (b.settings.items as any[]).some((x) => String(x?.q || '').trim() && String(x?.a || '').trim()));
  const hasTestimonialItems = blocks.some((b) => b.type === 'testimonials' && b.enabled !== false
    && Array.isArray(b.settings?.items) && (b.settings.items as any[]).some((t) => String(t?.text || '').trim()));

  // Disponibilidade REAL (mesma regra da página pública — lib/nav.ts).
  const available = new Set(availableNavIds({
    business: business as any,
    blocks,
    services,
    products,
    reviews: Array.from({ length: reviewCount }, (_, i) => ({ id: `r${i}` })),
    hasFaq,
    hasTestimonialItems,
    professionals,
  }));

  // Configuração efetiva (o que está salvo ou o automático mostraria).
  const current: NavItemConfig[] = draft
    ?? (auto
      ? ([
          ...(Object.keys(NAV_ANCHORS) as string[])
            .filter((id) => available.has(id))
            .map((id): NavItemConfig => ({ id, label: NAV_ANCHORS[id].label, type: 'anchor', target: NAV_ANCHORS[id].target, active: true })),
          ...(business.mapsUrl && available.has('directions')
            ? [{ id: 'directions', label: 'Como chegar', type: 'link', target: business.mapsUrl, active: true } as NavItemConfig]
            : []),
          ...(['instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'site'] as string[])
            .filter((id) => available.has(id))
            .map((id): NavItemConfig => ({ id, label: id === 'site' ? 'Site' : id[0].toUpperCase() + id.slice(1), type: 'link', target: '#', active: true })),
        ] as NavItemConfig[])
      : (business.navItems || []));

  // Todos os itens que o editor conhece: salvos + disponíveis não salvos.
  const knownIds = Array.from(new Set([
    ...current.map((i) => i.id),
    ...Object.keys(NAV_ANCHORS),
    'directions', 'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'site',
  ]));
  const labelOf = (id: string) => current.find((i) => i.id === id)?.label || NAV_ANCHORS[id]?.label || (id === 'directions' ? 'Como chegar' : id[0].toUpperCase() + id.slice(1));
  const unavailableHint = (id: string) => {
    if (id === 'about') return 'Ative e preencha a seção “Sobre” abaixo';
    if (id === 'services') return 'Cadastre serviços em Serviços';
    if (id === 'highlights') return 'Adicione itens ao bloco Diferenciais (aba Estrutura)';
    if (id === 'professionals') return 'Cadastre profissionais ativos';
    if (id === 'gallery') return 'Adicione fotos ao bloco Conheça o espaço';
    if (id === 'reviews') return 'Aguardando avaliações publicadas';
    if (id === 'faq') return 'Preencha o bloco de dúvidas';
    if (id === 'contact' || id === 'directions') return 'Cadastre o endereço/mapa em Configurações';
    return 'Configure a rede em Configurações';
  };

  function setItems(next: NavItemConfig[]) { setDraft(next); }

  function toggleItem(item: NavItemConfig) {
    setItems(current.map((i) => (i.id === item.id ? { ...i, active: !(i.active !== false) } : i)));
  }
  function move(index: number, dir: -1 | 1) {
    const n = [...current];
    const j = index + dir;
    if (j < 0 || j >= n.length) return;
    [n[index], n[j]] = [n[j], n[index]];
    setItems(n);
  }
  function rename(item: NavItemConfig, label: string) {
    setItems(current.map((i) => (i.id === item.id ? { ...i, label: label.slice(0, 40) } : i)));
  }

  const dirty = !!draft;

  return (
    <div className="space-y-4">
      <section className="bg-white border border-zinc-200 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div>
            <p className="font-bold text-sm">Itens do menu público</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {auto
                ? 'Modo automático: a página monta o menu conforme módulos e conteúdo preenchido. Qualquer ajuste abaixo vira configuração sua.'
                : 'Você escolheu os itens, a ordem e os nomes. Itens de seções vazias ou desligadas ficam desabilitados até voltarem a existir.'}
            </p>
          </div>
          {auto
            ? <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">Automático</span>
            : <span className="text-[11px] font-semibold bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-full px-2 py-0.5 shrink-0">Personalizado</span>}
        </div>

        <div className="mt-3 divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
          {current.filter((i) => knownIds.includes(i.id)).map((item, index) => {
            const ok = available.has(item.id);
            const on = item.active !== false;
            return (
              <div key={item.id} className={cn('flex flex-wrap items-center gap-2 px-3 py-2.5', !ok && 'bg-zinc-50/70')}>
                <div className="flex flex-col gap-0.5">
                  <button disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${labelOf(item.id)}`}
                    className="text-zinc-400 hover:text-zinc-900 disabled:opacity-20 px-0.5 inline-flex"><Icon n="chevU" size={11} /></button>
                  <button disabled={index === current.length - 1} onClick={() => move(index, 1)} aria-label={`Descer ${labelOf(item.id)}`}
                    className="text-zinc-400 hover:text-zinc-900 disabled:opacity-20 px-0.5 inline-flex"><Icon n="chevD" size={11} /></button>
                </div>
                <button onClick={() => ok && toggleItem(item)} disabled={!ok}
                  className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 transition-colors',
                    !ok ? 'bg-zinc-50 text-zinc-400 border-zinc-200 cursor-not-allowed'
                    : on ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-500 border-zinc-300')}
                  title={ok ? (on ? 'Visível no menu' : 'Oculto do menu') : unavailableHint(item.id)}>
                  {ok ? (on ? 'No menu' : 'Oculto') : 'Indisponível'}
                </button>
                <input value={item.label} onChange={(e) => rename(item, e.target.value)} disabled={!ok}
                  className="flex-1 min-w-[110px] bg-transparent border-0 focus:border focus:border-zinc-300 rounded-md px-2 py-1 text-sm font-semibold disabled:text-zinc-400"
                  placeholder={NAV_ANCHORS[item.id]?.label || item.id} maxLength={40} />
                <span className="text-[10px] font-bold text-zinc-400 uppercase shrink-0 w-14 text-right">
                  {item.type === 'anchor' ? 'Seção' : 'Link'}
                </span>
              </div>
            );
          })}
        </div>
        {!ok_all_available(available, current) && (
          <p className="text-[11px] text-zinc-500 mt-2">
            Itens “Indisponível” ficam de fora do menu público até existir conteúdo — a página nunca aponta para seção vazia.
          </p>
        )}

        <div className="flex flex-wrap gap-2 mt-3">
          <button disabled={!dirty} onClick={() => { onSaveNav(draft || []); setDraft(null); }}
            className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md hover:bg-zinc-700 disabled:opacity-40">
            Salvar menu
          </button>
          {!auto && (
            <button onClick={() => { setDraft(null); onSaveNav([]); }} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-md hover:bg-zinc-200">
              Voltar ao automático
            </button>
          )}
          {dirty && (
            <button onClick={() => setDraft(null)} className="text-sm font-bold text-zinc-500 px-3 py-2.5 rounded-md hover:text-zinc-900">Descartar</button>
          )}
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-bold text-sm">Sobre a empresa</p>
          <button onClick={() => onAbout({ ...aboutDraft, enabled: !about.enabled })}
            className={cn('text-xs font-medium px-3 py-1 rounded-full border', about.enabled ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-500')}>
            {about.enabled ? 'Visível' : 'Oculto'}
          </button>
        </div>
        <p className="text-xs text-zinc-500 -mt-1">Aparece na página logo abaixo do Perfil, quando ativado e com conteúdo.</p>
        <input value={aboutDraft.title} onChange={(e) => setAboutDraft({ ...aboutDraft, title: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" placeholder="Título (ex: Sobre o estúdio)" />
        <textarea value={aboutDraft.text} onChange={(e) => setAboutDraft({ ...aboutDraft, text: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" rows={3} placeholder="Ex: Somos uma clínica especializada em…" />
        <ImageUpload label="IMAGEM (OPCIONAL)" value={aboutDraft.image} onChange={(url) => setAboutDraft({ ...aboutDraft, image: url })} businessId={businessId} />
        <button onClick={() => onAbout(aboutDraft)} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2 rounded-md hover:bg-zinc-700">Salvar “Sobre”</button>
      </section>
    </div>
  );
}

// helper: existe algum item indisponível na lista?
function ok_all_available(available: Set<string>, items: NavItemConfig[]): boolean {
  return items.every((i) => available.has(i.id));
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
    case 'highlights': return !Array.isArray(s.items) || s.items.filter((x: any) => String(x?.title || '').trim()).length === 0;
    case 'testimonials': {
      const staticEmpty = !Array.isArray(s.items) || s.items.filter((t: any) => t.text).length === 0;
      return staticEmpty && rvCounts.published === 0;
    }
    default: return false;
  }
}

function BlockSettings({ block, businessId, business, onChange, onSave }: {
  block: Block;
  businessId: string;
  business: Business;
  onChange: (s: Record<string, any>) => void;
  onSave: () => void;
}) {
  const s = block.settings || {};
  const set = (k: string, v: any) => onChange({ ...s, [k]: v });
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
  // Orçamento só aparece como destino se a empresa LEGADA ainda tem o módulo
  // ligado — novas experiências não oferecem pedidos/orçamentos.
  const quoteLegacy = (business.modes || []).includes('quote');
  const productsOn = (business.modes || []).includes('products') || (business.modes || []).includes('orders');
  const bookingsOn = (business.modes || []).includes('bookings');

  return (
    <div className="space-y-3">
      {['cta', 'products', 'services', 'booking', 'contact', 'quote', 'concierge', 'highlights', 'professionals', 'gallery', 'testimonials', 'faq', 'location'].includes(block.type) && (
        <label className="block">
          <span className="text-xs font-bold text-zinc-500">{block.type === 'cta' ? 'TEXTO DO BOTÃO' : 'TÍTULO'}</span>
          <input value={block.type === 'cta' ? s.label || '' : s.title || ''} onChange={(e) => set(block.type === 'cta' ? 'label' : 'title', e.target.value)}
            className={input + ' mt-1'} placeholder={block.type === 'cta' ? 'Ex: Agendar horário' : 'Título da seção'} />
        </label>
      )}
      {block.type === 'cta' && (
        <p className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 leading-snug">
          Este é o <strong>botão principal do topo</strong> da página (hero). Ele não se repete em outras seções — a barra inferior cuida do acesso persistente, e cada serviço pode ter o seu atalho “Agendar”.
        </p>
      )}
      {['products', 'services', 'gallery', 'testimonials', 'faq', 'highlights', 'professionals', 'location'].includes(block.type) && (
        <label className="block">
          <span className="text-xs font-bold text-zinc-500">SUBTÍTULO (OPCIONAL)</span>
          <input value={s.subtitle || ''} onChange={(e) => set('subtitle', e.target.value.slice(0, 120))}
            className={input + ' mt-1'} placeholder="Uma linha que explica a seção (ex: Toque em um serviço para agendar)" />
        </label>
      )}
      {block.type === 'cta' && (
        <label className="block">
          <span className="text-xs font-bold text-zinc-500">DESTINO DO BOTÃO</span>
          <select value={s.target || 'auto'} onChange={(e) => set('target', e.target.value === 'auto' ? '' : e.target.value)}
            className={input + ' mt-1'}>
            <option value="auto">Automático (pelo texto)</option>
            <option value="booking">Agendamento</option>
            <option value="products">Vitrine de produtos</option>
            {quoteLegacy && <option value="quote">Orçamento</option>}
            <option value="whatsapp">WhatsApp</option>
          </select>
          {!s.target && !bookingsOn && !productsOn && (
            <span className="block text-[11px] text-zinc-500 mt-1">Com “Automático”, o botão escolhe o melhor destino entre os módulos ativos.</span>
          )}
        </label>
      )}
      {block.type === 'products' && (
        <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2.5 space-y-1.5">
          <p>A vitrine mostra os produtos ativos com foto, nome, preço e o botão <strong>“Tenho interesse”</strong>, que abre o WhatsApp do negócio com mensagem pronta — sem carrinho nem pedido.</p>
          {/* Destino certo conforme o módulo (auditoria §11): com Produtos
              ligado, o link é o cadastro; desligado, o único caminho útil é
              Recursos — apontar para /produtos negrear o acesso é o bug que
              fazia o lojista achar que “não tinha acesso” à própria área. */}
          {productsOn ? (
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <Link href={`/produtos?b=${businessId}`} className="font-semibold text-zinc-900 underline">Gerenciar produtos →</Link>
              <span className="text-emerald-700 font-semibold">● Módulo Produtos ativo</span>
            </p>
          ) : (
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <Link href={`/recursos?b=${businessId}`} className="font-semibold text-zinc-900 underline">Ativar Produtos em Recursos →</Link>
              <span className="text-amber-700">○ Com o módulo desligado, a vitrine não aparece na página (nada foi apagado).</span>
            </p>
          )}
        </div>
      )}
      {block.type === 'booking' && (
        <p className="text-xs text-zinc-500">O agendamento não precisa de bloco próprio: o CTA, o botão “Agendar” por serviço e o menu público já abrem o mesmo fluxo.</p>
      )}
      {block.type === 'text' && (
        <>
          <input value={s.title || ''} onChange={(e) => set('title', e.target.value)} className={input} placeholder="Título" />
          <textarea value={s.body || ''} onChange={(e) => set('body', e.target.value)} className={input} rows={4} placeholder="Texto…" />
        </>
      )}
      {block.type === 'image' && (
        <>
          <ImageUpload label="IMAGEM" value={s.url || ''} onChange={(url) => set('url', url)} businessId={businessId} />
          <input value={s.link || ''} onChange={(e) => set('link', e.target.value)} className={input} placeholder="Link ao clicar (opcional)" />
        </>
      )}
      {block.type === 'gallery' && (
        <>
          {/* Galerias antigas podiam guardar objetos {url}; a leitura é
              normalizada para strings — salvar nunca "perde" a imagem. */}
          {(() => {
            const imgs: string[] = (Array.isArray(s.images) ? s.images : [])
              .map((x: any) => (typeof x === 'string' ? x : String(x?.url || '')))
              .filter(Boolean);
            return (
              <>
                {imgs.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {imgs.map((url, i) => (
                      <div key={`${url}-${i}`} className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Foto ${i + 1}`} className="w-full h-20 object-cover rounded-md border border-zinc-200" />
                        <button type="button" onClick={() => set('images', imgs.filter((_, j) => j !== i))}
                          aria-label={`Remover foto ${i + 1}`}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-bold flex items-center justify-center opacity-80 hover:opacity-100 hover:bg-red-600">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <ImageUpload label={imgs.length > 0 ? 'ADICIONAR MAIS UMA' : 'ADICIONAR IMAGEM À GALERIA'} value="" businessId={businessId}
                    onChange={(url) => set('images', [...imgs, url])} />
                  <p className="text-[11px] text-zinc-500 leading-snug max-w-[180px]">
                    Até 6 fotos aparecem na página, em grade. Com o módulo Galeria ativo, a seção entra no ar na hora de salvar.
                  </p>
                </div>
                <details>
                  <summary className="text-[11px] font-bold text-zinc-500 cursor-pointer">ou colar URLs (uma por linha)</summary>
                  <textarea value={imgs.join('\n')} onChange={(e) => set('images', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
                    className={input + ' mt-2'} rows={4} placeholder="https://…" />
                </details>
              </>
            );
          })()}
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
      {block.type === 'highlights' && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-zinc-500 pt-1">DIFERENCIAIS (UM POR LINHA)</p>
          <p className="text-[11px] text-zinc-500 -mt-1">Título é obrigatório; texto e ícone são opcionais. Ex.: “Atendimento no dia”, “Primeira avaliação grátis”.</p>
          {((Array.isArray(s.items) ? s.items : [{ icon: '', title: '', text: '' }]) as any[]).map((it, i, arr) => (
            <div key={i} className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-zinc-600">Item {i + 1}</p>
                {arr.length > 1 && (
                  <button type="button" onClick={() => set('items', arr.filter((_, j) => j !== i))}
                    className="text-[11px] font-bold text-red-600 px-2 py-1 rounded-lg hover:bg-red-50">Remover</button>
                )}
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input value={it.title || ''} onChange={(e) => set('items', arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  className={input} placeholder="Título (ex: Atendimento no mesmo dia)" maxLength={80} />
                <select value={it.icon || ''} onChange={(e) => set('items', arr.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x)))}
                  className="rounded-md border border-zinc-300 px-2 py-2 text-sm bg-white" aria-label="Ícone do diferencial">
                  <option value="">✓</option>
                  <option value="star">★ Estrela</option>
                  <option value="heart">♥ Coração</option>
                  <option value="clock">🕐 Relógio</option>
                  <option value="check">✓ Certo</option>
                  <option value="shield">🛡 Escudo</option>
                  <option value="spark">✨ Brilho</option>
                </select>
              </div>
              <input value={it.text || ''} onChange={(e) => set('items', arr.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                className={input} placeholder="Descrição curta (opcional)" maxLength={140} />
            </div>
          ))}
          <button type="button" onClick={() => set('items', [...(Array.isArray(s.items) ? s.items : []), { icon: '', title: '', text: '' }])}
            className="text-sm font-bold bg-zinc-100 text-zinc-700 px-4 py-2 rounded-md hover:bg-zinc-200">+ Adicionar diferencial</button>
        </div>
      )}
      {block.type === 'professionals' && (
        <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2.5 space-y-1.5">
          <p>Mostra os <strong>profissionais ativos</strong> do negócio com foto, nome e função — é a mesma equipe da agenda e da distribuição automática.</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <Link href={`/profissionais?b=${businessId}`} className="font-semibold text-zinc-900 underline">Gerenciar profissionais →</Link>
          </p>
        </div>
      )}
      {['profile', 'location', 'whatsapp'].includes(block.type) && (
        <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2.5">
          <p>
            {block.type === 'profile' && 'O Perfil mostra nome, logo, capa e descrição do negócio.'}
            {block.type === 'location' && 'O bloco Localização mostra o mapa salvo no endereço do negócio.'}
            {block.type === 'whatsapp' && 'O botão flutuante usa o número de WhatsApp cadastrado do negócio.'}
            {' '}Esses dados são do <strong>cadastro do negócio</strong> — você edita tudo em{' '}
            <Link href={`/configuracoes?b=${businessId}`} className="font-semibold text-zinc-900 underline">Configurações → Negócio</Link>.
            Aqui você só decide <strong>como e onde eles aparecem</strong> na página.
          </p>
        </div>
      )}
      <button onClick={onSave} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2 rounded-md hover:bg-zinc-700">Salvar bloco</button>
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
        <div key={index} className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3 sm:p-4 space-y-3">
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
        className="text-sm font-bold bg-zinc-100 text-zinc-700 px-4 py-2 rounded-md hover:bg-zinc-200"
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
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

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
      <div key={r.id} className="border border-zinc-200 rounded-md p-3">
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
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
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

// ── Prévia da página REAL (aba Visual, §24) ──
// Mesma origem + sessão do dono: o rascunho aparece (isOwnerPreview).
function PagePreview({ slug, published }: { slug: string; published: boolean }) {
  const [wide, setWide] = useState(true);
  const [nonce, setNonce] = useState(0);
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="font-bold text-sm">Prévia da página</p>
          <p className="text-xs text-zinc-500">
            {published ? 'Como está no ar agora.' : 'Rascunho — só você vê esta versão.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-100 rounded-lg p-0.5">
            <button onClick={() => setWide(true)} aria-label="Prévia em tela larga"
              className={cn('text-xs font-bold px-3 py-1.5 rounded-md', wide && 'bg-white shadow-sm')}>Larga</button>
            <button onClick={() => setWide(false)} aria-label="Prévia em tela de celular"
              className={cn('text-xs font-bold px-3 py-1.5 rounded-md', !wide && 'bg-white shadow-sm')}>Celular</button>
          </div>
          <button onClick={() => setNonce((n) => n + 1)} className="text-xs font-bold bg-zinc-100 hover:bg-zinc-200 px-3 py-2 rounded-md inline-flex items-center gap-1.5">
            <Icon n="sync" size={13} /> Atualizar
          </button>
        </div>
      </div>
      <div className="flex justify-center">
        <div className={cn('transition-all w-full', !wide && 'sm:w-[390px] sm:max-w-full')}>
          <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-50 w-full"
            style={{ height: wide ? 'min(76dvh, 720px)' : 620, minHeight: 520 }}>
            <iframe key={nonce} src={`/${slug}`} title="Prévia da página pública"
              className="w-full h-full border-0" sandbox="allow-same-origin allow-scripts allow-popups allow-forms" />
          </div>
        </div>
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
      <div className="bg-white border border-zinc-200 rounded-lg p-5">
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
              className={cn('text-left rounded-md border-2 p-1.5 transition-all hover:-translate-y-0.5', match === p.id ? 'border-zinc-900' : 'border-transparent hover:border-zinc-200')}
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

      <div className="space-y-4">
        <details className="bg-white border border-zinc-200 rounded-lg p-5" open={!match}>
          <summary className="font-bold text-sm cursor-pointer">Ajustar cores e detalhes</summary>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
            {colors.map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-xs font-bold text-zinc-500">{label.toUpperCase()}</span>
                <span className="mt-1 flex items-center gap-2">
                  <input type="color" value={theme[key] as string} onChange={(e) => set(key, e.target.value)} className="w-10 h-10 rounded-lg border border-zinc-200 bg-white p-1 shrink-0" />
                  <input value={theme[key] as string} onChange={(e) => set(key, e.target.value)} className="w-full min-w-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-mono" />
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
              <select value={theme.font} onChange={(e) => set('font', e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-2 text-sm">
                {fonts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-zinc-500">BOTÕES</span>
              <select value={theme.buttonStyle} onChange={(e) => set('buttonStyle', e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-2 text-sm">
                <option value="solid">Cheio</option>
                <option value="soft">Suave</option>
                <option value="outline">Contorno</option>
              </select>
            </label>
          </div>
          <button onClick={onSave} disabled={saving} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-md hover:bg-zinc-700 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar visual'}
          </button>
        </details>
        <div className="rounded-lg p-5" style={{ background: theme.background, color: theme.text }}>
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
      <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
        <div>
          <p className="font-bold text-sm">Status</p>
          <p className="text-sm text-zinc-500 mt-0.5">{business.published ? <><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 align-middle" /> Sua página está no ar.</> : <><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 align-middle" /> Sua página está como rascunho (só você vê).</>}</p>
          <button onClick={() => onPublish(!business.published)}
            className={cn('mt-3 text-sm font-bold px-5 py-2.5 rounded-md', business.published ? 'bg-zinc-100 hover:bg-zinc-200' : 'bg-emerald-600 text-white hover:bg-emerald-500')}>
            {business.published ? 'Despublicar' : 'Publicar página'}
          </button>
        </div>
        <div>
          <p className="font-bold text-sm">Endereço</p>
          <div className="mt-1.5 flex gap-2">
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2.5 text-sm font-mono" />
            <button onClick={() => onSlug(slug)} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md">Salvar</button>
          </div>
          <p className="text-xs text-zinc-500 mt-1">instalink.app/{slug}</p>
        </div>
      </div>
      <div className="bg-white border border-zinc-200 rounded-lg p-5 text-center">
        <p className="font-bold text-sm">QR Code da sua página</p>
        <p className="text-xs text-zinc-500 mb-3">Imprima e cole no balcão, cardápio ou vitrine.</p>
        <img src={`/api/qr?text=${encodeURIComponent(`${origin}/${business.slug}`)}`} alt="QR Code da página"
          className="mx-auto w-48 h-48 rounded-lg border border-zinc-200" />
        <a href={`/api/qr?text=${encodeURIComponent(`${origin}/${business.slug}`)}`} download={`qr-${business.slug}.png`}
          className="inline-block mt-3 text-sm font-bold bg-zinc-100 px-4 py-2 rounded-md hover:bg-zinc-200">Baixar QR</a>
      </div>
    </div>
  );
}
