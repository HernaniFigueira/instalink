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

/**
 * P1.14 — GRUPO da notificação. O sino separa o que EXIGE ATENÇÃO agora
 * (Falhas) do que é fila de trabalho (Pendências) e do que é informação
 * (Informações). O badge vermelho conta SÓ Falhas.
 */
export type AlertSeverity = 'failure' | 'pending' | 'info';

export interface WorkspaceAlert {
  id: string;
  tone: AlertTone;
  severity: AlertSeverity;
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

/** Grupo de notificações com rótulo canônico (ordem de leitura). */
export interface AlertGroup {
  id: AlertSeverity;
  label: string;
  items: WorkspaceAlert[];
}

export interface WorkspaceAlerts {
  status: AlertsStatus;
  items: WorkspaceAlert[];
  /** Tudo somado (painel). */
  total: number;
  /**
   * P1.14 — o que o BADGE VERMELHO conta: apenas Falhas (atenção real).
   * Pendências e informações aparecem no painel, sem gritar no sino.
   */
  badgeCount: number;
  /** Grupos canônicos, na ordem Falhas → Pendências → Informações. */
  groups: AlertGroup[];
}

export const ALERT_GROUP_LABELS: Record<AlertSeverity, string> = {
  failure: 'Falhas',
  pending: 'Pendências',
  info: 'Informações',
};

/** Tom → grupo (a fonte é o tom semântico, já decidido pelo servidor). */
function severityOf(tone: AlertTone): AlertSeverity {
  if (tone === 'danger') return 'failure';
  if (tone === 'info') return 'info';
  return 'pending';
}

/** Tom/ícone por tipo de atenção — coerente com o significado da cor. */
const ATTENTION_PRESENTATION: Record<string, { tone: AlertTone; icon: string }> = {
  closures: { tone: 'warning', icon: 'fileText' },
  leadsNew: { tone: 'violet', icon: 'funnel' },
  tasksOverdue: { tone: 'danger', icon: 'tasks' },
  queueWaiting: { tone: 'warning', icon: 'users' },
  arrivalsPending: { tone: 'warning', icon: 'idcard' },
  // FASE 2 · P10 — retorno vencido (dado real do atendimento).
  returnsDue: { tone: 'violet', icon: 'history' },
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
  if (!source) return { status: 'unavailable', items: [], total: 0, badgeCount: 0, groups: [] };

  const items: WorkspaceAlert[] = [];

  for (const entry of source.attention || []) {
    const count = Number(entry.count) || 0;
    if (count <= 0) continue;
    const presentation = ATTENTION_PRESENTATION[entry.id] || FALLBACK_PRESENTATION;
    items.push({
      id: entry.id,
      tone: presentation.tone,
      severity: severityOf(presentation.tone),
      icon: presentation.icon,
      count,
      label: entry.label,
      href: withUnit(entry.href, unitQuery),
    });
  }

  const unread = Number(source.whatsapp?.unread) || 0;
  if (unread > 0) {
    items.push({
      id: 'conversationsUnread', tone: 'info', severity: 'info', icon: 'inbox', count: unread,
      label: 'mensagens não lidas', href: withUnit('/conversas', unitQuery),
    });
  }

  const pendingMessages = Number(source.whatsapp?.pendingMessages) || 0;
  if (pendingMessages > 0) {
    items.push({
      id: 'messagesPending', tone: 'warning', severity: 'pending', icon: 'send', count: pendingMessages,
      label: 'mensagens na fila de envio', href: withUnit('/conversas', unitQuery),
    });
  }

  const pendingSetup = Number(source.pendingSetup) || 0;
  if (pendingSetup > 0) {
    items.push({
      id: 'setupPending', tone: 'success', severity: 'pending', icon: 'checkCircle', count: pendingSetup,
      label: pendingSetup === 1 ? 'item de configuração pendente' : 'itens de configuração pendentes',
      href: withUnit('/dashboard', unitQuery),
    });
  }

  const order: Record<AlertTone, number> = { danger: 0, warning: 1, info: 2, violet: 3, success: 4 };
  items.sort((a, b) => order[a.tone] - order[b.tone] || b.count - a.count);

  const badgeCount = items
    .filter((i) => severityOf(i.tone) === 'failure')
    .reduce((sum, i) => sum + i.count, 0);
  const groups: AlertGroup[] = (['failure', 'pending', 'info'] as AlertSeverity[])
    .map((id) => ({ id, label: ALERT_GROUP_LABELS[id], items: items.filter((i) => severityOf(i.tone) === id) }))
    .filter((g) => g.items.length > 0);

  return { status: 'ready', items, total: items.reduce((sum, i) => sum + i.count, 0), badgeCount, groups };
}

/** Rótulo acessível do sino: diz a verdade (número ou ausência de pendência). */
export function bellLabel(alerts: WorkspaceAlerts): string {
  if (alerts.status === 'loading') return 'Notificações: carregando';
  if (alerts.status === 'unavailable') return 'Notificações: indisponíveis';
  if (alerts.total === 0) return 'Notificações: nenhuma pendência';
  // P1.14 — o badge vermelho é só das FALHAS; o rótulo explica a diferença.
  if (alerts.badgeCount > 0) {
    return `Notificações: ${alerts.badgeCount} ${alerts.badgeCount === 1 ? 'exige atenção' : 'exigem atenção'} · ${alerts.total} no total`;
  }
  return `Notificações: ${alerts.total} ${alerts.total === 1 ? 'pendência' : 'pendências'}`;
}
