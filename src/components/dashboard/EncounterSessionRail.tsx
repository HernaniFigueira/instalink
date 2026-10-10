'use client';
// ═══════════════════════════════════════════════════════════════
// SESSION CONTEXT RAIL — contexto persistente do atendimento
// ═══════════════════════════════════════════════════════════════
// Usado pelo workspace canônico (/atendimento/[id]) e pelo registro completo
// (/atendimento/[id]/registro): MESMA identidade, MESMO switcher entre as
// duas superfícies, MESMO lugar. O paciente (pet) é o protagonista; o tutor
// é contexto. Não é perfil social: só dados reais do atendimento/cadastro.
//
// Ordem fixa (Entrega 2):
//   Voltar previsível (diz para onde) → estado da sessão (timer ao vivo ou
//   status) → identidade do paciente → switcher "Atendimento | Registro
//   completo" → fatos do atendimento.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageBackAction, StatusBadge } from '@/components/ui';
import type { Tone } from '@/lib/status';
import { encounterTimer } from '@/lib/encounter-timer';
import type { EncounterSurface } from '@/lib/encounter-workspace';

export interface SessionRailFact { label: string; value: string }

export interface SessionRailProps {
  onBack: () => void;
  /** Para onde o Voltar leva, dito no próprio botão ("Voltar para Bernardo"). */
  backLabel?: string;
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
  /**
   * Timer ao vivo — só para atendimento em andamento com início PERSISTIDO
   * pelo servidor. Ausente = mostra o status textual.
   */
  timer?: { startedAt?: string; timezone?: string | null } | null;
  /** Switcher entre as superfícies da MESMA sessão (ausente = sem Registro). */
  surfaces?: { current: EncounterSurface; onSelect: (surface: EncounterSurface) => void } | null;
  children?: ReactNode;
}

/** Relógio de EXIBIÇÃO (1 s). O tempo é sempre now − startedAt do servidor. */
function useSecondClock(active: boolean): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    if (!active) return undefined;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * "● Em atendimento 00:02:14" — derivado do `startedAt` gravado. Sobrevive a
 * reload, troca de aba e re-render porque não guarda contagem própria.
 */
export function EncounterSessionTimer({ startedAt, timezone, fallback }: {
  startedAt?: string;
  timezone?: string | null;
  /** O que mostrar quando não há início válido (ex.: o status textual). */
  fallback?: ReactNode;
}) {
  const now = useSecondClock(Boolean(startedAt));
  const timer = encounterTimer(startedAt, now, timezone);
  if (!timer) return <>{fallback ?? null}</>;
  if (timer.kind === 'stale') {
    return (
      <p className="encounter-timer encounter-timer--stale" data-testid="encounter-timer" data-timer-state="stale">
        <span className="encounter-timer__label">Em atendimento</span>
        <span className="encounter-timer__since">{timer.label}</span>
      </p>
    );
  }
  return (
    <p
      className="encounter-timer"
      role="timer"
      aria-live="off"
      aria-label={`Em atendimento há ${timer.clock}, desde ${timer.startedHM}`}
      data-testid="encounter-timer"
      data-timer-state="live"
      title={`Início às ${timer.startedHM}`}
    >
      <span className="encounter-timer__dot" aria-hidden="true" />
      <span className="encounter-timer__label">Em atendimento</span>
      <span className="encounter-timer__clock tabular-nums">{timer.clock}</span>
    </p>
  );
}

const SURFACES: Array<{ id: EncounterSurface; label: string }> = [
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'registro', label: 'Registro completo' },
];

/**
 * Switcher canônico "Atendimento | Registro completo". Não é "Voltar": é a
 * troca de superfície da MESMA sessão, no mesmo lugar e com o mesmo estilo
 * nas duas telas. A navegação real passa pela guarda de saída de cada tela.
 */
export function EncounterSurfaceSwitch({ current, onSelect }: {
  current: EncounterSurface;
  onSelect: (surface: EncounterSurface) => void;
}) {
  return (
    <nav className="encounter-switch" aria-label="Superfícies do atendimento" data-testid="encounter-surface-switch">
      {SURFACES.map((surface) => {
        const active = surface.id === current;
        return (
          <button
            key={surface.id}
            type="button"
            className="encounter-switch__item"
            aria-current={active ? 'page' : undefined}
            data-active={active || undefined}
            data-surface={surface.id}
            onClick={() => { if (!active) onSelect(surface.id); }}
          >
            {surface.label}
          </button>
        );
      })}
    </nav>
  );
}

export function EncounterSessionRail({
  onBack, backLabel = 'Voltar', eyebrow, headline, patientLine, tutor, tutorPhone, facts = [],
  statusLabel, statusTone, bookingLabel, timer, surfaces, children,
}: SessionRailProps) {
  const visibleFacts = facts.filter((f) => f.value);
  const status = <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>;
  const railRef = useRef<HTMLElement>(null);
  // Tablet: o rail vira faixa sticky; a navegação de seções gruda LOGO ABAIXO
  // dela (nunca por baixo). A altura real da faixa vira uma variável CSS.
  useEffect(() => {
    const el = railRef.current;
    const host = el?.closest('.encounter-session') as HTMLElement | null;
    if (!el || !host || typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return undefined;
    const mq = window.matchMedia('(min-width: 640px) and (max-width: 1023px)');
    const sync = () => host.style.setProperty('--gd-encounter-strip-h', mq.matches ? `${el.offsetHeight}px` : '0px');
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    mq.addEventListener?.('change', sync);
    sync();
    return () => { ro.disconnect(); mq.removeEventListener?.('change', sync); };
  }, []);
  return (
    <aside ref={railRef} className="encounter-rail" aria-label="Contexto do atendimento" data-testid="encounter-rail">
      <div className="encounter-rail__top">
        <PageBackAction className="encounter-rail__back" onClick={onBack} label={backLabel} />
      </div>

      <div className="encounter-rail__state">
        {timer ? <EncounterSessionTimer startedAt={timer.startedAt} timezone={timer.timezone} fallback={status} /> : status}
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

      {surfaces && <EncounterSurfaceSwitch current={surfaces.current} onSelect={surfaces.onSelect} />}

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

      {children}
    </aside>
  );
}
