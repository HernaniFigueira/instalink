'use client';
// ═══════════════════════════════════════════════════════════════
// A3.4 fix (revisão B5/B6) — CAMPO DE WHATSAPP COM +55 VISUAL
// ═══════════════════════════════════════════════════════════════
// O requisito é visual: `[ +55 ] [ (21) 99999-9999 ]`. O prefixo é FIXO — não
// é digitável, não é apagável e não duplica quando a pessoa cola `+55 (21)…`
// (a máscara de `lib/field-quality.ts` tira o código do país e devolve o
// mesmo `(21) 99999-9999`).
//
// O `onChange` entrega SEMPRE os dígitos, do mesmo jeito que o resto do
// sistema já grava (o formato de persistência não muda por causa do enfeite
// da tela), e `value` aceita tanto dígitos quanto texto já mascarado.
import { Input } from '@/components/ui';
import { maskPhoneBR } from '@/lib/field-quality';

export function PhoneBRInput({
  value, onChange, id, name, placeholder = '(11) 91234-5678', disabled, autoFocus, className,
  onBlur, 'aria-label': ariaLabel,
}: {
  /** Dígitos (o que o sistema grava) ou algo já mascarado. */
  value: string;
  /** Recebe os DÍGITOS — a máscara é só apresentação. */
  onChange: (digits: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  onBlur?: () => void;
  'aria-label'?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-stretch">
        {/* Prefixo fixo: aria-hidden porque o número já vem com DDD. */}
        <span aria-hidden="true"
          className="inline-flex items-center px-2.5 rounded-l-md border border-r-0 border-[var(--border-strong)] bg-[var(--surface-3)] text-sm font-semibold text-[var(--text-muted)] select-none">
          +55
        </span>
        <Input
          id={id} name={name} type="tel" inputMode="tel" autoFocus={autoFocus} disabled={disabled}
          value={maskPhoneBR(value)} placeholder={placeholder} onBlur={onBlur}
          aria-label={ariaLabel}
          className="rounded-l-none"
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 13))}
        />
      </div>
    </div>
  );
}
