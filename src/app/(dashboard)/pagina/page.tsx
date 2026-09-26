'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BLOCK_DEFS } from '@/lib/templates';
import { blockModuleGate } from '@/lib/features';
import { NAV_ANCHORS, availableNavIds } from '@/lib/nav';
import type { NavItemConfig, Professional, Service, Product } from '@/lib/types';
import { THEME_PRESETS, clinicPresetId, matchingPreset, presetById } from '@/lib/themes';
import { cn } from '@/lib/utils';
import type { Block, BlockType, Business, Page, Theme } from '@/lib/types';
import { PageSkeleton, Tabs } from '@/components/ui';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { Icon } from '@/components/icons';
import { ClinicPreview } from '@/components/dashboard/ClinicPreview';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { useUnsavedChanges } from '@/components/dashboard/useUnsavedChanges';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { readFaqItems, visibleFaqItems, type FaqItem } from '@/lib/faq';

// ═══════════════════════════════════════════════════════════════
// EDITOR 2.0 — seções da coluna esquerda. Só entra na lista o que o
// produto REALMENTE suporta (bloco existente/módulo possível): nenhuma
// seção vazia promessa. "Modelo" reúne estrutura + menu; as demais abrem o
// formulário daquela área com a prévia fixa ao lado.
// ═══════════════════════════════════════════════════════════════
type PageSection = 'modelo' | 'secoes' | 'perfil' | 'servicos' | 'equipe' | 'contato' | 'avaliacoes' | 'faq' | 'localizacao' | 'aparencia' | 'publicacao';
const PAGE_SECTIONS: { id: PageSection; label: string; icon: string; available: (blocks: Block[]) => boolean }[] = [
  { id: 'modelo', label: 'Modelo', icon: 'grid', available: () => true },
  { id: 'secoes', label: 'Seções da página', icon: 'panel', available: () => true },
  { id: 'perfil', label: 'Perfil', icon: 'store', available: (b) => b.some((x) => x.type === 'profile') },
  { id: 'servicos', label: 'Serviços', icon: 'service', available: (b) => b.some((x) => x.type === 'services') },
  { id: 'equipe', label: 'Equipe', icon: 'users', available: (b) => b.some((x) => x.type === 'professionals') },
  { id: 'contato', label: 'Botões e contato', icon: 'phone', available: (b) => b.some((x) => x.type === 'buttons' || x.type === 'cta' || x.type === 'whatsapp' || x.type === 'quote') },
  { id: 'avaliacoes', label: 'Avaliações', icon: 'star', available: (b) => b.some((x) => x.type === 'testimonials') },
  { id: 'faq', label: 'FAQ', icon: 'chat', available: (b) => b.some((x) => x.type === 'faq') },
  { id: 'localizacao', label: 'Localização', icon: 'pin', available: (b) => b.some((x) => x.type === 'location') },
  { id: 'aparencia', label: 'Aparência', icon: 'spark', available: () => true },
  { id: 'publicacao', label: 'Publicação', icon: 'upload', available: () => true },
];

export default function PaginaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [business, setBusiness] = useState<Business | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [section, setSection] = useState<PageSection>(() => {
    // Deep-link compatível com as abas antigas (?tab=…): editor 2.0 abre já na
    // seção certa sem quebrar links/fluxos existentes.
    try {
      const q = new URLSearchParams(window.location.search).get('tab') as PageSection | null;
      return q && PAGE_SECTIONS.some((x) => x.id === q) ? q : 'perfil';
    } catch { return 'perfil'; }
  });
  const [previewSheet, setPreviewSheet] = useState(false);
  // "Próximos passos" usa o MESMO checklist real do /api/overview (nada inventado).
  const [setup, setSetup] = useState<{ pct: number; checklist: Array<{ done: boolean; label: string; href: string }> } | null>(null);
  useEffect(() => {
    if (!businessId) return;
    let on = true;
    apiGet<{ pct?: number; checklist?: Array<{ done: boolean; label: string; href: string }> }>(
      `/api/overview?businessId=${businessId}&period=7`, { scope: 'area', area: 'Página' },
    ).then((r) => { if (on && r.ok) setSetup({ pct: r.data?.pct ?? 0, checklist: r.data?.checklist || [] }); })
      .catch(() => { if (on) setSetup(null); });
    return () => { on = false; };
  }, [businessId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [rvCounts, setRvCounts] = useState({ pending: 0, published: 0 });
  // Catálogo leve (para a aba Navegação calcular o que está disponível).
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [savedPage, setSavedPage] = useState('');
  const [savedAbout, setSavedAbout] = useState('');
  const [navDraft, setNavDraft] = useState<NavItemConfig[] | null>(null);

  const [catalog, setCatalog] = useState({ categories: [], products: [], options: [], optionValues: [], services: [], serviceCategories: [], professionals: [], reviews: [] });
  const snapshot = (p: Page) => JSON.stringify([p.blocks, p.theme, p.presetId]);
  const dirty = !!page && !!savedPage && (snapshot(page) !== savedPage || JSON.stringify(business?.about) !== savedAbout || navDraft !== null);
  useUnsavedChanges(dirty);

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
      setSavedAbout(JSON.stringify(res.data.business.about));
      setNavDraft(null);
      setPage(res.data.page);
      setSavedPage(snapshot(res.data.page));
      // Catálogo: alimenta o cálculo de disponibilidade dos itens de menu
      // (seção vazia/módulo desligado nunca aparece no menu público).
      const cat = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Página' });
      if (cat.ok && cat.data) {
        setCatalog({ categories: cat.data.categories || [], serviceCategories: cat.data.serviceCategories || [], options: cat.data.options || [], optionValues: cat.data.optionValues || [], services: (cat.data.services || []).filter((x: any) => x.active), professionals: (cat.data.professionals || []).filter((x: any) => x.active), products: (cat.data.products || []).filter((x: any) => x.active), reviews: rv.ok ? ((rv.data as any)?.reviews || []).filter((x: any) => x.status === 'published') : [] });
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
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setMsg('');
    try {
      const res = await apiSend<{ business?: Business; page?: Page }>('/api/pages', 'PUT', { businessId, about: business?.about, ...(navDraft !== null ? { navItems: navDraft } : {}), ...(page ? { blocks: page.blocks, theme: page.theme, presetId: page.presetId } : {}), ...patch }, { scope: 'action', area: 'Página' });
      if (!res.ok) throw new Error(res.message);
      // REVALIDAÇÃO HONESTA (auditoria §15): nada de assumir "salvo" pelo
      // toast. O servidor devolve o estado CANÔNICO recém-lido do banco e é
      // ELE que atualiza a tela — se não estiver lá, nada aparece salvo.
      if (res.data?.business) { setBusiness(res.data.business); setSavedAbout(JSON.stringify(res.data.business.about)); setNavDraft(null); }
      if (res.data?.page) { setPage(res.data.page); setSavedPage(snapshot(res.data.page)); }
      setMsg(business?.published ? 'Alterações salvas. A página pública já foi atualizada.' : 'Alterações salvas e confirmadas no servidor.');
      return true;
    } catch (err: any) {
      setMsg(`Falha ao salvar: ${err.message}. Suas alterações continuam nesta tela.`);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function updateBlocks(blocks: Block[], persist = false) {
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
          className="mt-4 text-xs font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-4 py-2 rounded-md">Tentar de novo</button>
      </div>
    );
  }
  if (!business || !page) return <PageSkeleton />;

  const previewBusiness = navDraft === null ? business : { ...business, navItems: navDraft };
  const blocks = [...page.blocks].sort((a, b) => a.order - b.order);

  // SOBRE A EMPRESA — linha sintética da Estrutura: seção pública fixa logo
  // abaixo do Perfil (mesma convenção do render público, AboutView). Ela
  // participa da Estrutura (visibilidade e conteúdo) sem virar um bloco
  // reordenável: posição fixa por decisão de produto e compatibilidade com
  // os dados existentes (Business.about).
  const aboutData = business.about || { title: '', text: '', image: '', enabled: false };
  const aboutFilled = !!(aboutData.title || aboutData.text || aboutData.image);
  const aboutRow = (
    <div className={cn('px-3 py-2.5 border-t border-zinc-100', !aboutData.enabled && 'bg-zinc-50/60')}>
      <div className="flex items-center gap-2.5">
        <span className="w-6 shrink-0" />
        <span className="w-[18px] shrink-0 flex justify-center text-zinc-300"><Icon n="pin" size={11} /></span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm flex items-center gap-1.5 flex-wrap">
            <span className={cn(aboutData.enabled ? 'text-zinc-900' : 'text-zinc-400')}>Sobre a empresa</span>
            <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">seção fixa abaixo do Perfil</span>
            {!aboutFilled && (
              <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Falta preencher</span>
            )}
          </p>
          <p className="text-xs text-zinc-500 truncate">História, diferenciais e imagem do negócio</p>
        </div>
        <button aria-label="Editar Sobre a clínica" aria-expanded={editing === 'about'} onClick={() => setEditing(editing === 'about' ? null : 'about')}
          className="text-xs font-semibold bg-zinc-100 px-3 py-1.5 rounded-lg hover:bg-zinc-200">Editar</button>
        <button onClick={() => setBusiness({ ...business, about: { ...aboutData, enabled: !aboutData.enabled } })}
          className={cn('text-xs font-semibold px-3 py-1.5 rounded-lg min-w-[64px]', aboutData.enabled ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200')}>
          {aboutData.enabled ? 'Ativo' : 'Oculto'}
        </button>
      </div>
      {editing === 'about' && (
        <div className="mt-3 pt-3 border-t border-zinc-100">
          <AboutSectionEditor
            about={aboutData}
            onChange={about => setBusiness({ ...business, about })}
            businessId={businessId}
            onSave={async (a) => { if (await save({ about: a })) setEditing(null); }}
          />
        </div>
      )}
    </div>
  );
  const hasProfileBlock = blocks.some((b) => b.type === 'profile');

  const available = PAGE_SECTIONS
    .map((s) => ({ ...s, ok: s.available(blocks) }))
    .filter((s) => s.ok);
  const active = available.find((s) => s.id === section) ? section : 'modelo';
  const blockOf = (t: BlockType) => blocks.find((b) => b.type === t);
  const cardFor = (b: Block | undefined, extra?: React.ReactNode) => {
    if (!b) return null;
    return (
      <section className="pe-card" key={b.id}>
        <header className="pe-card__head">
          <div className="min-w-0">
            <p className="pe-card__title">
              {BLOCK_DEFS[b.type]?.label || b.type}
              {blockIsEmpty(b, rvCounts) && <span className="pe-tag pe-tag--warn">Falta preencher</span>}
              {!b.enabled && <span className="pe-tag">oculto na página</span>}
            </p>
            <p className="pe-card__hint">{BLOCK_DEFS[b.type]?.hint}</p>
          </div>
          <button onClick={() => updateBlocks(blocks.map((x) => (x.id === b.id ? { ...x, enabled: !x.enabled } : x)))}
            className={cn('pe-toggle', b.enabled && 'pe-toggle--on')}>
            {b.enabled ? 'Ativo' : 'Oculto'}
          </button>
        </header>
        <div className="pe-card__body">
          <BlockSettings
            block={b}
            businessId={businessId}
            business={business}
            onChange={(settings) => {
              const n = blocks.map((x) => (x.id === b.id ? { ...x, settings } : x));
              setPage({ ...page, blocks: n });
            }}
            onSave={async () => { await save({ blocks: page.blocks }); }}
            onRefresh={() => setReloadTick((t) => t + 1)}
          />
          {extra}
        </div>
      </section>
    );
  };

  return (
    <>
      {/* ══ TOPO DO EDITOR: estado real + ações globais ══ */}
      <div className="pe-top">
        <div className="min-w-0">
          {/* Sem eyebrow de branding: o breadcrumb do shell já dá o contexto
              (Início › Página); o nome da clínica vive no seletor de unidade. */}
          <h1 className="pe-title">Editor da página</h1>
        </div>
        <div className="pe-top__actions">
          <span className={cn('pe-state', business.published ? 'pe-state--on' : 'pe-state--draft')}>
            <span aria-hidden="true" className="pe-state__dot" />
            {business.published ? 'Publicado' : 'Rascunho'}
          </span>
          <span className="pe-state pe-state--muted" aria-live="polite">
            {saving ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Tudo salvo'}
          </span>
          <a href={`/${business.slug}`} target="_blank" rel="noreferrer" className="pe-btn">
            <Icon n="eye" size={13} /> Ver página <Icon n="external" size={11} />
          </a>
          <button type="button" disabled={saving} onClick={() => save({ published: true })} className="pe-btn pe-btn--green">
            <Icon n="upload" size={13} />
            {saving ? 'Publicando…' : business.published ? 'Atualizar publicação' : 'Publicar'}
          </button>
          <button type="button" disabled={saving || !dirty}
            onClick={() => save({ blocks: page.blocks, theme: page.theme, presetId: page.presetId })}
            className="pe-btn pe-btn--primary">
            <Icon n="check" size={13} />
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </div>
      {msg && <p role={msg.startsWith('Falha') ? 'alert' : 'status'} className={`pe-msg ${msg.startsWith('Falha') ? 'pe-msg--err' : ''}`}>{msg}</p>}

      {/* ══ WORKSPACE DO EDITOR: seções · formulário · prévia fixa ══ */}
      <div className="pe-grid">
        <nav className="pe-nav" aria-label="Seções do editor da página">
          {available.map((s) => (
            <button key={s.id} type="button" aria-current={active === s.id ? 'page' : undefined}
              onClick={() => setSection(s.id)} className="pe-nav__item">
              <Icon n={s.icon} size={15} /> <span>{s.label}</span>
            </button>
          ))}
        </nav>

        <div className="pe-form min-w-0">
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            {active === 'modelo' && (
              <>
                {/* HOMOLOGAÇÃO · P1 — Modelo = templates/preset da página. */}
                <ThemePresetCards
                  theme={page.theme}
                  presetId={page.presetId || undefined}
                  niche={business.niche}
                  clinicType={business.clinicType}
                  onApply={(t, id) => setPage({ ...page, theme: t, presetId: id })}
                />
                <div className="bg-white border border-zinc-200 rounded-lg p-4">
                  <p className="font-semibold text-sm mb-1">Itens do menu e blocos da página</p>
                  <p className="text-xs text-zinc-500 mb-3">Ordem, ativação e conteúdo dos blocos vivem em <strong>Seções da página</strong>. O menu público segue o que está ativo.</p>
                  <button type="button" onClick={() => setSection('secoes')}
                    className="text-sm font-semibold bg-[var(--surface-2)] text-[var(--text)] px-4 py-2 rounded-md hover:bg-[var(--brand-soft)] hover:text-[var(--brand-fg)]">
                    Abrir Seções da página
                  </button>
                </div>
              </>
            )}
            {active === 'secoes' && (
              <>
                <div className="bg-white border border-zinc-200 rounded-lg p-4">
                  <p className="font-semibold text-sm mb-1">Menu público e texto de apresentação</p>
                  <p className="text-xs text-zinc-500 mb-3">Configure os itens de navegação e o “Sobre” — o menu segue os blocos ativos.</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Abrir configuração do menu</summary>
                    <div className="mt-3">
                      <PageNavTab
                        business={business}
                        businessId={businessId}
                        blocks={blocks}
                        services={services}
                        products={products}
                        professionals={professionals}
                        reviewCount={rvCounts.published}
                        draft={navDraft} setDraft={setNavDraft}
                        onChangeAbout={about => setBusiness({ ...business, about })}
                        onSaveNav={(navItems) => save({ navItems })}
                        onAbout={(about) => save({ about } as any)}
                      />
                    </div>
                  </details>
                </div>

                <div className="space-y-4">
                  <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
                      <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Seções da página · {blocks.length} blocos</p>
                      <p className="text-[11px] text-zinc-400 hidden sm:block">ordenar, ativar e editar — Editar abre o bloco</p>
                    </div>
                    <div className="divide-y divide-zinc-100">
                      {blocks.map((b, i) => {
                        const gate = blockModuleGate(business, b.type);
                        return (
                          <div key={b.id} data-block-id={b.id}>
                          <div className={cn('px-3 py-2.5', !b.enabled && 'bg-zinc-50/60')}>
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="w-6 text-center text-[11px] font-semibold text-zinc-400 tabular-nums shrink-0">{i + 1}</span>
                              <div className="flex flex-col gap-0.5 shrink-0">
                                <button disabled={i === 0} onClick={() => { const n = [...blocks]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; updateBlocks(n); }}
                                  className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded p-2 disabled:opacity-20 disabled:hover:bg-transparent inline-flex" aria-label={`Mover ${BLOCK_DEFS[b.type]?.label || b.type} para cima`}><Icon n="chevU" size={12} /></button>
                                <button disabled={i === blocks.length - 1} onClick={() => { const n = [...blocks]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; updateBlocks(n); }}
                                  className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded p-2 disabled:opacity-20 disabled:hover:bg-transparent inline-flex" aria-label={`Mover ${BLOCK_DEFS[b.type]?.label || b.type} para baixo`}><Icon n="chevD" size={12} /></button>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm flex items-center gap-1.5 flex-wrap">
                                  <span className={cn(b.enabled ? 'text-zinc-900' : 'text-zinc-400')}>{BLOCK_DEFS[b.type]?.label || b.type}</span>
                                  {blockIsEmpty(b, rvCounts) && (
                                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Falta preencher</span>
                                  )}
                                  {gate && (
                                    <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full inline-flex items-center gap-1" title={`O módulo ${gate} está desligado — o bloco fica salvo, mas não aparece na página até o módulo voltar em Recursos.`}>
                                      <Icon n="lock" size={9} /> módulo {gate} desligado
                                    </span>
                                  )}
                                  {b.type === 'testimonials' && rvCounts.pending > 0 && (
                                    <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{rvCounts.pending} para aprovar</span>
                                  )}
                                  {b.type === 'testimonials' && rvCounts.published > 0 && (
                                    <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">{rvCounts.published} no ar</span>
                                  )}
                                </p>
                                <p className="text-xs text-zinc-500 truncate">{BLOCK_DEFS[b.type]?.hint}</p>
                              </div>
                              <button aria-label={`Editar ${BLOCK_DEFS[b.type]?.label || b.type}`} aria-expanded={editing === b.id} onClick={() => { setEditing(editing === b.id ? null : b.id); }}
                                className="text-xs font-semibold bg-zinc-100 px-3 py-1.5 rounded-lg hover:bg-zinc-200">Editar</button>
                              <button onClick={() => updateBlocks(blocks.map((x) => (x.id === b.id ? { ...x, enabled: !x.enabled } : x)))}
                                className={cn('text-xs font-semibold px-3 py-1.5 rounded-lg min-w-[64px]', b.enabled ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200')}>
                                {b.enabled ? 'Ativo' : 'Oculto'}
                              </button>
                              {b.type !== 'profile' && (
                                <button onClick={() => { if (confirm('Remover este bloco?')) updateBlocks(blocks.filter((x) => (x.id !== b.id))); }}
                                  className="text-xs font-semibold text-red-500 px-2 py-1.5 hover:bg-red-50 rounded-lg inline-flex" aria-label="Remover bloco"><Icon n="x" size={12} /></button>
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
                                  onSave={async () => { if (await save({ blocks: page.blocks })) setEditing(null); }}
                                  onRefresh={() => setReloadTick((t) => t + 1)}
                                />
                              </div>
                            )}
                          </div>
                          {b.type === 'profile' && aboutRow}
                          </div>
                        );
                      })}
                      {!hasProfileBlock && aboutRow}
                    </div>
                  </div>
                  <div className="bg-white border border-zinc-200 rounded-lg p-4 lg:sticky lg:top-4">
                    <p className="font-semibold text-sm mb-1">Adicionar bloco</p>
                    <p className="text-xs text-zinc-500 mb-3">Blocos de conversão seguem os módulos da empresa (Recursos).</p>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(BLOCK_DEFS) as BlockType[])
                        .filter((t) => t !== 'profile' && t !== 'booking' && t !== 'quote')
                        .map((t) => {
                          const gate = blockModuleGate(business, t);
                          return (
                            <button key={t} disabled={!!gate}
                              title={gate ? `Ative o módulo “${gate}” em Recursos para usar este bloco` : undefined}
                              onClick={() => updateBlocks([...blocks, { id: `b-${Date.now()}-${t}`, type: t, order: blocks.length, enabled: true, settings: {} }])}
                              className={cn('text-xs font-semibold px-3 py-2 rounded-lg transition-colors',
                                gate ? 'bg-[var(--surface-2)] text-[var(--text-muted)] cursor-not-allowed' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-fg)]')}>
                              + {BLOCK_DEFS[t]?.label}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </>
            )}
            {active === 'perfil' && (
              <>
{/* HOMOLOGAÇÃO · P1 — capa/hero da página pública (mesma fonte institucional). */}
                <div className="bg-white border border-zinc-200 rounded-lg p-4 space-y-2">
                  <p className="font-semibold text-sm">Capa da página</p>
                  <p className="text-xs text-zinc-500">Aparece no topo da página pública. A logo fica em Configurações → Identidade.</p>
                  <ImageUpload label="CAPA / HERO" value={business.cover || ''} onChange={(url) => setBusiness({ ...business, cover: url })} businessId={businessId} />
                </div>
                {cardFor(blockOf('profile'))}
                <section className="pe-card">
                  <header className="pe-card__head">
                    <div className="min-w-0">
                      <p className="pe-card__title">
                        Sobre a empresa
                        <span className="pe-tag">seção fixa abaixo do Perfil</span>
                        {!aboutFilled && <span className="pe-tag pe-tag--warn">Falta preencher</span>}
                      </p>
                      <p className="pe-card__hint">História, diferenciais e imagem do negócio.</p>
                    </div>
                    <button onClick={() => setBusiness({ ...business, about: { ...aboutData, enabled: !aboutData.enabled } })}
                      className={cn('pe-toggle', aboutData.enabled && 'pe-toggle--on')}>
                      {aboutData.enabled ? 'Ativo' : 'Oculto'}
                    </button>
                  </header>
                  <div className="pe-card__body">
                    <AboutSectionEditor
                      about={aboutData}
                      onChange={about => setBusiness({ ...business, about })}
                      businessId={businessId}
                      onSave={async (a) => { await save({ about: a }); }}
                    />
                  </div>
                </section>
              </>
            )}
            {active === 'servicos' && cardFor(blockOf('services'))}
            {active === 'equipe' && cardFor(blockOf('professionals'))}
            {active === 'contato' && (
              <>
                {cardFor(blockOf('buttons'))}
                {cardFor(blockOf('cta'))}
                {cardFor(blockOf('whatsapp'))}
                {cardFor(blockOf('quote'))}
              </>
            )}
            {active === 'avaliacoes' && (
              <>
                {cardFor(blockOf('testimonials'))}
                <section className="pe-card">
                  <header className="pe-card__head">
                    <div className="min-w-0">
                      <p className="pe-card__title">Moderação das avaliações</p>
                      <p className="pe-card__hint">O que entra no ar na seção de avaliações.</p>
                    </div>
                  </header>
                  <div className="pe-card__body"><ReviewsEditor businessId={businessId} /></div>
                </section>
              </>
            )}
            {active === 'faq' && cardFor(blockOf('faq'))}
            {active === 'localizacao' && (
              <>
                <LocationAddressEditor business={business} businessId={businessId}
                  onSave={(patch) => setBusiness({ ...business, ...patch })} />
                {cardFor(blockOf('location'))}
              </>
            )}
            {active === 'aparencia' && (
              <ThemeEditor theme={page.theme} presetId={page.presetId || ''} onChange={(theme, presetId) => { setPage({ ...page, theme, presetId }); }} onSave={() => save({ theme: page.theme, presetId: page.presetId || '' })} saving={saving} />
            )}
            {active === 'publicacao' && (
              <PublishTab business={business} businessId={businessId} onSlug={(slug) => save({ slug })} onPublish={(published) => save({ published })} />
            )}
          </fieldset>
        </div>

        {/* Prévia fixa — acompanha a edição. */}
        <aside className="pe-preview" aria-label="Prévia">
          <ClinicPreview business={previewBusiness} page={page} catalog={catalog} />
        </aside>
      </div>

      {/* Barra de progresso da configuração (mockup): dados reais do overview. */}
      {setup && setup.checklist.length > 0 && (
        <section className="dsh-card mt-4" aria-label="Próximos passos da configuração">
          <div className="dsh-card__head">
            <h2 className="dsh-card__title">Próximos passos</h2>
            <span className="text-[12px] font-semibold text-[var(--text-muted)]">
              {setup.checklist.filter((c) => c.done).length} de {setup.checklist.length} concluídos
            </span>
          </div>
          <div className="dsh-card__body">
            <div className="h-2 rounded-full bg-[var(--surface-3)] overflow-hidden mb-3" role="progressbar"
              aria-valuenow={setup.pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${setup.pct}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {setup.checklist.map((c) => (
                <span key={c.label} className={`pe-next__chip ${c.done ? 'pe-next__chip--done' : ''}`}>
                  <span className={`dsh-check__mark ${c.done ? 'dsh-check__mark--done' : 'dsh-check__mark--todo'}`} aria-hidden="true">
                    {c.done && <Icon n="check" size={12} />}
                  </span>
                  {c.label}
                </span>
              ))}
              {(() => {
                const next = setup.checklist.find((c) => !c.done);
                return next ? (
                  <Link href={`${next.href}${next.href.includes('?') ? '&' : '?'}b=${businessId}`} className="ws-newbtn ml-auto">
                    Continuar configuração <Icon n="chevronRight" size={14} />
                  </Link>
                ) : (
                  <span className="ml-auto text-[12px] font-semibold text-[var(--success-fg)] inline-flex items-center gap-1.5">
                    <Icon n="checkCircle" size={15} /> Configuração completa
                  </span>
                );
              })()}
            </div>
          </div>
        </section>
      )}

      {/* Telas estreitas: a mesma prévia abre em sheet, nunca some. */}
      <button type="button" className="pe-fab" onClick={() => setPreviewSheet(true)} aria-haspopup="dialog">
        <Icon n="monitor" size={15} /> Prévia
      </button>
      <WorkspaceSheet open={previewSheet} onClose={() => setPreviewSheet(false)} title="Prévia"
        icon="eye" width="min(560px, 94vw)">
        <div className="p-3"><ClinicPreview business={previewBusiness} page={page} catalog={catalog} /></div>
      </WorkspaceSheet>
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
function PageNavTab({ business, businessId, blocks, services, products, professionals, reviewCount, onSaveNav, onAbout, draft, setDraft, onChangeAbout }: {
  business: Business;
  businessId: string;
  blocks: Block[];
  services: Service[];
  products: Product[];
  professionals: Professional[];
  reviewCount: number;
  draft: NavItemConfig[] | null;
  setDraft: (value: NavItemConfig[] | null) => void;
  onChangeAbout: (about: Business['about']) => void;
  onSaveNav: (navItems: NavItemConfig[]) => void | Promise<boolean | void>;
  onAbout: (about: Business['about']) => void | Promise<boolean | void>;
}) {
  const about = business.about || { title: '', text: '', image: '', enabled: false };
  const aboutDraft = about;
  const setAboutDraft = onChangeAbout;
  const auto = (draft ?? business.navItems ?? []).length === 0;

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
  const current: NavItemConfig[] = draft?.length ? draft : (auto
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
            <p className="font-semibold text-sm">Itens do menu público</p>
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
          {current.filter((i) => knownIds.includes(i.id)).map((item, index, arr) => {
            const ok = available.has(item.id);
            const on = item.active !== false;
            // Agrupamento visual (auditoria da aba): âncoras da própria página
            // × links externos — conceitos diferentes, headers claros. A
            // ordem/lógica do menu NÃO muda (índice global preservado).
            const showGroupHeader = index === 0 || arr[index - 1].type !== item.type;
            return (
              <div key={item.id}>
                {showGroupHeader && (
                  <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 bg-zinc-50/60">
                    {item.type === 'anchor' ? 'Seções da página' : 'Links externos'}
                  </p>
                )}
                <div className={cn('flex flex-wrap items-center gap-2 px-3 py-2.5', !ok && 'bg-zinc-50/70')}>
                <div className="flex flex-col gap-0.5">
                  <button disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${labelOf(item.id)}`}
                    className="text-zinc-400 hover:text-zinc-900 disabled:opacity-20 px-0.5 inline-flex"><Icon n="chevU" size={11} /></button>
                  <button disabled={index === current.length - 1} onClick={() => move(index, 1)} aria-label={`Descer ${labelOf(item.id)}`}
                    className="text-zinc-400 hover:text-zinc-900 disabled:opacity-20 px-0.5 inline-flex"><Icon n="chevD" size={11} /></button>
                </div>
                <button onClick={() => ok && toggleItem(item)} disabled={!ok}
                  className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 transition-colors',
                    !ok ? 'bg-zinc-50 text-zinc-400 border-zinc-200 cursor-not-allowed'
                    : on ? 'bg-[var(--brand-soft)] text-[var(--brand-fg)] border-[var(--brand-border)]'
                    : 'bg-white text-[var(--text-muted)] border-[var(--border-strong)]')}
                  title={ok ? (on ? 'Visível no menu' : 'Oculto do menu') : unavailableHint(item.id)}>
                  {ok ? (on ? 'No menu' : 'Oculto') : 'Indisponível'}
                </button>
                <input aria-label={`Nome no menu: ${NAV_ANCHORS[item.id]?.label || item.id}`} value={item.label} onChange={(e) => rename(item, e.target.value)} disabled={!ok}
                  className="flex-1 min-w-[110px] bg-transparent border-0 focus:border focus:border-zinc-300 rounded-md px-2 py-1 text-sm font-semibold disabled:text-zinc-400"
                  placeholder={NAV_ANCHORS[item.id]?.label || item.id} maxLength={40} />
                <span className="text-[10px] font-semibold text-zinc-400 uppercase shrink-0 w-14 text-right">
                  {item.type === 'anchor' ? 'Seção' : 'Link'}
                </span>
                </div>
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
          <button disabled={!dirty} onClick={async () => { if (await onSaveNav(draft || []) !== false) setDraft(null); }}
            className="text-sm font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-4 py-2.5 rounded-md disabled:opacity-40">
            Salvar menu
          </button>
          {!auto && (
            <button onClick={() => setDraft([])} className="text-sm font-semibold bg-zinc-100 px-4 py-2.5 rounded-md hover:bg-zinc-200">
              Voltar ao automático
            </button>
          )}
          {dirty && (
            <button onClick={() => setDraft(null)} className="text-sm font-semibold text-zinc-500 px-3 py-2.5 rounded-md hover:text-zinc-900">Descartar</button>
          )}
        </div>
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm">Sobre a empresa</p>
          <button onClick={() => setAboutDraft({ ...aboutDraft, enabled: !about.enabled })}
            className={cn('text-xs font-medium px-3 py-1 rounded-full border', about.enabled ? 'bg-[var(--brand-soft)] text-[var(--brand-fg)] border-[var(--brand-border)]' : 'bg-white border-[var(--border)] text-[var(--text-muted)]')}>
            {about.enabled ? 'Visível' : 'Oculto'}
          </button>
        </div>
        <p className="text-xs text-zinc-500 -mt-1">Aparece na página logo abaixo do Perfil, quando ativado e com conteúdo.</p>
        <input aria-label="Título sobre a clínica" value={aboutDraft.title} onChange={(e) => setAboutDraft({ ...aboutDraft, title: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" placeholder="Título (ex: Sobre a clínica)" />
        <textarea aria-label="Texto sobre a clínica" value={aboutDraft.text} onChange={(e) => setAboutDraft({ ...aboutDraft, text: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" rows={3} placeholder="Ex: Somos uma clínica especializada em…" />
        <ImageUpload label="IMAGEM (OPCIONAL)" value={aboutDraft.image} onChange={(url) => setAboutDraft({ ...aboutDraft, image: url })} businessId={businessId} />
        <button onClick={() => onAbout(aboutDraft)} className="text-sm font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-4 py-2 rounded-md">Salvar “Sobre”</button>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EDITOR DA SEÇÃO "SOBRE" — compartilhado (Estrutura e Navegação).
// "Sobre a empresa" pertence à página pública: não existe página
// administrativa "Sobre" — só esta configuração dentro de Página.
// ═══════════════════════════════════════════════════════════════
function AboutSectionEditor({ about, businessId, onSave, onChange }: {
  about: Business['about'];
  businessId: string;
  onSave: (about: Business['about']) => void;
  onChange: (about: Business['about']) => void;
}) {
  const draft = about || { title: '', text: '', image: '', enabled: false };
  const set = (k: 'title' | 'text' | 'image', v: string) => onChange({ ...draft, [k]: v });
  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-zinc-500">TÍTULO</span>
        <input aria-label="Título sobre a clínica" value={draft.title} onChange={(e) => set('title', e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="Ex: Sobre a clínica" maxLength={80} />
      </div>
      <div>
        <span className="text-xs font-semibold text-zinc-500">TEXTO</span>
        <textarea aria-label="Texto sobre a clínica" value={draft.text} onChange={(e) => set('text', e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          rows={4} placeholder="Ex: Somos uma clínica especializada em…" maxLength={1200} />
      </div>
      <ImageUpload label="IMAGEM (OPCIONAL)" value={draft.image} onChange={(url) => set('image', url)} businessId={businessId} />
      <button onClick={() => onSave({ ...draft, enabled: !!draft.enabled })}
        className="text-sm font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-4 py-2 rounded-md">
        Salvar “Sobre”
      </button>
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


// HOMOLOGAÇÃO · P1 — Localização edita a MESMA fonte institucional do
// endereço (Business.address/…) que alimenta Configurações e a página.
function LocationAddressEditor({ business, businessId, onSave }: {
  business: Business;
  businessId: string;
  onSave: (patch: Partial<Business>) => void;
}) {
  const [draft, setDraft] = useState({
    address: business.address || '',
    mapsUrl: business.mapsUrl || '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: draft.address, mapsUrl: draft.mapsUrl }),
      });
      if (res.ok) {
        onSave({ address: draft.address, mapsUrl: draft.mapsUrl });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally { setSaving(false); }
  };
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3" data-testid="location-address-editor">
      <div>
        <p className="font-semibold text-sm">Endereço da clínica</p>
        <p className="text-xs text-zinc-500">Mesma fonte de Configurações → Contato — editar aqui atualiza o cadastro institucional.</p>
      </div>
      <label className="block">
        <span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Endereço completo</span>
        <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="Rua, número, bairro, cidade" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Link do Google Maps</span>
        <input value={draft.mapsUrl} onChange={(e) => setDraft({ ...draft, mapsUrl: e.target.value })}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="https://maps.app.goo.gl/…" />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving}
          className="text-sm font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-4 py-2 rounded-md disabled:opacity-60">
          {saving ? 'Salvando…' : 'Salvar endereço'}
        </button>
        {saved && <span className="text-xs font-semibold text-[var(--success)]">Salvo ✓</span>}
      </div>
    </div>
  );
}

function BlockSettings({ block, businessId, business, onChange, onSave, onRefresh }: {
  block: Block;
  businessId: string;
  business: Business;
  onChange: (s: Record<string, any>) => void;
  onSave: () => void;
  /** Recarrega negócio+página após uma mudança de módulo (ex.: ativar Produtos). */
  onRefresh?: () => void;
}) {
  const s = block.settings || {};
  const set = (k: string, v: any) => onChange({ ...s, [k]: v });
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
  const [activating, setActivating] = useState('');
  const [activateError, setActivateError] = useState('');

  // VITRINE → ATIVAÇÃO (auditoria §6): o caminho "Página → Vitrine de
  // produtos → Ativar" funciona ponta a ponta SEM depender de navegador:
  // ativa aqui mesmo (servidor salva → contexto do painel atualiza → o
  // bloco deixa de avisar que o módulo está desligado) — ou abre Recursos.
  async function activateModule(feature: 'products' | 'services' | 'bookings') {
    setActivating(feature);
    setActivateError('');
    try {
      const res = await apiSend<any>(`/api/businesses/${businessId}/features`, 'PATCH',
        { businessId, feature, enabled: true }, { scope: 'action', area: 'Página' });
      if (!res.ok) throw new Error(res.message || 'Não foi possível ativar.');
      // Atualiza o shell (menu/áreas) na hora e relê negócio+página — sem F5.
      window.dispatchEvent(new Event('il:business-refresh'));
      onRefresh?.();
    } catch (e: any) {
      setActivateError(e.message || 'Não foi possível ativar o módulo.');
    } finally {
      setActivating('');
    }
  }
  // Orçamento só aparece como destino se a empresa LEGADA ainda tem o módulo
  // ligado — novas experiências não oferecem pedidos/orçamentos.
  const quoteLegacy = (business.modes || []).includes('quote');
  const productsOn = (business.modes || []).includes('products') || (business.modes || []).includes('orders');
  const bookingsOn = (business.modes || []).includes('bookings');

  return (
    <div className="space-y-3">
      {['cta', 'products', 'services', 'booking', 'contact', 'quote', 'concierge', 'highlights', 'professionals', 'gallery', 'testimonials', 'faq', 'location'].includes(block.type) && (
        <label className="block">
          <span className="text-xs font-semibold text-zinc-500">{block.type === 'cta' ? 'TEXTO DO BOTÃO' : 'TÍTULO'}</span>
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
          <span className="text-xs font-semibold text-zinc-500">SUBTÍTULO (OPCIONAL)</span>
          <input value={s.subtitle || ''} onChange={(e) => set('subtitle', e.target.value.slice(0, 120))}
            className={input + ' mt-1'} placeholder="Uma linha que explica a seção (ex: Toque em um serviço para agendar)" />
        </label>
      )}
      {block.type === 'cta' && (
        <label className="block">
          <span className="text-xs font-semibold text-zinc-500">DESTINO DO BOTÃO</span>
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
            <div className="space-y-2">
              <p className="text-amber-700">○ Com o módulo desligado, a vitrine não aparece na página (nada foi apagado).</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  type="button"
                  onClick={() => activateModule('products')}
                  disabled={!!activating}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold pe-btn--green px-3.5 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-60">
                  {activating === 'products' && <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  Ativar Produtos agora
                </button>
                <Link href={`/recursos?b=${businessId}`} className="font-semibold text-zinc-900 underline">ou abrir as capacidades do sistema →</Link>
              </p>
              {activateError && <p className="text-red-700 font-semibold">{activateError}</p>}
            </div>
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
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[var(--danger)] text-white text-xs font-semibold flex items-center justify-center opacity-90 hover:opacity-100">
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
                  <summary className="text-[11px] font-semibold text-zinc-500 cursor-pointer">ou colar URLs (uma por linha)</summary>
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
          <p className="text-xs font-semibold text-zinc-500 pt-1">DEPOIMENTOS FIXOS (aparecem só se nenhuma avaliação estiver publicada)</p>
          <input value={s.title || ''} onChange={(e) => set('title', e.target.value)} className={input} placeholder="Título (opcional)" />
          <textarea value={(s.items || []).map((t: any) => `${t.name || ''} | ${t.text || ''}`).join('\n')}
            onChange={(e) => set('items', e.target.value.split('\n').map((line) => { const [name, text] = line.split('|').map((x) => (x || '').trim()); return { name, text }; }).filter((t) => t.text))}
            className={input} rows={4} placeholder={'Maria | Melhor corte da cidade!\nJoão | Atendimento nota 10'} />
        </>
      )}
      {block.type === 'faq' && (
        <>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">TÍTULO DA SEÇÃO (OPCIONAL)</span>
            <input value={s.title || ''} onChange={(e) => set('title', e.target.value)} className={input + ' mt-1'} placeholder="Ex: Dúvidas frequentes" />
          </label>
          <FaqEditor items={s.items} onChange={(items) => set('items', items)} inputClass={input} />
        </>
      )}
      {block.type === 'highlights' && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-500 pt-1">DIFERENCIAIS (UM POR LINHA)</p>
          <p className="text-[11px] text-zinc-500 -mt-1">Título é obrigatório; texto e ícone são opcionais. Ex.: “Atendimento no dia”, “Primeira avaliação grátis”.</p>
          {((Array.isArray(s.items) ? s.items : [{ icon: '', title: '', text: '' }]) as any[]).map((it, i, arr) => (
            <div key={i} className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-zinc-600">Item {i + 1}</p>
                {arr.length > 1 && (
                  <button type="button" onClick={() => set('items', arr.filter((_, j) => j !== i))}
                    className="text-[11px] font-semibold text-red-600 px-2 py-1 rounded-lg hover:bg-red-50">Remover</button>
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
            className="text-sm font-semibold bg-zinc-100 text-zinc-700 px-4 py-2 rounded-md hover:bg-zinc-200">+ Adicionar diferencial</button>
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
      <button onClick={onSave} className="text-sm font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-4 py-2 rounded-md">Salvar bloco</button>
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
            <p className="text-sm font-semibold text-zinc-700">Pergunta {index + 1}</p>
            {savedItems.length > 0 && (
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-xs font-semibold text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
                aria-label={`Remover pergunta ${index + 1}`}
              >
                Remover
              </button>
            )}
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">PERGUNTA</span>
            <input
              value={item.q}
              onChange={(event) => updateItem(index, 'q', event.target.value)}
              className={inputClass + ' mt-1'}
              placeholder="Ex: Qual o horário de atendimento?"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-zinc-500">RESPOSTA</span>
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
        className="text-sm font-semibold bg-zinc-100 text-zinc-700 px-4 py-2 rounded-md hover:bg-zinc-200"
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
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
            <Icon n="star" size={13} /> {r.rating}/5
          </span>
          <span className="text-xs font-semibold">{r.customerName}</span>
          {r.source === 'google' && (
            <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">Google</span>
          )}
        </div>
        {r.text && <p className="text-sm text-zinc-600 mt-1">“{r.text}”</p>}
        <div className="flex gap-2 mt-2">
          {r.status !== 'published' && (
            <button disabled={acting === r.id} onClick={() => setStatus(r.id, 'published')}
              className="text-xs font-semibold pe-btn--green px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              Publicar
            </button>
          )}
          {r.status !== 'hidden' && (
            <button disabled={acting === r.id} onClick={() => setStatus(r.id, 'hidden')}
              className="text-xs font-semibold bg-zinc-100 px-3 py-1.5 rounded-lg hover:bg-zinc-200 disabled:opacity-50">
              Ocultar
            </button>
          )}
          {r.status === 'hidden' && (
            <button disabled={acting === r.id} onClick={() => setStatus(r.id, 'pending')}
              className="text-xs font-semibold bg-zinc-100 px-3 py-1.5 rounded-lg hover:bg-zinc-200 disabled:opacity-50">
              Reavaliar
            </button>
          )}
          <button onClick={() => remove(r.id)}
            className="text-xs font-semibold text-red-500 px-2 py-1.5 hover:bg-red-50 rounded-lg">
            Excluir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
      <p className="text-xs font-semibold text-zinc-500">AVALIAÇÕES DOS CLIENTES (vão para a página ao publicar — máx. 4 no ar)</p>
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
              <p className="text-xs font-semibold text-blue-700">AGUARDANDO APROVAÇÃO ({pending.length})</p>
              {pending.map(row)}
            </div>
          )}
          {published.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-emerald-700">NO AR ({published.length})</p>
              {published.map(row)}
            </div>
          )}
          {hidden.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500">OCULTAS ({hidden.length})</p>
              {hidden.map(row)}
            </div>
          )}
        </div>
      )}
      <div className="pt-1 space-y-2 border-t border-zinc-200">
        <p className="text-xs font-semibold text-zinc-500 pt-2">GOOGLE (opcional)</p>
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
            className="text-xs font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-3 py-2 rounded-lg disabled:opacity-50">
            Salvar Google
          </button>
          <button disabled={acting === 'import'} onClick={importGoogle}
            className="text-xs font-semibold bg-zinc-100 px-3 py-2 rounded-lg hover:bg-zinc-200 disabled:opacity-50">
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
/** Cartões VISUAIS de modelo — o ponto de partida da página, como no mockup
    da seção "Modelo": aparência inicial em miniatura, estado aplicado e
    recomendação por contexto do negócio (quando o nicho existe). */
function ThemePresetCards({ theme, presetId, niche, clinicType, onApply }: {
  theme: Theme; presetId?: string; niche?: string;
  /** FASE 2 · P9 — tipo da clínica: destaca o modelo do preset (mesmos blocos). */
  clinicType?: string;
  onApply: (t: Theme, id: string) => void;
}) {
  const match = matchingPreset(theme);
  const baseName = presetId ? presetById(presetId).name : '';
  const NICHE_REC: Record<string, string> = { alimentacao: 'pordosol', beleza: 'rose', pet: 'fresh', saude: 'fresh', loja: 'noite', servicos: 'oceano' };
  const NICHE_LABEL: Record<string, string> = { alimentacao: 'alimentação', beleza: 'beleza', pet: 'pet', saude: 'saúde', loja: 'loja', servicos: 'serviços' };
  const rec = niche ? NICHE_REC[niche] : undefined;
  // FASE 2 · P9 — o modelo do tipo da clínica aparece PRIMEIRO, com selo.
  const clinicLabel: Record<string, string> = {
    medica: 'médica', odontologica: 'odontológica', veterinaria: 'veterinária',
    estetica: 'estética', particular: 'profissional particular', geral: 'clínica',
  };
  const suggestedId = clinicType ? clinicPresetId(clinicType) : '';
  const ordered = suggestedId
    ? [...THEME_PRESETS].sort((a, b) => (a.id === suggestedId ? -1 : b.id === suggestedId ? 1 : 0))
    : THEME_PRESETS;
  return (
      <div className="bg-white border border-zinc-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <p className="font-semibold text-sm">Modelos prontos</p>
          {match ? (
            <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full inline-flex items-center gap-1">
              {presetById(match).name} aplicado <Icon n="check" size={12} />
            </span>
          ) : (
            <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-3 py-1 rounded-full">
              Personalizado{baseName ? ` (base: ${baseName})` : ''}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mb-4">Escolha uma combinação fechada de cores, fonte e formato — depois ajuste o que quiser abaixo.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ordered.map((p) => (
            <button key={p.id} onClick={() => onApply({ ...p.theme }, p.id)}
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
              <span className="block text-xs font-semibold mt-1.5 px-0.5">{p.name}</span>
              <span className="block text-[11px] text-zinc-500 px-0.5 leading-tight">{p.hint}</span>
              {suggestedId === p.id && match !== p.id && (
                <span className="block mt-1 px-0.5">
                  <span className="text-[10px] font-semibold bg-[var(--brand-soft)] text-[var(--brand-fg)] px-2 py-0.5 rounded-full">Sugerido para clínica {clinicLabel[p.clinicType || ''] || ''}</span>
                </span>
              )}
              {!(suggestedId === p.id) && rec === p.id && match !== p.id && niche && (
                <span className="block mt-1 px-0.5">
                  <span className="text-[10px] font-semibold bg-[var(--brand-soft)] text-[var(--brand-fg)] px-2 py-0.5 rounded-full">Recomendado para {NICHE_LABEL[niche]}</span>
                </span>
              )}
            </button>
          ))}
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
      <div className="space-y-4">
        <details className="bg-white border border-zinc-200 rounded-lg p-5" open>
          <summary className="font-semibold text-sm cursor-pointer">Ajustar cores e detalhes</summary>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
            {colors.map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-xs font-semibold text-zinc-500">{label.toUpperCase()}</span>
                <span className="mt-1 flex items-center gap-2">
                  <input type="color" value={theme[key] as string} onChange={(e) => set(key, e.target.value)} className="w-10 h-10 rounded-lg border border-zinc-200 bg-white p-1 shrink-0" />
                  <input value={theme[key] as string} onChange={(e) => set(key, e.target.value)} className="w-full min-w-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-mono" />
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">CANTOS</span>
              <input type="range" min={0} max={28} value={theme.radius} onChange={(e) => set('radius', Number(e.target.value))} className="w-full mt-2" />
              <span className="text-xs text-zinc-500">{theme.radius}px</span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">TIPOGRAFIA</span>
              <select value={theme.font} onChange={(e) => set('font', e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-2 text-sm">
                {fonts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-500">BOTÕES</span>
              <select value={theme.buttonStyle} onChange={(e) => set('buttonStyle', e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-2 text-sm">
                <option value="solid">Cheio</option>
                <option value="soft">Suave</option>
                <option value="outline">Contorno</option>
              </select>
            </label>
          </div>
          <button onClick={onSave} disabled={saving} className="mt-4 text-sm font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-5 py-2.5 rounded-md disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar visual'}
          </button>
        </details>
        <div className="rounded-lg p-5" style={{ background: theme.background, color: theme.text }}>
          <p className="text-xs font-semibold opacity-60 mb-3">Prévia</p>
          <div className="text-center mb-3">
            <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center font-semibold"
              style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`, color: '#fff' }}>SN</div>
            <p className="font-semibold mt-2">Seu negócio</p>
            <p className="text-xs" style={{ color: theme.muted }}>Prévia</p>
          </div>
          <div className="p-4" style={{ background: theme.surface, borderRadius: theme.radius, border: '1px solid rgba(0,0,0,0.08)' }}>
            <p className="font-semibold text-sm">Card de exemplo</p>
            <p className="text-sm" style={{ color: theme.muted }}>Assim ficam os textos e cards.</p>
            <div className="mt-3 font-semibold text-center py-3 text-sm" style={{ background: theme.buttonStyle === 'solid' ? theme.primary : 'transparent', color: theme.buttonStyle === 'solid' ? '#fff' : theme.primary, borderRadius: theme.radius, border: theme.buttonStyle === 'solid' ? 'none' : `2px solid ${theme.primary}` }}>Botão principal</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublishTab({ business, onSlug, onPublish }: { business: Business; businessId: string; onSlug: (slug: string) => void; onPublish: (p: boolean) => void }) {
  const [slug, setSlug] = useState(business.slug);
  useUnsavedChanges(slug !== business.slug);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
        <div>
          <p className="font-semibold text-sm">Status</p>
          <p className="text-sm text-zinc-500 mt-0.5">{business.published ? <><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 align-middle" /> Sua página está no ar.</> : <><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 align-middle" /> Sua página está como rascunho (só você vê).</>}</p>
          <button onClick={() => onPublish(!business.published)}
            className={cn('mt-3 text-sm font-semibold px-5 py-2.5 rounded-md', business.published ? 'bg-zinc-100 hover:bg-zinc-200' : 'pe-btn--green')}>
            {business.published ? 'Despublicar' : 'Publicar página'}
          </button>
        </div>
        <div>
          <p className="font-semibold text-sm">Endereço</p>
          <div className="mt-1.5 flex gap-2">
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2.5 text-sm font-mono" />
            <button onClick={() => onSlug(slug)} className="text-sm font-semibold bg-[var(--brand)] text-white shadow-brand hover:bg-[var(--brand-strong)] px-4 py-2.5 rounded-md">Salvar</button>
          </div>
          <p className="text-xs text-zinc-500 mt-1">godoutor.app/{slug}</p>
        </div>
      </div>
      <div className="bg-white border border-zinc-200 rounded-lg p-5 text-center">
        <p className="font-semibold text-sm">QR Code da sua página</p>
        <p className="text-xs text-zinc-500 mb-3">Imprima e cole na recepção ou em materiais da clínica.</p>
        <img src={`/api/qr?text=${encodeURIComponent(`${origin}/${business.slug}`)}`} alt="QR Code da página"
          className="mx-auto w-48 h-48 rounded-lg border border-zinc-200" />
        <a href={`/api/qr?text=${encodeURIComponent(`${origin}/${business.slug}`)}`} download={`qr-${business.slug}.png`}
          className="inline-block mt-3 text-sm font-semibold bg-zinc-100 px-4 py-2 rounded-md hover:bg-zinc-200">Baixar QR</a>
      </div>
    </div>
  );
}
