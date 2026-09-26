'use client';
// ═══════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// Estrutura completa (sino + badge numérico + painel), mas SEM notificação
// falsa: tudo vem de `GET /api/overview`, o MESMO payload da tela Início.
//
// Regras do briefing respeitadas:
//   • sem fonte real para um contador ⇒ o contador não aparece;
//   • payload indisponível (403/erro) ⇒ sino SEM badge e painel honesto
//     ("não foi possível carregar"), nunca "tudo em dia" de mentira;
//   • destino só é link quando o servidor disse que o usuário pode abrir
//     (`attention[].href` já vem `null` sem permissão).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { mayLeaveEditor } from './useUnsavedChanges';
import { buildWorkspaceAlerts, bellLabel, type AlertsSource, type WorkspaceAlerts } from '@/lib/workspace-alerts';
import { loadOverview } from '@/lib/overview';

const REFRESH_MS = 120_000;

/** Lê o resumo operacional real da unidade. Nenhuma contagem é fabricada. */
export function useWorkspaceAlerts(businessId: string, unitQuery: string): WorkspaceAlerts {
  const [source, setSource] = useState<AlertsSource | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  const load = useCallback(() => {
    if (!businessId) { setStatus('unavailable'); setSource(null); return; }
    let cancelled = false;
    // Mesmo payload do shell/tela — o loader compartilhado divide a chamada em
    // vez de baixar o overview uma TERCEIRA vez por navegação.
    loadOverview(businessId, 7, { scope: 'area', area: 'Visão geral' })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) { setSource(null); setStatus('unavailable'); return; }
        const d = res.data || {};
        setSource({
          attention: d.attention || [],
          whatsapp: (d.whatsapp as AlertsSource['whatsapp']) || null,
          pendingSetup: typeof d.pendingSetup === 'number' ? d.pendingSetup : 0,
          checklist: d.checklist || [],
        });
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) { setSource(null); setStatus('unavailable'); } });
    return () => { cancelled = true; };
  }, [businessId]);

  useEffect(() => {
    setStatus('loading');
    const cancel = load();
    const timer = setInterval(load, REFRESH_MS);
    // Módulos/permissões/agenda mudam sem recarregar a página: o painel avisa.
    // §P1.4 — escrita concluída em qualquer tela também revalida na hora.
    window.addEventListener('il:business-refresh', load);
    window.addEventListener('il:overview-refresh', load);
    // Revalida ao voltar para a aba (dado velho de madrugada não ajuda ninguém).
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancel?.();
      clearInterval(timer);
      window.removeEventListener('il:business-refresh', load);
      window.removeEventListener('il:overview-refresh', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { ...buildWorkspaceAlerts(source, unitQuery), status };
}

export function NotificationsBell({ alerts }: { alerts: WorkspaceAlerts }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function go(href: string | null) {
    if (!href || !mayLeaveEditor()) return;
    setOpen(false);
    router.push(href);
  }

  // P1.14 — badge vermelho SÓ para atenção real (Falhas). Pendências e
  // informações vivem no painel, sem grito no sino.
  const hasBadge = alerts.status === 'ready' && alerts.badgeCount > 0;

  return (
    <div ref={boxRef} className="ws-bell">
      <button
        ref={buttonRef}
        type="button"
        className="ws-topbar__icon-button"
        aria-label={bellLabel(alerts)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={bellLabel(alerts)}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon n="bell" size={18} />
        {/* Badge só com contador REAL de FALHAS. Sem fonte ⇒ sem badge. */}
        {hasBadge && (
          <span className="ws-bell__badge" data-count={alerts.badgeCount > 99 ? '99+' : alerts.badgeCount}>
            {alerts.badgeCount > 99 ? '99+' : alerts.badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="ws-popover ws-bell__panel" role="dialog" aria-label="Notificações">
          <header className="ws-popover__header">
            <h2>Pendências</h2>
            {alerts.status === 'ready' && alerts.total > 0 && (
              <span className="ws-bell__count">{alerts.total}</span>
            )}
          </header>

          {alerts.status === 'loading' && (
            <div className="ws-bell__loading" role="status">
              <span className="ws-skeleton-line" /><span className="ws-skeleton-line ws-skeleton-line--short" />
              <span className="sr-only">Carregando notificações…</span>
            </div>
          )}

          {alerts.status === 'unavailable' && (
            <p className="ws-popover__empty">
              Não foi possível carregar as pendências agora. Nada foi perdido — tente novamente em instantes.
            </p>
          )}

          {alerts.status === 'ready' && alerts.items.length === 0 && (
            <p className="ws-popover__empty">
              <Icon n="checkCircle" size={20} />
              Nenhuma pendência no momento.
            </p>
          )}

          {alerts.status === 'ready' && alerts.items.length > 0 && (
            // P1.14 — grupos canônicos: FALHAS · PENDÊNCIAS · INFORMAÇÕES.
            // Cada item leva ao DESTINO contextual (href do servidor).
            <div className="ws-bell__list">
              {alerts.groups.map((group) => (
                <section key={group.id} aria-label={group.label}>
                  <p className={`ws-bell__group-label${group.id === 'failure' ? ' ws-bell__group-label--failure' : ''}`}>
                    {group.label}
                  </p>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.id}>
                        {item.href ? (
                          <button type="button" className="ws-bell__item" onClick={() => go(item.href)}>
                            <span className={`ws-bell__dot ws-bell__dot--${item.tone}`}><Icon n={item.icon} size={14} /></span>
                            <span className="ws-bell__text">{item.label}</span>
                            <span className="ws-bell__count">{item.count}</span>
                            <Icon n="chevronRight" size={14} className="ws-bell__chevron" />
                          </button>
                        ) : (
                          // Sem permissão para a rota: a informação é preservada como
                          // texto (nunca um link que termina em 403).
                          <span className="ws-bell__item ws-bell__item--static">
                            <span className={`ws-bell__dot ws-bell__dot--${item.tone}`}><Icon n={item.icon} size={14} /></span>
                            <span className="ws-bell__text">{item.label}</span>
                            <span className="ws-bell__count">{item.count}</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
