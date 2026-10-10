'use client';
// ═══════════════════════════════════════════════════════════════
// ENTREGA 2 · RETORNO ESTRUTURADO NO ATENDIMENTO (fonte canônica)
// ═══════════════════════════════════════════════════════════════
// Antes, o retorno ESTRUTURADO (sem retorno · data · intervalo · texto livre)
// só era editável no Registro completo, que era um segundo editor do núcleo.
// Agora o lugar canônico de edição é a seção Atendimento, junto do texto de
// orientação de retorno; Conduta e Registro mostram o RESUMO em leitura.
//
// Persistência: a MESMA autoridade das seções clínicas (`useClinicalSection`)
// → PATCH /api/encounters com `expectedVersion` e só a fatia do retorno
// (`followUpMode` + data/dias). O núcleo (texto) nunca envia `followUpMode`,
// então as duas fatias não se sobrescrevem.
import { useMemo } from 'react';
import { Input } from '@/components/ui';
import { FOLLOW_UP_MODES, FOLLOW_UP_MODE_LABELS, followUpDueDate, validateFollowUp } from '@/lib/encounters';
import type { EncounterFollowUpMode } from '@/lib/types';
import { formatDateBR } from '@/lib/tz';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';
import { useClinicalSection } from './useClinicalSection';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  authority: EncounterAuthority;
  adoptToken: number;
  blocked: boolean;
  editable: boolean;
}

interface FollowUpForm { mode: EncounterFollowUpMode | ''; date: string; days: number }

const formOf = (row: EncounterAuthorityRow): FollowUpForm => ({
  mode: (row.followUpMode as EncounterFollowUpMode) || '',
  date: row.followUpDate || '',
  days: Number(row.followUpDays) || 0,
});
const keyOf = (f: FollowUpForm) => JSON.stringify([f.mode, f.mode === 'date' ? f.date : '', f.mode === 'interval' ? f.days : 0]);

type FollowUpRow = Pick<EncounterAuthorityRow, 'date' | 'followUp' | 'followUpMode' | 'followUpDate' | 'followUpDays'>;
type DueInput = Parameters<typeof followUpDueDate>[0];

function dueOf(date: string | undefined, mode: string | undefined, followUpDate: string | undefined, days: number | undefined): string {
  return followUpDueDate({ date: date || '', followUpMode: (mode || undefined), followUpDate, followUpDays: days } as DueInput);
}

/** Só a parte ESTRUTURADA do retorno ("Em 30 dias (08/11/2026)"). */
export function followUpPlanLabel(row: FollowUpRow): string {
  const mode = row.followUpMode as EncounterFollowUpMode | '' | undefined;
  if (!mode) return '';
  const due = dueOf(row.date, mode, row.followUpDate, row.followUpDays);
  if (mode === 'none') return 'Sem retorno';
  if (mode === 'interval' && Number(row.followUpDays) > 0) return `Em ${row.followUpDays} dias${due ? ` (${formatDateBR(due)})` : ''}`;
  if (mode === 'date' && due) return `Em ${formatDateBR(due)}`;
  return mode === 'custom' ? 'Texto livre' : FOLLOW_UP_MODE_LABELS[mode];
}

/** Resumo legível do retorno (estruturado + texto) para leituras/resumos. */
export function followUpSummary(row: FollowUpRow): string {
  const plan = followUpPlanLabel(row);
  const text = String(row.followUp || '').trim();
  return [plan === 'Texto livre' && text ? '' : plan, text].filter(Boolean).join(' · ');
}

export function EncounterFollowUpPlanner({ businessId, row, authority, adoptToken, blocked, editable }: Props) {
  const patchOf = useMemo(() => (f: FollowUpForm) => (
    f.mode === 'date' ? { followUpMode: 'date', followUpDate: f.date }
      : f.mode === 'interval' ? { followUpMode: 'interval', followUpDays: f.days }
        : { followUpMode: f.mode }
  ), []);
  const validate = useMemo(() => (f: FollowUpForm) => (
    f.mode ? validateFollowUp({ followUpMode: f.mode, followUpDate: f.date, followUpDays: f.days }) : ''
  ), []);
  const { form, update } = useClinicalSection<FollowUpForm>({
    id: 'retorno', businessId, authority, row, adoptToken, blocked, editable,
    formOf, keyOf, patchOf, validate,
  });

  const choose = (mode: EncounterFollowUpMode) => {
    const next: FollowUpForm = { ...form, mode };
    if (mode === 'date' && !next.date) {
      const base = Date.parse(`${row.date || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      next.date = new Date(base + 7 * 86400000).toISOString().slice(0, 10);
    }
    if (mode === 'interval' && !next.days) next.days = 30;
    update(next);
  };
  const due = dueOf(row.date, form.mode, form.date, form.days);
  const problem = validate(form);

  return (
    <div className="gd-field encounter-followup" role="group" aria-labelledby="encounter-followup-label" data-testid="encounter-followup">
      <span id="encounter-followup-label" className="gd-field__label">Retorno</span>
      <div className="encounter-followup__choices" role="radiogroup" aria-label="Como fica o retorno">
        {FOLLOW_UP_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={form.mode === mode}
            className="il-option-choice"
            aria-pressed={form.mode === mode}
            disabled={!editable}
            onClick={() => choose(mode)}
          >
            {FOLLOW_UP_MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      {form.mode === 'date' && (
        <div className="encounter-followup__detail">
          <Input type="date" aria-label="Data do retorno" value={form.date} disabled={!editable}
            onChange={(e) => update({ ...form, date: e.target.value })} className="max-w-[200px]" />
        </div>
      )}
      {form.mode === 'interval' && (
        <div className="encounter-followup__detail">
          <Input type="number" aria-label="Intervalo em dias" min={1} max={730} value={form.days || ''} disabled={!editable}
            onChange={(e) => update({ ...form, days: Number(e.target.value) || 0 })} className="max-w-[110px]" />
          <span className="gd-field__hint">dias após o atendimento</span>
        </div>
      )}
      {problem
        ? <span className="gd-field__error" role="alert">{problem}</span>
        : (
          <span className="gd-field__hint">
            {due ? `Retorno previsto para ${formatDateBR(due)} — alimenta o follow-up e a ficha do cliente.`
              : 'Alimenta o follow-up e o “Retorno previsto” da ficha do cliente.'}
          </span>
        )}
    </div>
  );
}
