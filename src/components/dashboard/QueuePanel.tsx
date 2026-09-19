'use client';
// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — FILA DE HOJE (balcão)
// ═══════════════════════════════════════════════════════════════
// O que o balcão precisa ver de relance: quem chegou, em que ordem, há quanto
// tempo espera, quem já foi chamado e quem está em atendimento. Cada linha tem
// UMA ação principal (a próxima da máquina de estados da fila) e as ações
// secundárias ficam no menu de contexto da própria linha — sem botão que não
// faz nada e sem enfeite.
//
// A fila NÃO cria agendamento: quando a pessoa chega sem horário, ela entra
// aqui. Quem quiser marcar um horário usa a agenda (é outro caminho).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { Badge, Button, EmptyState, Field, IconButton, Input, Notice, SubCard } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import { QUEUE_LONG_WAIT_MIN, QUEUE_STATUS, queuePosition, queueTransitionAllowed, waitLabel, waitMinutes } from '@/lib/queue';
import { cn } from '@/lib/utils';
import type { QueueEntry, QueueStatus } from '@/lib/types';

/**
 * Linha da fila como o servidor devolve: a entidade + os nomes resolvidos.
 * O tipo é a PRÓPRIA entidade (não uma cópia) para que as regras puras de
 * `lib/queue.ts` continuem valendo na tela — nada de dois formatos.
 */
export type QueueRow = QueueEntry & {
  serviceName: string;
  professionalName: string;
  statusLabel: string;
};

const NEXT_ACTION: Record<string, { to: QueueStatus; label: string; variant: 'primary' | 'success' | 'secondary' }> = {
  waiting: { to: 'called', label: 'Chamar', variant: 'primary' },
  called: { to: 'in_service', label: 'Iniciar atendimento', variant: 'success' },
  in_service: { to: 'done', label: 'Concluir', variant: 'success' },
};

export function QueuePanel({ businessId, date, rows, loading, canWrite, canEncounter, onChanged, professionals, services, onOpenBooking, onEncounter, onOpenClient, onFitIn }: {
  businessId: string;
  /** Dia do negócio em exibição (a fila mostrada é sempre a de HOJE + a viva). */
  date: string;
  rows: QueueRow[];
  loading: boolean;
  canWrite: boolean;
  /**
   * A3.4 fix (revisão B5) — permissão PRÓPRIA do registro de atendimento.
   * Sem ela o balcão continua operando a fila (chamar, iniciar, concluir),
   * mas não abre o conteúdo profissional do atendimento.
   */
  canEncounter: boolean;
  onChanged: () => void;
  professionals: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  /** Abre o agendamento de origem (quando a entrada veio de um horário marcado). */
  onOpenBooking?: (bookingId: string) => void;
  /** "Iniciar atendimento" com permissão: a fila avança E o registro abre. */
  onEncounter?: (row: QueueRow) => void;
  /** Abrir a ficha do cliente (a que existe no CRM desta unidade). */
  onOpenClient?: (row: QueueRow) => void;
  /** "Encaixar na agenda": abre o agendamento PRÉ-PREENCHIDO (não cria nada). */
  onFitIn?: (row: QueueRow) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState({ name: '', phone: '', serviceId: '', professionalId: '', note: '' });

  // O tempo de espera muda sozinho: 30s é o suficiente para o balcão e não
  // transforma a tela num relógio.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const now = useMemo(() => new Date(), [tick]);
  const waiting = rows.filter((r) => r.status === 'waiting').length;
  const longest = rows
    .filter((r) => r.status === 'waiting' || r.status === 'called')
    .reduce((max, r) => Math.max(max, waitMinutes(r, now)), 0);

  const move = useCallback(async (row: QueueRow, to: QueueStatus) => {
    setBusy(row.id); setError('');
    const res = await apiSend('/api/queue', 'PATCH', { businessId, id: row.id, status: to }, { scope: 'action', area: 'Fila' });
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível atualizar a fila.'); return; }
    onChanged();
    // Handoff: sair da fila para "em atendimento" é o momento em que o registro
    // deve abrir — sem isso a pessoa teria que reencontrar o cliente pela agenda.
    if (to === 'in_service' && canEncounter && onEncounter) onEncounter(row);
  }, [businessId, canEncounter, onChanged, onEncounter]);

  const remove = useCallback(async (row: QueueRow) => {
    setBusy(row.id); setError('');
    const res = await apiSend('/api/queue', 'DELETE', { businessId, id: row.id }, { scope: 'action', area: 'Fila' });
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível remover da fila.'); return; }
    onChanged();
  }, [businessId, onChanged]);

  async function add() {
    setBusy('new'); setError('');
    const res = await apiSend('/api/queue', 'POST', {
      businessId,
      customerName: form.name,
      customerPhone: form.phone,
      serviceId: form.serviceId,
      professionalId: form.professionalId,
      note: form.note,
    }, { scope: 'action', area: 'Fila' });
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível adicionar à fila.'); return; }
    setForm({ name: '', phone: '', serviceId: '', professionalId: '', note: '' });
    setAdding(false);
    onChanged();
  }

  return (
    <SubCard className="p-0 overflow-hidden" data-queue-panel="true">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <Icon n="clock" size={15} className="text-[var(--text-muted)]" />
        <span className="text-sm font-semibold text-[var(--text)]">Fila de hoje</span>
        {waiting > 0 && <Badge tone="amber">{waiting} aguardando</Badge>}
        {rows.some((r) => r.status === 'in_service') && (
          <Badge tone="green">{rows.filter((r) => r.status === 'in_service').length} em atendimento</Badge>
        )}
        {longest >= QUEUE_LONG_WAIT_MIN && <Badge tone="red">maior espera: {waitLabel(longest)}</Badge>}
        {canWrite && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => { setAdding((v) => !v); setError(''); }}>
            <Icon n="plus" size={14} /> {adding ? 'Fechar' : 'Adicionar à fila'}
          </Button>
        )}
      </div>

      {error && <Notice tone="error" className="m-3">{error}</Notice>}

      {adding && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Quem chegou sem horário marcado. A entrada vive na FILA — ela não ocupa a agenda e pode virar atendimento depois.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Marlene" autoFocus />
            </Field>
            <Field label="WhatsApp" hint="Opcional se já tiver o nome">
              <PhoneBRInput value={form.phone} onChange={(digits) => setForm({ ...form, phone: digits })} />
            </Field>
            <Field label="Serviço">
              <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
                <option value="">A definir</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Profissional">
              <select value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })}
                className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
                <option value="">Quem estiver livre</option>
                {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Observação" hint="Opcional">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} placeholder="Ex: veio só para retoque" />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={add} disabled={busy === 'new'}>{busy === 'new' ? 'Adicionando…' : 'Adicionar à fila'}</Button>
            <Button size="sm" variant="secondary" onClick={() => { setAdding(false); setError(''); }}>Cancelar</Button>
          </div>
        </div>
      )}

      {loading && rows.length === 0 && (
        <p className="px-4 py-6 text-sm text-[var(--text-muted)]">Carregando a fila…</p>
      )}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="clock"
          title="Ninguém na fila"
          hint={canWrite
            ? 'Quando alguém chegar sem horário marcado, use “Adicionar à fila” — a agenda não é o lugar certo para isso.'
            : 'A fila do balcão aparece aqui em ordem de chegada.'}
        />
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((row) => {
            const def = QUEUE_STATUS[row.status];
            const action = NEXT_ACTION[row.status];
            const pos = queuePosition(rows, businessId, row.date, row.id);
            const waited = waitMinutes(row, now);
            const long = (row.status === 'waiting' || row.status === 'called') && waited >= QUEUE_LONG_WAIT_MIN;
            return (
              <li key={row.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-queue-row={row.id}>
                <span className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  row.status === 'in_service' ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--surface-3)] text-[var(--text-muted)]',
                )}>
                  {row.status === 'in_service' ? <Icon n="check" size={14} strokeWidth={3} /> : (pos || '—')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--text)] truncate flex items-center gap-2">
                    {row.customerName || 'Sem nome'}
                    <Badge tone={def.tone}>{def.label}</Badge>
                    {long && <Badge tone="red">esperando {waitLabel(waited)}</Badge>}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {[row.serviceName || 'Serviço a definir', row.professionalName || 'quem estiver livre'].join(' · ')}
                    {' · '}
                    {row.status === 'in_service' || row.status === 'done'
                      ? `esperou ${waitLabel(waited)}`
                      : `na fila há ${waitLabel(waited)}`}
                    {row.bookingId ? ' · veio de horário marcado' : ''}
                  </p>
                </div>
                {canWrite && action && (
                  <>
                    <Button size="sm" variant={action.variant} disabled={busy === row.id} onClick={() => move(row, action.to)}
                      title={action.to === 'in_service' && canEncounter ? 'Abre o registro do atendimento já vinculado' : undefined}>
                      {busy === row.id ? 'Salvando…' : action.label}
                    </Button>
                    {/* Ações secundárias: só as transições que a máquina permite. */}
                    {row.status === 'waiting' && queueTransitionAllowed('waiting', 'left') && (
                      <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => move(row, 'left')}>Desistiu</Button>
                    )}
                    {row.status === 'called' && (
                      <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => move(row, 'waiting')}>Voltar para a fila</Button>
                    )}
                    {row.contactId && onOpenClient && (
                      <Button size="sm" variant="ghost" onClick={() => onOpenClient(row)}>Abrir cliente</Button>
                    )}
                    {onFitIn && (
                      <Button size="sm" variant="ghost" onClick={() => onFitIn(row)}>Encaixar na agenda</Button>
                    )}
                    {/* A3.4 fix (2ª revisão): depois que o registro fecha, falta
                        uma porta óbvia para voltar nele. Quem está em atendimento
                        e tem a permissão reabre o registro AQUI — sem tocar no
                        status da fila. Sem a permissão, a linha segue só
                        operacional (nada de conteúdo profissional). */}
                    {row.status === 'in_service' && canEncounter && onEncounter && (
                      <Button size="sm" variant="secondary" onClick={() => onEncounter(row)}>Abrir atendimento</Button>
                    )}
                    {row.bookingId && onOpenBooking && (
                      <Button size="sm" variant="secondary" onClick={() => onOpenBooking(row.bookingId)}>Ver horário</Button>
                    )}
                    <IconButton icon="x" label={`Remover ${row.customerName || 'entrada'} da fila`} size="sm" variant="ghost"
                      disabled={busy === row.id} onClick={() => remove(row)} tip="Remover da fila (não apaga o histórico do contato)" />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SubCard>
  );
}
