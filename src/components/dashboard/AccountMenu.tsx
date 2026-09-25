'use client';
// ═══════════════════════════════════════════════════════════════
// MENU DA CONTA — GoDoutor Product/UX Revolution 2.0
// ═══════════════════════════════════════════════════════════════
// Avatar (foto REAL quando existe; iniciais só como fallback) + nome + papel
// e o menu da própria pessoa.
//
// O QUE MUDOU (correção de acesso, §17):
//   • "Meu perfil" aparecia SOMENTE para quem podia administrar Equipe
//     (`canTeam`). Editar o próprio nome, foto e conselho nunca deveria
//     depender de administrar outras pessoas: agora a porta existe para TODO
//     usuário autenticado.
//   • A troca de unidade veio para cá (era um pill na topbar) — a identidade
//     da clínica vive na sidebar, então esta é a região de "quem eu sou" e
//     "onde eu estou".
//   • Ajuda e suporte é um item de verdade (abre a central), não um popover
//     decorativo de atalhos.
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

export function AccountMenu({ user, unit, units = [], overview, canOverview, canConfig, onUnit, onLogout, isMaster, onOpenHelp }: {
  user: { name: string; email?: string; role?: string; photo?: string };
  unit: AccountUnit;
  units?: AccountUnit[];
  /** true = o contexto atual é a visão de organização (não uma unidade). */
  overview?: boolean;
  canOverview?: boolean;
  canConfig?: boolean;
  onUnit?: (id: string) => void;
  onLogout: () => void;
  isMaster?: boolean;
  /** Abre a central de ajuda do shell. */
  onOpenHelp?: () => void;
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
    onUnit?.(id);
  }

  const role = unit.role || (isMaster ? 'MASTER' : user.role);
  const multiUnit = units.length > 1;

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
                {multiUnit && unit.name && <> · {overview ? 'visão da organização' : unit.name}</>}
              </p>
            </div>
          </header>

          <div className="ws-menu">
            {/* PERFIL — para QUALQUER pessoa autenticada. Editar o próprio
                nome/foto nunca depende de administrar a equipe. */}
            <Link className="ws-menu__item" href={`/perfil${q}`} onClick={() => setOpen(false)}>
              <Icon n="userCircle" size={16} /> Meu perfil
            </Link>

            {/* Troca de unidade: só quando há mais de uma (ou visão de
                organização). Uma unidade só não precisa de seletor. */}
            {(multiUnit || canOverview) && (
              <div className="ws-menu__group">
                <p className="ws-menu__label">Clínica atual</p>
                {canOverview && (
                  <button type="button" className="ws-menu__item" aria-pressed={!!overview}
                    onClick={() => pick('__overview')}>
                    <Icon n="buildings" size={16} />
                    <span className="ws-menu__item-text">Visão da organização</span>
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
            )}

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
            <button type="button" className="ws-menu__item" onClick={() => { setOpen(false); onOpenHelp?.(); }}>
              <Icon n="help" size={16} /> Ajuda e suporte
            </button>
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
