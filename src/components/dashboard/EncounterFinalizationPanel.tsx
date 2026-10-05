'use client';

import { useEffect, useRef, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { Button, Textarea } from '@/components/ui';
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
  const reviewTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (reviewOpen) reviewTitle.current?.focus();
  }, [reviewOpen]);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="encounter-finalization-title" className="text-base font-semibold">Fechamento clínico</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {row.status === 'finalized' ? 'FINALIZADO · READ-ONLY' : 'Revise o atendimento antes de criar a fronteira clínica.'}
          </p>
        </div>
        {row.status === 'draft' && (
          <Button type="button" onClick={() => { setError(''); setReviewOpen(true); }} disabled={!canFinalize}>
            Revisar e finalizar
          </Button>
        )}
      </div>

      {row.status === 'finalized' && (
        <div className="mt-3 space-y-3 text-sm">
          <p><strong>Finalização atual:</strong> revisão {finalRevision?.revisionNumber || '—'} · {fmt(row.finalizedAt)} · {row.signedBy || 'Profissional responsável'}</p>
          {canAddendum && <div className="rounded-md border border-[var(--border)] p-3">
            <h3 className="font-medium">Adicionar nota complementar</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Esta nota será adicionada ao prontuário sem alterar o conteúdo originalmente finalizado.</p>
            <label className="mt-3 block text-sm" htmlFor="encounter-addendum">Nota complementar</label>
            <Textarea id="encounter-addendum" value={addendum} onChange={(e) => setAddendum(e.target.value)} disabled={busy} className="mt-1" />
            <Button type="button" className="mt-2" onClick={() => { void saveAddendum(); }} disabled={busy || !addendum.trim()}>Adicionar nota complementar</Button>
          </div>}
          <div>
            <h3 className="font-medium">Histórico</h3>
            <ol className="mt-2 space-y-2" aria-label="Histórico de finalizações e notas">
              {timeline.map((event) => <li key={event.id} className={`border-l-2 pl-3 ${event.kind === 'reopen' ? 'border-amber-500' : event.kind === 'addendum' ? 'border-blue-500' : 'border-[var(--border)]'}`}><strong>{event.label}</strong> · {fmt(event.at)}<br />{event.detail}</li>)}
            </ol>
          </div>
          {canReopen && <>
            <label className="block" htmlFor="encounter-reopen-reason">Motivo da reabertura</label>
            <Textarea id="encounter-reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="Explique por que o registro precisa voltar ao estado editável." />
            <Button type="button" variant="secondary" onClick={() => { void reopen(); }} disabled={busy || reason.trim().length < 3}>Reabrir atendimento</Button>
          </>}
        </div>
      )}

      {message && <p className="mt-3 text-sm text-emerald-700" role="status">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}

      {reviewOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-4" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-[var(--surface)] p-5 shadow-xl">
            <h2 ref={reviewTitle} tabIndex={-1} id="review-dialog-title" className="text-lg font-semibold">Revisar e finalizar</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Paciente: {row.context?.patient?.name || row.petName || row.customerName} · Profissional: {row.professionalName || 'responsável'} · Agendado para: {fmt(scheduledAt)}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ['Queixa principal', row.complaint], ['Evolução clínica', row.evolution], ['Anamnese', row.clinical?.anamnesis?.history],
                ['Avaliação', row.clinical?.assessment?.veterinary?.physicalExam], ['Problemas', row.clinical?.problems?.map((item) => item.label).join(', ')],
                ['Conduta', row.clinical?.plan?.conduct], ['Procedimentos', row.clinical?.procedures?.map((item) => item.name).join(', ')], ['Orientações', row.guidance],
              ].map(([label, value]) => <div key={label} className="rounded-md border border-[var(--border)] p-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</h3><p className="mt-1 whitespace-pre-wrap text-sm">{value || 'Não preenchido'}</p></div>)}
            </div>
            <p className="mt-4 text-sm">Ao finalizar, esta versão será registrada em snapshot e o conteúdo ficará somente para leitura.</p>
            <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReviewOpen(false)} disabled={busy}>Voltar</Button><Button type="button" onClick={() => { void finalize(); }} disabled={busy || !canFinalize}>{busy ? 'Finalizando…' : 'Finalizar atendimento'}</Button></div>
          </div>
        </div>
      )}
    </section>
  );
}
