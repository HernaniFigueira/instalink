'use client';
// ═══════════════════════════════════════════════════════════════
// SIDEBAR DO APP SHELL — GoDoutor final (disciplina visual Meta-like)
// ═══════════════════════════════════════════════════════════════
// Objetivo: POUCAS PORTAS. A arquitetura vem de
// lib/workspace-navigation.ts (apresentação) sobre o catálogo lib/panel.ts
// (rotas + permissões + módulos). Nenhuma rota é apagada aqui: item com
// `sidebar: false` continua existindo por URL e por atalho contextual.
//
//   Visão geral · Agenda · Conversas · Pendências · Clientes     (links)
//   Clínica ▾ (grupo) · Página                                    (porta)
//   Automação ▾ · Gestão ▾ · Configurações ▾                      (grupos)
//
// MISSÃO SIDEBAR FINAL (Meta-like):
//   • SEM títulos de seção (nada de OPERAÇÃO/CLÍNICA/ADMINISTRAÇÃO) — a
//     hierarquia vem do alinhamento, do recuo e do espaçamento entre blocos;
//   • acordeão: SEMPRE exatamente UM grupo aberto quando expandida. Rotas
//     planas abrem "Clínica" por padrão; deep-link abre o grupo dono; clicar
//     noutro grupo troca; clicar no aberto NÃO fecha;
//   • item ativo/grupo aberto = fundo azul MUITO claro + texto azul (nunca
//     botão azul sólido, nunca texto branco);
//   • recolhida (~68px): SÓ ícones centralizados com tooltip (renderizado no
//     nível do <aside>, fora do container rolável — é isso que elimina a
//     scrollbar horizontal que os ::after do .il-tip causavam), sem nome de
//     clínica, sem submenu inline; clicar num grupo EXPANDE e abre o grupo;
//   • submenu abre PARA BAIXO na própria coluna, com recuo limpo (a linha-guia
//     saiu — hierarquia percebida pelo recuo).
//
// IDENTIDADE (co-branding): dentro da operação a identidade principal é a da
// CLÍNICA — logo, nome e tipo. GoDoutor é a plataforma e aparece discretamente
// ("Powered by") e na central de ajuda. Nada de duas marcas disputando o mesmo
// espaço: uma identidade principal por região.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Drawer } from '@/components/ui';
import { useRevalidateOnFocus } from './use-revalidate';
import { loadOverview } from '@/lib/overview';
import { apiGet } from '@/lib/api-client';
import { clinicTypeLabel } from '@/lib/clinic-presets';
import type { panelNavigation } from '@/lib/panel';
import {
  areaOfRoute, workspaceAreas, workspaceSections, type WorkspaceArea,
} from '@/lib/workspace-navigation';

type Unit = {
  id: string; name: string; logo?: string; slug: string; role?: string;
  organizationId?: string; clinicType?: import('@/lib/types').ClinicType;
};
type Nav = ReturnType<typeof panelNavigation>;
type NavItem = Nav['allowed'][number];

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '·';
}

export function WorkspaceNavigation({ nav, activePath, unit, units = [], multiUnit, collapsed, onCollapse, mobileOpen, onMobileOpen, onHelp, onUnit }: {
  nav: Nav; activePath: string; unit: Unit; collapsed: boolean; onCollapse: () => void;
  /** Estado do drawer móvel pertence ao shell: é a topbar que abre o menu. */
  mobileOpen?: boolean; onMobileOpen?: (open: boolean) => void;
  /** Unidades disponíveis (troca real de contexto). Uma só = sem seletor. */
  units?: Array<{ id: string; name: string; logo?: string; role?: string }>;
  /** true = existe mais de uma unidade (multiunidade REAL). */
  multiUnit?: boolean;
  /** Abre a central de ajuda (sheet do shell). */
  onHelp?: () => void;
  /** Troca de unidade a partir do cabeçalho. */
  onUnit?: (id: string) => void;
}) {
  const setMobile = (open: boolean) => onMobileOpen?.(open);
  const mobile = !!mobileOpen;
  const areas = useMemo(() => workspaceAreas(nav.allowed, { multiUnit }), [nav.allowed, multiUnit]);
  const sections = useMemo(() => workspaceSections(areas), [areas]);

  // Mini-card de setup: MESMO checklist real do /api/overview. É ONBOARDING,
  // não decoração permanente: enquanto houver passo pendente ele aparece; ao
  // completar 100% sai de cena (o rodapé fixo fica para Ajuda e suporte).
  //
  // §P1.4 — UMA fonte de verdade, SEM número velho: o card revalida quando
  // qualquer escrita do painel conclui (`il:overview-refresh`, disparado pelo
  // apiSend), quando módulos/permissões mudam (`il:business-refresh`) e quando
  // a aba volta ao foco. Completou 100% ⇒ o card SOME na hora (nada de
  // "88% pronta" com a página mostrando 8/8).
  const [setup, setSetup] = useState<{ pct: number; href: string } | null>(null);
  const loadSetup = useCallback((businessId: string) => {
    if (!businessId) return;
    let on = true;
    loadOverview(businessId, 7, { scope: 'area', area: 'Visão geral' })
      .then((r) => {
        if (!on || !r.ok) return;
        const next = (r.data?.checklist || []).find((c) => !c.done);
        const pending = r.data?.pendingSetup ?? (r.data?.checklist || []).filter((c) => !c.done).length;
        const pct = r.data?.pct ?? 0;
        setSetup(next && pending && pct < 100 ? { pct, href: next.href } : null);
      }).catch(() => { if (on) setSetup(null); });
    return () => { on = false; };
  }, []);
  useEffect(() => loadSetup(unit.id), [unit.id, loadSetup]);
  useEffect(() => {
    const refresh = () => loadSetup(unit.id);
    window.addEventListener('il:overview-refresh', refresh);
    window.addEventListener('il:business-refresh', refresh);
    return () => {
      window.removeEventListener('il:overview-refresh', refresh);
      window.removeEventListener('il:business-refresh', refresh);
    };
  }, [unit.id, loadSetup]);
  useRevalidateOnFocus(() => loadSetup(unit.id), 30_000);

  // Destinos com `sidebar: false` não ocupam linha no menu (régua: frequência),
  // mas continuam acessíveis por URL/atalho contextual.
  const visible = (items: NavItem[]) => items.filter((i) => i.sidebar !== false);

  const activeArea = areaOfRoute(activePath, areas);
  // Um grupo SÓ tem acordeão se tiver LINHA para mostrar. Destinos com
  // `sidebar: false` (Meu perfil, Execuções, Recursos) vivem de atalho
  // contextual e não criam grupo vazio.
  const isGroup = (area: WorkspaceArea) => visible(area.items).length > 0 && !sections.some(
    (s) => s.groups.some((g) => g.flat && g.area.id === area.id),
  );
  const activeGroup = activeArea && isGroup(activeArea) ? activeArea.id : null;

  // ACORDEÃO META-LIKE: SEMPRE exatamente UM grupo aberto quando a sidebar
  // está expandida — não existe estado "nenhum grupo aberto".
  //   • padrão: "Clínica" (rotas planas como /dashboard e /agenda);
  //   • deep-link: a rota ativa ABRE o grupo dono (autoridade do catálogo);
  //   • clicar noutro grupo TROCA (um por vez, nunca dois);
  //   • clicar no grupo ABERTO não fecha — ele permanece aberto.
  // `openedByUser` distingue "o usuário escolheu" (persiste ao navegar em
  // rotas planas) de "a rota abriu" (rota plana volta ao padrão Clínica).
  const groups = useMemo(
    () => sections.flatMap((s) => s.groups.filter((g) => !g.flat).map((g) => g.area)),
    [sections],
  );
  const defaultGroup = groups.some((a) => a.id === 'clinica') ? 'clinica' : (groups[0]?.id ?? null);
  const [opened, setOpened] = useState<string | null>(activeGroup ?? defaultGroup);
  const openedByUser = useRef(false);
  const [unitOpen, setUnitOpen] = useState(false);

  useEffect(() => {
    if (activeGroup) { setOpened(activeGroup); openedByUser.current = false; }
    else if (!openedByUser.current) { setOpened(defaultGroup); }
    setMobile(false);
  }, [activePath, unit.id, activeGroup, defaultGroup]);

  // Ao crescer para desktop o drawer móvel não pode ficar aberto por cima.
  useEffect(() => {
    const media = window.matchMedia?.('(min-width:1200px)');
    const close = () => { if (media?.matches) setMobile(false); };
    media?.addEventListener?.('change', close);
    return () => media?.removeEventListener?.('change', close);
  }, []);

  // ── TOOLTIP do modo recolhido ────────────────────────────────
  // O tooltip é renderizado como FILHO DO <aside>, fora do container rolável
  // (.workspace-primary). Os tooltips antigos (.il-tip::after) ficavam DENTRO
  // do container com overflow-y:auto — invisíveis (opacity:0) mas ainda no
  // layout, esticando a largura de scroll e criando a scrollbar horizontal da
  // sidebar recolhida. Aqui o <aside> não rola e não corta: o tooltip escapa
  // para cima do conteúdo sem aumentar largura física de nada.
  const asideRef = useRef<HTMLElement | null>(null);
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  useEffect(() => {
    if (!collapsed) { setTip(null); return; }
    const root = asideRef.current;
    if (!root) return;
    const tipOf = (el: Element) => el.closest('[data-tip]');
    const show = (e: Event) => {
      const el = tipOf(e.target as Element);
      const text = el?.getAttribute('data-tip');
      if (!el || !text) { setTip(null); return; }
      const elRect = el.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      setTip({ text, top: elRect.top - rootRect.top + elRect.height / 2 });
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
  }, [collapsed]);

  function hrefFor(item: NavItem) {
    if (item.href === '/organizacao') return `/organizacao?organization=${unit.organizationId || ''}`;
    return item.requiresBusiness === false ? item.href : `${item.href}?b=${unit.id}`;
  }

  // `mini` = este destino está sendo desenhado para o RAIL recolhido (só
  // ícone + tooltip). O drawer móvel sempre usa o modo expandido.
  const link = (item: NavItem, sub = false, mini = collapsed) => (
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

  const groupButton = (area: WorkspaceArea, mini = collapsed) => {
    const items = visible(area.items);
    if (!items.length) return null;
    const open = opened === area.id;
    return (
      <div key={area.id} className={`workspace-group${open && !mini ? ' is-open' : ''}${activeGroup === area.id ? ' is-active' : ''}`}>
        <button
          type="button"
          className="workspace-link workspace-link--group"
          aria-label={area.label}
          aria-expanded={mini ? false : open}
          aria-controls={mini ? undefined : `submenu-${area.id}`}
          data-tip={area.label}
          onClick={() => {
            // Recolhida: o clique EXPANDE a sidebar e abre o grupo escolhido.
            // Expandida: abre ESTE grupo — clicar no grupo aberto NÃO fecha
            // (nunca existe estado "nenhum grupo aberto").
            if (mini) onCollapse?.();
            setOpened(area.id);
            openedByUser.current = true;
          }}
        >
          <span className="workspace-link__icon"><Icon n={area.icon} size={18} /></span>
          <span className="workspace-label">{area.label}</span>
          {!mini && (
            <Icon n="chevronRight" size={15} className="workspace-link__chevron" aria-hidden="true" />
          )}
        </button>
        {/* Acordeão: expande PARA BAIXO (altura+opacidade+translateY), com
            recuo limpo — nunca uma segunda coluna. No modo recolhido o
            submenu NÃO é renderizado: o clique no ícone do grupo expande a
            sidebar e abre o grupo. */}
        {!mini && (
          <div id={`submenu-${area.id}`} className="workspace-submenu">
            <div className="workspace-submenu__clip">
              <div className="workspace-submenu__guide">
                {items.map((item) => link(item, true, false))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  /**
   * CABEÇALHO — a clínica é a identidade principal desta região.
   * Com mais de uma unidade o nome vira botão (troca real de contexto);
   * com uma unidade só, é texto — sem controle que não faz nada.
   * RECOLHIDO: SÓ a logo (ou monograma), centralizada — nome e tipo não são
   * renderizados (nada de "A…"/"Cl…" truncado); o tooltip carrega
   * "Nome · Tipo" para quem precisar do contexto.
   */
  const header = (mini = collapsed, interactive = true) => {
    const label = unit.name || 'Clínica';
    const kind = clinicTypeLabel(unit.clinicType);
    const canSwitch = interactive && !!onUnit && units.length > 1;
    if (mini) {
      const mark = unit.logo
        ? <img src={unit.logo} alt="" className="workspace-clinic-head__logo workspace-clinic-head__logo--mini" />
        : <span className="workspace-clinic-head__mark workspace-clinic-head__mark--mini" aria-hidden="true">{initials(label)}</span>;
      const tipText = `${label} · ${kind || 'Clínica'}`;
      return (
        <div className="workspace-clinic-head-wrap">
          {canSwitch ? (
            <button
              type="button"
              className="workspace-clinic-head workspace-clinic-head--collapsed"
              aria-haspopup="menu"
              aria-expanded={unitOpen}
              aria-label={`Unidade atual: ${label}. Trocar de unidade`}
              data-tip={tipText}
              onClick={() => setUnitOpen((v) => !v)}
            >
              {mark}
            </button>
          ) : (
            <div className="workspace-clinic-head workspace-clinic-head--collapsed" data-tip={tipText}>
              {mark}
            </div>
          )}
          {canSwitch && unitOpen && (
            <div className="ws-pop ws-pop--left" role="menu" aria-label="Trocar de unidade">
              <p className="ws-pop__label">Unidades</p>
              {units.map((u) => (
                <button key={u.id} type="button" role="menuitem" className="ws-pop__item"
                  onClick={() => { setUnitOpen(false); if (u.id !== unit.id) onUnit?.(u.id); }}>
                  {u.logo
                    ? <img src={u.logo} alt="" aria-hidden="true" className="ws-unitpill__logo" />
                    : <span className="ws-unitpill__dot" aria-hidden="true">{initials(u.name || 'Clínica')}</span>}
                  <span className="flex-1 truncate">{u.name || 'Clínica'}</span>
                  {u.id === unit.id && <Icon n="check" size={14} className="text-[var(--success-fg)]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    const inner = (
      <>
        {unit.logo
          ? <img src={unit.logo} alt="" className="workspace-clinic-head__logo" />
          : <span className="workspace-clinic-head__mark" aria-hidden="true">{initials(label)}</span>}
        <span className="workspace-clinic-head__text">
          <span className="workspace-clinic-head__name">{label}</span>
          <span className="workspace-clinic-head__meta">{kind || 'Clínica'}</span>
          {canSwitch && (
            <span className="workspace-clinic-head__unit">
              Trocar unidade <Icon n="chevD" size={12} aria-hidden="true" />
            </span>
          )}
        </span>
      </>
    );
    return (
      <div className="workspace-clinic-head-wrap">
        {canSwitch ? (
          <button
            type="button"
            className="workspace-clinic-head"
            aria-haspopup="menu"
            aria-expanded={unitOpen}
            aria-label={`Unidade atual: ${label}. Trocar de unidade`}
            onClick={() => setUnitOpen((v) => !v)}
          >
            {inner}
          </button>
        ) : (
          <div className="workspace-clinic-head">{inner}</div>
        )}
        {canSwitch && unitOpen && (
          <div className="ws-pop ws-pop--left" role="menu" aria-label="Trocar de unidade">
            <p className="ws-pop__label">Unidades</p>
            {units.map((u) => (
              <button key={u.id} type="button" role="menuitem" className="ws-pop__item"
                onClick={() => { setUnitOpen(false); if (u.id !== unit.id) onUnit?.(u.id); }}>
                {u.logo
                  ? <img src={u.logo} alt="" aria-hidden="true" className="ws-unitpill__logo" />
                  : <span className="ws-unitpill__dot" aria-hidden="true">{initials(u.name || 'Clínica')}</span>}
                <span className="flex-1 truncate">{u.name || 'Clínica'}</span>
                {u.id === unit.id && <Icon n="check" size={14} className="text-[var(--success-fg)]" />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // SEM TÍTULOS DE SEÇÃO (missão §2): a sidebar é uma sequência contínua de
  // destinos e grupos. As seções continuam existindo como AGRUPAMENTO/ORDEM
  // (e fonte do breadcrumb), mas não desenham rótulo nenhum — a separação é
  // só espaçamento vertical; no rail recolhido, um fio discreto entre blocos.
  const menu = (mini = collapsed) => (
    <>
      {sections.map((section) => {
        const rows = section.groups.flatMap(({ area, flat }) =>
          flat ? visible(area.items).map((item) => link(item, false, mini)) : [groupButton(area, mini)],
        ).filter(Boolean);
        if (!rows.length) return null;
        return (
          <div className="workspace-section" key={section.id}>
            {mini && <span className="workspace-section__rule" aria-hidden="true" />}
            {rows}
          </div>
        );
      })}
    </>
  );

  const footer = (withCollapse: boolean, mini = collapsed) => (
    <div className="workspace-foot">
      {setup && !mini && (
        <div className="ws-setup-mini">
          <p className="text-[12px] font-semibold text-[var(--text-primary)] leading-tight">
            Sua clínica está {setup.pct}% pronta
          </p>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-snug">
            Complete a configuração para receber agendamentos.
          </p>
          <div className="h-1.5 rounded-full bg-white overflow-hidden mt-2" aria-hidden="true">
            <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${setup.pct}%` }} />
          </div>
          <Link href={`${setup.href}${setup.href.includes('?') ? '&' : '?'}b=${unit.id}`}
            className="mt-2 inline-flex w-full items-center justify-center rounded-[var(--radius-sm)] border border-[var(--brand-100)] bg-white px-2 py-1.5 text-[11.5px] font-semibold text-[var(--brand-fg)] hover:bg-[var(--brand-50)]">
            Continuar configuração
          </Link>
        </div>
      )}
      <button
        type="button"
        className="workspace-foot__item"
        onClick={() => { setMobile(false); onHelp?.(); }}
        aria-label="Ajuda e suporte"
        {...(mini ? { 'data-tip': 'Ajuda e suporte' } : {})}
      >
        <Icon n="help" size={18} />
        <span className="workspace-label">Ajuda e suporte</span>
      </button>
      {withCollapse && (
        <button
          type="button"
          className="workspace-foot__item workspace-foot__item--collapse"
          aria-label={mini ? 'Expandir navegação' : 'Recolher navegação'}
          {...(mini ? { 'data-tip': 'Expandir navegação' } : {})}
          onClick={onCollapse}
        >
          <Icon n="panel" size={18} />
          <span className="workspace-label">{mini ? 'Expandir navegação' : 'Recolher menu'}</span>
        </button>
      )}
      {!mini && (
        <p className="workspace-foot__brand">
          powered by <strong>GoDoutor</strong>
        </p>
      )}
    </div>
  );

  return (
    <>
      <aside ref={asideRef} className={`workspace-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Navegação da clínica">
        {header(collapsed)}
        <nav aria-label="Menu principal" className="workspace-primary ws-scroll">
          {menu(collapsed)}
        </nav>
        {footer(true, collapsed)}
        {/* Tooltip do rail recolhido: filho do <aside> (fora do container
            rolável) — não gera scrollbar horizontal e escapa sobre o conteúdo. */}
        {collapsed && tip && (
          <div className="ws-nav-tip" role="tooltip" style={{ top: `${tip.top}px` }}>{tip.text}</div>
        )}
      </aside>

      {/* Mobile: UM diálogo, o MESMO acordeão (nunca duas colunas na tela).
          O drawer sempre usa o modo EXPANDIDO — mesmo que a sidebar desktop
          esteja recolhida. */}
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        title="Navegar na clínica"
        width="max-w-[420px]"
      >
        {header(false)}
        <nav aria-label="Menu móvel" className="p-3">{menu(false)}</nav>
        {footer(false, false)}
      </Drawer>
    </>
  );
}
