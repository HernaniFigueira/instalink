'use client';
// Seletor de período compartilhado (Dashboard e Resultados).
// As opções vêm da fonte única (lib/periods.ts) — nenhuma tela redefine
// períodos. É só recorte de visualização, não inteligência financeira.
import { PERIOD_VALUES, periodLabel, periodShortLabel } from '@/lib/periods';

export function PeriodSelector({ value, onChange, compact = false, label = 'Período' }: {
  value: number;
  onChange: (period: number) => void;
  /** Rótulos curtos ("7d", "12m", "Tudo") para telas estreitas. */
  compact?: boolean;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center bg-[var(--surface)] border border-[var(--border)] rounded-md p-0.5 gap-1 max-w-full overflow-x-auto no-scrollbar">
      {PERIOD_VALUES.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={value === p}
          className="il-option-choice il-option-choice--compact whitespace-nowrap shrink-0"
        >
          {compact ? periodShortLabel(p) : periodLabel(p)}
        </button>
      ))}
    </div>
  );
}
