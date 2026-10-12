// Preferência de visualização da Agenda (Dia/Semana/Mês/Lista) — por USUÁRIO, no navegador.
// Mesmo padrão de `lastBusinessStorageKey`: a chave é por conta; nunca concede acesso.
// A escolha vale só para a tela; não altera banco, papel nem permissão.

export const AGENDA_VIEWS = ['day', 'week', 'month', 'list'] as const;
export type AgendaView = (typeof AGENDA_VIEWS)[number];

const PREFIX = 'godoutor:agenda-view:';

export function agendaViewStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/** Lê a escolha salva desta conta. Valor inválido ou ausente → '' (sem preferência). */
export function readAgendaViewPreference(userId?: string | null): AgendaView | '' {
  if (typeof window === 'undefined') return '';
  const uid = String(userId || '').trim();
  if (!uid) return '';
  try {
    const raw = String(window.localStorage.getItem(agendaViewStorageKey(uid)) || '').trim();
    return (AGENDA_VIEWS as readonly string[]).includes(raw) ? (raw as AgendaView) : '';
  } catch {
    return '';
  }
}

/** Persiste a escolha EXPLÍCITA do usuário (não o padrão automático). */
export function writeAgendaViewPreference(userId: string | null | undefined, view: AgendaView): void {
  if (typeof window === 'undefined') return;
  const uid = String(userId || '').trim();
  if (!uid || !(AGENDA_VIEWS as readonly string[]).includes(view)) return;
  try {
    window.localStorage.setItem(agendaViewStorageKey(uid), view);
  } catch {
    // Armazenamento indisponível (modo privado/cheio): a tela segue sem lembrar a escolha.
  }
}

/**
 * Padrão quando NÃO há escolha salva:
 * - celular → Lista (como antes);
 * - Professional com agenda própria (vínculo na unidade) → Semana;
 * - demais papéis (Owner, Recepção) → Dia (sem mudança).
 */
export function defaultAgendaView(input: { isMobile: boolean; professionalScoped: boolean }): AgendaView {
  if (input.isMobile) return 'list';
  return input.professionalScoped ? 'week' : 'day';
}
