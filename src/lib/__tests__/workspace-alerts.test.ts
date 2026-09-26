// ═══════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — só dado real (Etapa A)
// ═══════════════════════════════════════════════════════════════
// O briefing proíbe notificação inventada. Estes testes travam a regra:
// sem payload não se afirma "nada pendente"; contador zero não vira item;
// destino sem permissão (href null do servidor) não vira link.
import { describe, it, expect } from 'vitest';
import { buildWorkspaceAlerts, bellLabel, withUnit } from '../workspace-alerts';

describe('workspace alerts nunca inventam pendência', () => {
  it('sem payload fica indisponível (e não "tudo em dia")', () => {
    const none = buildWorkspaceAlerts(null);
    expect(none.status).toBe('unavailable');
    expect(none.items).toEqual([]);
    expect(bellLabel(none)).toBe('Notificações: indisponíveis');
  });

  it('payload vazio = pronto, sem itens e sem badge', () => {
    const ready = buildWorkspaceAlerts({ attention: [], whatsapp: null, pendingSetup: 0 });
    expect(ready.status).toBe('ready');
    expect(ready.total).toBe(0);
    expect(bellLabel(ready)).toBe('Notificações: nenhuma pendência');
  });

  it('contador zero nunca vira notificação', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [
        { id: 'closures', count: 0, label: 'atendimentos para fechar', href: '/agenda' },
        { id: 'leadsNew', count: 3, label: 'leads sem tratamento', href: '/funil' },
      ],
      whatsapp: { unread: 0, pendingMessages: 0 },
      pendingSetup: 0,
    });
    expect(alerts.items.map((i) => i.id)).toEqual(['leadsNew']);
    expect(alerts.total).toBe(3);
  });

  it('usa as contagens reais do servidor (atenção + unread + fila + setup)', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [
        { id: 'closures', count: 2, label: 'atendimentos para fechar', href: '/agenda' },
        { id: 'tasksOverdue', count: 1, label: 'tarefas vencidas', href: null },
      ],
      whatsapp: { unread: 4, pendingMessages: 1 },
      pendingSetup: 2,
    }, '?b=one');
    expect(alerts.total).toBe(2 + 1 + 4 + 1 + 2);
    const ids = alerts.items.map((i) => i.id);
    for (const id of ['closures', 'tasksOverdue', 'conversationsUnread', 'messagesPending', 'setupPending']) {
      expect(ids).toContain(id);
    }
    // Urgência primeiro: perigo → atenção → comunicação.
    expect(alerts.items[0].tone).toBe('danger');
  });

  it('preserva href null do servidor como texto (nunca link para 403)', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [{ id: 'leadsNew', count: 5, label: 'leads sem tratamento', href: null }],
    }, '?b=one');
    expect(alerts.items[0].href).toBeNull();
  });

  it('resolve o ?b= das rotas e não o anexa à visão de organização', () => {
    expect(withUnit('/agenda', '?b=one')).toBe('/agenda?b=one');
    expect(withUnit('/organizacao', '?b=one')).toBe('/organizacao');
    expect(withUnit(null, '?b=one')).toBeNull();
  });

  it('pluraliza o rótulo do sino de forma honesta', () => {
    expect(bellLabel({ status: 'loading', items: [], total: 0, badgeCount: 0, groups: [] })).toBe('Notificações: carregando');
    expect(bellLabel(buildWorkspaceAlerts({ pendingSetup: 1 }))).toBe('Notificações: 1 pendência');
    expect(bellLabel(buildWorkspaceAlerts({ pendingSetup: 2 }))).toBe('Notificações: 2 pendências');
  });
});

// ═══════════════════════════════════════════════════════════════
// P1.14 — grupos FALHAS · PENDÊNCIAS · INFORMAÇÕES e badge honesto
// ═══════════════════════════════════════════════════════════════
describe('P1.14 — sino separado por grupo, badge vermelho só para atenção real', () => {
  it('badge conta SÓ as Falhas (perigo real), não o total', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [
        { id: 'tasksOverdue', count: 2, label: 'pendências vencidas', href: '/tarefas' },
        { id: 'queueWaiting', count: 5, label: 'na fila', href: '/agenda' },
      ],
      whatsapp: { unread: 7 },
    });
    expect(alerts.badgeCount).toBe(2);
    expect(alerts.total).toBe(14);
  });

  it('grupos canônicos na ordem Falhas → Pendências → Informações (vazios não aparecem)', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [
        { id: 'tasksOverdue', count: 1, label: 'pendência vencida', href: '/tarefas' },
        { id: 'closures', count: 3, label: 'fechamentos', href: '/agenda' },
      ],
      whatsapp: { unread: 4, pendingMessages: 2 },
      pendingSetup: 1,
    });
    expect(alerts.groups.map((g) => g.label)).toEqual(['Falhas', 'Pendências', 'Informações']);
    const failures = alerts.groups.find((g) => g.id === 'failure')!;
    expect(failures.items.map((i) => i.id)).toEqual(['tasksOverdue']);
    const pending = alerts.groups.find((g) => g.id === 'pending')!;
    expect(pending.items.map((i) => i.id).sort()).toEqual(['closures', 'messagesPending', 'setupPending']);
    const info = alerts.groups.find((g) => g.id === 'info')!;
    expect(info.items.map((i) => i.id)).toEqual(['conversationsUnread']);
  });

  it('sem Falhas não há badge vermelho — mesmo com pendências e não lidas', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [{ id: 'closures', count: 9, label: 'fechamentos', href: '/agenda' }],
      whatsapp: { unread: 30 },
    });
    expect(alerts.badgeCount).toBe(0);
    expect(alerts.total).toBeGreaterThan(0);
    expect(alerts.groups.map((g) => g.id)).toEqual(['pending', 'info']);
  });

  it('rótulo do sino explica a diferença (atenção ≠ volume)', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [{ id: 'tasksOverdue', count: 2, label: 'vencidas', href: '/tarefas' }],
      whatsapp: { unread: 3 },
    });
    expect(bellLabel(alerts)).toBe('Notificações: 2 exigem atenção · 5 no total');
  });
});
