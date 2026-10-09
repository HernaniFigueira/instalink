'use client';
// ═══════════════════════════════════════════════════════════════
// SESSION CONTEXT RAIL — contexto persistente do atendimento
// ═══════════════════════════════════════════════════════════════
// Usado pelo workspace canônico (/atendimento/[id]) e pelo registro completo
// (/atendimento/[id]/registro): MESMA identidade, MESMA navegação entre as
// duas superfícies, MESMO lugar. O paciente (pet) é o protagonista; o tutor
// é contexto. Não é perfil social: só dados reais do atendimento/cadastro.
import type { ReactNode } from 'react';
import { PageBackAction, StatusBadge } from '@/components/ui';
import type { Tone } from '@/lib/status';

export interface SessionRailFact { label: string; value: string }

export interface SessionRailProps {
  onBack: () => void;
  eyebrow: string;
  headline: string;
  /** Espécie · raça · idade · sexo (somente o que existe no cadastro). */
  patientLine?: string;
  tutor?: string;
  tutorPhone?: string;
  facts?: SessionRailFact[];
  statusLabel: string;
  statusTone: Tone;
  bookingLabel?: string;
  /** Navegação entre as superfícies da MESMA sessão. */
  nav?: Array<{ key: string; label: string; current: boolean; onSelect: () => void }>;
  /** Ações adicionais (ex.: finalização fica no rodapé, não aqui). */
  children?: ReactNode;
}

export function EncounterSessionRail({
  onBack, eyebrow, headline, patientLine, tutor, tutorPhone, facts = [],
  statusLabel, statusTone, bookingLabel, nav = [], children,
}: SessionRailProps) {
  const visibleFacts = facts.filter((f) => f.value);
  return (
    <aside className="encounter-rail" aria-label="Contexto do atendimento" data-testid="encounter-rail">
      <div className="encounter-rail__top">
        <PageBackAction className="encounter-rail__back" onClick={onBack} label="Voltar" />
        <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
      </div>

      <div className="encounter-rail__identity">
        <p className="encounter-rail__eyebrow">{eyebrow}</p>
        <h1 className="encounter-rail__patient">{headline}</h1>
        {patientLine && <p className="encounter-rail__line">{patientLine}</p>}
        {tutor && (
          <p className="encounter-rail__tutor">
            Tutor: {tutor}{tutorPhone ? ` · ${tutorPhone}` : ''}
          </p>
        )}
      </div>

      {visibleFacts.length > 0 && (
        <dl className="encounter-rail__facts">
          {visibleFacts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className="tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {bookingLabel && <p className="encounter-rail__booking">Agendamento: {bookingLabel}</p>}

      {nav.length > 0 && (
        <nav className="encounter-rail__nav" aria-label="Superfícies do atendimento">
          {nav.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-current={item.current ? 'page' : undefined}
              data-active={item.current || undefined}
              className="encounter-rail__nav-item"
              onClick={item.onSelect}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {children}
    </aside>
  );
}
