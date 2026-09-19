import { cn } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { toneCls, type Tone } from '@/lib/status';
import { buildHoursChips, type HoursChipDay } from '@/lib/hours-chips';

export type { HoursChipDay };

// ═══════════════════════════════════════════════════════════════
// DESIGN SYSTEM INSTALINK (A3.3) — componentes compartilhados
// ═══════════════════════════════════════════════════════════════
// Toda a linguagem visual do painel vive AQUI + nos tokens de
// src/app/globals.css. Telas não inventam estilo: importam destes
// componentes (ou usam as classes utilitárias mapeadas no Tailwind).
//
// Hierarquia de AÇÃO — status do atendimento ≠ cor de botão:
//   primary  → a ação principal da tela (azul da marca, com peso real)
//   success  → conclusão/avanço (verde)
//   warning  → atenção operacional (âmbar suave, nunca gritante)
//   danger   → ação destrutiva (vermelho — SÓ para perigo)
//   soft     → ação relacionada à marca sem competir com a principal
//   secondary→ neutro com borda e sombra leve (reagendar, filtros, voltar)
//   ghost    → discreto (fechar, alternar)
//   quiet    → texto com ícone, mas AINDA com cara de botão (contorno suave)
// Nada de "é texto ou é botão?": todo elemento acionável tem contorno,
// preenchimento ou peso de botão.
export type ButtonVariant =
  | 'primary' | 'success' | 'warning' | 'danger' | 'soft'
  | 'secondary' | 'ghost' | 'quiet';

const BTN_VARIANT_CLS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--brand)] text-white border border-[var(--brand-strong)]/40 shadow-brand hover:bg-[var(--brand-strong)] active:translate-y-px',
  success:
    'bg-[var(--success)] text-white border border-[var(--success-strong)]/40 shadow-sm hover:bg-[var(--success-strong)] active:translate-y-px',
  warning:
    'bg-[var(--attention-bg)] text-[var(--attention)] border border-[var(--attention-border)] hover:bg-[var(--attention-bg-hover)] active:translate-y-px',
  danger:
    'bg-[var(--danger)] text-white border border-[var(--danger-strong)]/40 shadow-sm hover:bg-[var(--danger-strong)] active:translate-y-px',
  soft:
    'bg-[var(--brand-soft)] text-[var(--brand-fg)] border border-[var(--brand-border)] hover:bg-[var(--brand-bg-hover)] active:translate-y-px',
  secondary:
    'bg-white text-[var(--text)] border border-[var(--border-strong)] shadow-xs hover:bg-[var(--surface-hover)] hover:border-[var(--brand-border)] active:translate-y-px',
  ghost:
    'text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] border border-transparent',
  quiet:
    'bg-[var(--surface-3)] text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-fg)] hover:border-[var(--brand-border)] active:translate-y-px',
};

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BTN_SIZE_CLS: Record<ButtonSize, string> = {
  xs: 'text-[11px] px-2 py-1 gap-1',
  sm: 'text-xs px-2.5 py-1.5 gap-1.5',
  md: 'text-sm px-3.5 py-2 gap-1.5',
  lg: 'text-sm px-5 py-2.5 gap-2',
};

/** Classes compartilhadas de botão — permite manter a MESMA linguagem em
 *  elementos de navegação (Link/a) sem duplicar estilo fora do ui.tsx. */
export function buttonCls(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return cn(
    'inline-flex items-center justify-center font-semibold rounded-md whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150',
    'focus-visible:outline-none focus-visible:shadow-focus',
    'disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none',
    BTN_SIZE_CLS[size],
    BTN_VARIANT_CLS[variant],
  );
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const { variant = 'primary', size = 'md', className, ...rest } = props;
  return <button className={cn(buttonCls(variant, size), className)} {...rest} />;
}

export function A(props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const { variant = 'primary', size = 'md', className, ...rest } = props;
  return <a className={cn(buttonCls(variant, size), className)} {...rest} />;
}

/** Botão só de ícone (com rótulo acessível obrigatório via aria-label). */
export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string; label: string; variant?: ButtonVariant; size?: 'sm' | 'md'; tip?: string;
}) {
  const { icon, label, variant = 'secondary', size = 'md', tip, className, ...rest } = props;
  return (
    <button
      aria-label={label}
      title={tip || label}
      className={cn(
        buttonCls(variant, size),
        size === 'sm' ? 'w-8 h-8 p-0' : 'w-9 h-9 p-0',
        className,
      )}
      {...rest}
    >
      <Icon n={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cn('bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm', className)} {...rest} />;
}

// Painel workspace — cartão base do painel, com sombra de uma camada.
export function Panel({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ws-panel', className)} {...rest} />;
}

/** Cartão aninhado (card sobre card): profundidade leve, sem borda dura. */
export function SubCard({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-md shadow-xs', className)}
      {...rest}
    />
  );
}

export function Toolbar({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]', className)}
      {...rest}
    />
  );
}

export function SectionHeader({ title, hint, action, icon }: { title: string; hint?: string; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-soft)]">
      <div className="min-w-0 flex items-start gap-2.5">
        {icon && (
          <span className="mt-0.5 w-7 h-7 shrink-0 rounded-md bg-[var(--brand-soft)] text-[var(--brand-fg)] flex items-center justify-center">
            <Icon n={icon} size={15} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
          {hint && <p className="text-xs text-[var(--text-muted)] mt-0.5">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ── Formulários ────────────────────────────────────────────────
const FIELD_CLS =
  'w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm text-[var(--text)] ' +
  'placeholder:text-[var(--text-faint)] shadow-xs transition-[border-color,box-shadow] ' +
  'focus:outline-none focus:shadow-focus focus:border-[var(--brand)] ' +
  'disabled:bg-[var(--surface-3)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input className={cn(FIELD_CLS, className)} {...rest} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea className={cn(FIELD_CLS, 'min-h-[72px]', className)} {...rest} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select className={cn(FIELD_CLS, 'pr-8 appearance-none bg-[length:14px] bg-no-repeat bg-[right_10px_center]', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235a6480' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
        {label} {required && <span className="text-[var(--danger)]">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-[var(--text-muted)] mt-1">{hint}</span>}
    </label>
  );
}

/** Checkbox com cara de checkbox (não de texto clicável). */
export function Checkbox({ label, hint, checked, onChange, disabled }: {
  label: React.ReactNode; hint?: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-2.5 cursor-pointer select-none', disabled && 'opacity-60 cursor-not-allowed')}>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            'w-[18px] h-[18px] rounded-[6px] border flex items-center justify-center transition-colors',
            checked
              ? 'bg-[var(--brand)] border-[var(--brand)] text-white'
              : 'bg-white border-[var(--border-strong)] text-transparent',
            'peer-focus-visible:shadow-focus',
          )}
        >
          <Icon n="check" size={12} strokeWidth={3} />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-[var(--text)] leading-snug">{label}</span>
        {hint && <span className="block text-xs text-[var(--text-muted)] mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

/** Interruptor (liga/desliga) — estado legível com rótulo ON/OFF. */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex items-center h-6 w-11 shrink-0 rounded-pill transition-colors',
        'focus-visible:outline-none focus-visible:shadow-focus',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-150',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}

// ── Etiquetas e estados ────────────────────────────────────────
export type BadgeTone = 'zinc' | 'green' | 'amber' | 'red' | 'blue' | 'pink' | 'lilac';

export function Badge({ tone = 'zinc', children, icon, className, title }: { tone?: BadgeTone; children: React.ReactNode; icon?: string; className?: string; title?: string }) {
  const tones: Record<BadgeTone, string> = {
    zinc: 'bg-[var(--surface-3)] text-[var(--text-muted)] border-[var(--border)]',
    green: 'bg-[var(--success-bg)] text-[var(--success-fg)] border-[var(--success-border)]',
    amber: 'bg-[var(--warning-bg)] text-[var(--warning-fg)] border-[var(--warning-border)]',
    red: 'bg-[var(--danger-bg)] text-[var(--danger-fg)] border-[var(--danger-border)]',
    blue: 'bg-[var(--info-bg)] text-[var(--info-fg)] border-[var(--info-border)]',
    pink: 'bg-pink-50 text-pink-700 border-pink-200',
    lilac: 'bg-[var(--lilac-bg)] text-[var(--lilac-fg)] border-[var(--lilac-border)]',
  };
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold border', tones[tone], className)}>
      {icon && <Icon n={icon} size={11} />}
      {children}
    </span>
  );
}

// Selo de ESTADO (cor = estado): usa a fonte única de cores (lib/status.ts).
// Para etiquetas neutras, usar Badge. O estado nunca depende só da cor — o
// texto do selo é sempre o rótulo do status.
export function StatusBadge({ tone = 'zinc', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold leading-tight border shadow-xs', toneCls(tone), className)}>
      {children}
    </span>
  );
}

// Faixa de atenção operacional (pendências que pedem decisão): mesma
// apresentação na Dashboard e na Agenda — um componente, não dois estilos.
// A3.3: âmbar quente com ícone presente (o amarelo apagado sumiu).
/**
 * Faixa de atenção operacional (ponto 6 da convergência).
 *
 * Antes era uma caixa âmbar com contorno em toda a volta — com três pendências
 * na tela virava alarme. Agora: fundo âmbar MUITO suave, sem contorno, uma
 * rail de 3px à esquerda como acento, ícone laranja e título com contraste.
 * Perceptível para quem procura, elegante para quem só passa o olho.
 */
export function AttentionStrip({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg bg-[var(--warning-bg)] border-l-[3px] border-l-[var(--attention-mark)] px-3 py-2.5 flex flex-wrap items-center gap-2">
      <span className="w-6 h-6 rounded-md bg-[var(--attention-mark)] text-[var(--attention-mark-fg)] flex items-center justify-center shrink-0">
        <Icon n="alert" size={14} strokeWidth={2.2} />
      </span>
      <span className="text-xs font-bold text-[var(--text)]">{title}</span>
      {hint && <span className="text-xs text-[var(--warning-fg)] hidden sm:inline">· {hint}</span>}
      {action && <span className="flex flex-wrap gap-1.5 ml-auto">{action}</span>}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon = 'spark' }: { title: string; hint: string; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="il-empty">
      <div className="il-empty__icon"><Icon n={icon} size={22} /></div>
      <h3 className="font-semibold text-[var(--text)] text-sm">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, hint, action, icon }: { title: string; hint?: string; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="w-10 h-10 shrink-0 rounded-lg bg-gradient-to-br from-[var(--brand)] to-[var(--lilac)] text-white flex items-center justify-center shadow-brand">
            <Icon n={icon} size={19} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">{title}</h1>
          {hint && <p className="text-sm text-[var(--text-muted)] mt-1">{hint}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

// ── Navegação interna: abas em pill (padrão único do painel) ────
export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: string;
  count?: number;
  disabled?: boolean;
  title?: string;
}

/** Abas/pills de navegação interna. `role="tablist"` + setas do teclado. */
export function Tabs<T extends string = string>({ items, value, onChange, ariaLabel, size = 'md' }: {
  items: TabItem<T>[]; value: T; onChange: (id: T) => void; ariaLabel: string; size?: 'sm' | 'md';
}) {
  const idx = Math.max(0, items.findIndex((i) => i.id === value));
  function move(delta: number) {
    const enabled = items.map((i, n) => ({ i, n })).filter((x) => !x.i.disabled);
    if (!enabled.length) return;
    const pos = enabled.findIndex((x) => x.n === idx);
    const next = enabled[(pos + delta + enabled.length) % enabled.length];
    onChange(next.i.id);
  }
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('il-tabbar max-w-full overflow-x-auto no-scrollbar', size === 'sm' && 'scale-95 origin-left')}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      }}
    >
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          role="tab"
          title={i.title}
          aria-selected={value === i.id}
          disabled={i.disabled}
          onClick={() => onChange(i.id)}
          className="il-tab"
        >
          {i.icon && <Icon n={i.icon} size={14} />}
          {i.label}
          {typeof i.count === 'number' && (
            <span className={cn(
              'ml-0.5 min-w-[18px] h-[18px] px-1 rounded-pill text-[10px] font-bold inline-flex items-center justify-center',
              value === i.id ? 'bg-[var(--brand-soft)] text-[var(--brand-fg)]' : 'bg-[var(--border)] text-[var(--text-muted)]',
            )}>{i.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Chip de filtro (pill) — usado em toolbars com muitos filtros. */
export function FilterPill({ active, children, onClick, title }: {
  active: boolean; children: React.ReactNode; onClick: () => void; title?: string;
}) {
  return (
    <button type="button" aria-pressed={active} title={title} onClick={onClick} className="il-chip">
      {children}
    </button>
  );
}

// KPI compacto — não é card gigante
export function Kpi({ label, value, hint, tone, icon }: {
  label: string; value: string; hint?: string; icon?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'brand';
}) {
  const toneCls2 = {
    default: 'text-[var(--text)]',
    success: 'text-[var(--success-fg)]',
    warning: 'text-[var(--warning-fg)]',
    danger: 'text-[var(--danger-fg)]',
    brand: 'text-[var(--brand-fg)]',
  }[tone || 'default'];
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        {icon && <Icon n={icon} size={13} className="text-[var(--text-faint)]" />}
        <p className="text-[11px] font-bold tracking-wider uppercase text-[var(--text-muted)]">{label}</p>
      </div>
      <p className={cn('text-xl font-semibold mt-1 leading-none tabular-nums', toneCls2)}>{value}</p>
      {hint && <p className="text-xs text-[var(--text-muted)] mt-1">{hint}</p>}
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'brand', icon }: {
  label: string; value: string; hint?: string; icon?: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'lilac' | 'info';
}) {
  const map: Record<string, { bg: string; fg: string }> = {
    brand: { bg: 'var(--brand-soft)', fg: 'var(--brand-fg)' },
    success: { bg: 'var(--success-bg)', fg: 'var(--success-fg)' },
    warning: { bg: 'var(--warning-bg)', fg: 'var(--warning-fg)' },
    danger: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
    lilac: { bg: 'var(--lilac-bg)', fg: 'var(--lilac-fg)' },
    info: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  };
  const c = map[tone] || map.brand;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 shadow-sm flex items-start gap-3">
      {icon && (
        <span
          className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center"
          style={{ background: c.bg, color: c.fg }}
        >
          <Icon n={icon} size={17} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide uppercase text-[var(--text-muted)]">{label}</p>
        <p className="text-2xl font-semibold text-[var(--text)] mt-1 tracking-tight tabular-nums">{value}</p>
        {hint && <p className="text-xs text-[var(--text-muted)] mt-1">{hint}</p>}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children, title, className }: { tone?: 'info' | 'success' | 'error' | 'warning'; children: React.ReactNode; title?: string; className?: string }) {
  const map = {
    info: 'bg-[var(--info-bg)] text-[var(--info-fg)] border-[var(--info-border)]',
    success: 'bg-[var(--success-bg)] text-[var(--success-fg)] border-[var(--success-border)]',
    warning: 'bg-[var(--warning-bg)] text-[var(--warning-fg)] border-[var(--warning-border)]',
    error: 'bg-[var(--danger-bg)] text-[var(--danger-fg)] border-[var(--danger-border)]',
  }[tone];
  const icon = { info: 'spark', success: 'checkCircle', warning: 'alert', error: 'alert' }[tone];
  return (
    <div className={cn('rounded-md px-3 py-2.5 text-sm font-medium border flex items-start gap-2', map, className)}>
      <Icon n={icon} size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ── Drawer (painel lateral) — padrão do A3.3 para fichas ricas ──
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-[720px]' }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode; width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Fechar painel"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[1px]"
      />
      <div className={cn('relative w-full h-full bg-[var(--bg)] shadow-xl flex flex-col', width)}>
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-[var(--surface)] border-b border-[var(--border)]">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text)] truncate">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--text-muted)] truncate">{subtitle}</p>}
          </div>
          <IconButton icon="x" label="Fechar" size="sm" variant="ghost" onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto ws-scroll">{children}</div>
        {footer && <footer className="il-actionbar shrink-0 px-4 py-3 flex flex-wrap items-center justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
}

/** Avatar com placeholder bonito (iniciais) quando não há foto. */
export function Avatar({ name, src, size = 44, className }: { name: string; src?: string; size?: number; className?: string }) {
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
  return (
    <span
      className={cn('il-avatar rounded-xl', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), borderRadius: size >= 56 ? 18 : 12 }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials || '?'}</span>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOURS CHIPS (A3.4) — horário por dia em chips, não em linha corrida
// ═══════════════════════════════════════════════════════════════
// O QUE mostrar em cada dia é decidido em `lib/hours-chips.ts` (testável sem
// navegador); aqui só desenhamos. Nenhuma regra de agenda é recalculada nesta
// camada: os dias chegam das tabelas reais de `lib/schedule.ts`.
export function HoursChips({ days, className, size = 'md' }: {
  /** Dias na ordem que quiser; o componente renderiza em ordem de semana. */
  days: HoursChipDay[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  const chips = buildHoursChips(days);
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} role="list" aria-label="Horário por dia da semana">
      {chips.map((chip) => (
        <span
          key={chip.weekday}
          role="listitem"
          title={chip.text}
          aria-label={chip.text}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border font-semibold tabular-nums',
            size === 'sm' ? 'text-[11px] px-2 py-1' : 'text-xs px-2.5 py-1.5',
            chip.closed
              ? 'bg-[var(--surface-3)] border-[var(--border)] text-[var(--text-faint)]'
              : 'bg-[var(--surface)] border-[var(--border-strong)] text-[var(--text)]',
          )}
        >
          <span className={cn('font-bold tracking-wide', chip.closed ? 'text-[var(--text-faint)]' : 'text-[var(--text-muted)]')}>
            {chip.label}
          </span>
          {chip.closed ? (
            <span>Fechado</span>
          ) : (
            chip.windows.map((w, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[var(--text-faint)]">·</span>}
                <span>{w.start}</span>
                <span aria-hidden="true" className="text-[var(--brand)]">→</span>
                <span>{w.end}</span>
              </span>
            ))
          )}
        </span>
      ))}
    </div>
  );
}

// ── Skeletons ───────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-[var(--surface-3)]', className)} />;
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
