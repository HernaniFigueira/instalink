'use client';
// ═══════════════════════════════════════════════════════════════
// MENU DA CONTA — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// Avatar + nome + papel + dropdown (Meu perfil · clínica/unidade atual ·
// configurações · sair).
//
// Nada aqui inventa destino: cada item só aparece quando existe rota REAL e
// permissão para ela. "Meu perfil" abre /perfil (rota própria do usuário:
// foto, contato, cargo e dados profissionais). Equipe continua sendo a lista
// de acessos da unidade.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { roleLabel } from '@/lib/role-labels';
import { mayLeaveEditor } from './useUnsavedChanges';

export interface AccountUnit {
  id: string;
  name: string;
  logo?: string;
  slug: string;
  role?: string;
  organizationId?: string;
}

export function AccountMenu({ user, unit, units, overview, canOverview, canTeam, canConfig, onUnit, onLogout, isMaster }: {
  user: { name: string; email?: string; role?: string; photo?: string };
  unit: AccountUnit;
  units: AccountUnit[];
  /** true = o contexto atual é a visão de organização (não uma unidade). */
  overview?: boolean;
  canOverview?: boolean;
  canTeam?: boolean;
  canConfig?: boolean;
  onUnit: (id: string) => void;
  onLogout: () => void;
  isMaster?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const q = unit.id ? `?b=${unit.id}` : '';

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);


  function pick(id: string) {
    if (!mayLeaveEditor()) return;
    setOpen(false);
    onUnit(id);
  }

  const role = unit.role || (isMaster ? 'MASTER' : user.role);

  return (
    <div ref={boxRef} className="ws-account">
      <button
        ref={buttonRef}
        type="button"
        className="ws-account__trigger"
        aria-label={`Menu da conta — ${user.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {/* Avatar do USUÁRIO (iniciais). O logo da clínica vive na sidebar e o
            avatar da página pública é outro contexto — nunca misturar. */}
        <Avatar name={user.name} src={user.photo || undefined} size={32} />
        <span className="ws-account__who">
          <span className="ws-account__name">{user.name}</span>
          <span className="ws-account__role">{roleLabel(role) || 'Equipe'}</span>
        </span>
        <Icon n="chevron" size={15} className="ws-account__chevron" />
      </button>

      {open && (
        <div className="ws-popover ws-account__panel" role="dialog" aria-label="Menu da conta">
          <header className="ws-account__header">
            <Avatar name={user.name} src={user.photo || undefined} size={40} />
            <div className="ws-account__identity">
              <p className="ws-account__identity-name">{user.name}</p>
              {user.email && <p className="ws-account__identity-email">{user.email}</p>}
              <p className="ws-account__identity-role">
                {roleLabel(role) || 'Equipe'}
                {unit.name && <> · {overview ? 'visão da organização' : unit.name}</>}
              </p>
            </div>
          </header>

          <div className="ws-menu">
            {canTeam && (
              <Link className="ws-menu__item" href={`/perfil${q}`} onClick={() => setOpen(false)}>
                <Icon n="userCircle" size={16} /> Meu perfil
              </Link>
            )}

            {/* Clínica/unidade atual — troca REAL de contexto (mesma função que
                existia na sidebar; só mudou de lugar). */}
            <div className="ws-menu__group">
              <p className="ws-menu__label">Clínica atual</p>
              {canOverview && (
                <button type="button" className="ws-menu__item" aria-pressed={!!overview}
                  onClick={() => pick('__overview')}>
                  <Icon n="buildings" size={16} />
                  <span className="ws-menu__item-text">Visão geral da organização</span>
                  {overview && <Icon n="check" size={14} className="ws-menu__check" />}
                </button>
              )}
              {units.map((item) => (
                <button type="button" key={item.id} className="ws-menu__item"
                  aria-pressed={!overview && item.id === unit.id}
                  onClick={() => pick(item.id)}>
                  <Icon n="store" size={16} />
                  <span className="ws-menu__item-text">{item.name}</span>
                  {item.role && <em className="ws-menu__tag">{roleLabel(item.role)}</em>}
                  {!overview && item.id === unit.id && <Icon n="check" size={14} className="ws-menu__check" />}
                </button>
              ))}
              {canOverview && (
                <button type="button" className="ws-menu__item ws-menu__item--muted" onClick={() => pick('__add')}>
                  <Icon n="plus" size={16} /> <span className="ws-menu__item-text">Nova unidade</span>
                </button>
              )}
            </div>

            {unit.slug && (
              <a className="ws-menu__item" href={`/${unit.slug}`} target="_blank" rel="noreferrer">
                <Icon n="external" size={16} /> Ver página pública
              </a>
            )}
            {canConfig && unit.id && (
              <Link className="ws-menu__item" href={`/configuracoes${q}`} onClick={() => setOpen(false)}>
                <Icon n="settings" size={16} /> Configurações
              </Link>
            )}
            <Link className="ws-menu__item" href={`/alterar-senha${q}`} onClick={() => setOpen(false)}>
              <Icon n="lock" size={16} /> Alterar senha
            </Link>

            <div className="ws-menu__separator" />
            <button type="button" className="ws-menu__item ws-menu__item--danger"
              onClick={() => { setOpen(false); onLogout(); }}>
              <Icon n="logout" size={16} /> Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
