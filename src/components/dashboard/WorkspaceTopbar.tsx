'use client';
// ═══════════════════════════════════════════════════════════════
// TOPBAR DO APP SHELL — Visual Fidelity Pass
// ═══════════════════════════════════════════════════════════════
// A topbar começa DEPOIS da sidebar (que ocupa top:0→bottom:0), como no
// mockup aprovado. Regiões:
//   ESQUERDA → seletor de unidade (identifica a clínica UMA vez)
//   CENTRO   → busca global (campo de aplicação, Ctrl+K)
//   DIREITA  → quick create “+” (missão 6: voltou como ação global premium)
//              · sino com badge real · ajuda · conta (avatar + nome + papel).
// O breadcrumb de CONTEXTO (sem branding) vive no conteúdo, acima do título.
// Fundo sólido: nenhum blur/filtro em container que contém texto.
import { Icon } from '@/components/icons';
import { GlobalSearch, type NavSearchItem } from './GlobalSearch';
import { NotificationsBell } from './NotificationsBell';
import { AccountMenu, type AccountUnit } from './AccountMenu';
import { QuickCreateMenu } from './QuickCreateMenu';
import type { WorkspaceAlerts } from '@/lib/workspace-alerts';

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '·';
}

export function WorkspaceTopbar({ page, query, searchItems, activePath, businessId = '', alerts, user, unit, units, overview, canOverview, canConfig, canCreate, onUnit, onLogout, onOpenNav, onOpenHelp, isMaster, vet }: {
  /** Tela atual — usado só no aria e no rótulo do botão de ajuda. */
  page: string;
  query: string;
  searchItems: NavSearchItem[];
  activePath: string;
  /** Unidade ativa — a busca de ENTIDADES (pessoas/agendamentos/conversas) é da unidade. */
  businessId?: string;
  alerts: WorkspaceAlerts;
  user: { name: string; email?: string; role?: string; photo?: string };
  /** Unidade atual + unidades da conta: usadas SÓ pelo menu da conta (a
   *  identidade da clínica vive na sidebar; a topbar não duplica branding). */
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
  onLogout: () => void;
  onOpenNav: () => void;
  /** Abre a central de ajuda confiável (sheet) do shell. */
  onOpenHelp?: () => void;
  isMaster?: boolean;
}) {
  return (
    <header className="ws-topbar">
      <div className="ws-topbar__left">
        <button type="button" className="ws-topbar__icon-button ws-topbar__nav-toggle"
          aria-label="Abrir navegação" onClick={onOpenNav}>
          <Icon n="menu" size={19} />
        </button>
      </div>

      <div className="ws-topbar__center">
        <GlobalSearch items={searchItems} activePath={activePath} businessId={businessId} />
      </div>

      <div className="ws-topbar__right">
        {/* Missão 6 — o “+” volta como quick create global premium. */}
        <QuickCreateMenu canCreate={canCreate} businessId={businessId} vet={vet} />

        <NotificationsBell alerts={alerts} />

        <button type="button" className="ws-topbar__icon-button"
          aria-label="Ajuda e suporte" title="Ajuda e suporte" onClick={onOpenHelp}>
          <Icon n="help" size={18} />
        </button>

        <AccountMenu
          user={user} unit={unit} units={units} overview={overview}
          canOverview={canOverview} canConfig={canConfig}
          isMaster={isMaster} onUnit={onUnit} onLogout={onLogout} onOpenHelp={onOpenHelp}
        />
      </div>
    </header>
  );
}
