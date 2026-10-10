'use client';
// ═══════════════════════════════════════════════════════════════
// TOPBAR DO APP SHELL — missão UX Closure · item 2
// ═══════════════════════════════════════════════════════════════
// A topbar é FULL-WIDTH e fica acima de tudo. Ela carrega a IDENTIDADE: o
// logo + nome completo da clínica ficam no bloco ESQUERDO (como no
// comportamento observado na referência) — a sidebar NÃO repete nome nem
// logo, porque identidade se lê uma vez.
//
//   ESQUERDA → [logo] Andrioni Veterinaria      (troca de unidade quando há mais de uma)
//   CENTRO   → busca global (Ctrl+K)
//   DIREITA  → quick create “+” · sino · conversas · ajuda · conta
//
// Sem breadcrumb global: o contrato do refino final continua valendo (o
// cabeçalho da página identifica a tela; o contexto vive na navegação).
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { GlobalSearch, type NavSearchItem } from './GlobalSearch';
import { NotificationsBell } from './NotificationsBell';
import { AccountMenu, type AccountUnit } from './AccountMenu';
import { QuickCreateMenu } from './QuickCreateMenu';
import { ViewportPopover } from './ViewportPopover';
import type { WorkspaceAlerts } from '@/lib/workspace-alerts';

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '·';
}

/** Identidade da clínica na topbar: logo (ou monograma) + nome COMPLETO.
 *  Com mais de uma unidade o bloco vira botão de troca real de contexto
 *  (mesmo popover do resto da topbar); com uma unidade só, é texto —
 *  nenhum controle que não faz nada. */
function ClinicIdentity({ unit, units = [], onUnit }: {
  unit: AccountUnit; units?: AccountUnit[]; onUnit?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const switchable = !!onUnit && units.length > 1;
  const label = unit.name || 'Clínica';
  const mark = unit.logo
    ? <img src={unit.logo} alt="" className="ws-clinic__logo" />
    : <span className="ws-clinic__mark" aria-hidden="true">{initials(label)}</span>;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrap.current?.contains(target) && !popover.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!switchable) {
    return (
      <span className="ws-clinic" data-clinic-identity="true" title={label}>
        {mark}
        <span className="ws-clinic__name">{label}</span>
      </span>
    );
  }
  return (
    <div ref={wrap} className="min-w-0">
      <button
        type="button"
        className="ws-clinic ws-clinic--action"
        data-clinic-identity="true"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Unidade atual: ${label}. Trocar de unidade`}
        onClick={(event) => {
          if (open) setOpen(false);
          else { setAnchor(event.currentTarget); setOpen(true); }
        }}
      >
        {mark}
        <span className="ws-clinic__name">{label}</span>
        <Icon n="chevD" size={14} className="ws-clinic__chev" aria-hidden="true" />
      </button>
      <ViewportPopover
        open={open}
        anchor={anchor}
        className="ws-pop"
        role="menu"
        ariaLabel="Trocar de unidade"
        panelRef={popover}
      >
        <p className="ws-pop__label">Unidades</p>
        {units.map((u) => (
          <button key={u.id} type="button" role="menuitem" className="ws-pop__item"
            onClick={() => { setOpen(false); if (u.id !== unit.id) onUnit?.(u.id); }}>
            {u.logo
              ? <img src={u.logo} alt="" aria-hidden="true" className="ws-unitpill__logo" />
              : <span className="ws-unitpill__dot" aria-hidden="true">{initials(u.name || 'Clínica')}</span>}
            <span className="flex-1 truncate">{u.name || 'Clínica'}</span>
            {u.id === unit.id && <Icon n="check" size={14} className="text-[var(--success-fg)]" />}
          </button>
        ))}
      </ViewportPopover>
    </div>
  );
}

export function WorkspaceTopbar({ page, query, searchItems, activePath, businessId = '', alerts, user, unit, units, overview, canOverview, canConfig, canCreate, onUnit, onLogout, onOpenNav, onOpenHelp, isMaster, vet, canOpenConversations, legacyPagesEnabled }: {
  /** Tela atual — usado só no aria e no rótulo do botão de ajuda. */
  page: string;
  query: string;
  searchItems: NavSearchItem[];
  activePath: string;
  /** Unidade ativa — a busca de ENTIDADES (pessoas/agendamentos/conversas) é da unidade. */
  businessId?: string;
  alerts: WorkspaceAlerts;
  user: { name: string; email?: string; role?: string; photo?: string };
  /** Unidade atual + unidades da conta — identidade da topbar e troca de contexto. */
  unit: AccountUnit;
  units?: AccountUnit[];
  overview?: boolean;
  canOverview?: boolean;
  canConfig?: boolean;
  /** Troca real de contexto (mesma função da sidebar). */
  onUnit?: (id: string) => void;
  /** Hrefs permitidos ao usuário — filtram as ações do quick create. */
  canCreate: string[];
  /** Clínica veterinária: o quick create oferece o atalho do pet. */
  vet?: boolean;
  /** Acesso contextual ao sheet de conversas, somente com permissão efetiva. */
  canOpenConversations?: boolean;
  onLogout: () => void;
  onOpenNav: () => void;
  /** Abre a central de ajuda confiável (sheet) do shell. */
  onOpenHelp?: () => void;
  isMaster?: boolean;
  legacyPagesEnabled?: boolean;
}) {
  return (
    <header className="ws-topbar">
      <div className="ws-topbar__left">
        {/* Menu do APP só existe quando a navegação é drawer (abaixo de 1200px).
            Não é o antigo "expandir/recolher": o rail não tem pin. */}
        <button type="button" className="ws-topbar__icon-button ws-topbar__nav-toggle"
          aria-label="Abrir navegação" onClick={onOpenNav}>
          <Icon n="menu" size={19} />
        </button>
        <ClinicIdentity unit={unit} units={units} onUnit={onUnit} />
      </div>

      <div className="ws-topbar__center">
        <GlobalSearch items={searchItems} activePath={activePath} businessId={businessId} />
      </div>

      <div className="ws-topbar__right">
        {/* MISSÃO UX CLOSURE · item 2 — prioridade em telas estreitas:
            IDENTIDADE (logo + nome completo) > busca > ações globais.
            `data-topbar-secondary` marca os atalhos que já existem em outro
            lugar (Conversas na navegação, Ajuda no rodapé do menu) e que por
            isso saem primeiro quando a largura aperta — nenhuma função some. */}
        {/* Missão 6 — o “+” volta como quick create global premium. */}
        <QuickCreateMenu canCreate={canCreate} businessId={businessId} vet={vet} />

        <NotificationsBell alerts={alerts} />

        {canOpenConversations && (
          <button type="button" className="ws-topbar__icon-button" data-topbar-secondary="true"
            aria-label="Abrir Conversas" title="Conversas"
            onClick={() => window.dispatchEvent(new Event('godoutor:open-conversations'))}>
            <Icon n="inbox" size={18} />
          </button>
        )}

        <button type="button" className="ws-topbar__icon-button" data-topbar-secondary="true"
          aria-label="Ajuda e suporte" title="Ajuda e suporte" onClick={onOpenHelp}>
          <Icon n="help" size={18} />
        </button>

        <AccountMenu
          user={user} unit={unit} units={units} overview={overview}
          canOverview={canOverview} canConfig={canConfig}
          legacyPagesEnabled={legacyPagesEnabled}
          isMaster={isMaster} onUnit={onUnit} onLogout={onLogout} onOpenHelp={onOpenHelp}
        />
      </div>
    </header>
  );
}
