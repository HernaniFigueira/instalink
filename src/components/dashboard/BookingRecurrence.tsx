'use client';
// ═══════════════════════════════════════════════════════════════
// REPETIÇÃO DE AGENDAMENTO (A3.3 — clareza de fluxo)
// ═══════════════════════════════════════════════════════════════
// A REGRA não mudou (lib/booking-recurrence + lib/booking-series continuam
// sendo a fonte). O que mudou é a explicação do fluxo para quem nunca usou:
//
//   1. escolher a frequência e quando termina;
//   2. GERAR as datas (botão real, com ícone);
//   3. REVISAR/ajustar cada ocorrência;
//   4. VALIDAR as alterações;
//   5. confirmar o agendamento (fora daqui, no rodapé do sheet).
//
// Nada é criado antes da confirmação final — e isso continua dito na tela.
import { useState } from 'react';
import { generateOccurrences, MAX_SERIES_OCCURRENCES, type BookingOccurrence, type RecurrenceFrequency } from '@/lib/booking-recurrence';
import type { OccurrencePreview } from '@/lib/booking-series';
import type { Professional } from '@/lib/types';
import { Button, Input, Select } from '@/components/ui';
import { Icon } from '@/components/icons';

const FREQUENCY_LABEL: Record<string, string> = {
  none: 'Sem repetição (atendimento único)',
  weekly: 'Toda semana',
  fortnightly: 'A cada 2 semanas',
  monthly: 'Todo mês',
  custom: 'Datas personalizadas (eu escolho cada dia)',
};

export function BookingRecurrence({ first, rows, preview, pros, min, max, busy, onChange, onReview, onDisable }: {
  first: BookingOccurrence; rows: BookingOccurrence[]; preview: OccurrencePreview[] | null;
  pros: Professional[]; min: string; max: string; busy: boolean;
  onChange: (rows: BookingOccurrence[]) => void; onReview: (rows: BookingOccurrence[]) => void; onDisable: () => void;
}) {
  const [frequency, setFrequency] = useState<RecurrenceFrequency | 'custom'>('weekly');
  const [endMode, setEndMode] = useState('count');
  const [count, setCount] = useState(6);
  const [until, setUntil] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'config' | 'review'>('config');

  function generate() {
    try {
      setError('');
      const next = frequency === 'custom' ? (rows.length ? rows : [{ ...first }, { ...first, date: '' }])
        : generateOccurrences(first, frequency, endMode === 'count' ? { count } : { until });
      onChange(next);
      setStep('review');
      if (frequency !== 'custom') onReview(next);
    } catch (e: any) { setError(e.message); setStep('config'); }
  }

  function change(i: number, patch: Partial<BookingOccurrence>) {
    onChange(rows.map((r, j) => i === j ? { ...r, ...patch } : r));
  }

  const availableCount = (preview || []).filter((p) => p?.state === 'available').length;
  const pendingCount = rows.length - availableCount;

  return (
    <fieldset disabled={busy} className="space-y-3 rounded-lg border border-[var(--lilac-border)] bg-[var(--lilac-bg)]/55 p-3.5">
      <legend className="text-sm font-bold text-[var(--lilac-fg)] inline-flex items-center gap-1.5 px-1">
        <Icon n="sync" size={14} /> Repetir este atendimento (opcional)
      </legend>

      {/* Passo 1 — como repetir */}
      <div className="rounded-md bg-white border border-[var(--border)] p-3 space-y-3 shadow-xs">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)] inline-flex items-center gap-1.5">
          <Step n={1} /> Como repetir
        </p>
        <label className="block text-xs font-semibold text-[var(--text-muted)]">Frequência
          <Select aria-label="Frequência" className="mt-1" value={frequency} onChange={(e) => {
            if (e.target.value === 'none') { onDisable(); return; }
            setFrequency(e.target.value as typeof frequency); onChange([]); setStep('config');
          }}>
            {Object.entries(FREQUENCY_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </Select>
        </label>

        {frequency !== 'custom' && <>
          <label className="block text-xs font-semibold text-[var(--text-muted)]">Quando termina
            <Select className="mt-1" value={endMode} onChange={(e) => { setEndMode(e.target.value); onChange([]); }}>
              <option value="count">Depois de uma quantidade de atendimentos</option>
              <option value="until">Em uma data final</option>
            </Select>
          </label>
          {endMode === 'count'
            ? <label className="block text-xs font-semibold text-[var(--text-muted)]">Quantidade de atendimentos (inclui o primeiro)
              <Input className="mt-1" type="number" min={2} max={MAX_SERIES_OCCURRENCES} value={count}
                onChange={(e) => { setCount(Number(e.target.value)); onChange([]); }} />
            </label>
            : <label className="block text-xs font-semibold text-[var(--text-muted)]">Última data (inclusive)
              <Input className="mt-1" type="date" min={first.date || min} max={max} value={until}
                onChange={(e) => { setUntil(e.target.value); onChange([]); }} />
            </label>}
          {frequency === 'monthly' && (
            <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-2.5 py-2">
              Em meses menores usamos o último dia e voltamos ao dia original no mês seguinte: 31/jan → 28/fev → 31/mar.
            </p>
          )}
        </>}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="primary" size="sm" onClick={generate}>
            <Icon n="calendarPlus" size={14} />
            {frequency === 'custom' ? 'Preparar datas personalizadas' : 'Gerar datas'}
          </Button>
          {rows.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { onChange([]); setStep('config'); }}>
              <Icon n="x" size={13} /> Limpar datas
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs font-semibold text-[var(--danger-fg)] bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-md px-2.5 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Passo 2 — revisar */}
      {rows.length > 0 && (
        <div className="rounded-md bg-white border border-[var(--border)] p-3 space-y-3 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)] inline-flex items-center gap-1.5">
            <Step n={2} /> Revisar e validar
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-[var(--text)] tabular-nums">
              {rows.length} {rows.length === 1 ? 'atendimento será criado' : 'atendimentos serão criados'}
            </span>
            {preview && (
              <span className="text-xs font-semibold text-[var(--text-muted)]">
                · <span className="text-[var(--success-fg)]">{availableCount} livre(s)</span>
                {pendingCount > 0 && <> · <span className="text-[var(--warning-fg)]">{pendingCount} a verificar</span></>}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Ajuste data, horário ou profissional de cada ocorrência. Nada é criado antes da confirmação final.
          </p>

          <ol className="space-y-2.5">
            {rows.map((row, i) => {
              const st = preview?.[i];
              const ok = st?.state === 'available';
              return (
                <li key={i} className={
                  'rounded-md border p-2.5 space-y-2 '
                  + (st ? (ok ? 'border-[var(--success-border)] bg-[var(--success-bg)]/60' : 'border-[var(--warning-border)] bg-[var(--warning-bg)]/60')
                    : 'border-[var(--border)] bg-[var(--surface-2)]')
                }>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 h-6 shrink-0 rounded-pill bg-[var(--lilac-bg)] text-[var(--lilac-fg)] text-[11px] font-bold flex items-center justify-center tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-xs font-bold text-[var(--text)] tabular-nums">
                      {row.date ? row.date.split('-').reverse().join('/') : 'sem data'}{row.time ? ` · ${row.time}` : ''}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] truncate">
                      {st?.professionalName || pros.find((p) => p.id === row.professionalId)?.name || 'Automático (equipe elegível)'}
                    </span>
                    <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
                      className="ml-auto il-chip" aria-label={`Remover ocorrência ${i + 1}`}>
                      <Icon n="x" size={11} /> Remover
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input aria-label={`Data ${i + 1}`} type="date" min={min} max={max} value={row.date}
                      onChange={(e) => change(i, { date: e.target.value })} />
                    <Input aria-label={`Horário ${i + 1}`} type="time" value={row.time}
                      onChange={(e) => change(i, { time: e.target.value })} />
                  </div>
                  <Select aria-label={`Profissional ${i + 1}`} value={row.professionalId}
                    onChange={(e) => change(i, { professionalId: e.target.value })}>
                    <option value="">Automático (equipe elegível)</option>
                    {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <p role="status" className={
                    'text-xs font-semibold inline-flex items-center gap-1.5 '
                    + (st ? (ok ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]') : 'text-[var(--text-muted)]')
                  }>
                    <Icon n={st ? (ok ? 'checkCircle' : 'alert') : 'clock'} size={12} />
                    {st?.label || 'Aguardando validação'}
                  </p>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--border-soft)]">
            <Button type="button" variant="soft" size="sm" disabled={rows.length >= MAX_SERIES_OCCURRENCES}
              onClick={() => onChange([...rows, { ...first, date: '' }])}>
              <Icon n="plus" size={14} /> Adicionar data
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={() => onReview(rows)}>
              <Icon n="checkCircle" size={14} /> Validar alterações
            </Button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            A disponibilidade é verificada de novo ao confirmar. Limite: {MAX_SERIES_OCCURRENCES} atendimentos por série, até 5 anos.
          </p>
        </div>
      )}

      {step === 'config' && rows.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] inline-flex items-start gap-1.5">
          <Icon n="spark" size={13} className="mt-0.5" />
          Escolha a frequência e clique em “Gerar datas” para ver a lista de atendimentos antes de confirmar.
        </p>
      )}
    </fieldset>
  );
}

/** Bolinha numerada do passo (o fluxo é didático para quem nunca repetiu). */
function Step({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="w-4 h-4 rounded-full bg-[var(--lilac)] text-white text-[10px] font-bold inline-flex items-center justify-center">
      {n}
    </span>
  );
}
