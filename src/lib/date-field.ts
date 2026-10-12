// Data no formato brasileiro DD/MM/AAAA ↔ formato interno ISO (AAAA-MM-DD).
// Puro e sem `new Date(string)`: nenhuma conversão de fuso acontece aqui.
// O valor persistido continua sendo a string ISO que o servidor já recebe.

export type BrDateResult =
  | { ok: true; iso: string }
  | { ok: false; error: 'incompleta' | 'invalida' | 'antiga' | 'depois_do_limite' | 'antes_do_limite' };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1900;

/** Máscara de digitação: mantém só dígitos e insere as barras. */
export function maskBrDate(input: string): string {
  const d = String(input ?? '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** ISO → DD/MM/AAAA. Valor vazio ou fora do formato ISO devolve ''. */
export function isoToBr(iso: string): string {
  const m = ISO_RE.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Data de hoje no fuso LOCAL do navegador, em ISO (sem UTC). */
export function todayIsoLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte = último dia deste mês (aritmética de calendário, sem fuso).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Interpreta o texto digitado. Vazio é válido (sem data). Parcial ou inexistente
 * (ex.: 31/02) é inválido. `max`/`min` são ISO e comparados como texto.
 */
export function parseBrDate(text: string, opts: { max?: string; min?: string } = {}): BrDateResult {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length === 0) return { ok: true, iso: '' };
  if (digits.length < 8) return { ok: false, error: 'incompleta' };
  const dd = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const yyyy = Number(digits.slice(4, 8));
  if (yyyy < MIN_YEAR || mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth(yyyy, mm)) {
    return { ok: false, error: yyyy < MIN_YEAR ? 'antiga' : 'invalida' };
  }
  const iso = `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  if (opts.max && iso > opts.max) return { ok: false, error: 'depois_do_limite' };
  if (opts.min && iso < opts.min) return { ok: false, error: 'antes_do_limite' };
  return { ok: true, iso };
}

/** Mensagem curta, em português, para o erro junto do campo. */
export function dateErrorMessage(error: Extract<BrDateResult, { ok: false }>['error']): string {
  switch (error) {
    case 'incompleta': return 'Use o formato DD/MM/AAAA.';
    case 'invalida': return 'Data inexistente. Confira dia e mês.';
    case 'antiga': return 'Ano anterior a 1900.';
    case 'depois_do_limite': return 'Data no futuro ou acima do limite permitido.';
    case 'antes_do_limite': return 'Data anterior ao limite permitido.';
  }
}
