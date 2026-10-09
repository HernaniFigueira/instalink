'use client';

import { useRef, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { ActionSection, Button, Dialog, Disclosure, Field, Notice, PageActionBar, StatusBadge, Textarea } from '@/components/ui';
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
  /** Revisão de finalização é controlada pelo corpo: o rodapé do workspace abre o mesmo diálogo. */
  reviewOpen?: boolean;
  onReviewOpenChange?: (open: boolean) => void;
}

function fmt(value: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function ReviewBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h4 className="encounter-review__label">{label}</h4>
      <p className="encounter-review__value">{value || 'Não preenchido'}</p>
    </div>
  );
}

/** Retorno estruturado (F2 P3) lido como texto humano — sem inventar data. */
function followUpText(row: EncounterAuthorityRow): string {
  const mode = row.followUpMode || (row.followUp ? 'custom' : 'none');
  if (mode === 'date' && row.followUpDate) {
    return `Retorno em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(`${row.followUpDate}T12:00:00`))}`;
  }
  if (mode === 'interval' && row.followUpDays) return `Retorno em ${row.followUpDays} dias`;
  if (mode === 'custom' && row.followUp) return row.followUp;
  return 'Sem retorno definido';
}

/** Monta a revisão a partir do que EXISTE no Encounter (nenhum campo novo). */
function buildReview(row: EncounterAuthorityRow, professionalFallback: string) {
  const physicalExam = row.clinical?.assessment?.veterinary?.physicalExam || '';
  const problems = (row.clinical?.problems || []).map((item) => item.label).filter(Boolean).join(', ');
  const conduct = row.clinical?.plan?.conduct || '';
  const procedures = (row.clinical?.procedures || []).map((item) => item.name).filter(Boolean).join(', ');
  const pending = [
    ['Queixa principal', row.complaint],
    ['Avaliação', physicalExam],
    ['Problemas', problems],
    ['Conduta', conduct],
  ].filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
  return {
    clinical: [
      { label: 'Queixa principal', value: row.complaint },
      { label: 'Avaliação', value: physicalExam },
      { label: 'Problemas', value: problems },
      { label: 'Conduta', value: conduct },
      { label: 'Procedimentos', value: procedures },
    ],
    followUp: followUpText(row),
    pending,
    authorship: row.signedBy
      ? `Assinado por ${row.signedBy}`
      : `Será registrado como ${row.professionalName || professionalFallback}, profissional responsável.`,
    other: [
      { label: 'Evolução clínica', value: row.evolution },
      { label: 'Anamnese', value: row.clinical?.anamnesis?.history || '' },
      { label: 'Orientações ao tutor', value: row.guidance },
      { label: 'Nota interna', value: row.internalNote },
      { label: 'Etiquetas', value: (row.tags || []).join(', ') },
    ],
  };
}

/** F1C: revisão explícita, sem finalizar às cegas. */
export function EncounterFinalizationPanel({ businessId, row, canFinalize, flush, authority, revisions, addenda, reopenEvents, canReopen, canAddendum, reviewOpen: controlledOpen, onReviewOpenChange }: Props) {
  // Controlado pelo corpo (rodapé) quando fornecido; autônomo caso contrário.
  const [localOpen, setLocalOpen] = useState(false);
  const reviewOpen = controlledOpen ?? localOpen;
  const setReviewOpen = onReviewOpenChange ?? setLocalOpen;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Erro da FINALIZAÇÃO aparece dentro da revisão (é onde o humano está agindo).
  const [reviewError, setReviewError] = useState('');
  const [message, setMessage] = useState('');
  const [addendum, setAddendum] = useState('');
  const [reason, setReason] = useState('');
  const operation = useRef('');

  async function finalize() {
    setReviewError(''); setMessage(''); setBusy(true);
    try {
      // A autoridade flushes every registered clinical section first. Any
      // failure leaves the review open and never sends the transition.
      if (!(await flush())) { setReviewError('Não foi possível persistir todas as seções. O atendimento não foi finalizado.'); return; }
      const key = operation.current || (operation.current = crypto.randomUUID());
      const res = await apiSend<{ encounter: EncounterAuthorityRow }>('/api/encounters', 'PATCH', {
        businessId, id: row.id, action: 'finalize', expectedVersion: authority.version(), idempotencyKey: key,
      }, { scope: 'action', area: 'Atendimento' });
      if (!res.ok) { setReviewError(res.message || 'Não foi possível finalizar.'); return; }
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
  const review = buildReview(row, 'profissional responsável');
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
          <Button type="button" onClick={() => { setError(''); setReviewError(''); setReviewOpen(true); }} disabled={!canFinalize}>
            Revisar e finalizar
          </Button>
        )}
        {row.status !== 'draft' && (
          <StatusBadge tone="emerald">Finalizado</StatusBadge>
        )}
      </ActionSection>

      {row.status === 'finalized' && (
        /* Estado finalizado em TRÊS faixas, de cima para baixo por tempo de
           decisão: (1) Registro clínico — o que foi fechado; (2) Revisão-
           finalização — a revisão vigente; (3) Pós-finalização — ações
           subordinadas (nota complementar, reabertura, histórico). */
        <div className="encounter-final mt-3" data-testid="encounter-final">
          <section className="encounter-final__band encounter-final__band--record" aria-label="Registro clínico">
            <h3 className="encounter-final__band-title">Registro clínico</h3>
            <p className="encounter-final__band-text">Conteúdo finalizado e somente leitura. Alterações exigem reabertura.</p>
          </section>
          <section className="encounter-final__band encounter-final__band--review" aria-label="Revisão-finalização">
            <h3 className="encounter-final__band-title">Revisão-finalização</h3>
            <p className="encounter-final__band-text">
              {finalRevision?.revisionNumber ? <><span className="encounter-final__label">Revisão vigente</span> <span className="tabular-nums">{finalRevision.revisionNumber}</span> · </> : null}
              <span className="tabular-nums">{fmt(row.finalizedAt)}</span>
              {' · '}{row.signedBy || 'Profissional responsável'}
            </p>
          </section>
          <section className="encounter-final__band encounter-final__band--after" aria-label="Pós-finalização">
            <h3 className="encounter-final__band-title">Pós-finalização</h3>
            {canAddendum && (
              <div className="encounter-final__addendum">
                <h4 className="encounter-final__sub">Adicionar nota complementar</h4>
                <p className="encounter-final__hint">Entra no prontuário sem alterar o conteúdo originalmente finalizado.</p>
                <Field label="Nota complementar" htmlFor="encounter-addendum">
                  <Textarea id="encounter-addendum" value={addendum} onChange={(e) => setAddendum(e.target.value)} disabled={busy} />
                </Field>
                <div className="encounter-final__actions">
                  <Button type="button" size="sm" onClick={() => { void saveAddendum(); }} disabled={busy || !addendum.trim()}>Adicionar nota</Button>
                </div>
              </div>
            )}
            {addenda.length > 0 && (
              <div className="encounter-final__notes" aria-label="Notas complementares">
                <h4 className="encounter-final__sub">Notas complementares</h4>
                <ul className="encounter-final__timeline">
                  {addenda.map((note) => (
                    <li key={note.id} className="encounter-final__event encounter-final__event--addendum">
                      <span className="tabular-nums">{fmt(note.createdAt)}</span>
                      <br />{note.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canReopen && (
              <Disclosure label="Reabrir para editar" hint="Ação rara · registra motivo na auditoria">
                <div className="encounter-final__reopen">
                  <p className="encounter-final__hint">A reabertura fica registrada no histórico com o motivo.</p>
                  <Field label="Motivo da reabertura" htmlFor="encounter-reopen-reason">
                    <Textarea id="encounter-reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="Explique por que o registro precisa voltar ao estado editável." />
                  </Field>
                  <div className="encounter-final__actions">
                    <Button type="button" variant="secondary" size="sm" onClick={() => { void reopen(); }} disabled={busy || reason.trim().length < 3}>Reabrir atendimento</Button>
                  </div>
                </div>
              </Disclosure>
            )}
            <Disclosure label="Histórico de finalizações e notas" hint={`${timeline.length} ${timeline.length === 1 ? 'evento' : 'eventos'}`}>
              <ol className="encounter-final__timeline" aria-label="Histórico de finalizações e notas">
                {timeline.map((event) => (
                  <li key={event.id} className={`encounter-final__event encounter-final__event--${event.kind}`}>
                    <strong>{event.label}</strong> · <span className="tabular-nums">{fmt(event.at)}</span>
                    <br />{event.detail}
                  </li>
                ))}
              </ol>
            </Disclosure>
          </section>
        </div>
      )}

      {message && <Notice tone="success" className="mt-3">{message}</Notice>}
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}

      {/* §43 — a confirmação é o Dialog CANÔNICO (Escape, foco contido, scroll
          lock e guarda de descarte do sistema). Nada de modal artesanal.
          Hierarquia da revisão: o que o profissional precisa CONFERIR primeiro
          (avaliação, problemas, conduta, procedimentos, retorno), depois o que
          falta preencher, a autoria e, por último, os demais dados reais. */}
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
                exige confirmação explícita. Em repouso, o CTA do rodapé é primário. */}
            <Button type="button" variant="destructive" onClick={() => { void finalize(); }} disabled={busy || !canFinalize}>
              {busy ? 'Finalizando…' : 'Finalizar atendimento'}
            </Button>
          </>
        }
      >
        {reviewError && <Notice tone="error" className="mb-3">{reviewError}</Notice>}
        <div className="encounter-review" data-testid="encounter-review">
          <section className="encounter-review__group" aria-label="Avaliação e plano">
            <h3 className="encounter-review__group-title">Avaliação e plano</h3>
            <div className="encounter-review__grid">
              {review.clinical.map((block) => <ReviewBlock key={block.label} label={block.label} value={block.value} />)}
            </div>
          </section>
          <section className="encounter-review__group" aria-label="Retorno e pendências">
            <h3 className="encounter-review__group-title">Retorno e pendências</h3>
            <div className="encounter-review__grid">
              <ReviewBlock label="Retorno" value={review.followUp} />
              <div>
                <h4 className="encounter-review__label">Pendências de preenchimento</h4>
                {review.pending.length === 0
                  ? <p className="encounter-review__value">Nenhuma pendência de preenchimento.</p>
                  : <ul className="encounter-review__pending">{review.pending.map((item) => <li key={item}>{item}</li>)}</ul>}
              </div>
            </div>
          </section>
          <section className="encounter-review__group" aria-label="Autoria">
            <h3 className="encounter-review__group-title">Autoria</h3>
            <p className="encounter-review__value">{review.authorship}</p>
          </section>
          <section className="encounter-review__group" aria-label="Demais dados">
            <h3 className="encounter-review__group-title">Demais dados do atendimento</h3>
            <div className="encounter-review__grid">
              {review.other.map((block) => <ReviewBlock key={block.label} label={block.label} value={block.value} />)}
            </div>
          </section>
        </div>
        <Notice tone="warning" className="mt-4">
          Ao finalizar, esta versão será registrada em snapshot e o conteúdo ficará somente para leitura.
        </Notice>
      </Dialog>
    </section>
  );
}
