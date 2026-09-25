'use client';
// ═══════════════════════════════════════════════════════════════
// TOPBAR DO APP SHELL — Visual Fidelity Pass
// ═══════════════════════════════════════════════════════════════
// A topbar começa DEPOIS da sidebar (que ocupa top:0→bottom:0), como no
// mockup aprovado. Regiões:
//   ESQUERDA → seletor de unidade (identifica a clínica UMA vez)
//   CENTRO   → busca global (campo de aplicação, Ctrl+K)
//   DIREITA  → + Novo (ação de produto, roxo assinatura) · sino com badge
//              real · ajuda · conta (avatar circular + nome + papel)
// O breadcrumb de CONTEXTO (sem branding) vive no conteúdo, acima do título.
// Fundo sólido: nenhum blur/filtro em container que contém texto.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { GlobalSearch, type NavSearchItem } from './GlobalSearch';
import { NotificationsBell } from './NotificationsBell';
import { AccountMenu, type AccountUnit } from './AccountMenu';
import type { WorkspaceAlerts } from '@/lib/workspace-alerts';

function useOutside(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [close]);
  return ref;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '·';
}

export function WorkspaceTopbar({ page, query, searchItems, activePath, alerts, user, unit, units, overview, canOverview, canConfig, canCreate, onUnit, onLogout, onOpenNav, onOpenHelp, isMaster }: {
  /** Tela atual — usado só no aria e no rótulo do botão de ajuda. */
  page: string;
  query: string;
  searchItems: NavSearchItem[];
  activePath: string;
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
  /** Rotas de criação que este usuário pode abrir (menu "Novo"). */
  canCreate: string[];
  onLogout: () => void;
  onOpenNav: () => void;
  /** Abre a central de ajuda confiável (sheet) do shell. */
  onOpenHelp?: () => void;
  isMaster?: boolean;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const newRef = useOutside(() => setNewOpen(false));

  // Quick Create GLOBAL: as seis criações do produto, somente o que o papel/
  // módulo deste usuário permite (canCreate vem do catálogo).
  // `open: 'novo=1'` = a página abre o formulário em Workspace Sheet na hora.
  const createItems = [
    { href: '/agenda', label: 'Novo agendamento', icon: 'calendarPlus', open: 'novo=1' },
    { href: '/clientes', label: 'Novo paciente', icon: 'users', open: 'novo=1' },
    { href: '/profissionais', label: 'Novo profissional', icon: 'idcard', open: '' },
    { href: '/servicos', label: 'Novo serviço', icon: 'service', open: '' },
    { href: '/tarefas', label: 'Nova pendência', icon: 'tasks', open: '' },
    { href: '/financeiro', label: 'Recebimento', icon: 'wallet', open: 'novo=1' },
  ].filter((i) => canCreate.includes(i.href));
  const createHref = (i: { href: string; open: string }) =>
    `${i.href}${query || '?'}${query ? '&' : ''}${i.open || ''}`;

  return (
    <header className="ws-topbar">
      <div className="ws-topbar__left">
        <button type="button" className="ws-topbar__icon-button ws-topbar__nav-toggle"
          aria-label="Abrir navegação" onClick={onOpenNav}>
          <Icon n="menu" size={19} />
        </button>
      </div>

      <div className="ws-topbar__center">
        <GlobalSearch items={searchItems} activePath={activePath} />
      </div>

      <div className="ws-topbar__right">
        {createItems.length > 0 && (
          <div className="relative" ref={newRef}>
            <button type="button" className="ws-newbtn" aria-haspopup="menu" aria-expanded={newOpen}
              onClick={() => setNewOpen((v) => !v)}>
              <Icon n="plus" size={15} /> Novo
            </button>
            {newOpen && (
              <div className="ws-pop" role="menu" aria-label="Criar novo">
                {createItems.map((i) => (
                  <Link key={i.href + i.label} href={createHref(i)} role="menuitem" className="ws-pop__item"
                    onClick={() => setNewOpen(false)}>
                    <Icon n={i.icon} size={15} className="text-[var(--brand-fg)]" /> {i.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

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
