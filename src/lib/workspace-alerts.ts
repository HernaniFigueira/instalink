// ═══════════════════════════════════════════════════════════════
// NOTIFICAÇÕES DO WORKSPACE — apenas dado REAL (Etapa A)
// ═══════════════════════════════════════════════════════════════
// Regra inegociável do briefing: NÃO inventar notificações. Se não existe
// fonte real para um contador, o contador não existe.
//
// Por isso este módulo não gera nada: ele apenas TRADUZ o payload que o
// servidor já produz em `GET /api/overview` (o mesmo usado pela tela Início).
// Toda contagem vem de dado persistido:
//   • `attention[]`       → pendências que o servidor já calculou e já decidiu
//                           se o usuário pode abrir a rota (`href: string|null`);
//   • `whatsapp.unread`   → soma de `conversation.unread` real;
//   • `whatsapp.pendingMessages` → mensagens com status 'pending' na fila;
//   • `pendingSetup`      → itens do checklist de configuração ainda pendentes.
//
// PURE (sem I/O, sem DOM) para ser testável e reutilizável.

/** Tom semântico → família de cor do design system (nunca hex aqui). */
export type AlertTone = 'danger' | 'warning' | 'info' | 'violet' | 'success';

export interface WorkspaceAlert {
  id: string;
  tone: AlertTone;
  icon: string;
  count: number;
  /** O que está pendente, na palavra de quem opera. */
  label: string;
  /** Destino REAL. `null` = o usuário não pode abrir a rota (vira texto). */
  href: string | null;
}

/** Item de atenção já calculado pelo servidor (lib/dashboard.ts). */
export interface ServerAttentionItem {
  id: string;
  count: number;
  label: string;
  href: string | null;
}

/** Recorte mínimo do payload de /api/overview que as notificações consomem. */
export interface AlertsSource {
  attention?: ServerAttentionItem[] | null;
  whatsapp?: { unread?: number; pendingMessages?: number; open?: number } | null;
  pendingSetup?: number | null;
  checklist?: Array<{ done: boolean; label: string; href: string }> | null;
}

/** Estado honesto da leitura: sem payload não há como afirmar "nada pendente". */
export type AlertsStatus = 'loading' | 'ready' | 'unavailable';

export interface WorkspaceAlerts {
  status: AlertsStatus;
  items: WorkspaceAlert[];
  total: number;
}

/** Tom/ícone por tipo de atenção — coerente com o significado da cor. */
const ATTENTION_PRESENTATION: Record<string, { tone: AlertTone; icon: string }> = {
  closures: { tone: 'warning', icon: 'fileText' },
  leadsNew: { tone: 'violet', icon: 'funnel' },
  tasksOverdue: { tone: 'danger', icon: 'tasks' },
  queueWaiting: { tone: 'warning', icon: 'users' },
  arrivalsPending: { tone: 'warning', icon: 'idcard' },
};

const FALLBACK_PRESENTATION: { tone: AlertTone; icon: string } = { tone: 'warning', icon: 'alert' };

/** `?b=` já vem resolvido do servidor? Não: ele devolve a rota nua. */
export function withUnit(href: string | null, unitQuery: string): string | null {
  if (!href) return null;
  if (href === '/organizacao') return href;
  return unitQuery ? `${href}${unitQuery}` : href;
}

/**
 * Traduz o payload em notificações. Ordem de leitura = urgência:
 * o que está vencido/atrasado primeiro, configuração por último.
 */
export function buildWorkspaceAlerts(
  source: AlertsSource | null | undefined,
  unitQuery = '',
): WorkspaceAlerts {
  if (!source) return { status: 'unavailable', items: [], total: 0 };

  const items: WorkspaceAlert[] = [];

  for (const entry of source.attention || []) {
    const count = Number(entry.count) || 0;
    if (count <= 0) continue;
    const presentation = ATTENTION_PRESENTATION[entry.id] || FALLBACK_PRESENTATION;
    items.push({
      id: entry.id,
      tone: presentation.tone,
      icon: presentation.icon,
      count,
      label: entry.label,
      href: withUnit(entry.href, unitQuery),
    });
  }

  const unread = Number(source.whatsapp?.unread) || 0;
  if (unread > 0) {
    items.push({
      id: 'conversationsUnread', tone: 'info', icon: 'inbox', count: unread,
      label: 'mensagens não lidas', href: withUnit('/conversas', unitQuery),
    });
  }

  const pendingMessages = Number(source.whatsapp?.pendingMessages) || 0;
  if (pendingMessages > 0) {
    items.push({
      id: 'messagesPending', tone: 'warning', icon: 'send', count: pendingMessages,
      label: 'mensagens na fila de envio', href: withUnit('/conversas', unitQuery),
    });
  }

  const pendingSetup = Number(source.pendingSetup) || 0;
  if (pendingSetup > 0) {
    items.push({
      id: 'setupPending', tone: 'success', icon: 'checkCircle', count: pendingSetup,
      label: pendingSetup === 1 ? 'item de configuração pendente' : 'itens de configuração pendentes',
      href: withUnit('/dashboard', unitQuery),
    });
  }

  const order: Record<AlertTone, number> = { danger: 0, warning: 1, info: 2, violet: 3, success: 4 };
  items.sort((a, b) => order[a.tone] - order[b.tone] || b.count - a.count);

  return { status: 'ready', items, total: items.reduce((sum, i) => sum + i.count, 0) };
}

/** Rótulo acessível do sino: diz a verdade (número ou ausência de pendência). */
export function bellLabel(alerts: WorkspaceAlerts): string {
  if (alerts.status === 'loading') return 'Notificações: carregando';
  if (alerts.status === 'unavailable') return 'Notificações: indisponíveis';
  if (alerts.total === 0) return 'Notificações: nenhuma pendência';
  return `Notificações: ${alerts.total} ${alerts.total === 1 ? 'pendência' : 'pendências'}`;
}
