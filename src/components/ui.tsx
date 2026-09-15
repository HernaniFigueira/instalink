import { cn } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { toneCls, type Tone } from '@/lib/status';

// ── Design System InstaLink — workspace first, card quando fizer sentido ──
export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }) {
  const { variant = 'primary', size = 'md', className, ...rest } = props;
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 disabled:opacity-50 disabled:pointer-events-none rounded-md',
        size === 'sm' && 'text-xs px-2.5 py-1.5',
        size === 'md' && 'text-sm px-3.5 py-2',
        size === 'lg' && 'text-sm px-5 py-2.5',
        variant === 'primary' && 'bg-zinc-900 text-white hover:bg-zinc-800',
        variant === 'secondary' && 'bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50',
        variant === 'ghost' && 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 border border-transparent',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
      {...rest}
    />
  );
}

export function A(props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' | 'lg' }) {
  const { variant = 'primary', size = 'md', className, ...rest } = props;
  return (
    <a
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-semibold transition-colors rounded-md',
        size === 'sm' && 'text-xs px-2.5 py-1.5',
        size === 'md' && 'text-sm px-3.5 py-2',
        size === 'lg' && 'text-sm px-5 py-2.5',
        variant === 'primary' && 'bg-zinc-900 text-white hover:bg-zinc-800',
        variant === 'secondary' && 'bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50',
        variant === 'ghost' && 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
        className,
      )}
      {...rest}
    />
  );
}

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cn('bg-white border border-zinc-200 rounded-lg', className)} {...rest} />;
}

// Painel workspace — sem sombra exagerada, densidade adequada
export function Panel({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-white border border-zinc-200 rounded-lg', className)} {...rest} />;
}

export function Toolbar({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 bg-white', className)} {...rest} />;
}

export function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {hint && <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      className={cn('w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900', className)}
      {...rest}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      className={cn('w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900', className)}
      {...rest}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select
      className={cn('w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900', className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold tracking-wide text-zinc-600 mb-1">
        {label} {required && <span className="text-red-600">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-zinc-500 mt-1">{hint}</span>}
    </label>
  );
}

export function Badge({ tone = 'zinc', children }: { tone?: 'zinc' | 'green' | 'amber' | 'red' | 'blue' | 'pink'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    zinc: 'bg-zinc-100 text-zinc-700 border border-zinc-200',
    green: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border border-amber-200',
    red: 'bg-red-50 text-red-700 border border-red-200',
    blue: 'bg-blue-50 text-blue-800 border border-blue-200',
    pink: 'bg-pink-50 text-pink-800 border border-pink-200',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

// Selo de ESTADO (cor = estado): usa a fonte única de cores (lib/status.ts).
// Para etiquetas neutras, usar Badge. O estado nunca depende só da cor — o
// texto do selo é sempre o rótulo do status.
export function StatusBadge({ tone = 'zinc', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold leading-tight border', toneCls(tone), className)}>
      {children}
    </span>
  );
}

// Faixa de atenção operacional (pendências que pedem decisão): mesma
// apresentação na Dashboard e na Agenda — um componente, não dois estilos.
export function AttentionStrip({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5">
        <Icon n="alert" size={14} /> {title}
      </span>
      {hint && <span className="text-xs text-amber-800 hidden sm:inline">· {hint}</span>}
      {action && <span className="flex flex-wrap gap-1.5 ml-auto">{action}</span>}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-400 mb-3"><Icon n="spark" size={20} /></div>
      <h3 className="font-semibold text-zinc-900 text-sm">{title}</h3>
      <p className="text-sm text-zinc-500 mt-1 max-w-sm mx-auto">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {hint && <p className="text-sm text-zinc-500 mt-1">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// KPI compacto — não é card gigante
export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-semibold tracking-wider uppercase text-zinc-500">{label}</p>
      <p className={cn('text-xl font-semibold mt-1 leading-none', tone === 'success' && 'text-emerald-700', tone === 'warning' && 'text-amber-700', tone === 'danger' && 'text-red-600')}>{value}</p>
      {hint && <p className="text-xs text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold text-zinc-900 mt-1 tracking-tight">{value}</p>
      {hint && <p className="text-xs text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'error'; children: React.ReactNode }) {
  return (
    <div className={cn(
      'rounded-md px-3 py-2.5 text-sm font-medium border',
      tone === 'info' && 'bg-blue-50 text-blue-800 border-blue-200',
      tone === 'success' && 'bg-emerald-50 text-emerald-800 border-emerald-200',
      tone === 'error' && 'bg-red-50 text-red-700 border-red-200',
    )}>
      {children}
    </div>
  );
}

// ── Skeletons ───────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-zinc-200/70', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid sm:grid-cols-3 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}
