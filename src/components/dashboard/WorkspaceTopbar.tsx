'use client';
// ═══════════════════════════════════════════════════════════════
// TOPBAR DO APP SHELL — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// Barra fixa de ~62px (token --topbar-h) com três regiões:
//   ESQUERDA → breadcrumb contextual (Clínica / Agenda)
//   CENTRO   → busca global (saiu da sidebar; vira campo de aplicação)
//   DIREITA  → notificações (sino + badge real) e conta (avatar/nome/papel)
//
// A topbar NÃO cobre nada e nada a cobre: o Workspace Sheet é posicionado
// abaixo dela (top: calc(var(--topbar-h) + var(--sheet-gap))).
import { Icon } from '@/components/icons';
import { GlobalSearch, type NavSearchItem } from './GlobalSearch';
import { NotificationsBell } from './NotificationsBell';
import { AccountMenu, type AccountUnit } from './AccountMenu';
import type { WorkspaceAlerts } from '@/lib/workspace-alerts';

export interface Crumbs {
  /** Primeiro nível: a clínica (ou "Clínica" quando não há unidade ativa). */
  clinic: string;
  /** Nível intermediário opcional: a área/grupo ("Estrutura da clínica"). */
  group?: string;
  /** Nível final: a tela atual ("Serviços"). */
  page: string;
}

export function WorkspaceTopbar({ crumbs, searchItems, activePath, alerts, user, unit, units, overview, canOverview, canTeam, canConfig, isMaster, onUnit, onLogout, onOpenNav }: {
  crumbs: Crumbs;
  searchItems: NavSearchItem[];
  activePath: string;
  alerts: WorkspaceAlerts;
  user: { name: string; email?: string; role?: string };
  unit: AccountUnit;
  units: AccountUnit[];
  overview?: boolean;
  canOverview?: boolean;
  canTeam?: boolean;
  canConfig?: boolean;
  isMaster?: boolean;
  onUnit: (id: string) => void;
  onLogout: () => void;
  onOpenNav: () => void;
}) {
  return (
    <header className="ws-topbar">
      <div className="ws-topbar__left">
        <button type="button" className="ws-topbar__icon-button ws-topbar__nav-toggle"
          aria-label="Abrir navegação" onClick={onOpenNav}>
          <Icon n="menu" size={19} />
        </button>

        <nav aria-label="Breadcrumb" className="ws-crumbs">
          <ol>
            <li className="ws-crumbs__item">
              <span className="ws-crumbs__clinic" title={crumbs.clinic}>
                <span className="ws-crumbs__mark" aria-hidden="true" />
                {crumbs.clinic}
              </span>
            </li>
            {crumbs.group && (
              <li className="ws-crumbs__item">
                <Icon n="chevronRight" size={13} className="ws-crumbs__sep" aria-hidden="true" />
                <span className="ws-crumbs__group">{crumbs.group}</span>
              </li>
            )}
            <li className="ws-crumbs__item">
              <Icon n="chevronRight" size={13} className="ws-crumbs__sep" aria-hidden="true" />
              <span className="ws-crumbs__current" aria-current="page">{crumbs.page}</span>
            </li>
          </ol>
        </nav>
      </div>

      <div className="ws-topbar__center">
        <GlobalSearch items={searchItems} activePath={activePath} />
      </div>

      <div className="ws-topbar__right">
        <NotificationsBell alerts={alerts} />
        <AccountMenu
          user={user} unit={unit} units={units} overview={overview}
          canOverview={canOverview} canTeam={canTeam} canConfig={canConfig}
          isMaster={isMaster} onUnit={onUnit} onLogout={onLogout}
        />
      </div>
    </header>
  );
}
