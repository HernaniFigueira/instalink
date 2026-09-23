'use client';
import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef } from 'react';
import { wrapDialogFocus } from '@/lib/dialog-focus';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/scroll-lock';
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
    'il-control inline-flex items-center justify-center font-semibold rounded-md whitespace-nowrap',
    `il-control--${size}`,
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
        'il-icon-button',
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
  'il-field-control w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm text-[var(--text)] ' +
  'placeholder:text-[var(--text-faint)] shadow-xs transition-[border-color,box-shadow] ' +
  'focus:outline-none focus:shadow-focus focus:border-[var(--brand)] ' +
  'disabled:bg-[var(--surface-3)] disabled:text-[var(--text-muted)] disabled:cursor-not-allowed';

interface FieldContextValue {
  controlId: string;
  labelId: string;
  descriptionIds: string[];
  required?: boolean;
  invalid?: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

/** Preserve caller IDs/ARIA and add the Field's help/error without replacing them. */
function useFieldControl<T extends {
  id?: string; required?: boolean; 'aria-label'?: string; 'aria-labelledby'?: string;
  'aria-describedby'?: string; 'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-required'?: React.AriaAttributes['aria-required'];
}>(props: T): T {
  const field = useContext(FieldContext);
  return field ? fieldControlProps(props, field) : props;
}

function fieldControlProps<T extends React.AriaAttributes & { id?: string; required?: boolean }>(props: T, field: FieldContextValue): T {
  const descriptions = [...new Set([
    ...(props['aria-describedby'] || '').split(/\s+/).filter(Boolean), ...field.descriptionIds,
  ])].join(' ');
  return {
    ...props,
    id: props.id || field.controlId,
    'aria-labelledby': props['aria-labelledby'] || (props['aria-label'] ? undefined : field.labelId),
    'aria-describedby': descriptions || undefined,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    // Field.required was presentation only. Announce it, but do NOT introduce
    // native submit blocking into existing forms; explicit required still wins.
    'aria-required': props['aria-required'] ?? (props.required || field.required || undefined),
  };
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = useFieldControl(props);
  return <input className={cn(FIELD_CLS, className)} {...rest} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = useFieldControl(props);
  return <textarea className={cn(FIELD_CLS, 'min-h-[72px]', className)} {...rest} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = useFieldControl(props);
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

export function Field({ label, hint, children, required, htmlFor, error }: {
  label: string; hint?: string; children: React.ReactNode; required?: boolean;
  htmlFor?: string; error?: string;
}) {
  const id = useId();
  const child = isValidElement<{ id?: string }>(children) ? children : null;
  const nativeControl = child && typeof child.type === 'string' && ['input', 'select', 'textarea'].includes(child.type);
  const field: FieldContextValue = {
    controlId: child?.props.id || htmlFor || `${id}-control`,
    labelId: `${id}-label`,
    descriptionIds: [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean),
    required, invalid: !!error,
  };
  return (
    <FieldContext.Provider value={field}>
      <label className="block" htmlFor={htmlFor || child?.props.id || (nativeControl || child?.type === Input || child?.type === Select || child?.type === Textarea ? field.controlId : undefined)}>
        <span id={field.labelId} className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
          {label} {required && <span aria-hidden="true" className="text-[var(--danger)]">*</span>}
        </span>
        {nativeControl ? cloneElement(child, fieldControlProps(child.props, field)) : children}
        {hint && <span id={`${id}-hint`} className="block text-xs text-[var(--text-muted)] mt-1">{hint}</span>}
        {error && <span id={`${id}-error`} role="alert" className="block text-xs text-[var(--danger-fg)] mt-1">{error}</span>}
      </label>
    </FieldContext.Provider>
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
          <span className="il-page-header__icon w-10 h-10 shrink-0 rounded-lg bg-[var(--surface-3)] text-[var(--brand-fg)] flex items-center justify-center border border-[var(--border)]">
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
  /** Optional IDs for consumers with a real tabpanel (filters need none). */
  tabId?: string;
  panelId?: string;
}

/** Abas/pills de navegação interna. `role="tablist"` + setas do teclado. */
export function Tabs<T extends string = string>({ items, value, onChange, ariaLabel, size = 'md', idPrefix }: {
  items: TabItem<T>[]; value: T; onChange: (id: T) => void; ariaLabel: string; size?: 'sm' | 'md';
  idPrefix?: string;
}) {
  const generatedId = useId();
  const prefix = idPrefix || generatedId;
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const entry = enabled.find((item) => item.id === value) || enabled[0];
  function move(event: React.KeyboardEvent<HTMLButtonElement>, current: T) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const position = enabled.findIndex((item) => item.id === current);
    let next: TabItem<T> | undefined;
    if (event.key === 'ArrowRight') next = enabled[(position + 1) % enabled.length];
    if (event.key === 'ArrowLeft') next = enabled[(position - 1 + enabled.length) % enabled.length];
    if (event.key === 'Home') next = enabled[0];
    if (event.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    buttons.current.get(next.id)?.focus();
    onChange(next.id);
  }
  return (
    <div role="tablist" aria-label={ariaLabel}
      className={cn('il-tabbar max-w-full overflow-x-auto no-scrollbar', size === 'sm' && 'il-tabbar--sm scale-95 origin-left')}>
      {items.map((item) => (
        <button key={item.id} type="button" role="tab"
          ref={(node) => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}
          id={item.tabId || `${prefix}-tab-${item.id}`}
          // Do not fabricate aria-controls pointing to an absent panel.
          aria-controls={item.panelId}
          title={item.title}
          aria-selected={value === item.id}
          tabIndex={entry?.id === item.id ? 0 : -1}
          disabled={item.disabled}
          onKeyDown={(event) => move(event, item.id)}
          onClick={() => onChange(item.id)}
          className="il-tab">
          {item.icon && <Icon n={item.icon} size={14} />}
          {item.label}
          {typeof item.count === 'number' && (
            <span className={cn(
              'ml-0.5 min-w-[18px] h-[18px] px-1 rounded-pill text-[10px] font-bold inline-flex items-center justify-center',
              value === item.id ? 'bg-[var(--brand-soft)] text-[var(--brand-fg)]' : 'bg-[var(--border)] text-[var(--text-muted)]',
            )}>{item.count}</span>
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

// ── Drawer — native modal: focus containment and background inertness are
// browser responsibilities, including nested dialogs. Kept in its DOM parent
// (no portal) so platform/public CSS scopes are never copied or leaked.

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-[720px]' }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode; width?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll(dialog);
    dialog.showModal();
    // Start at the heading rather than scrolling to a distant form autofocus.
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      unlockBodyScroll(dialog);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog ref={dialogRef} className="il-drawer fixed inset-0 z-50" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={subtitle ? `${id}-description` : undefined}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onKeyDown={(event) => {
        // Native modal inertness prevents focus in the page, but some browsers
        // Tab from the final control into browser chrome. Wrap the boundaries
        // explicitly, querying current controls (async/disabled fields included).
        wrapDialogFocus(event, event.currentTarget, titleRef.current);
        // Do not let Escape also close an underlying legacy booking sheet.
        // An inner widget may preventDefault to consume Escape itself.
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!event.defaultPrevented) { event.preventDefault(); onClose(); }
        }
      }}>
      <div className="flex h-full justify-end">
        <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[1px]" />
        <div className={cn('relative w-full h-full bg-[var(--bg)] shadow-xl flex flex-col', width)}>
          <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-[var(--surface)] border-b border-[var(--border)]">
            <div className="min-w-0">
              <h2 ref={titleRef} tabIndex={-1} id={`${id}-title`} className="text-sm font-semibold text-[var(--text)] break-words">{title}</h2>
              {subtitle && <p id={`${id}-description`} className="text-xs text-[var(--text-muted)] break-words">{subtitle}</p>}
            </div>
            <IconButton type="button" icon="x" label="Fechar" size="sm" variant="ghost" onClick={onClose} />
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto ws-scroll">{children}</div>
          {footer && <footer className="il-actionbar shrink-0 px-4 py-3 flex flex-wrap items-center justify-end gap-2">{footer}</footer>}
        </div>
      </div>
    </dialog>
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
      className={cn('il-avatar rounded-full', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
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
// HOMOLOGAÇÃO · P0-5 — contraste real via tokens --skeleton-* + shimmer.
// Nunca "branco sobre cinza quase branco"; não esconde lentidão — sinaliza.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('il-skeleton', className)} />;
}

export function PageSkeleton() {
  // HOMOLOGAÇÃO · P1 — menu (esq.) + formulário + prévia (dir.) = a forma da tela.
  return (
    <div className="space-y-4" aria-label="Carregando página">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="grid lg:grid-cols-[232px_minmax(0,1fr)_minmax(0,430px)] gap-4">
        <div className="hidden lg:block space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
        </div>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64" />
        </div>
        <div className="hidden lg:block"><Skeleton className="h-[420px] rounded-[40px]" /></div>
      </div>
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

// HOMOLOGAÇÃO · P1 — skeletons ESPECÍFicos (KPIs, grade, menu).
// Sinalizam lentidão com contraste real; nunca escondem o carregamento.
export function KpiSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-label="Carregando indicadores">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="il-skeleton h-24 rounded-lg" />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando painel">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <KpiSkeleton />
      <div className="grid lg:grid-cols-12 gap-4">
        <Skeleton className="h-64 lg:col-span-5" />
        <Skeleton className="h-64 lg:col-span-7" />
      </div>
    </div>
  );
}

export function AgendaSkeleton() {
  return (
    <div className="space-y-3" aria-label="Carregando agenda">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-36" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-px bg-[var(--border)] rounded-lg overflow-hidden">
        {Array.from({ length: 5 }).map((_, c) => (
          <div key={c} className="bg-[var(--surface)] p-2 space-y-2 min-h-[280px]">
            <Skeleton className="h-5 w-20 mx-auto" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SearchListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Carregando">
      <Skeleton className="h-10 w-full max-w-md" />
      <ListSkeleton rows={rows} />
    </div>
  );
}

export function FinanceSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando financeiro">
      <KpiSkeleton count={6} />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
