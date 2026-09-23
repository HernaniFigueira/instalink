'use client';
// ═══════════════════════════════════════════════════════════════
// SIDEBAR DO APP SHELL — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// Objetivo: acabar com a sensação de "lista infinita". A arquitetura vem de
// lib/workspace-navigation.ts (apresentação) sobre o catálogo lib/panel.ts
// (rotas + permissões + módulos). Nenhuma rota é apagada aqui: item com
// `sidebar: false` continua existindo por URL e por atalho contextual.
//
//   Principal      Início · Agenda · Clientes · Conversas      (links diretos)
//   Operação       Estrutura da clínica (grupo) · Tarefas
//   Comercial      Funil
//   Presença       Página
//   Inteligência   Automação (grupo)
//   Administração  Gestão (grupo) · Ajustes (grupo)
//
// Grupo abre a SEGUNDA COLUNA CONTEXTUAL — é assim que "Estrutura da clínica"
// reúne Serviços/Profissionais/Disponibilidade/Equipe sem unificar modelo de
// dado (Professional e User/Member continuam separados internamente).
//
// A busca NÃO mora mais aqui (foi para a topbar) e o seletor de unidade foi
// para o menu da conta. Aqui ficam: identidade da clínica, menu e recolher.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Drawer } from '@/components/ui';
import type { panelNavigation } from '@/lib/panel';
import {
  areaOfRoute, workspaceAreas, workspaceSections, type WorkspaceArea,
} from '@/lib/workspace-navigation';

type Unit = { id: string; name: string; logo?: string; slug: string; role?: string; organizationId?: string };
type Nav = ReturnType<typeof panelNavigation>;
type NavItem = Nav['allowed'][number];

export function WorkspaceNavigation({ nav, activePath, unit, collapsed, onCollapse, mobileOpen, onMobileOpen }: {
  nav: Nav; activePath: string; unit: Unit; collapsed: boolean; onCollapse: () => void;
  /** Estado do drawer móvel pertence ao shell: é a topbar que abre o menu. */
  mobileOpen?: boolean; onMobileOpen?: (open: boolean) => void;
}) {
  const setMobile = (open: boolean) => onMobileOpen?.(open);
  const mobile = !!mobileOpen;
  const areas = useMemo(() => workspaceAreas(nav.allowed), [nav.allowed]);
  const sections = useMemo(() => workspaceSections(areas), [areas]);

  // Destinos com `sidebar: false` não ocupam linha no menu (régua: frequência),
  // mas continuam acessíveis por URL/atalho contextual.
  const visible = (items: NavItem[]) => items.filter((i) => i.sidebar !== false);

  const activeArea = areaOfRoute(activePath, areas);
  const isGroup = (area: WorkspaceArea) => !sections.some(
    (s) => s.groups.some((g) => g.flat && g.area.id === area.id),
  );
  const activeGroup = activeArea && isGroup(activeArea) ? activeArea.id : null;

  const [opened, setOpened] = useState<string | null>(activeGroup);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);

  useEffect(() => {
    setOpened(activeGroup);
    setMobile(false);
    setMobileGroup(null);
  }, [activePath, unit.id, activeGroup]);

  // Ao crescer para desktop o drawer móvel não pode ficar aberto por cima.
  useEffect(() => {
    const media = window.matchMedia?.('(min-width:1200px)');
    const close = () => { if (media?.matches) setMobile(false); };
    media?.addEventListener?.('change', close);
    return () => media?.removeEventListener?.('change', close);
  }, []);

  const selected = areas.find((a) => a.id === opened && isGroup(a));
  const mobileSelected = areas.find((a) => a.id === mobileGroup);

  function hrefFor(item: NavItem) {
    if (item.href === '/organizacao') return `/organizacao?organization=${unit.organizationId || ''}`;
    return item.requiresBusiness === false ? item.href : `${item.href}?b=${unit.id}`;
  }

  const link = (item: NavItem, area?: WorkspaceArea, primary = false) => (
    <Link
      key={item.href}
      href={hrefFor(item)}
      data-nav-item={item.href}
      aria-label={item.label}
      aria-current={activePath === item.href ? 'page' : undefined}
      title={collapsed ? `${item.label} — ${item.description}` : item.description}
      onClick={() => { setMobile(false); if (primary) setOpened(null); }}
      className={`workspace-link${collapsed ? ' il-tip' : ''}`}
      {...(collapsed ? { 'data-tip': item.label } : {})}
    >
      <span className="workspace-link__icon" style={{ color: area?.color || 'var(--text-muted)' }}>
        <Icon n={item.icon} size={19} />
      </span>
      <span className="workspace-label">{item.label}</span>
      {activePath === item.href && <span className="workspace-link__rail" data-nav-rail aria-hidden="true" />}
    </Link>
  );

  const groupButton = (area: WorkspaceArea, onSelect: (id: string) => void, current: string | null) => {
    const items = visible(area.items);
    if (!items.length) return null;
    const open = current === area.id;
    return (
      <button
        key={area.id}
        type="button"
        className={`workspace-link workspace-link--group${collapsed ? ' il-tip' : ''}`}
        aria-label={area.label}
        aria-expanded={open}
        title={collapsed ? area.label : undefined}
        {...(collapsed ? { 'data-tip': area.label } : {})}
        onClick={(e) => {
          // No drawer móvel o foco volta para o título do diálogo (padrão do
          // componente), evitando que o foco fique preso no botão que saiu.
          e.currentTarget.closest('dialog')?.querySelector<HTMLElement>('h2')?.focus();
          onSelect(open ? '' : area.id);
        }}
      >
        <span className="workspace-link__icon" style={{ color: area.color }}><Icon n={area.icon} size={19} /></span>
        <span className="workspace-label">{area.label}</span>
        {!collapsed && (
          <Icon n="chevronRight" size={15} className="workspace-link__chevron" aria-hidden="true" />
        )}
        {open && <span className="workspace-link__rail" data-nav-rail aria-hidden="true" />}
      </button>
    );
  };

  const identity = (
    <div className="workspace-identity">
      {/* Identidade da CLÍNICA (logo quando existe). O fallback usa a marca
          atual do produto — o rebrand é outra frente e não entra nesta rodada,
          para não deixar a marca aplicada pela metade. */}
      {unit.logo
        ? <img src={unit.logo} alt="" className="workspace-logo" />
        : <span className="workspace-wordmark">Insta<span>Link</span></span>}
      {!collapsed && <p className="workspace-clinic" title={unit.name}>{unit.name || 'Minha clínica'}</p>}
    </div>
  );

  const menu = (onSelect: (id: string) => void, current: string | null) => (
    <>
      {sections.map((section) => {
        const rows = section.groups.flatMap(({ area, flat }) =>
          flat ? visible(area.items).map((item) => link(item, area, true)) : [groupButton(area, onSelect, current)],
        ).filter(Boolean);
        if (!rows.length) return null;
        return (
          <div className="workspace-section" key={section.id}>
            {!collapsed && <p className="workspace-section__label">{section.label}</p>}
            {collapsed && <span className="workspace-section__rule" aria-hidden="true" />}
            {rows}
          </div>
        );
      })}
    </>
  );

  return (
    <>
      <aside className={`workspace-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Navegação da clínica">
        {identity}
        <nav aria-label="Menu principal" className="workspace-primary ws-scroll">
          {menu((id) => setOpened(id || null), opened)}
        </nav>
        <div className="workspace-footer">
          {!collapsed && unit.slug && (
            <a className="workspace-public-link" href={`/${unit.slug}`} target="_blank" rel="noreferrer">
              <Icon n="external" size={14} /> Página pública
            </a>
          )}
          <button
            type="button"
            aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
            onClick={onCollapse}
            className={`workspace-icon-button${collapsed ? ' il-tip' : ''}`}
            title={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
            {...(collapsed ? { 'data-tip': 'Expandir navegação', 'data-tip-pos': 'top' } : {})}
          >
            <Icon n={collapsed ? 'expand' : 'collapse'} size={18} />
            {!collapsed && <span className="workspace-label">Recolher</span>}
          </button>
        </div>
      </aside>

      {/* Segunda coluna contextual: só para subáreas (nunca para o conteúdo). */}
      {selected && (
        <aside className="workspace-secondary ws-scroll" aria-label={`Submenu ${selected.label}`}>
          <header>
            <h2 style={{ color: selected.color }}>{selected.label}</h2>
            <button type="button" className="workspace-icon-button" aria-label="Fechar submenu" onClick={() => setOpened(null)}>
              <Icon n="x" size={17} />
            </button>
          </header>
          <nav aria-label={selected.label}>{visible(selected.items).map((item) => link(item, selected))}</nav>
        </aside>
      )}

      {/* Mobile: UM diálogo com passo de voltar (nunca duas colunas na tela). */}
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        title={mobileSelected?.label || 'Navegar na clínica'}
        width="max-w-[420px]"
      >
        {mobileSelected ? (
          <div className="p-3">
            <button type="button" className="workspace-link"
              onClick={(e) => { e.currentTarget.closest('dialog')?.querySelector<HTMLElement>('h2')?.focus(); setMobileGroup(null); }}>
              <Icon n="collapse" size={18} /> <span className="workspace-label">← Voltar</span>
            </button>
            <nav aria-label={mobileSelected.label}>{visible(mobileSelected.items).map((item) => link(item, mobileSelected))}</nav>
          </div>
        ) : (
          <>
            {identity}
            <nav aria-label="Menu móvel" className="p-3">{menu(setMobileGroup, mobileGroup)}</nav>
          </>
        )}
        {unit.slug && (
          <div className="workspace-footer">
            <a className="workspace-public-link" href={`/${unit.slug}`} target="_blank" rel="noreferrer">
              <Icon n="external" size={14} /> Página pública
            </a>
          </div>
        )}
      </Drawer>
    </>
  );
}
