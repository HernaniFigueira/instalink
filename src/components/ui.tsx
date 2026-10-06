'use client';
import Link from 'next/link';
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { wrapDialogFocus } from '@/lib/dialog-focus';
import { isTopOverlay, popOverlay, pushOverlay } from '@/lib/overlay-stack';
import { avatarColorFor, avatarInitials } from '@/lib/avatar-palette';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/scroll-lock';
import { useOverlayDismissGuard, type DismissGuardState, type DismissReason } from '@/components/dashboard/OverlayDismissGuard';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { toneCls, type Tone } from '@/lib/status';
import { buildHoursChips, type HoursChipDay } from '@/lib/hours-chips';
import { WORKSPACE_NESTED_PANEL, WORKSPACE_SHEET_SIZES } from '@/lib/workspace-sheet-sizes';
import type { PageType } from '@/lib/panel';

export type { HoursChipDay };

// ═══════════════════════════════════════════════════════════════
// GODOUTOR WORKSPACE UI — primitives oficiais
// ═══════════════════════════════════════════════════════════════
// Componentes existentes são a única fonte de apresentação operacional.
// A cor primária vem do tema ativo; semânticas ficam reservadas a estados.
export type CanonicalButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructive-soft' | 'link' | 'success' | 'warning' | 'whatsapp';
/** Aliases temporários mantidos para compatibilidade de chamadas existentes. */
export type ButtonVariant = CanonicalButtonVariant | 'success' | 'warning' | 'danger' | 'danger-soft' | 'soft' | 'quiet' | 'cta';

const BUTTON_VARIANT_ALIAS: Partial<Record<ButtonVariant, CanonicalButtonVariant>> = {
  danger: 'destructive',
  'danger-soft': 'destructive-soft',
  soft: 'secondary',
  quiet: 'ghost',
  cta: 'primary',
};

const BTN_VARIANT_CLS: Record<CanonicalButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-contrast)] border border-[var(--accent)] hover:bg-[var(--accent-hover)] hover:border-[var(--accent-hover)]',
  secondary:
    'bg-transparent text-[var(--brand-fg)] border border-[var(--brand)] hover:bg-[var(--brand-soft)]',
  whatsapp:
    'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-transparent',
  ghost:
    'bg-transparent text-[var(--text-muted)] border border-transparent hover:bg-[var(--surface-3)] hover:text-[var(--text)]',
  // SOLID vermelho = SÓ o passo de confirmação destrutiva final (regra do DS
  // catalogada em /dev/design-system). Em repouso, numa fila de ações, o
  // destrutivo é `destructive-soft` — senão o vermelho cheio compete com o CTA
  // primário da própria superfície.
  destructive:
    'bg-[var(--danger)] text-white border border-[var(--danger)] hover:bg-[var(--danger-strong)] hover:border-[var(--danger-strong)]',
  'destructive-soft':
    'bg-[var(--danger-bg)] text-[var(--danger-fg)] border border-[var(--danger-border)] hover:bg-[var(--danger)] hover:border-[var(--danger)] hover:text-white',
  link:
    'bg-transparent text-[var(--accent)] border border-transparent underline-offset-4 hover:underline',
  success:
    'bg-[var(--success)] text-white border border-[var(--success)] hover:bg-[var(--success-strong)] hover:border-[var(--success-strong)]',
  warning:
    'bg-[var(--warning-bg)] text-[var(--warning-fg)] border border-[var(--warning-border)] hover:bg-[var(--warning-bg-hover)]',
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
    'il-control inline-flex items-center justify-center font-medium rounded-sm whitespace-nowrap',
    `il-control--${size}`,
    'transition-[background-color,border-color,color] duration-150',
    'focus-visible:outline-none focus-visible:shadow-focus',
    'disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none',
    BTN_SIZE_CLS[size],
    BTN_VARIANT_CLS[BUTTON_VARIANT_ALIAS[variant] || (variant as CanonicalButtonVariant)],
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

/** Ação única de retorno para páginas full-page (link ou saída protegida). */
export function PageBackAction({ href, onClick, label = 'Voltar', className }: {
  href?: string;
  onClick?: () => void;
  label?: string;
  className?: string;
}) {
  const classes = cn('il-page-back', className);
  const content = <><Icon n="chevL" size={15} />{label}</>;
  return href
    ? <Link href={href} className={classes}>{content}</Link>
    : <button type="button" onClick={onClick} className={classes}>{content}</button>;
}

/** Botão só de ícone (com rótulo acessível obrigatório via aria-label).
 *
 *  Métrica canônica: o botão é QUADRADO no nível escolhido, medindo da MESMA
 *  régua do Button/Select do mesmo nível (`--gd-control-h` / `-sm` / `-xs`).
 *  A altura/quadratura vive no contrato `.gd-icon-control*` do design system —
 *  a página nunca define `h-[34px]` nem corrige "por fora". */
export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string; label: string; variant?: ButtonVariant; size?: 'sm' | 'md' | 'xs'; tip?: string;
}) {
  const { icon, label, variant = 'secondary', size = 'md', tip, className, ...rest } = props;
  return (
    <button
      aria-label={label}
      title={tip || label}
      className={cn(
        buttonCls(variant, size),
        'il-icon-button p-0',
        size === 'sm' ? 'gd-icon-control--sm' : size === 'xs' ? 'gd-icon-control--xs' : 'gd-icon-control',
        className,
      )}
      {...rest}
    >
      <Icon n={icon} size={size === 'sm' ? 15 : size === 'xs' ? 13 : 16} />
    </button>
  );
}

/**
 * Moldura única do conteúdo autenticado. A largura e os gutters vêm do
 * arquétipo obrigatório declarado no catálogo de rotas, não da página filha.
 */
export function PageFrame({ type, flush = false, className, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & {
  type: PageType;
  flush?: boolean;
}) {
  return (
    <div data-page-type={type}
      className={cn('il-page-frame', `il-page-frame--${type}`, flush && 'il-page-frame--flush', className)}
      {...rest}>
      {children}
    </div>
  );
}

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cn('bg-[var(--surface)] border border-[var(--border)] rounded-md', className)} {...rest} />;
}

// Painel workspace — agrupamento neutro, sem sombra decorativa.
export function Panel({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ws-panel', className)} {...rest} />;
}

/** Cartão aninhado (card sobre card): profundidade leve, sem borda dura. */
export function SubCard({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-sm', className)}
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
          <h3 className="il-type-section text-sm font-semibold text-[var(--text)]">{title}</h3>
          {hint && <p className="text-xs text-[var(--text-muted)] mt-0.5">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Agrupamento oficial de campos de um formulário de negócio. */
export function FormSection({ title, hint, action, className, children, ...rest }: React.HTMLAttributes<HTMLElement> & {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn('il-form-section bg-[var(--surface)] border border-[var(--border)] rounded-md overflow-hidden', className)} {...rest}>
      <SectionHeader title={title} hint={hint} action={action} />
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

/** Faixa de ações do formulário: primary fica na submissão, sem igualar intenções. */
export function ActionBar({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('il-actionbar flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-4', className)} {...rest}>
      {children}
    </div>
  );
}

// ── Formulários ────────────────────────────────────────────────
const FIELD_CLS =
  'il-field-control w-full rounded-sm border border-[var(--border-strong)] bg-white px-3 py-2 text-sm text-[var(--text)] ' +
  'placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] ' +
  'focus:outline-none focus:shadow-focus focus:border-[var(--accent)] ' +
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
      <label className="il-type-body block" htmlFor={htmlFor || child?.props.id || (nativeControl || child?.type === Input || child?.type === Select || child?.type === Textarea ? field.controlId : undefined)}>
        <span id={field.labelId} className="il-type-label block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
          {label} {required && <span aria-hidden="true" className="text-[var(--danger)]">*</span>}
        </span>
        {nativeControl ? cloneElement(child, fieldControlProps(child.props, field)) : children}
        {hint && <span id={`${id}-hint`} className="il-type-help block text-xs text-[var(--text-muted)] mt-1">{hint}</span>}
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
        'relative inline-flex items-center h-6 w-11 shrink-0 rounded-pill border transition-colors duration-200',
        'focus-visible:outline-none focus-visible:shadow-focus',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--surface-3)] border-[var(--border-strong)]',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200',
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
    pink: 'bg-[var(--info-bg)] text-[var(--info-fg)] border-[var(--info-border)]',
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
// Atenção é semântica: âmbar tokenizado, nunca cor decorativa.
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
      <span className="text-xs font-semibold text-[var(--text)]">{title}</span>
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
  // CONTRATO ÚNICO de cabeçalho (refino final): [chip 40×40 neutro sutil +
  // borda 1px] + ícone line na cor do TEMA + TÍTULO near-black. Sem breadcrumb
  // no workspace; sem ícone "solto" — todas as telas usam este chip.
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="il-page-header__icon w-10 h-10 shrink-0 rounded-sm bg-[var(--surface-2)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
            <Icon n={icon} size={19} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="il-type-page text-xl font-semibold tracking-tight text-[var(--text)]">{title}</h1>
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
export function Tabs<T extends string = string>({ items, value, onChange, ariaLabel, size = 'md', idPrefix, className }: {
  items: TabItem<T>[]; value: T; onChange: (id: T) => void; ariaLabel: string; size?: 'sm' | 'md';
  idPrefix?: string; className?: string;
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
    const target = buttons.current.get(next.id);
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    onChange(next.id);
  }
  return (
    <div role="tablist" aria-label={ariaLabel}
      className={cn('il-tabbar max-w-full overflow-x-auto no-scrollbar', size === 'sm' && 'il-tabbar--sm', className)}>
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
              'ml-0.5 min-w-[18px] h-[18px] px-1 rounded-pill text-[10px] font-semibold inline-flex items-center justify-center',
              value === item.id ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--border)] text-[var(--text-muted)]',
            )}>{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * SEGMENTED CONTROL com indicador deslizante (§8).
 *
 * Por que não `Tabs`: a régua de "Dia/Semana/Mês/Lista" parecia aba de página
 * (marcador sublinhado, cada opção um alvo isolado). Aqui as quatro opções são
 * UM controle só, no mesmo espírito de um seletor de modo de aplicativo:
 * o indicador desliza por baixo do rótulo em 200ms com a curva padrão do
 * sistema, então trocar de visão parece mover uma peça — não recarregar tela.
 *
 * Acessibilidade preservada dos Tabs: `role="tablist"`, `aria-selected`,
 * roving tabindex e setas ←/→ (Home/End). Quem usa leitor de tela não perde
 * nada; quem não distingue cor continua vendo o indicador posicionado.
 */
export function Segmented<T extends string = string>({ items, value, onChange, ariaLabel, size = 'md' }: {
  items: TabItem<T>[]; value: T; onChange: (id: T) => void; ariaLabel: string; size?: 'sm' | 'md';
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const enabled = items.filter((item) => !item.disabled);
  const entry = enabled.find((item) => item.id === value) || enabled[0];
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // O indicador é MEDIDO do botão real: assim ele acompanha rótulo de tamanho
  // variável (idioma, contador) sem ninguém calcular largura na mão.
  const measure = useCallback(() => {
    const node = value ? buttons.current.get(value) : undefined;
    const list = listRef.current;
    if (!node || !list) { setThumb(null); return; }
    setThumb({ left: node.offsetLeft, width: node.offsetWidth });
  }, [value]);

  useEffect(() => { measure(); }, [measure, items.length]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !listRef.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [measure]);

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
    <div ref={listRef} role="tablist" aria-label={ariaLabel}
      className={cn('il-segmented', size === 'sm' && 'il-segmented--sm')}>
      {thumb && (
        <span className="il-segmented__thumb" aria-hidden="true"
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />
      )}
      {items.map((item) => (
        <button key={item.id} type="button" role="tab"
          ref={(node) => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}
          aria-selected={value === item.id}
          tabIndex={entry?.id === item.id ? 0 : -1}
          title={item.title}
          disabled={item.disabled}
          onKeyDown={(event) => move(event, item.id)}
          onClick={() => onChange(item.id)}
          className="il-segmented__item">
          {item.icon && <Icon n={item.icon} size={14} />}
          {item.label}
          {typeof item.count === 'number' && (
            <span className="il-segmented__count">{item.count}</span>
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
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'brand' | 'info';
}) {
  const toneCls2 = {
    default: 'text-[var(--text)]',
    success: 'text-[var(--success-fg)]',
    warning: 'text-[var(--warning-fg)]',
    danger: 'text-[var(--danger-fg)]',
    brand: 'text-[var(--brand-fg)]',
    info: 'text-[var(--info-fg)]',
  }[tone || 'default'];
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5">
        {icon && <Icon n={icon} size={13} className="text-[var(--text-faint)]" />}
        <p className="text-[11px] font-semibold tracking-wider uppercase text-[var(--text-muted)]">{label}</p>
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
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-md p-4 flex items-start gap-3">
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

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-[720px]', side, sideTitle, sideSubtitle, sideWidth = 'max-w-[520px]', onSideClose, dismissGuard, sideDismissGuard, dialogClassName, modal = true, variant = 'side', dialogWidth = '672px' }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  /**
   * `side` (padrão) = faixa lateral; `dialog` = MODAL CENTRAL.
   *
   * MISSÃO UX CLOSURE · item 3C — criação/edição de agendamento é FORMULÁRIO
   * CURTO: fluxo por etapas, largura confortável e leitura no centro da tela.
   * A faixa lateral (95% da viewport em telas largas) ficou reservada para
   * SUPERFÍCIES DE TRABALHO longas (prontuário, ficha do paciente, conversas).
   * É o MESMO componente e o MESMO overlay system — muda só a geometria, então
   * guards, foco, Escape, empilhamento com o cadastro aninhado e presets de
   * largura continuam valendo sem uma segunda implementação.
   */
  variant?: 'side' | 'dialog';
  /** Faixa do modal central (valor CSS). Ignorado no `variant="side"`. */
  dialogWidth?: string;
  /** Nonmodal workspace editors leave navigation reachable; caller must guard exits. */
  modal?: boolean;
  /** Optional root class for a single, explicitly scoped Drawer surface. */
  dialogClassName?: string;
  /** Dirty/saving contract. Omitted on read-only surfaces, which remain freely dismissible. */
  dismissGuard?: DismissGuardState;
  /** Independent guard for an expanded side-form; parent guard still covers the whole overlay. */
  sideDismissGuard?: DismissGuardState;
  children: React.ReactNode; footer?: React.ReactNode; width?: string;
  /**
   * §19–25 — OVERLAY SYSTEM: painel lateral do MESMO overlay (ex.: "Cadastrar
   * novo paciente" dentro do "Novo agendamento"). Com `side`, o dialog EXPANDE
   * lateralmente (até ~1280px), o painel base recua/fica atenuado e o
   * secundário entra pela direita. NUNCA abre outro modal/backdrop. Em
   * viewports sem largura útil para ambos, o secundário assume a faixa inteira
   * no mesmo overlay e o painel base volta ao fechar.
   */
  side?: React.ReactNode;
  sideTitle?: string;
  sideSubtitle?: string;
  /**
   * Largura do painel auxiliar quando ele ocupa a faixa SOZINHO (viewport sem
   * espaço para o par — ver `@media (max-width: 1359px)` em globals.css). No
   * par 50/50 o grid de `.il-drawer__panels` é quem define as duas colunas:
   * os dois painéis usam `WORKSPACE_NESTED_PANEL` e têm a MESMA largura.
   */
  sideWidth?: string;
  /** Fecha só o painel lateral (voltar ao base). Padrão: fecha o overlay. */
  onSideClose?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const expanded = !!side;
  const dismiss = useOverlayDismissGuard();
  const requestClose = (reason: DismissReason) => dismiss.requestClose(reason, dismissGuard, onClose);
  const requestSideClose = (reason: DismissReason) => dismiss.requestClose(reason, sideDismissGuard, onSideClose || onClose);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll(dialog);
    if (modal) dialog.showModal(); else dialog.show();
    // Start at the heading rather than scrolling to a distant form autofocus.
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      unlockBodyScroll(dialog);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, modal]);

  if (!open) return null;
  return (
    <dialog ref={dialogRef}
      className={cn("il-drawer fixed inset-0 z-50", variant === 'dialog' && 'il-drawer--dialog', dialogClassName)}
      style={variant === 'dialog' ? ({ '--il-dialog-w': dialogWidth } as React.CSSProperties) : undefined}
      aria-modal={modal || undefined}
      aria-labelledby={`${id}-title`} aria-describedby={subtitle ? `${id}-description` : undefined}
      data-expanded={expanded ? 'true' : undefined}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); requestClose('escape'); }}
      onKeyDown={(event) => {
        // Native modal inertness prevents focus in the page, but some browsers
        // Tab from the final control into browser chrome. Wrap the boundaries
        // explicitly, querying current controls (async/disabled fields included).
        if (modal) wrapDialogFocus(event, event.currentTarget, titleRef.current);
        // Do not let Escape also close an underlying legacy booking sheet.
        // An inner widget may preventDefault to consume Escape itself.
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!event.defaultPrevented) { event.preventDefault(); requestClose('escape'); }
        }
      }}>
      <div className={cn('flex h-full', variant === 'dialog' ? 'items-center justify-center' : 'justify-end')}>
        <div aria-hidden="true" onClick={() => requestClose('backdrop')} className="absolute inset-0 bg-transparent" />
        {/* §19–25 — a FAIXA do overlay: um dialog, largura que transiciona
            (entrada 180–220ms). Com `side`, dois painéis lado a lado. */}
        <div className={cn(
          'il-drawer__strip relative h-full bg-[var(--bg)] shadow-xl flex flex-col',
          // No modal central a largura vem do token do dialog (CSS); nos
          // demais casos continua sendo o preset pedido pela tela.
          variant === 'dialog'
            ? (expanded ? `w-full ${WORKSPACE_SHEET_SIZES.expanded}` : 'w-full')
            : (expanded ? `w-full ${WORKSPACE_SHEET_SIZES.expanded}` : `w-full ${width}`),
        )} data-expanded={expanded ? 'true' : undefined}>
          <div className="il-drawer__panels flex h-full min-h-0">
            {/* Painel base (agendamento): recua/atenua quando o secundário abre.
                No par, usa o MESMO preset do secundário — 50/50 exato. */}
            <div className={cn('il-drawer__panel il-drawer__panel--base flex flex-col min-h-0', expanded && 'il-drawer__panel--recessed', expanded ? WORKSPACE_NESTED_PANEL : 'w-full')}>
              <header className="ws-sheet__header shrink-0">
                <div className="ws-sheet__titles">
                  <h2 ref={titleRef} tabIndex={-1} id={`${id}-title`}>{title}</h2>
                  {subtitle && <p className="ws-sheet__sub" id={`${id}-description`}>{subtitle}</p>}
                </div>
                {!expanded && (
                  <IconButton type="button" icon="x" label="Fechar" size="sm" variant="secondary" className="ws-sheet__close" onClick={() => requestClose('close-button')} />
                )}
              </header>
              <div className="ws-sheet__body flex-1 min-h-0 overflow-y-auto ws-scroll">{children}</div>
              {footer && !expanded && <footer className="ws-sheet__footer il-actionbar shrink-0 flex flex-wrap items-center justify-end gap-2">{footer}</footer>}
            </div>
            {/* Painel secundário (cadastro rápido): entra pela direita, único overlay. */}
            {expanded && (
              <div className={cn('il-drawer__panel il-drawer__panel--side flex min-h-0 flex-col border-l border-[var(--border)]', WORKSPACE_NESTED_PANEL)}>
                <header className="ws-sheet__header shrink-0">
                  <div className="ws-sheet__titles">
                    <h2>{sideTitle || 'Cadastrar novo paciente'}</h2>
                    {sideSubtitle && <p className="ws-sheet__sub">{sideSubtitle}</p>}
                  </div>
                  <IconButton type="button" icon="x" label="Voltar" size="sm" variant="secondary" className="ws-sheet__close" onClick={() => requestSideClose('close-button')} />
                </header>
                <div className="ws-sheet__body flex-1 min-h-0 overflow-y-auto ws-scroll">{side}</div>
              </div>
            )}
          </div>
        </div>
      </div>
      {dismiss.dialog}
    </dialog>
  );
}

/** Avatar com placeholder bonito (iniciais) quando não há foto. */
export function Avatar({ name, src, size = 44, className }: { name: string; src?: string; size?: number; className?: string }) {
  const initials = avatarInitials(name || '?');
  // Avatar fallback: paleta intercalada DETERMINÍSTICA (mesma pessoa → mesma
  // cor, sempre), com iniciais AA. Contrato do refino final de UI.
  const tone = avatarColorFor(name || '?');
  return (
    <span
      className={cn('il-avatar rounded-full', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex items-center justify-center w-full h-full rounded-full font-semibold"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {initials}
        </span>
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
          <span className={cn('font-semibold tracking-wide', chip.closed ? 'text-[var(--text-faint)]' : 'text-[var(--text-muted)]')}>
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

// ═══════════════════════════════════════════════════════════════
// DS 1.0 — PRIMITIVES CANÔNICOS (segunda parte da MESMA biblioteca)
// ═══════════════════════════════════════════════════════════════
// Nada aqui cria uma segunda linguagem: superfícies, alturas, raio, foco,
// motion e tipografia vêm dos tokens `--gd-*`. O contrato está em
// docs/GODOUTOR-DESIGN-SYSTEM.md e o catálogo vivo em /dev/design-system.

/** Fecha SEMPRE assim: um único botão neutro, no canto, com rótulo acessível. */
export function CloseButton({ onClick, label = 'Fechar', className }: {
  onClick: () => void; label?: string; className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'lds-close inline-flex items-center justify-center rounded-[var(--gd-radius-sm)]',
        'w-8 h-8 text-[var(--gd-text-muted)] hover:text-[var(--gd-text)] hover:bg-[var(--gd-bg-hover)]',
        'focus-visible:outline-none focus-visible:shadow-[var(--gd-focus-ring)]',
        className,
      )}
    >
      <Icon n="x" size={16} />
    </button>
  );
}

// ── camadas flutuantes: uma única engenharia de ancoragem ───────────────
type LayerSide = 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start' | 'left-start';

/**
 * Retângulo do ANCORADOR. O gatilho real é o CONTEÚDO do wrapper, não o
 * wrapper: há casos (evento da Agenda) em que o filho é `position: absolute`
 * dentro da coluna e o wrapper fica 0×0 — medir o wrapper colocaria o card no
 * canto da coluna em vez de colado ao evento. Regra: se o wrapper tem tamanho,
 * usa o wrapper (o conteúdo pode ser composto); se não tem, mede o filho.
 */
function anchorRectOf(ref: React.RefObject<HTMLElement | null>): DOMRect | null {
  const el = ref.current;
  if (!el) return null;
  const own = el.getBoundingClientRect();
  if (own.width > 0 && own.height > 0) return own;
  const child = el.firstElementChild as HTMLElement | null;
  return child ? child.getBoundingClientRect() : own;
}

/**
 * Posiciona uma camada em PORTAL a partir do retângulo do gatilho, com
 * clamp na viewport, flip vertical (cima/baixo) e flip horizontal
 * (direita/esquerda) quando o lado pedido não tem espaço. Sem medição por
 * `offsetHeight` no render: lê o rect real a cada abertura/scroll.
 */
function useAnchoredLayer(open: boolean, anchorRef: React.RefObject<HTMLElement | null>, side: LayerSide, offset = 6, layerRef?: React.RefObject<HTMLElement | null>) {
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (!open) { setStyle(null); return; }
    const place = () => {
      const a = anchorRectOf(anchorRef);
      if (!a) return;
      const w = layerRef?.current?.offsetWidth || 0;
      const h = layerRef?.current?.offsetHeight || 0;
      const margin = 8;
      let top = a.bottom + offset;
      let left = a.left;
      if (side === 'bottom-end') left = a.right - w;
      if (side === 'top-start') top = a.top - h - offset;
      if (side === 'right-start' || side === 'left-start') {
        // Preferência declarada primeiro; se não couber (com a camada já
        // medida), abre do outro lado — nunca "por cima" do evento nem fora
        // da viewport. A distância do evento continua sendo o mesmo offset.
        top = a.top;
        const rightFits = a.right + offset + w <= window.innerWidth - margin;
        const leftFits = a.left - offset - w >= margin;
        const preferLeft = side === 'left-start';
        const openToRight = preferLeft ? !leftFits && rightFits : !rightFits && leftFits;
        left = openToRight ? a.right + offset : (preferLeft ? a.left - offset - w : (rightFits ? a.right + offset : a.left - offset - w));
      }
      if (side === 'bottom-start' || side === 'bottom-end') {
        // Sem espaço abaixo (e com espaço acima) → abre para cima.
        if (h && top + h > window.innerHeight - margin && a.top - h - offset > margin) top = a.top - h - offset;
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - Math.max(w, 0) - margin));
      top = Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight - h - margin)));
      setStyle({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef, side, offset, layerRef]);
  return style;
}

// Sequência global de camadas: uma camada aberta DEPOIS de outra é, por
// construção, um overlay descendente (calendário de um DatePicker dentro de um
// Popover, lista de um Combobox, submenu…). O outside-click usa essa ordem para
// não tratar o clique num descendente como "fora" (B1).
let LAYER_SEQ = 0;

function LayerPortal({ children, style, className, role, label, id }: {
  children: React.ReactNode; style: React.CSSProperties | null; className?: string;
  role?: string; label?: string; id?: string;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      id={id}
      role={role}
      aria-label={label}
      className={className}
      style={style || undefined}
      data-layer=""
      ref={(el) => { if (el && !el.dataset.layerOrder) el.dataset.layerOrder = String(++LAYER_SEQ); }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Verdadeiro se o alvo está dentro de uma camada aberta DEPOIS da camada própria. */
function withinLaterLayer(target: Node, ownLayer: HTMLElement | null): boolean {
  const own = ownLayer?.closest('[data-layer-order]');
  const ownOrder = own ? Number((own as HTMLElement).dataset.layerOrder || 0) : 0;
  const layers = document.querySelectorAll<HTMLElement>('[data-layer-order]');
  for (const el of Array.from(layers)) {
    if (Number(el.dataset.layerOrder) > ownOrder && el.contains(target)) return true;
  }
  return false;
}

// Pilha de Escape: com camadas aninhadas (Popover do quick create + Popover do
// DatePicker), o Escape deve fechar SÓ a camada do topo (B1).
const ESC_STACK: object[] = [];

function useDismissOnEscape(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const entry = {};
    ESC_STACK.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ESC_STACK[ESC_STACK.length - 1] === entry) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const i = ESC_STACK.indexOf(entry);
      if (i >= 0) ESC_STACK.splice(i, 1);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

/** Tooltip: informação curta. Aparece no hover E no foco; nunca é só decoração. */
export function Tooltip({ label, side = 'bottom-start', children, disabled }: {
  label: string; side?: LayerSide; children: React.ReactNode; disabled?: boolean;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const style = useAnchoredLayer(open && !disabled, anchorRef, side, 8, layerRef);
  const show = () => { if (!disabled) setOpen(true); };
  const hide = () => setOpen(false);
  return (
    <>
      <span
        ref={anchorRef}
        className="lds-tip-anchor inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open && !disabled && (
        <LayerPortal style={style} className="gd-tooltip">
          <div ref={layerRef} role="tooltip">{label}</div>
        </LayerPortal>
      )}
    </>
  );
}

/** HoverCard: painel rico em hover/foco com a janela do §15 (150–250ms).
 *
 *  Contrato (missão UX Closure, resumo contextual da Agenda):
 *   • abre ~180ms depois de o ponteiro pousar no alvo;
 *   • fica ANCORADO ao alvo (8px de distância), com flip automático quando
 *     falta espaço — nunca no canto da página nem fora da viewport;
 *   • permanece aberto com o ponteiro no alvo OU na própria camada (o atraso
 *     de fechamento de `closeDelayMs` evita o flicker do caminho entre os dois);
 *   • teclado: foco abre igual ao hover; Escape fecha;
 *   • `closeOnClick`: qualquer clique DENTRO da camada fecha antes de navegar
 *     (a ação pedida acontece, a prévia não fica pendurada na tela);
 *   • onde não existe hover real (toque), a prévia não abre por foco de toque. */
export const HOVER_CARD_OPEN_MS = 180;
export const HOVER_CARD_CLOSE_MS = 140;
export function HoverCard({ content, side = 'right-start', children, openDelayMs = HOVER_CARD_OPEN_MS, closeDelayMs = HOVER_CARD_CLOSE_MS, offset = 10, closeOnClick = true, className }: {
  content: React.ReactNode; side?: LayerSide; children: React.ReactNode;
  openDelayMs?: number; closeDelayMs?: number; offset?: number; closeOnClick?: boolean; className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const style = useAnchoredLayer(open, anchorRef, side, offset, layerRef);
  const clear = () => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const canHover = () => {
    try { return window.matchMedia('(hover: hover)').matches; } catch { return true; }
  };
  /** Ponteiro/foco entrou no alvo OU na camada: cancela o fechamento pendente. */
  const enter = () => {
    if (!canHover()) return;
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => { setOpen(true); openTimer.current = null; }, openDelayMs);
  };
  const leave = () => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current !== null) return;
    closeTimer.current = window.setTimeout(() => { setOpen(false); closeTimer.current = null; }, closeDelayMs);
  };
  useEffect(() => clear, []);
  useDismissOnEscape(open, () => setOpen(false));
  return (
    <>
      <span
        ref={anchorRef}
        className="lds-hovercard-anchor inline-flex"
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={(e) => {
          // EQUIVALÊNCIA TECLADO ↔ HOVER: sair do alvo para dentro da PRÓPRIA
          // camada (Tab até "Ver detalhes"/"Reagendar") não fecha o resumo.
          const next = e.relatedTarget as Node | null;
          if (next && layerRef.current?.contains(next)) return;
          setOpen(false);
        }}
      >
        {children}
      </span>
      {open && (
        <LayerPortal style={style} className={cn('gd-layer gd-hovercard', className)}>
          <div ref={layerRef} onMouseEnter={enter} onMouseLeave={leave}
            onFocus={enter}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (next && (layerRef.current?.contains(next) || anchorRef.current?.contains(next))) return;
              setOpen(false);
            }}
            onClick={closeOnClick ? () => setOpen(false) : undefined}>
            {content}
          </div>
        </LayerPortal>
      )}
    </>
  );
}

/** Popover: painel ancorado controlado (usado pelo quick create e filtros). */
export function Popover({ open, onClose, trigger, children, side = 'bottom-start', label, className, anchorStyle }: {
  open: boolean; onClose: () => void; trigger: React.ReactNode; children: React.ReactNode;
  side?: LayerSide; label?: string; className?: string;
  /**
   * Posiciona o ÂNCORA (não a camada). Serve para ancorar a um PONTO do
   * documento — ex.: o slot clicado na grade da Agenda — sem criar um
   * elemento fantasma no meio do fluxo.
   */
  anchorStyle?: React.CSSProperties;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredLayer(open, anchorRef, side, 6, layerRef);
  useDismissOnEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (layerRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      // B1: o calendário do DatePicker / lista de Combobox vivem em portais
      // descendentes — clicar neles NÃO é "fora" (não desmonta o pai).
      if (withinLaterLayer(t, layerRef.current)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onClose]);
  return (
    <>
      <span ref={anchorRef} style={anchorStyle} className={cn('lds-popover-anchor inline-flex', className)}>{trigger}</span>
      {open && (
        <LayerPortal style={style} className="gd-layer gd-popover" role="dialog" label={label}>
          <div ref={layerRef}>{children}</div>
        </LayerPortal>
      )}
    </>
  );
}

export type MenuItem = {
  id: string; label: string; icon?: string; onSelect?: () => void;
  danger?: boolean; disabled?: boolean; href?: string; separatorBefore?: boolean;
};

/** DropdownMenu canônico: teclado completo, roving focus e Escape. */
export function DropdownMenu({ items, trigger, label = 'Ações', side = 'bottom-end', align = 'end' }: {
  items: MenuItem[]; trigger: React.ReactNode; label?: string; side?: LayerSide; align?: 'start' | 'end';
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const restoreRef = useRef<HTMLElement | null>(null);
  const style = useAnchoredLayer(open, anchorRef, align === 'end' ? 'bottom-end' : side, 6, listRef);
  useDismissOnEscape(open, () => setOpen(false));
  const enabled = items.map((i, idx) => (i.disabled ? -1 : idx)).filter((i) => i >= 0);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !anchorRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => {
    if (open) setActive(enabled[0] ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // B3: ao abrir, guarda o gatilho; ao fechar, devolve o foco a ele.
  useEffect(() => {
    if (open) restoreRef.current = (document.activeElement as HTMLElement) || null;
    else if (restoreRef.current) { restoreRef.current.focus?.(); restoreRef.current = null; }
  }, [open]);
  // B3: roving focus — o foco REAL segue o item ativo (navegação por teclado).
  useEffect(() => { if (open) itemRefs.current[active]?.focus(); }, [open, active]);
  const move = (dir: 1 | -1) => {
    if (!enabled.length) return;
    const pos = enabled.indexOf(active);
    const next = enabled[(pos + dir + enabled.length) % enabled.length];
    setActive(next);
  };
  const run = (item: MenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect?.();
  };
  return (
    <>
      <span
        ref={anchorRef}
        className="lds-menu-anchor inline-flex"
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
        }}
      >
        <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      </span>
      {open && (
        <LayerPortal style={style} className="gd-layer gd-menu" role="menu" label={label}>
          <div
            ref={listRef}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
              else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
              else if (e.key === ' ') { e.preventDefault(); run(items[active]); }
              else if (e.key === 'Tab') setOpen(false);
            }}
          >
            {items.map((item, idx) => (
              <div key={item.id}>
                {item.separatorBefore && <div className="gd-menu__separator" role="separator" />}
                {item.href ? (
                  <Link
                    href={item.href}
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    role="menuitem"
                    className={cn('gd-menu__item', item.danger && 'gd-menu__item--danger')}
                    data-active={idx === active}
                    onMouseEnter={() => setActive(idx)}
                    tabIndex={-1}
                  >
                    {item.icon && <Icon n={item.icon} size={15} />}
                    <span className="truncate">{item.label}</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    role="menuitem"
                    disabled={item.disabled}
                    className={cn('gd-menu__item', item.danger && 'gd-menu__item--danger')}
                    data-active={idx === active}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => run(item)}
                    tabIndex={-1}
                  >
                    {item.icon && <Icon n={item.icon} size={15} />}
                    <span className="truncate">{item.label}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </LayerPortal>
      )}
    </>
  );
}

/**
 * Pilha de Dialogs ABERTOS: com um Dialog sobre outro (ex.: "Novo agendamento"
 * + "Cadastrar novo paciente"), o Escape fecha SÓ o do topo. Sem isso os dois
 * handlers de janela disparariam juntos e o overlay de baixo fecharia junto.
 */
// A hierarquia de overlays vive em lib/overlay-stack.ts (fonte única): o
// Dialog responde a Escape/Tab só quando é o do TOPO — um sheet do DS aberto
// por cima (ex.: cadastro de paciente) fecha sozinho, sem derrubar o de baixo.

/** Dialog: overlay central com foco preso, Escape e devolução de foco. */
export function Dialog({ open, onClose, title, subtitle, children, footer, dismissGuard, label, width = '560px' }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode; dismissGuard?: DismissGuardState; label?: string;
  /**
   * Faixa do diálogo em unidade de CSS (ex.: '672px'). Confirmações simples
   * ficam curtas; revisões pedem mais. Vai como `--gd-dialog-w` (token local)
   * porque o `max-width` do próprio `.gd-dialog` venceria uma classe utilitária.
   */
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // O MESMO guarda de descarte dos overlays do produto (dirty/saving): um
  // Dialog do DS não pode ser a porta de fuga de um formulário sujo.
  const guard = useOverlayDismissGuard();
  const token = useRef({});
  const requestClose = (reason: DismissReason) => guard.requestClose(reason, dismissGuard, onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    lockBodyScroll(token.current);
    const node = ref.current;
    const entry = token.current;
    pushOverlay(entry);
    const first = node?.querySelector<HTMLElement>('[data-autofocus], button, input, select, textarea, a[href]');
    (first || headingRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Só o overlay do TOPO responde ao Escape (o de baixo continua aberto).
      if (e.key === 'Escape' && isTopOverlay(entry)) { e.preventDefault(); requestClose('escape'); }
      if (e.key === 'Tab' && node && isTopOverlay(entry)) wrapDialogFocus(e, node, headingRef.current);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      popOverlay(entry);
      window.removeEventListener('keydown', onKey, true);
      unlockBodyScroll(token.current);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div
      className="gd-dialog-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose('backdrop'); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label || title}
        className="gd-dialog"
        style={width ? ({ '--gd-dialog-w': width } as React.CSSProperties) : undefined}
      >
        <div className="gd-dialog__header">
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="il-type-section truncate font-semibold text-[var(--gd-text)]">{title}</h2>
            {subtitle && <p className="il-type-help truncate text-[var(--gd-text-muted)]">{subtitle}</p>}
          </div>
          <div className="ml-auto"><CloseButton onClick={() => requestClose('close-button')} /></div>
        </div>
        <div className="gd-dialog__body">{children}</div>
        {footer && <div className="gd-dialog__footer">{footer}</div>}
      </div>
      {guard.dialog}
    </div>,
    document.body,
  );
}

/**
 * DETAIL PANEL — overlay canônico de DETALHE (missão UX Closure · item 3B).
 *
 * Existe porque o produto tinha UMA superfície lateral para dois trabalhos
 * diferentes: ver um registro e preencher um formulário. Detalhe não é
 * formulário e não é sheet gigante:
 *   • backdrop + painel FLUTUANTE que entra pela direita (28px de deslocamento,
 *     ~200ms — janela 180–220ms declarada em `--gd-motion-overlay`);
 *   • margem de viewport (`--gd-detail-gap`), cantos arredondados, largura
 *     CONTROLADA (`--gd-detail-w`, 460px; janela 420–480px) — nada de coluna
 *     arbitrária de 60% da tela;
 *   • header curto, corpo por seções, rodapé opcional de ações;
 *   • Escape fecha, foco entra no título e VOLTA para quem abriu, Tab contido.
 *
 * NÃO reutiliza a aparência do WorkspaceSheet (superfície/geometria próprias);
 * o WorkspaceSheet continua sendo o overlay de FORMULÁRIO lateral.
 */
export function DetailPanel({ open, onClose, title, subtitle, children, footer, dismissGuard, width, label, flush = false, returnFocus }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode; dismissGuard?: DismissGuardState;
  /**
   * Largura PRÓPRIA (raro). Sem valor, vale o token do DS (`--gd-detail-w`,
   * 460px) — a largura do painel nunca é a do conteúdo. Não passe
   * `var(--gd-detail-w)` aqui: era exatamente isso que injetava um `var()`
   * autorreferente (`--gd-detail-w: var(--gd-detail-w)`) e o painel caía para
   * largura de conteúdo (448–456px, variando com o texto).
   */
  width?: string; label?: string;
  /** Gatilho ALTERNATIVO quando o do clique desmonta (ex.: "Ver detalhes" do
   *  HoverCard, que sai da tela junto com o card): o foco volta para o evento. */
  returnFocus?: React.RefObject<HTMLElement | null>;
  /**
   * `flush` = corpo SEM recuo próprio: quem recua é cada SEÇÃO (borda cheia de
   * ponta a ponta, divisórias contínuas). Use só em conteúdo seccionado — é a
   * mesma família visual, não um segundo padrão (a régua interna segue 16px).
   */
  flush?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dismiss = useOverlayDismissGuard();
  const requestClose = (reason: DismissReason) => dismiss.requestClose(reason, dismissGuard, closeNow);
  const motion = () => {
    try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 170; } catch { return 170; }
  };
  function closeNow() {
    if (closing) return;
    setClosing(true);
    timer.current = setTimeout(() => { setClosing(false); onClose(); }, motion());
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll(dialog);
    dialog.showModal();
    pushOverlay(dialog);
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      clearTimeout(timer.current);
      popOverlay(dialog);
      dialog.close();
      unlockBodyScroll(dialog);
      // Foco de VOLTA: o gatilho do clique quando ele ainda existe; se ele
      // desmontou (card de hover), o evento dono do detalhe.
      const fallback = returnFocus?.current ?? null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else if (fallback?.isConnected) fallback.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={dialogRef}
      className="gd-detail"
      data-closing={closing || undefined}
      aria-labelledby={titleId}
      aria-label={label}
      onCancel={(e) => { e.preventDefault(); requestClose('escape'); }}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose('backdrop'); }}
      onKeyDown={(e) => {
        wrapDialogFocus(e, e.currentTarget, headingRef.current);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose('escape'); }
      }}
    >
      <aside className="gd-detail__panel" style={width ? ({ '--gd-detail-w': width } as React.CSSProperties) : undefined}>
        <header className="gd-detail__header">
          <div className="min-w-0 flex-1">
            <h2 ref={headingRef} tabIndex={-1} id={titleId}>{title}</h2>
            {subtitle && <p className="gd-detail__sub">{subtitle}</p>}
          </div>
          <CloseButton label={`Fechar ${title}`} onClick={() => requestClose('close-button')} />
        </header>
        <div className={cn('gd-detail__body ws-scroll', flush && 'gd-detail__body--flush')}>{children}</div>
        {footer && <div className="gd-detail__footer">{footer}</div>}
      </aside>
      {dismiss.dialog}
    </dialog>
  );
}

/** Sheet: apelido semântico do Drawer (mesma implementação, mesmo contrato). */
export function Sheet(props: Parameters<typeof Drawer>[0]) {
  return <Drawer {...props} />;
}

/** Radio: mesma anatomia do Checkbox, um por grupo. */
export function Radio({ label, hint, name, value, checked, onChange, disabled }: {
  label: React.ReactNode; hint?: string; name?: string; value?: string;
  checked: boolean; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-2.5 cursor-pointer select-none', disabled && 'opacity-60 cursor-not-allowed')}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value || '')}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--gd-accent)] focus-visible:outline-none focus-visible:shadow-[var(--gd-focus-ring)]"
      />
      <span className="min-w-0">
        <span className="il-type-body block font-medium text-[var(--gd-text)]">{label}</span>
        {hint && <span className="il-type-help block text-[var(--gd-text-muted)]">{hint}</span>}
      </span>
    </label>
  );
}

/** SearchField: o campo de busca do sistema (ícone + limpar + atalho opcional). */
export function SearchField({ value, onChange, placeholder = 'Buscar', label = 'Buscar', kbd, className, ...rest }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string;
  kbd?: string; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <span className="pointer-events-none absolute left-2.5 text-[var(--gd-text-muted)]"><Icon n="search" size={15} /></span>
      <input
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD_CLS, 'pl-8 pr-8')}
        {...rest}
      />
      {value ? (
        <span className="absolute right-1.5">
          <CloseButton label="Limpar busca" onClick={() => onChange('')} className="h-6 w-6" />
        </span>
      ) : kbd ? (
        <span className="pointer-events-none absolute right-2 rounded border border-[var(--gd-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--gd-text-muted)]">{kbd}</span>
      ) : null}
    </div>
  );
}

/** Table: grade canônica (cabeçalho, hover, números tabulares). */
export function Table({ className, children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('gd-table', className)} {...rest}>{children}</table>
    </div>
  );
}
export function TableHead({ children, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...rest}>{children}</thead>;
}
export function TableBody({ children, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...rest}>{children}</tbody>;
}
export function TableRow({ children, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...rest}>{children}</tr>;
}
export function TableCell({ numeric, children, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn(numeric && 'gd-table__num')} {...rest}>{children}</td>;
}

/** Pagination: contagem + páginas. Sem "..." enigmático: sempre 1 · atual · última. */
export function Pagination({ page, pageCount, onPage, total, perPage, label = 'Paginação' }: {
  page: number; pageCount: number; onPage: (p: number) => void;
  total?: number; perPage?: number; label?: string;
}) {
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
    const start = Math.max(1, Math.min(page - 2, pageCount - 4));
    return start + i;
  }).filter((p) => p >= 1 && p <= pageCount);
  return (
    <nav className="gd-pagination" aria-label={label}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
        <Icon n="chevronLeft" size={14} />
      </Button>
      <span className="gd-pagination__pages">
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
            className={cn(
              'h-8 min-w-8 rounded-[var(--gd-radius-sm)] px-2 text-xs font-semibold',
              p === page
                ? 'bg-[var(--gd-accent-soft)] text-[var(--gd-accent-fg)]'
                : 'text-[var(--gd-text-muted)] hover:bg-[var(--gd-bg-hover)]',
            )}
          >{p}</button>
        ))}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Próxima página">
        <Icon n="chevronRight" size={14} />
      </Button>
      {typeof total === 'number' && (
        <span className="il-type-help text-[var(--gd-text-muted)]">
          {total} {total === 1 ? 'registro' : 'registros'}{perPage ? ` · ${perPage} por página` : ''}
        </span>
      )}
    </nav>
  );
}

// ── Toast ───────────────────────────────────────────────────────────────
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
export interface ToastItem { id: string; title: string; message?: string; tone?: ToastTone; }

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((t) => [...t, { ...item, id }]);
    return id;
  }, []);
  return { toasts, push, dismiss };
}

export function ToastViewport({ toasts, onDismiss, autoDismissMs = 5000 }: {
  toasts: ToastItem[]; onDismiss: (id: string) => void; autoDismissMs?: number;
}) {
  return (
    <div className="gd-toast-viewport" role="region" aria-label="Notificações" aria-live="polite">
      {toasts.map((t) => <Toast key={t.id} item={t} onDismiss={onDismiss} autoDismissMs={autoDismissMs} />)}
    </div>
  );
}

export function Toast({ item, onDismiss, autoDismissMs = 5000 }: {
  item: ToastItem; onDismiss: (id: string) => void; autoDismissMs?: number;
}) {
  useEffect(() => {
    if (!autoDismissMs) return;
    const id = window.setTimeout(() => onDismiss(item.id), autoDismissMs);
    return () => window.clearTimeout(id);
  }, [item.id, autoDismissMs, onDismiss]);
  return (
    <div className={cn('gd-toast', `gd-toast--${item.tone || 'info'}`)} role="status">
      <div className="min-w-0">
        <p className="il-type-body font-semibold text-[var(--gd-text)]">{item.title}</p>
        {item.message && <p className="il-type-help text-[var(--gd-text-muted)]">{item.message}</p>}
      </div>
      <CloseButton onClick={() => onDismiss(item.id)} className="ml-auto shrink-0" />
    </div>
  );
}

// ── Calendário / DatePicker ─────────────────────────────────────────────
const WEEKDAYS_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Data local em ISO (nunca UTC: o dia é do usuário, não do fuso do servidor). */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fromISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
export function formatDateBR(iso: string): string {
  const d = fromISODate(iso);
  return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
}

export function Calendar({ value, onSelect, month, onMonthChange, min, max, label = 'Calendário' }: {
  value?: string; onSelect: (iso: string) => void; month?: Date; onMonthChange?: (d: Date) => void;
  min?: string; max?: string; label?: string;
}) {
  const [cursor, setCursor] = useState<Date>(() => fromISODate(value || '') || new Date());
  const view = month || cursor;
  const setView = (d: Date) => { setCursor(d); onMonthChange?.(d); };
  const year = view.getFullYear();
  const monthIdx = view.getMonth();
  const first = new Date(year, monthIdx, 1);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const todayIso = toISODate(new Date());
  const cells: Array<number | null> = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const shift = (delta: number) => setView(new Date(year, monthIdx + delta, 1));
  return (
    <div className="gd-calendar" role="group" aria-label={label}>
      <div className="gd-calendar__head">
        <IconButton icon="chevronLeft" label="Mês anterior" size="sm" variant="secondary" onClick={() => shift(-1)} />
        <span className="gd-calendar__title" aria-live="polite">{MONTHS_PT[monthIdx]} de {year}</span>
        <IconButton icon="chevronRight" label="Próximo mês" size="sm" variant="secondary" onClick={() => shift(1)} />
      </div>
      <div className="gd-calendar__grid">
        {WEEKDAYS_PT.map((d, i) => <span key={`${d}-${i}`} className="gd-calendar__dow" aria-hidden="true">{d}</span>)}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e-${i}`} className="gd-calendar__day gd-calendar__day--empty" aria-hidden="true" />;
          const iso = toISODate(new Date(year, monthIdx, day));
          const disabled = (!!min && iso < min) || (!!max && iso > max);
          return (
            <button
              key={iso}
              type="button"
              className="gd-calendar__day"
              aria-selected={value === iso}
              data-today={iso === todayIso}
              disabled={disabled}
              onClick={() => onSelect(iso)}
            >{day}</button>
          );
        })}
      </div>
    </div>
  );
}

/** DatePicker canônico: o input `date` nativo não é mais usado no produto. */
export function DatePicker({ value, onChange, label = 'Data', placeholder = 'Selecionar data', min, max, disabled, className, formatValue }: {
  value: string; onChange: (iso: string) => void; label?: string;
  placeholder?: string; min?: string; max?: string; disabled?: boolean; className?: string;
  /** Rótulo do gatilho. Padrão: data em pt-BR. A Agenda usa o rótulo do período. */
  formatValue?: (iso: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={label}
      className={className}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(FIELD_CLS, 'inline-flex items-center justify-between gap-2 text-left disabled:opacity-60')}
        >
          <span className={cn('truncate', !value && 'text-[var(--gd-text-muted)]')}>
            {value ? (formatValue ? formatValue(value) : formatDateBR(value)) : placeholder}
          </span>
          <Icon n="calendar" size={15} />
        </button>
      }
    >
      <Calendar
        value={value}
        min={min}
        max={max}
        label={label}
        onSelect={(iso) => { onChange(iso); setOpen(false); }}
      />
    </Popover>
  );
}

// ── Combobox / Autocomplete / MultiSelect (uma implementação) ────────────
export interface ComboOption { value: string; label: string; hint?: string; disabled?: boolean; }

/**
 * Combobox canônico. `mode`:
 *   • `select`      — escolhe uma opção (mesmo contrato do Select, com busca);
 *   • `autocomplete`— texto livre + sugestões;
 *   • `multiple`    — várias opções, com chips e remoção por teclado.
 */
export function Combobox({ options, value, onChange, mode = 'select', label = 'Selecionar', placeholder = 'Buscar…', emptyLabel = 'Nenhum resultado', disabled, className }: {
  options: ComboOption[];
  value: string | string[];
  onChange: (v: string | string[]) => void;
  mode?: 'select' | 'autocomplete' | 'multiple';
  label?: string; placeholder?: string; emptyLabel?: string; disabled?: boolean; className?: string;
}) {
  const listId = useId();
  const multi = mode === 'multiple';
  const selected = multi ? (Array.isArray(value) ? value : []) : [String(value || '')];
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredLayer(open, anchorRef, 'bottom-start', 6, layerRef);
  const known = options.filter((o) => selected.includes(o.value));
  const displayLabel = multi ? query : (query || known[0]?.label || String(value || ''));
  const filtered = options.filter((o) => {
    if (multi && selected.includes(o.value)) return false;
    const q = query.trim().toLowerCase();
    return !q || o.label.toLowerCase().includes(q) || (o.hint || '').toLowerCase().includes(q);
  });
  useEffect(() => { setActive(0); }, [query, open]);
  useDismissOnEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!layerRef.current?.contains(t) && !anchorRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (opt: ComboOption) => {
    if (opt.disabled) return;
    if (multi) onChange([...selected.filter((v) => v), opt.value].filter((v) => options.some((o) => o.value === v)));
    else onChange(opt.value);
    setQuery('');
    if (!multi) setOpen(false);
  };

  return (
    <div className={cn('relative', className)} ref={anchorRef}>
      {multi && known.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {known.map((o) => (
            <span key={o.value} className="inline-flex items-center gap-1 rounded-[var(--gd-radius-pill)] border border-[var(--gd-border)] bg-[var(--gd-bg-subtle)] px-2 py-0.5 text-[var(--gd-font-size-caption)] font-medium text-[var(--gd-text)]">
              {o.label}
              <button
                type="button"
                aria-label={`Remover ${o.label}`}
                className="text-[var(--gd-text-muted)] hover:text-[var(--gd-text)]"
                onClick={() => onChange(selected.filter((v) => v !== o.value))}
              ><Icon n="x" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder={placeholder}
        value={displayLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open && filtered[active]) { e.preventDefault(); pick(filtered[active]); }
          else if (e.key === 'Backspace' && multi && !query && selected.length) {
            onChange(selected.slice(0, -1));
          }
        }}
        className={cn(FIELD_CLS, 'disabled:opacity-60')}
      />
      {open && (
        <LayerPortal style={style} className="gd-layer gd-menu" role="listbox" label={label}>
          <div id={listId} ref={layerRef} className="max-h-[260px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="il-type-help px-2 py-3 text-center text-[var(--gd-text-muted)]">{emptyLabel}</p>
            ) : filtered.map((o, idx) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={idx === active}
                disabled={o.disabled}
                data-active={idx === active}
                onMouseEnter={() => setActive(idx)}
                onClick={() => pick(o)}
                className="gd-menu__item"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="il-type-help block truncate text-[var(--gd-text-muted)]">{o.hint}</span>}
                </span>
                {selected.includes(o.value) && <Icon n="check" size={14} />}
              </button>
            ))}
          </div>
        </LayerPortal>
      )}
    </div>
  );
}

// ── Ações de seção/página ───────────────────────────────────────────────
/** ActionSection: texto à esquerda, ação à direita, com respiro (§41–43). */
export function ActionSection({ title, hint, children, className }: {
  title: string; hint?: string; children?: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn('gd-action-section', className)} aria-label={title}>
      <div className="min-w-0">
        <h3 className="il-type-section font-semibold text-[var(--gd-text)]">{title}</h3>
        {hint && <p className="il-type-help mt-0.5 text-[var(--gd-text-muted)]">{hint}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </section>
  );
}

/** PageActionBar: barra de ações de rodapé (uma PRIMARY por barra). */
export function PageActionBar({ children, hint, className }: {
  children: React.ReactNode; hint?: string; className?: string;
}) {
  return (
    <div className={cn('gd-page-action-bar', className)}>
      <p className="il-type-help min-w-0 text-[var(--gd-text-muted)]">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
