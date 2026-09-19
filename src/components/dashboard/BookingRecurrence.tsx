'use client';
import { useState } from 'react';
import { generateOccurrences, MAX_SERIES_OCCURRENCES, type BookingOccurrence, type RecurrenceFrequency } from '@/lib/booking-recurrence';
import type { OccurrencePreview } from '@/lib/booking-series';
import type { Professional } from '@/lib/types';

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
  const input = 'w-full border border-zinc-300 rounded-md px-2 py-2 text-sm bg-white';
  function generate() {
    try {
      setError('');
      const next = frequency === 'custom' ? (rows.length ? rows : [{ ...first }, { ...first, date: '' }])
        : generateOccurrences(first, frequency, endMode === 'count' ? { count } : { until });
      onChange(next);
      if (frequency !== 'custom') onReview(next);
    } catch (e: any) { setError(e.message); }
  }
  function change(i: number, patch: Partial<BookingOccurrence>) {
    onChange(rows.map((r, j) => i === j ? { ...r, ...patch } : r));
  }
  return <fieldset disabled={busy} className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
    <legend className="text-sm font-semibold">Repetição opcional</legend>
    <label className="block text-xs">Frequência
      <select aria-label="Frequência" className={input} value={frequency} onChange={(e) => {
        if (e.target.value === 'none') { onDisable(); return; }
        setFrequency(e.target.value as typeof frequency); onChange([]);
      }}>
        <option value="none">Sem repetição</option><option value="weekly">Toda semana</option>
        <option value="fortnightly">A cada 2 semanas</option><option value="monthly">Todo mês</option><option value="custom">Datas personalizadas</option>
      </select>
    </label>
    {frequency !== 'custom' && <>
      <label className="block text-xs">Finalizar por
        <select className={input} value={endMode} onChange={(e) => { setEndMode(e.target.value); onChange([]); }}>
          <option value="count">Quantidade de atendimentos</option><option value="until">Data final</option>
        </select>
      </label>
      {endMode === 'count' ? <label className="block text-xs">Quantidade (inclui o primeiro)
        <input className={input} type="number" min={2} max={MAX_SERIES_OCCURRENCES} value={count} onChange={(e) => { setCount(Number(e.target.value)); onChange([]); }} />
      </label> : <label className="block text-xs">Até (inclusive)
        <input className={input} type="date" min={first.date || min} max={max} value={until} onChange={(e) => { setUntil(e.target.value); onChange([]); }} />
      </label>}
      {frequency === 'monthly' && <p className="text-xs text-zinc-500">Em meses menores usamos o último dia, retornando ao dia original no mês seguinte: 31/jan → 28/fev → 31/mar.</p>}
    </>}
    <button type="button" className="text-sm font-semibold underline" onClick={generate}>{frequency === 'custom' ? 'Preparar datas personalizadas' : 'Gerar e validar ocorrências'}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {rows.length > 0 && <>
      <p className="text-sm font-semibold">{rows.length} atendimentos serão criados</p>
      <p className="text-xs text-zinc-500">Revise e corrija cada ocorrência. Nada é criado antes da confirmação final.</p>
      <ol className="space-y-3">
        {rows.map((row, i) => <li key={i} className="space-y-2 border-b border-zinc-200 pb-3">
          <p className="text-xs font-semibold">{String(i + 1).padStart(2, '0')}. {row.date.split('-').reverse().join('/')} · {row.time} · {preview?.[i]?.professionalName || pros.find((p) => p.id === row.professionalId)?.name || 'Automático'}</p>
          <div className="grid grid-cols-2 gap-2">
            <input aria-label={`Data ${i + 1}`} type="date" min={min} max={max} className={input} value={row.date} onChange={(e) => change(i, { date: e.target.value })} />
            <input aria-label={`Horário ${i + 1}`} type="time" className={input} value={row.time} onChange={(e) => change(i, { time: e.target.value })} />
          </div>
          <select aria-label={`Profissional ${i + 1}`} className={input} value={row.professionalId} onChange={(e) => change(i, { professionalId: e.target.value })}>
            <option value="">Automático (equipe elegível)</option>
            {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex justify-between gap-2 text-xs">
            <span role="status" className={preview?.[i]?.state === 'available' ? 'text-emerald-700' : 'text-amber-800'}>{preview?.[i]?.label || 'Aguardando validação'}</span>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="underline">Remover data</button>
          </div>
        </li>)}
      </ol>
      <div className="flex flex-wrap gap-3 text-sm font-semibold">
        <button type="button" disabled={rows.length >= MAX_SERIES_OCCURRENCES} onClick={() => onChange([...rows, { ...first, date: '' }])}>+ Adicionar data</button>
        <button type="button" onClick={() => onReview(rows)} className="underline">Validar alterações</button>
      </div>
      <p className="text-xs text-zinc-500">Disponibilidade será verificada novamente ao confirmar. Limite: {MAX_SERIES_OCCURRENCES} atendimentos por série; até 5 anos.</p>
    </>}
  </fieldset>;
}
