'use client';
// ═══════════════════════════════════════════════════════════════
// SIDEBAR DO APP SHELL — GoDoutor Product/UX Revolution 2.0
// ═══════════════════════════════════════════════════════════════
// Objetivo: POUCAS PORTAS. A arquitetura vem de
// lib/workspace-navigation.ts (apresentação) sobre o catálogo lib/panel.ts
// (rotas + permissões + módulos). Nenhuma rota é apagada aqui: item com
// `sidebar: false` continua existindo por URL e por atalho contextual.
//
//   OPERAÇÃO        Visão geral · Agenda · Conversas · Clientes   (links)
//   CLÍNICA         Clínica (grupo) · Página                      (portas)
//   ADMINISTRAÇÃO   Automação (grupo) · Gestão (grupo) · Configurações (grupo)
//
// GODOUTOR final (FASE D): cada grupo expande PARA BAIXO, no acordeão da
// PRÓPRIA coluna — uma coluna só (~256px), sem segunda coluna. A rota ativa
// abre o grupo dono; um grupo por vez; subitens com recuo e linha-guia.
// "Clínica" continua reunindo Serviços/Profissionais/Disponibilidade/Equipe
// sem unificar modelo de dado (Professional e User/Member seguem separados).
//
// IDENTIDADE (co-branding): dentro da operação a identidade principal é a da
// CLÍNICA — logo, nome e tipo. GoDoutor é a plataforma e aparece discretamente
// ("Powered by") e na central de ajuda. Nada de duas marcas disputando o mesmo
// espaço: uma identidade principal por região.
import { useCallback, useEffect, useMemo, useState } from 'react';
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

  // Acordeão: UM grupo aberto por vez. A rota ativa SEMPRE abre o grupo dono
  // (deep-link cai com o submenu certo aberto); clicar noutro grupo troca;
  // clicar de novo fecha. Nada de dois painéis empilhados.
  const [opened, setOpened] = useState<string | null>(activeGroup);
  const [unitOpen, setUnitOpen] = useState(false);

  useEffect(() => {
    setOpened(activeGroup);
    setMobile(false);
  }, [activePath, unit.id, activeGroup]);

  // Ao crescer para desktop o drawer móvel não pode ficar aberto por cima.
  useEffect(() => {
    const media = window.matchMedia?.('(min-width:1200px)');
    const close = () => { if (media?.matches) setMobile(false); };
    media?.addEventListener?.('change', close);
    return () => media?.removeEventListener?.('change', close);
  }, []);

  function hrefFor(item: NavItem) {
    if (item.href === '/organizacao') return `/organizacao?organization=${unit.organizationId || ''}`;
    return item.requiresBusiness === false ? item.href : `${item.href}?b=${unit.id}`;
  }

  const link = (item: NavItem, area?: WorkspaceArea, sub = false) => (
    <Link
      key={item.href}
      href={hrefFor(item)}
      data-nav-item={item.href}
      aria-label={item.label}
      aria-current={activePath === item.href ? 'page' : undefined}
      title={collapsed ? `${item.label} — ${item.description}` : item.description}
      onClick={() => { setMobile(false); }}
      className={`workspace-link${sub ? ' workspace-link--sub' : ''}${collapsed ? ' il-tip' : ''}`}
      {...(collapsed ? { 'data-tip': item.label } : {})}
    >
      <span className="workspace-link__icon">
        <Icon n={item.icon} size={18} />
      </span>
      <span className="workspace-label">{item.label}</span>
    </Link>
  );

  const groupButton = (area: WorkspaceArea) => {
    const items = visible(area.items);
    if (!items.length) return null;
    const open = opened === area.id;
    return (
      <div key={area.id} className={`workspace-group${open ? ' is-open' : ''}${activeGroup === area.id ? ' is-active' : ''}`}>
        <button
          type="button"
          className={`workspace-link workspace-link--group${collapsed ? ' il-tip' : ''}`}
          aria-label={area.label}
          aria-expanded={open}
          aria-controls={`submenu-${area.id}`}
          title={collapsed ? area.label : undefined}
          {...(collapsed ? { 'data-tip': area.label } : {})}
          onClick={() => setOpened(open ? null : area.id)}
        >
          <span className="workspace-link__icon"><Icon n={area.icon} size={18} /></span>
          <span className="workspace-label">{area.label}</span>
          {!collapsed && (
            <Icon n="chevronRight" size={15} className="workspace-link__chevron" aria-hidden="true" />
          )}
        </button>
        {/* Acordeão: expande PARA BAIXO (altura+opacidade+translateY), com
            linha-guia e recuo — nunca uma segunda coluna. */}
        <div id={`submenu-${area.id}`} className="workspace-submenu">
          <div className="workspace-submenu__clip">
            <div className="workspace-submenu__guide">
              {items.map((item) => link(item, area, true))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /**
   * CABEÇALHO — a clínica é a identidade principal desta região.
   * Com mais de uma unidade o nome vira botão (troca real de contexto);
   * com uma unidade só, é texto — sem controle que não faz nada.
   */
  const header = (interactive = true) => {
    const label = unit.name || 'Clínica';
    const kind = clinicTypeLabel(unit.clinicType);
    const canSwitch = interactive && !!onUnit && units.length > 1;
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

  const menu = () => (
    <>
      {sections.map((section) => {
        const rows = section.groups.flatMap(({ area, flat }) =>
          flat ? visible(area.items).map((item) => link(item, area, true)) : [groupButton(area)],
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

  const footer = (withCollapse: boolean) => (
    <div className="workspace-foot">
      {setup && !collapsed && (
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
        className={`workspace-foot__item${collapsed ? ' il-tip' : ''}`}
        onClick={() => { setMobile(false); onHelp?.(); }}
        aria-label="Ajuda e suporte"
        {...(collapsed ? { 'data-tip': 'Ajuda e suporte', 'data-tip-pos': 'right' } : {})}
      >
        <Icon n="help" size={18} />
        <span className="workspace-label">Ajuda e suporte</span>
      </button>
      {withCollapse && (
        <button
          type="button"
          className={`workspace-foot__item workspace-foot__item--collapse${collapsed ? ' il-tip' : ''}`}
          aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
          {...(collapsed ? { 'data-tip': 'Expandir navegação', 'data-tip-pos': 'right' } : {})}
          onClick={onCollapse}
        >
          <Icon n="panel" size={18} />
          <span className="workspace-label">Recolher menu</span>
        </button>
      )}
      {!collapsed && (
        <p className="workspace-foot__brand">
          powered by <strong>GoDoutor</strong>
        </p>
      )}
    </div>
  );

  return (
    <>
      <aside className={`workspace-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Navegação da clínica">
        {header(true)}
        <nav aria-label="Menu principal" className="workspace-primary ws-scroll">
          {menu()}
        </nav>
        {footer(true)}
      </aside>

      {/* Mobile: UM diálogo, o MESMO acordeão (nunca duas colunas na tela). */}
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        title="Navegar na clínica"
        width="max-w-[420px]"
      >
        {header(true)}
        <nav aria-label="Menu móvel" className="p-3">{menu()}</nav>
        {footer(false)}
      </Drawer>
    </>
  );
}
