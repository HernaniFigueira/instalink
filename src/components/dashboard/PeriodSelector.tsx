'use client';
// Seletor de período compartilhado (Dashboard e Resultados).
// As opções vêm da fonte única (lib/periods.ts) — nenhuma tela redefine
// períodos. É só recorte de visualização, não inteligência financeira.
import { PERIOD_VALUES, periodLabel, periodShortLabel } from '@/lib/periods';
import { cn } from '@/lib/utils';

export function PeriodSelector({ value, onChange, compact = false, label = 'Período' }: {
  value: number;
  onChange: (period: number) => void;
  /** Rótulos curtos ("7d", "12m", "Tudo") para telas estreitas. */
  compact?: boolean;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center bg-white border border-zinc-200 rounded-md p-0.5 gap-0.5 max-w-full overflow-x-auto no-scrollbar">
      {PERIOD_VALUES.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={value === p}
          className={cn(
            'text-xs font-medium px-2.5 py-1 rounded whitespace-nowrap transition-colors shrink-0',
            value === p ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50',
          )}
        >
          {compact ? periodShortLabel(p) : periodLabel(p)}
        </button>
      ))}
    </div>
  );
}
