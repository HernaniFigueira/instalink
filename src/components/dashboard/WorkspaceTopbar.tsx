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

export function WorkspaceTopbar({ group, page, query, searchItems, activePath, alerts, user, unit, units, overview, canOverview, canTeam, canConfig, isMaster, canCreate, onUnit, onLogout, onOpenNav }: {
  /** Nível intermediário do breadcrumb de conteúdo (ex.: "Estrutura da clínica"). */
  group?: string;
  /** Tela atual — usado só no menu de ajuda/atalhos e aria. */
  page: string;
  query: string;
  searchItems: NavSearchItem[];
  activePath: string;
  alerts: WorkspaceAlerts;
  user: { name: string; email?: string; role?: string; photo?: string };
  unit: AccountUnit;
  units: AccountUnit[];
  overview?: boolean;
  canOverview?: boolean;
  canTeam?: boolean;
  canConfig?: boolean;
  isMaster?: boolean;
  /** Rotas de criação que este usuário pode abrir (menu + Novo). */
  canCreate: string[];
  onUnit: (id: string) => void;
  onLogout: () => void;
  onOpenNav: () => void;
}) {
  const [unitOpen, setUnitOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const unitRef = useOutside(() => setUnitOpen(false));
  const newRef = useOutside(() => setNewOpen(false));
  const helpRef = useOutside(() => setHelpOpen(false));

  // FASE 2 · P9 — Quick Create GLOBAL: as seis criações do produto, somente o
  // que o papel/módulo deste usuário permite (canCreate vem do catálogo).
  // `open: 'novo=1'` = a página abre o formulário em Workspace Sheet na hora.
  const createItems = [
    { href: '/agenda', label: 'Novo agendamento', icon: 'calendarPlus', open: 'novo=1' },
    { href: '/clientes', label: 'Novo paciente', icon: 'users', open: 'novo=1' },
    { href: '/profissionais', label: 'Novo profissional', icon: 'idcard', open: '' },
    { href: '/servicos', label: 'Novo serviço', icon: 'service', open: '' },
    { href: '/tarefas', label: 'Nova tarefa', icon: 'tasks', open: '' },
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

        {/* Identificação da unidade: UMA vez, discreta, trocável. */}
        <div className="relative" ref={unitRef}>
          <button type="button" className="ws-unitpill" aria-haspopup="menu" aria-expanded={unitOpen}
            title={`Unidade atual: ${unit.name || 'Clínica'} — clique para trocar`}
            onClick={() => setUnitOpen((v) => !v)}>
            {unit.logo
              ? <img src={unit.logo} alt="" aria-hidden="true" className="ws-unitpill__logo" />
              : <span className="ws-unitpill__dot" aria-hidden="true">{initials(unit.name || 'Clínica')}</span>}
            <span className="truncate max-w-[18ch]">{unit.name || 'Clínica'}</span>
            <Icon n="chevD" size={13} className="text-[var(--text-faint)]" />
          </button>
          {unitOpen && (
            <div className="ws-pop ws-pop--left" role="menu" aria-label="Trocar de unidade">
              <p className="ws-pop__label">Unidades</p>
              {units.map((u) => (
                <button key={u.id} type="button" role="menuitem" className="ws-pop__item"
                  onClick={() => { setUnitOpen(false); if (u.id !== unit.id) onUnit(u.id); }}>
                  {u.logo
                    ? <img src={u.logo} alt="" aria-hidden="true" className="ws-unitpill__logo" />
                    : <span className="ws-unitpill__dot" aria-hidden="true">{initials(u.name || 'Clínica')}</span>}
                  <span className="flex-1 truncate">{u.name || 'Clínica'}</span>
                  {u.id === unit.id && <Icon n="check" size={14} className="text-[var(--success)]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Atalho global e discreto para a página pública (nova aba). */}
        {unit.slug && (
          <a className="ws-topbar__icon-button" href={`/${unit.slug}`} target="_blank" rel="noreferrer"
            aria-label="Ver página pública (abre em nova aba)" title="Ver página pública">
            <Icon n="globe" size={17} />
          </a>
        )}
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

        <div className="relative" ref={helpRef}>
          <button type="button" className="ws-help" aria-haspopup="dialog" aria-expanded={helpOpen}
            aria-label="Ajuda e atalhos" title="Ajuda e atalhos" onClick={() => setHelpOpen((v) => !v)}>
            <span aria-hidden="true" className="text-[15px] font-semibold leading-none">?</span>
          </button>
          {helpOpen && (
            <div className="ws-pop" role="dialog" aria-label="Ajuda e atalhos">
              <p className="ws-pop__label">Atalhos</p>
              <p className="ws-pop__item"><kbd className="ml-auto text-[10px] font-semibold bg-[var(--surface-hover)] border border-[var(--border)] rounded px-1.5 py-0.5">Ctrl K</kbd> buscar em tudo</p>
              <p className="ws-pop__item"><kbd className="ml-auto text-[10px] font-semibold bg-[var(--surface-hover)] border border-[var(--border)] rounded px-1.5 py-0.5">Esc</kbd> fechar sheet e popovers</p>
              <p className="ws-pop__label">Navegação</p>
              <p className="ws-pop__item">Grupos com seta abrem a segunda coluna com as subáreas — neste momento: {group || page}.</p>
            </div>
          )}
        </div>

        <AccountMenu
          user={user} unit={unit} units={units} overview={overview}
          canOverview={canOverview} canTeam={canTeam} canConfig={canConfig}
          isMaster={isMaster} onUnit={onUnit} onLogout={onLogout}
        />
      </div>
    </header>
  );
}
