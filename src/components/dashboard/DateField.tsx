'use client';
// Campo de data canônico do cadastro (tutor e pet): digitação DD/MM/AAAA com máscara,
// validação real (ano, mês, dia e limites) e calendário nativo pelo botão.
// Valor externo sempre em ISO (AAAA-MM-DD), que é o formato persistido.
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { dateErrorMessage, isoToBr, maskBrDate, parseBrDate } from '@/lib/date-field';

const input = 'w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900';
const labelCls = 'block text-xs font-semibold tracking-[0.06em] uppercase text-[var(--text-muted)]';
const fieldErrorCls = 'mt-1 block text-xs font-medium text-[var(--danger)]';

export interface DateFieldProps {
  label: string;
  /** ISO AAAA-MM-DD ou '' (sem data). */
  value: string;
  /** Recebe o ISO (ou '' quando vazio/inválido) e a mensagem de erro ('' quando válido). */
  onChange: (iso: string, error: string) => void;
  max?: string;
  min?: string;
  disabled?: boolean;
  /** Mostra o erro mesmo sem o campo ter sido tocado (ex.: tentativa de salvar). */
  forceError?: boolean;
  name?: string;
  id?: string;
}

export function DateField({ label, value, onChange, max, min, disabled, forceError, name, id: idProp }: DateFieldProps) {
  const autoId = useId();
  const id = idProp || `date-${autoId}`;
  const [text, setText] = useState(() => isoToBr(value));
  const [touched, setTouched] = useState(false);
  const lastEmitted = useRef(value);
  const nativeRef = useRef<HTMLInputElement>(null);

  // Sincroniza quando o pai muda o valor (ex.: rascunho restaurado). Não sobrescreve
  // o que o usuário está digitando, porque o valor emitido já é o mesmo.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setText(isoToBr(value));
  }, [value]);

  const parsed = parseBrDate(text, { max, min });
  const error = parsed.ok ? '' : dateErrorMessage(parsed.error);
  const showError = !!error && (forceError || touched || text.replace(/\D/g, '').length === 8);

  function emit(iso: string, err: string) {
    lastEmitted.current = iso;
    onChange(iso, err);
  }

  function handleText(raw: string) {
    const masked = maskBrDate(raw);
    setText(masked);
    const r = parseBrDate(masked, { max, min });
    emit(r.ok ? r.iso : '', r.ok ? '' : dateErrorMessage(r.error));
  }

  function openCalendar() {
    const el = nativeRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.click();
  }

  return (
    <div className="block">
      <label htmlFor={id} className={labelCls}>{label}</label>
      <div className="mt-1 flex items-stretch gap-2">
        <input
          id={id}
          name={name}
          value={text}
          onChange={(e) => handleText(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/AAAA"
          maxLength={10}
          className={input + ' min-w-0 flex-1'}
          aria-invalid={showError ? true : undefined}
          aria-describedby={showError ? `${id}-error` : undefined}
        />
        <button
          type="button"
          onClick={openCalendar}
          disabled={disabled}
          aria-label={`Abrir calendário: ${label}`}
          className="inline-flex w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-[var(--text-muted)] hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 disabled:opacity-50"
        >
          <Icon n="calendar" size={16} />
        </button>
        {/* Calendário nativo (escondido): mantém o ISO e a validação do navegador. */}
        <input
          ref={nativeRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={parsed.ok ? parsed.iso : ''}
          min={min}
          max={max}
          onChange={(e) => {
            const iso = e.target.value;
            const r = parseBrDate(isoToBr(iso), { max, min });
            setText(isoToBr(iso));
            setTouched(true);
            emit(r.ok ? r.iso : '', r.ok ? '' : dateErrorMessage(r.error));
          }}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      </div>
      {showError && <span id={`${id}-error`} role="alert" className={fieldErrorCls}>{error}</span>}
    </div>
  );
}
