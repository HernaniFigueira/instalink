'use client';
// ═══════════════════════════════════════════════════════════════
// SIDEBAR DO APP SHELL — missão UX Closure · item 1
// ═══════════════════════════════════════════════════════════════
// COMPORTAMENTO (o que o usuário vê e sente):
//
//   ┌──────────────────────── TOPBAR full-width ────────────────────────┐
//   │ [logo] Andrioni Veterinaria        busca        +  sino  ajuda  eu │
//   ├────┬──────────────────────────────────────────────────────────────┤
//   │ ▪  │                        CONTEÚDO                              │
//   │ ▪◄─┼─┐ painel do grupo COLADO no rail (sai de trás dele)          │
//   │ ▪  │ │  Serviços · Disponibilidade · Equipe…                      │
//   └────┴─┴──────────────────────────────────────────────────────────────┘
//
//  • a topbar continua full-width e ACIMA de tudo; ela carrega a identidade
//    (logo + nome completo). A sidebar NÃO repete nome nem logo;
//  • a sidebar é um RAIL BRANCO ESTREITO (~60px) — sem botão flutuante de
//    expandir/recolher, sem estado persistido de largura: não existe "modo
//    expandido" no desktop, então nada empurra o conteúdo;
//  • links diretos continuam diretos (Visão geral, Agenda, Conversas,
//    Pendências, Clientes… conforme autorização real);
//  • grupos (Clínica, Automação, Gestão, Configurações) abrem uma EXTENSÃO
//    fisicamente ligada ao rail: mesma superfície branca, UMA divisória
//    vertical fina, sem gap morto, sem sombra pesada, sem cara de modal;
//  • abrir/recolher em ~180ms; mover o cursor do ícone para a área branca
//    MANTÉM aberto; fecha só quando o ponteiro sai de rail + painel, com
//    pequeno atraso (mata o flicker); passar direto de Clínica → Automação →
//    Gestão troca o conteúdo sem fechar/reabrir;
//  • teclado equivalente ao hover: foco abre, ↑/↓ andam nos destinos, ← ou
//    Escape volta para o grupo e fecha.
//
// A arquitetura de informação vem de lib/workspace-navigation.ts
// (apresentação) sobre o catálogo lib/panel.ts (rotas + permissões + módulos).
// Nenhuma rota é criada nem apagada aqui: item com `sidebar: false` continua
// existindo por URL e aparece no painel do grupo dono.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { useSidebarPeek } from '@/lib/sidebar-peek';
import { Drawer } from '@/components/ui';
import { useRevalidateOnFocus } from './use-revalidate';
import { loadOverview, navAllowsOverview } from '@/lib/overview';
import { apiGet } from '@/lib/api-client';
import { isLegacyPagesEnabled } from '@/lib/product';
import type { panelNavigation } from '@/lib/panel';
import {
  areaOfRoute, workspaceAreas, workspacePanelItems, workspaceRailItems, workspaceSections,
  type WorkspaceArea,
} from '@/lib/workspace-navigation';

type Unit = {
  id: string; name: string; logo?: string; slug: string; role?: string;
  organizationId?: string;
};
type Nav = ReturnType<typeof panelNavigation>;
type NavItem = Nav['allowed'][number];

export function WorkspaceNavigation({ nav, activePath, unit, units = [], multiUnit, mobileOpen, onMobileOpen, onHelp, onUnit }: {
  nav: Nav; activePath: string; unit: Unit;
  /** Estado do drawer móvel pertence ao shell: é a topbar que abre o menu. */
  mobileOpen?: boolean; onMobileOpen?: (open: boolean) => void;
  /** Unidades disponíveis (troca real de contexto). Uma só = sem seletor. */
  units?: Array<{ id: string; name: string; logo?: string; role?: string }>;
  /** true = existe mais de uma unidade (multiunidade REAL). */
  multiUnit?: boolean;
  /** Abre a central de ajuda (sheet do shell). */
  onHelp?: () => void;
  /** Troca de unidade a partir da topbar (mantido no contrato do shell). */
  onUnit?: (id: string) => void;
}) {
  const setMobile = (open: boolean) => onMobileOpen?.(open);
  const mobile = !!mobileOpen;
  const legacyPagesEnabled = isLegacyPagesEnabled();
  const areas = useMemo(() => workspaceAreas(nav.allowed, { multiUnit }), [nav.allowed, multiUnit]);
  const sections = useMemo(() => workspaceSections(areas), [areas]);
  // REGRA ÚNICA de exibição (lib): rail = frequência; painel = tudo que é
  // autorizado. Nenhuma tela recria essa decisão.
  const railItems = useCallback((area: WorkspaceArea) => workspaceRailItems(area, { legacyPages: legacyPagesEnabled }), [legacyPagesEnabled]);
  const panelItems = useCallback((area: WorkspaceArea) => workspacePanelItems(area, { legacyPages: legacyPagesEnabled }), [legacyPagesEnabled]);

  // Mini-card de setup: MESMO checklist real do /api/overview. É ONBOARDING,
  // não decoração permanente: enquanto houver passo pendente ele aparece; ao
  // completar 100% sai de cena (o rodapé fica para Ajuda e suporte).
  const [setup, setSetup] = useState<{ pct: number; href: string } | null>(null);
  const overviewAllowed = navAllowsOverview(nav);
  const loadSetup = useCallback((businessId: string) => {
    if (!businessId) return;
    if (!overviewAllowed) { setSetup(null); return; }
    let on = true;
    loadOverview(businessId, 7, { scope: 'area', area: 'Visão geral' })
      .then((r) => {
        if (!on || !r.ok) return;
        const checklist = r.data?.checklist || [];
        const visibleChecklist = legacyPagesEnabled ? checklist : checklist.filter((c) => c.href.split('?')[0] !== '/pagina');
        const next = visibleChecklist.find((c) => !c.done);
        const pending = visibleChecklist.filter((c) => !c.done).length;
        const pct = legacyPagesEnabled
          ? (r.data?.pct ?? 0)
          : visibleChecklist.length
            ? Math.round((visibleChecklist.filter((c) => c.done).length / visibleChecklist.length) * 100)
            : 100;
        setSetup(next && pending && pct < 100 ? { pct, href: next.href } : null);
      }).catch(() => { if (on) setSetup(null); });
    return () => { on = false; };
  }, [legacyPagesEnabled, overviewAllowed]);
  useEffect(() => loadSetup(unit.id), [unit.id, loadSetup]);
  useEffect(() => {
    const refresh = () => loadSetup(unit.id);
    window.addEventListener('godoutor:overview-refresh', refresh);
    window.addEventListener('godoutor:business-refresh', refresh);
    return () => {
      window.removeEventListener('godoutor:overview-refresh', refresh);
      window.removeEventListener('godoutor:business-refresh', refresh);
    };
  }, [unit.id, loadSetup]);
  useRevalidateOnFocus(() => loadSetup(unit.id), 30_000);

  const activeArea = areaOfRoute(activePath, areas);
  // Grupo DONO da rota ativa (marca `is-active`): só grupos que desenham linha
  // própria. Destinos com `sidebar: false` vivem de atalho contextual e não
  // criam grupo vazio.
  const activeGroup = activeArea && sections.some(
    (s) => s.groups.some((g) => !g.flat && g.area.id === activeArea.id),
  ) ? activeArea.id : null;

  useEffect(() => {
    // Trocar de rota/unidade fecha o painel de grupo (nada de painel órfão
    // apontando para outra tela) e o drawer móvel.
    setMobile(false);
  }, [activePath, unit.id]);

  // Ao crescer para desktop o drawer móvel não pode ficar aberto por cima.
  useEffect(() => {
    const media = window.matchMedia?.('(min-width:1200px)');
    const close = () => { if (media?.matches) setMobile(false); };
    media?.addEventListener?.('change', close);
    return () => media?.removeEventListener?.('change', close);
  }, []);

  // ── TOOLTIP do rail ──────────────────────────────────────────
  // Renderizado em PORTAL no <body> (position: fixed, coordenadas de viewport):
  // escapa de qualquer stacking context da página (a toolbar da Agenda vive em
  // z-40) e nada o corta, sem esticar a largura de rolagem de container nenhum.
  // Estado da extensão de grupo (abre/retrai com o atraso de trânsito do
  // ponteiro — a máquina de estados vive em lib/sidebar-peek.ts).
  const peekCtl = useSidebarPeek();
  const asideRef = useRef<HTMLElement | null>(null);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  useEffect(() => {
    const root = asideRef.current;
    if (!root) return;
    const tipOf = (el: Element) => el.closest('[data-tip]');
    const show = (e: Event) => {
      const el = tipOf(e.target as Element);
      const text = el?.getAttribute('data-tip');
      if (!el || !text) { setTip(null); return; }
      const elRect = el.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      setTip({
        text,
        top: elRect.top + elRect.height / 2,
        left: rootRect.right + 10,
      });
    };
    const hide = (e: Event) => {
      // Mudança de elemento DENTRO do mesmo alvo não desmonta o tooltip.
      const rel = (e as MouseEvent).relatedTarget as Element | null;
      if (rel && tipOf(e.target as Element) === tipOf(rel)) return;
      setTip(null);
    };
    root.addEventListener('mouseover', show);
    root.addEventListener('mouseout', hide);
    root.addEventListener('focusin', show);
    root.addEventListener('focusout', hide);
    return () => {
      root.removeEventListener('mouseover', show);
      root.removeEventListener('mouseout', hide);
      root.removeEventListener('focusin', show);
      root.removeEventListener('focusout', hide);
    };
  }, []);

  function hrefFor(item: NavItem) {
    if (item.href === '/organizacao') return `/organizacao?organization=${unit.organizationId || ''}`;
    return item.requiresBusiness === false ? item.href : `${item.href}?b=${unit.id}`;
  }

  // ── RAIL ─────────────────────────────────────────────────────
  // `mini` = desenhado para a coluna estreita (só ícone + tooltip). O drawer
  // móvel sempre usa o modo expandido (toque não tem hover).
  const link = (item: NavItem, sub = false, mini = true) => (
    <Link
      key={item.href}
      href={hrefFor(item)}
      data-nav-item={item.href}
      aria-label={item.label}
      aria-current={activePath === item.href ? 'page' : undefined}
      title={mini ? undefined : item.description}
      onClick={() => { setMobile(false); }}
      className={`workspace-link${sub ? ' workspace-link--sub' : ''}`}
      {...(mini ? { 'data-tip': item.label } : {})}
    >
      <span className="workspace-link__icon">
        <Icon n={item.icon} size={18} />
      </span>
      <span className="workspace-label">{item.label}</span>
    </Link>
  );

  /** Id do painel de grupo (um por tela: só existe um aberto por vez). */
  const NAV_PANEL_ID = 'ws-nav-panel';
  const groupRefs = useRef(new Map<string, HTMLButtonElement>());

  const groupButton = (area: WorkspaceArea) => {
    // Um grupo existe enquanto houver DESTINO autorizado nele (a régua do
    // painel, não a do rail): grupo cujo conteúdo é contextual continua sendo
    // uma porta real.
    const items = panelItems(area);
    if (!items.length) return null;
    const open = peekCtl.peekId === area.id;
    return (
      <div key={area.id} className={`workspace-group${open ? ' is-open' : ''}${activeGroup === area.id ? ' is-active' : ''}`}>
        <button
          type="button"
          className="workspace-link workspace-link--group"
          aria-label={area.label}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? NAV_PANEL_ID : undefined}
          data-peek-group={area.id}
          ref={(node) => { if (node) groupRefs.current.set(area.id, node); else groupRefs.current.delete(area.id); }}
          onMouseEnter={() => peekCtl.onGroupEnter(area.id)}
          onMouseLeave={() => peekCtl.onGroupLeave()}
          onFocus={() => peekCtl.onGroupEnter(area.id)}
          onBlur={() => peekCtl.onGroupLeave()}
          onClick={() => {
            // Clique = abre/trava (ou fecha se já travado). NUNCA expande a
            // navegação: o rail é sempre o rail.
            peekCtl.togglePeek(area.id);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            peekCtl.pinPeek(area.id);
            // O foco entra no painel (equivalência teclado ↔ hover); o portal
            // vive no fim do <body>, então o foco é movido explicitamente.
            window.requestAnimationFrame(() => {
              document.querySelector<HTMLElement>(`#${NAV_PANEL_ID} [role="menuitem"]`)?.focus();
            });
          }}
        >
          <span className="workspace-link__icon"><Icon n={area.icon} size={18} /></span>
          <span className="workspace-label">{area.label}</span>
          {/* DS 1.1 — SEM CHEVRON no rail. A seta prometia um accordion que
              não existe: o grupo abre um PAINEL lateral conectado, e o próprio
              painel (título + itens) é o feedback de abertura. O estado aberto
              continua acessível por `aria-expanded`; nada de ícone decorativo
              sugerindo hierarquia/pilha. */}
        </button>
      </div>
    );
  };

  // SEM TÍTULOS DE SEÇÃO: a sidebar é uma sequência contínua de destinos e
  // grupos. As seções existem como agrupamento/ordem (fonte do painel), mas
  // não desenham rótulo — a separação é o respiro entre blocos.
  const menu = () => (
    <>
      {sections.map((section) => {
        const rows = section.groups.flatMap(({ area, flat }) =>
          flat ? railItems(area).map((item) => link(item)) : [groupButton(area)],
        ).filter(Boolean);
        if (!rows.length) return null;
        return (
          <div className="workspace-section" key={section.id}>
            <span className="workspace-section__rule" aria-hidden="true" />
            {rows}
          </div>
        );
      })}
    </>
  );

  /**
   * DRAWER MÓVEL — o painel (hover) não existe em toque: no celular o grupo
   * mostra os filhos DIRETO, sob um rótulo discreto do grupo, incluindo os
   * destinos contextuais que o rail não desenha.
   */
  const mobileMenu = () => (
    <>
      {sections.map((section) => {
        const rows = section.groups.flatMap(({ area, flat }) => {
          const items = panelItems(area);
          if (!items.length) return [];
          if (flat) return items.map((item) => link(item, false, false));
          return [
            <p key={`t-${area.id}`} className="workspace-nav-drawer__title">{area.label}</p>,
            ...items.map((item) => link(item, true, false)),
          ];
        });
        if (!rows.length) return null;
        return <div className="workspace-section" key={section.id}>{rows}</div>;
      })}
    </>
  );

  /** Passo pendente do checklist → href real, com a unidade preservada. */
  const setupHref = setup ? `${setup.href}${setup.href.includes('?') ? '&' : '?'}b=${unit.id}` : '';
  const footer = (withBrand: boolean) => (
    <div className="workspace-foot">
      {/* RAIL (60px): o cartão de setup não cabe em texto, mas a pendência não
          pode sumir do desktop — ela vira um ANEL de progresso com tooltip,
          levando ao MESMO próximo passo do checklist real. */}
      {setup && !withBrand && (
        <Link
          href={setupHref}
          className="workspace-foot__item ws-setup-ring"
          aria-label={`Configuração da clínica: ${setup.pct}% concluída`}
          data-tip={`Configuração: ${setup.pct}%`}
        >
          <span
            aria-hidden="true"
            className="ws-setup-ring__dial"
            style={{ background: `conic-gradient(var(--accent) ${setup.pct}%, var(--surface-3) 0)` }}
          >
            <span className="ws-setup-ring__hole" />
          </span>
          <span className="workspace-label">Configuração</span>
        </Link>
      )}
      {setup && withBrand && (
        <div className="ws-setup-mini">
          <p className="text-[12px] font-semibold text-[var(--text)] leading-tight">
            Sua clínica está {setup.pct}% pronta
          </p>
          <p className="text-[11px] text-[var(--il-nav-muted)] mt-1 leading-snug">
            Complete a configuração para receber agendamentos.
          </p>
          <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden mt-2" aria-hidden="true">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${setup.pct}%` }} />
          </div>
          <Link href={setupHref}
            className="mt-2 inline-flex w-full items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[11.5px] font-semibold text-[var(--brand-strong)] hover:bg-[var(--surface-hover)]">
            Continuar configuração
          </Link>
        </div>
      )}
      <button
        type="button"
        className="workspace-foot__item"
        onClick={() => { setMobile(false); onHelp?.(); }}
        aria-label="Ajuda e suporte"
        data-tip="Ajuda e suporte"
      >
        <Icon n="help" size={18} />
        <span className="workspace-label">Ajuda e suporte</span>
      </button>
      {withBrand && (
        <p className="workspace-foot__brand">
          powered by <strong>GoDoutor</strong>
        </p>
      )}
    </div>
  );

  // Teclado dentro do painel: ↑/↓/Home/End andam, ← e Escape voltam ao grupo.
  const peekKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, areaId: string) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const go = (target?: HTMLElement) => { if (target) { e.preventDefault(); target.focus(); } };
    if (e.key === 'ArrowDown') go(items[(index + 1 + items.length) % items.length]);
    if (e.key === 'ArrowUp') go(items[(index - 1 + items.length) % items.length]);
    if (e.key === 'Home') go(items[0]);
    if (e.key === 'End') go(items[items.length - 1]);
    if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      e.preventDefault();
      peekCtl.closePeek();
      groupRefs.current.get(areaId)?.focus();
    }
  };

  /**
   * Painel do grupo — a EXTENSÃO do rail: nasce na borda direita da coluna
   * (sem gap), com a mesma superfície branca, uma divisória vertical fina e
   * sem sombra. Quem calcula a geometria é o CSS por token (`--gd-rail-w`); o
   * painel é portal no <body> para escapar de qualquer stacking context.
   */
  const peekPanel = () => {
    if (!peekCtl.peekId || typeof document === 'undefined') return null;
    const area = sections.flatMap((s) => s.groups).find((g) => g.area.id === peekCtl.peekId)?.area;
    const items = area ? panelItems(area) : [];
    if (!area || !items.length) return null;
    return createPortal(
      <div
        id={NAV_PANEL_ID}
        className="ws-peek"
        role="menu"
        aria-label={area.label}
        onMouseEnter={peekCtl.onPeekEnter}
        onMouseLeave={peekCtl.onPeekLeave}
        onFocus={peekCtl.onPeekEnter}
        onKeyDown={(e) => peekKeyDown(e, area.id)}
      >
        <p className="ws-peek__title">{area.label}</p>
        <div className="ws-peek__items">
          {items.map((item) => (
            <Link
              key={item.href}
              href={hrefFor(item)}
              role="menuitem"
              aria-current={activePath === item.href ? 'page' : undefined}
              className="ws-peek__item"
              onClick={() => { peekCtl.closePeek(); setMobile(false); }}
            >
              <Icon n={item.icon} size={15} />
              <span>{item.label}</span>
              {item.sidebar === false && <span className="ws-peek__flag" aria-hidden="true">contextual</span>}
            </Link>
          ))}
        </div>
      </div>,
      document.body,
    );
  };

  return (
    <>
      <aside ref={asideRef} className="workspace-sidebar" aria-label="Navegação da clínica">
        <nav aria-label="Menu principal" className="workspace-primary ws-scroll">
          {menu()}
        </nav>
        {footer(false)}
        {/* Tooltip do rail: portal no <body> — não gera scrollbar horizontal e
            renderiza ACIMA do conteúdo da página (Agenda incluída). */}
        {tip && typeof document !== 'undefined' && createPortal(
          <div className="ws-nav-tip" role="tooltip" style={{ top: `${tip.top}px`, left: `${tip.left}px` }}>{tip.text}</div>,
          document.body,
        )}
        {peekPanel()}
      </aside>

      {/* Mobile: UM diálogo, os mesmos destinos (nunca duas colunas na tela). */}
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        title="Navegar na clínica"
        width="max-w-[420px]"
        dialogClassName="workspace-nav-drawer"
      >
        <nav aria-label="Menu móvel" className="p-3">{mobileMenu()}</nav>
        {footer(true)}
      </Drawer>
    </>
  );
}
