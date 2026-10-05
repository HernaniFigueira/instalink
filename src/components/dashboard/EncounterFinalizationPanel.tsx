'use client';

import { useRef, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { ActionSection, Button, Dialog, Field, Notice, PageActionBar, StatusBadge, Textarea } from '@/components/ui';
import type { EncounterFinalizationRevision, EncounterAddendum } from '@/lib/types';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  canFinalize: boolean;
  flush: () => Promise<boolean>;
  authority: EncounterAuthority;
  revisions: EncounterFinalizationRevision[];
  addenda: EncounterAddendum[];
  reopenEvents: Array<{ at: string; actorUserId: string; meta?: Record<string, unknown> }>;
  canReopen: boolean;
  canAddendum: boolean;
}

function fmt(value: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

/** F1C: revisão explícita, sem finalizar às cegas. */
export function EncounterFinalizationPanel({ businessId, row, canFinalize, flush, authority, revisions, addenda, reopenEvents, canReopen, canAddendum }: Props) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [addendum, setAddendum] = useState('');
  const [reason, setReason] = useState('');
  const operation = useRef('');

  async function finalize() {
    setError(''); setMessage(''); setBusy(true);
    try {
      // A autoridade flushes every registered clinical section first. Any
      // failure leaves the review open and never sends the transition.
      if (!(await flush())) { setError('Não foi possível persistir todas as seções. O atendimento não foi finalizado.'); return; }
      const key = operation.current || (operation.current = crypto.randomUUID());
      const res = await apiSend<{ encounter: EncounterAuthorityRow }>('/api/encounters', 'PATCH', {
        businessId, id: row.id, action: 'finalize', expectedVersion: authority.version(), idempotencyKey: key,
      }, { scope: 'action', area: 'Atendimento' });
      if (!res.ok) { setError(res.message || 'Não foi possível finalizar.'); return; }
      authority.publish(res.data!.encounter); setReviewOpen(false); setMessage('Atendimento finalizado.');
    } finally { setBusy(false); }
  }

  async function reopen() {
    setError(''); setMessage('');
    if (reason.trim().length < 3) { setError('Informe o motivo da reabertura.'); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ encounter: EncounterAuthorityRow }>('/api/encounters', 'PATCH', {
        businessId, id: row.id, action: 'reopen', expectedVersion: authority.version(), reason: reason.trim(),
      }, { scope: 'action', area: 'Atendimento' });
      if (!res.ok) { setError(res.message || 'Não foi possível reabrir.'); return; }
      authority.publish(res.data!.encounter); setReason(''); setMessage('Atendimento reaberto com auditoria.');
    } finally { setBusy(false); }
  }

  async function saveAddendum() {
    if (!addendum.trim()) { setError('Escreva a nota complementar.'); return; }
    setError(''); setMessage(''); setBusy(true);
    try {
      const res = await apiSend<{ encounter: EncounterAuthorityRow }>('/api/encounters', 'PATCH', {
        businessId, id: row.id, action: 'addendum', expectedVersion: authority.version(), text: addendum.trim(),
      }, { scope: 'action', area: 'Atendimento' });
      if (!res.ok) { setError(res.message || 'Não foi possível adicionar a nota.'); return; }
      authority.publish(res.data!.encounter); setAddendum(''); setMessage('Nota complementar adicionada ao prontuário.');
    } finally { setBusy(false); }
  }

  const finalRevision = revisions[revisions.length - 1];
  const scheduledDate = row.context?.booking?.date || row.date;
  const scheduledTime = row.context?.booking?.time || row.time;
  const scheduledAt = scheduledDate ? `${scheduledDate}T${scheduledTime || '00:00'}:00` : '';
  const timeline = [
    ...revisions.map((revision) => ({ id: `revision-${revision.id}`, at: revision.finalizedAt, kind: 'revision' as const, label: `Revisão ${revision.revisionNumber}`, detail: `Finalizada · snapshot ${revision.fingerprint ? revision.fingerprint.slice(0, 12) : 'preservado'}` })),
    ...reopenEvents.map((event, index) => ({ id: `reopen-${event.at}-${index}`, at: event.at, kind: 'reopen' as const, label: 'Reabertura', detail: String(event.meta?.reason || 'motivo registrado') })),
    ...addenda.map((note) => ({ id: `addendum-${note.id}`, at: note.createdAt, kind: 'addendum' as const, label: 'Nota complementar', detail: note.text })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section className="ws-panel mt-4" aria-labelledby="encounter-finalization-title" data-testid="encounter-finalization">
      {/* DS 1.0 · §4/§43 — texto à esquerda, ação à direita, com respiro: o
          fechamento clínico usa o MESMO ActionSection das outras superfícies.
          A autoridade continua vindo do servidor (`canFinalize`): a única
          PRIMARY daqui é "Revisar e finalizar". */}
      <ActionSection
        title="Fechamento clínico"
        hint={row.status === 'finalized' ? 'FINALIZADO · somente leitura' : 'Revise o atendimento antes de criar a fronteira clínica.'}
      >
        {row.status === 'draft' && (
          <Button type="button" onClick={() => { setError(''); setReviewOpen(true); }} disabled={!canFinalize}>
            Revisar e finalizar
          </Button>
        )}
        {row.status !== 'draft' && (
          <StatusBadge tone="emerald">Finalizado</StatusBadge>
        )}
      </ActionSection>

      {row.status === 'finalized' && (
        <div className="mt-3 space-y-4 text-sm">
          <p className="text-[var(--gd-text-muted)]">
            <strong className="text-[var(--gd-text)]">Finalização atual:</strong> revisão {finalRevision?.revisionNumber || '—'} · {fmt(row.finalizedAt)} · {row.signedBy || 'Profissional responsável'}
          </p>
          {canAddendum && (
            <ActionSection
              title="Adicionar nota complementar"
              hint="Entra no prontuário sem alterar o conteúdo originalmente finalizado."
            >
              <div className="w-full space-y-2">
                <Field label="Nota complementar" htmlFor="encounter-addendum">
                  <Textarea id="encounter-addendum" value={addendum} onChange={(e) => setAddendum(e.target.value)} disabled={busy} />
                </Field>
                <Button type="button" size="sm" onClick={() => { void saveAddendum(); }} disabled={busy || !addendum.trim()}>Adicionar nota</Button>
              </div>
            </ActionSection>
          )}
          <div>
            <h3 className="text-[var(--gd-font-size-section)] font-semibold text-[var(--gd-text)]">Histórico</h3>
            <ol className="mt-2 space-y-2" aria-label="Histórico de finalizações e notas">
              {timeline.map((event) => (
                <li key={event.id} className={`border-l-2 pl-3 ${event.kind === 'reopen' ? 'border-[var(--gd-warning)]' : event.kind === 'addendum' ? 'border-[var(--gd-info)]' : 'border-[var(--gd-border)]'}`}>
                  <strong>{event.label}</strong> · <span className="tabular-nums">{fmt(event.at)}</span>
                  <br />{event.detail}
                </li>
              ))}
            </ol>
          </div>
          {canReopen && (
            <PageActionBar hint="A reabertura fica registrada no histórico com o motivo.">
              <div className="mr-auto w-full max-w-[520px]">
                <Field label="Motivo da reabertura" htmlFor="encounter-reopen-reason">
                  <Textarea id="encounter-reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="Explique por que o registro precisa voltar ao estado editável." />
                </Field>
              </div>
              <Button type="button" variant="secondary" onClick={() => { void reopen(); }} disabled={busy || reason.trim().length < 3}>Reabrir atendimento</Button>
            </PageActionBar>
          )}
        </div>
      )}

      {message && <Notice tone="success" className="mt-3">{message}</Notice>}
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}

      {/* §43 — a confirmação é o Dialog CANÔNICO (Escape, foco contido, scroll
          lock e guarda de descarte do sistema). Nada de modal artesanal. */}
      <Dialog
        open={reviewOpen}
        onClose={() => { if (!busy) setReviewOpen(false); }}
        title="Revisar e finalizar"
        subtitle={`Paciente: ${row.context?.patient?.name || row.petName || row.customerName} · Profissional: ${row.professionalName || 'responsável'} · Agendado para: ${fmt(scheduledAt)}`}
        width="672px"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setReviewOpen(false)} disabled={busy}>Voltar</Button>
            {/* Ação destrutiva/final: Danger SOLID só aqui — a fronteira clínica
                exige confirmação explícita. */}
            <Button type="button" variant="destructive" onClick={() => { void finalize(); }} disabled={busy || !canFinalize}>
              {busy ? 'Finalizando…' : 'Finalizar atendimento'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Queixa principal', row.complaint], ['Evolução clínica', row.evolution], ['Anamnese', row.clinical?.anamnesis?.history],
            ['Avaliação', row.clinical?.assessment?.veterinary?.physicalExam], ['Problemas', row.clinical?.problems?.map((item) => item.label).join(', ')],
            ['Conduta', row.clinical?.plan?.conduct], ['Procedimentos', row.clinical?.procedures?.map((item) => item.name).join(', ')], ['Orientações', row.guidance],
          ].map(([label, value]) => (
            <div key={label}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--gd-text-muted)]">{label}</h3>
              <p className="mt-1 whitespace-pre-wrap text-[var(--gd-font-size-body)] text-[var(--gd-text)]">{value || 'Não preenchido'}</p>
            </div>
          ))}
        </div>
        <Notice tone="warning" className="mt-4">
          Ao finalizar, esta versão será registrada em snapshot e o conteúdo ficará somente para leitura.
        </Notice>
      </Dialog>
    </section>
  );
}
