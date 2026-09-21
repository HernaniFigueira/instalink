'use client';
import { createPortal } from 'react-dom';
// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 5 — REGISTRO DO ATENDIMENTO (painel lateral)
// ═══════════════════════════════════════════════════════════════
// Abre a partir do agendamento ("Atendimento"), da fila ("Abrir atendimento")
// ou do histórico do cliente.
//
// O que a tela faz:
//   • rascunho: escrita livre, salva SOZINHO um segundo depois da última tecla;
//   • finalizar: exige conteúdo mínimo e ASSINA o registro (nome do
//     profissional) — depois disso o texto só muda reabrindo;
//   • reabrir: só quem administra a unidade (e fica na auditoria);
//   • depois de finalizar: "como fica o acompanhamento?" — encerrar, agendar o
//     retorno (abre o agendamento pré-preenchido, não cria nada) ou pedir à
//     recepção (cria uma Tarefa de verdade, vinculada ao atendimento);
//   • imprimir: uma via do CLIENTE com o que ele levou para casa — a anotação
//     interna não entra no papel.
//
// REGRAS DE OURO DESTA TELA (2ª revisão da B5):
//   1. o ref `latest` é a fonte SÍNCRONA do que está na tela — todo caminho que
//      muda o formulário passa por `updateForm`, e o salvamento lê SEMPRE dali
//      (nunca do último payload do servidor);
//   2. se a pessoa digitar enquanto o request está em voo, a resposta NÃO pode
//      apagar o texto novo: só adota o formulário do servidor quando ninguém
//      mexeu desde o envio (`applySaveResult`);
//   3. `finalized` é READ ONLY para todos os papéis: `canReopen` só decide se o
//      botão "Reabrir para editar" aparece;
//   4. toda escrita manda `expectedVersion` — e recarregar depois de conflito é
//      leitura POR ID (nunca POST, que criaria outro registro).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Badge, Button, Drawer, Field, Input, Notice, Textarea } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import {
  ENCOUNTER_AUTOSAVE_LABELS, ENCOUNTER_AUTOSAVE_MS, ENCOUNTER_LABELS, ENCOUNTER_STATUS,
  ENCOUNTER_VERSION_ERROR, applySaveResult, canEditEncounter, canFinalize, encounterContentPayload,
  encounterDraftKey, encounterFormPrintBlocks, encounterSignature, encounterSummary,
  followUpTaskNote, followUpTaskTitle,
} from '@/lib/encounters';
import { formatDateBR } from '@/lib/tz';
import type { Encounter } from '@/lib/types';

export interface EncounterRow extends Encounter {
  professionalName: string;
  serviceName: string;
  bookingStatus: string;
  /**
   * A3.4 fix (fechamento do B5) — WhatsApp do cliente RESOLVIDO na leitura
   * (contato do CRM → agendamento → fila). Não vive no banco: é conveniência
   * de tela, e é o que deixa "Agendar retorno" pronto para agendar.
   */
  customerPhone: string;
}

export interface FollowUpSeed {
  encounterId: string;
  bookingId: string;
  contactId: string;
  customerName: string;
  /** WhatsApp já resolvido pelo servidor — a recepção não redigita o cliente. */
  customerPhone: string;
  serviceId: string;
  professionalId: string;
  followUp: string;
}

interface Props {
  businessId: string;
  /** Agendamento de origem (o registro é 1:1 com ele). */
  bookingId?: string;
  /** Pré-preenchimento quando o registro nasce de um agendamento. */
  seed?: { customerName?: string; serviceId?: string; professionalId?: string; date?: string; time?: string; contactId?: string; customerId?: string };
  /** Modelo de leitura (aberto pelo histórico do cliente, já existente). */
  existing?: EncounterRow | null;
  /** Entrada da fila de origem (o registro é 1:1 com ela). */
  queueId?: string;
  /** Quem manda na unidade: único que reabre registro finalizado. */
  canReopen?: boolean;
  /** "Agendar retorno": quem sabe abrir o agendamento pré-preenchido é o pai. */
  onScheduleReturn?: (seed: FollowUpSeed) => void;
  onClose: () => void;
  onChanged?: () => void;
}

const EMPTY = {
  complaint: '', evolution: '', guidance: '', followUp: '', internalNote: '', tags: '',
};

type Form = typeof EMPTY;

const formOf = (e: EncounterRow): Form => ({
  complaint: e.complaint || '', evolution: e.evolution || '', guidance: e.guidance || '',
  followUp: e.followUp || '', internalNote: e.internalNote || '', tags: (e.tags || []).join(', '),
});

export function EncounterSheet({
  businessId, bookingId, seed, existing, queueId, canReopen = false, onScheduleReturn, onClose, onChanged,
}: Props) {
  const [row, setRow] = useState<EncounterRow | null>(existing || null);
  const [form, setForm] = useState<Form>(() => existing ? formOf(existing) : { ...EMPTY });
  const [loading, setLoading] = useState(!existing);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [autoState, setAutoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [conflict, setConflict] = useState(false);
  // Pós-atendimento (item 9): "como fica o acompanhamento?"
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpNote, setFollowUpNote] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskDone, setTaskDone] = useState('');

  /**
   * Espelho SÍNCRONO do estado da tela. É daqui que o autosave, o flush de
   * fechamento e as ações de estado leem — não do último render nem do último
   * payload do servidor. Todo caminho que mexe no formulário passa por
   * `updateForm` (não existe `setForm` solto no arquivo).
   */
  const latest = useRef<{ row: EncounterRow | null; form: Form }>({ row: existing || null, form: existing ? formOf(existing) : { ...EMPTY } });
  const inflight = useRef<Promise<boolean> | null>(null);
  const lastSaved = useRef(existing ? encounterDraftKey(formOf(existing)) : '');

  /** Única porta de escrita do formulário: mantém ref e estado juntos. */
  const updateForm = useCallback((next: Form) => {
    latest.current = { ...latest.current, form: next };
    setForm(next);
  }, []);

  /** Única porta de escrita do registro (row) — sempre com o ref em sincronia. */
  const updateRow = useCallback((next: EncounterRow) => {
    latest.current = { ...latest.current, row: next };
    setRow(next);
  }, []);

  /** Adota o que veio do servidor (registro + formulário). */
  const apply = useCallback((e: EncounterRow) => {
    const next = formOf(e);
    latest.current = { row: e, form: next };
    lastSaved.current = encounterDraftKey(next);
    setRow(e);
    setForm(next);
    setAutoState('saved');
  }, []);

  const open = useCallback(async () => {
    setError('');
    if (existing) { apply(existing); setLoading(false); return; }
    setLoading(true);
    // Sem registro em mãos: o POST é IDEMPOTENTE por vínculo (agendamento ou
    // entrada da fila) — ele devolve o existente com `reused: true` em vez de
    // criar um segundo documento.
    const created = await apiSend<{ encounter: EncounterRow }>('/api/encounters', 'POST', {
      businessId, bookingId,
      customerName: seed?.customerName || '', serviceId: seed?.serviceId || '',
      professionalId: seed?.professionalId || '', date: seed?.date || '', time: seed?.time || '',
      contactId: seed?.contactId || '', customerId: seed?.customerId || '',
      queueId: queueId || '',
    }, { scope: 'action', area: 'Atendimento' });
    setLoading(false);
    if (!created.ok) { setError(created.message || 'Não foi possível abrir o atendimento.'); return; }
    apply(created.data!.encounter);
  }, [apply, bookingId, businessId, existing, queueId, seed]);

  useEffect(() => { void open(); }, [open]);

  /** Recarrega PELO ID — leitura pura. Nunca cria registro novo. */
  const reload = useCallback(async () => {
    const current = latest.current.row;
    if (!current?.id) return;
    setError('');
    const res = await apiGet<{ encounter: EncounterRow }>(
      `/api/encounters?businessId=${businessId}&id=${encodeURIComponent(current.id)}`,
      { scope: 'area', area: 'Atendimento' },
    );
    if (!res.ok || !res.data?.encounter) { setError(res.message || 'Não foi possível recarregar o atendimento.'); return; }
    setConflict(false);
    apply(res.data.encounter);
  }, [apply, businessId]);

  const isDraft = row?.status === 'draft';
  const editable = row ? canEditEncounter(row, { canReopen }) : false;
  const dirty = useMemo(() => !!row && encounterDraftKey(form) !== lastSaved.current, [form, row]);

  /**
   * Salva o conteúdo. Lê SEMPRE o estado atual do ref (o que está na tela
   * agora), manda a revisão conhecida e, ao voltar, só adota o texto do
   * servidor se ninguém digitou durante o envio.
   */
  const save = useCallback(async (opts: { silent?: boolean } = {}): Promise<boolean> => {
    const current = latest.current.row;
    if (!current || current.status !== 'draft') return false;
    const sentForm = latest.current.form;
    const sentKey = encounterDraftKey(sentForm);
    if (sentKey === lastSaved.current) return true;      // nada para salvar
    if (inflight.current) return inflight.current;        // um request por vez

    if (!opts.silent) { setBusy('save'); setError(''); setSaved(''); }
    setAutoState('saving');
    const run = (async () => {
      const res = await apiSend<{ encounter: EncounterRow }>(
        '/api/encounters', 'PATCH',
        encounterContentPayload(businessId, current.id, sentForm, current.version),
        { scope: 'action', area: 'Atendimento' },
      );
      if (!res.ok) {
        setAutoState('error');
        setConflict(res.status === 409);
        setError(res.message);
        return false;
      }
      const serverRow = res.data!.encounter;
      // O que o servidor confirmou é `sentKey`. Se a tela já tem texto mais
      // novo, ele é PRESERVADO: o próximo ciclo salva o resto com a versão nova.
      const result = applySaveResult({
        sentKey, currentKey: encounterDraftKey(latest.current.form), serverVersion: serverRow.version,
      });
      lastSaved.current = result.lastSavedKey;
      updateRow(serverRow);
      if (result.adoptServerForm) { updateForm(formOf(serverRow)); setAutoState('saved'); }
      else setAutoState('idle');
      setConflict(false);
      if (!opts.silent) { setBusy(''); setSaved('Registro salvo.'); }
      return true;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
      setBusy((b) => (b === 'save' ? '' : b));
      onChanged?.();
    }
  }, [businessId, onChanged, updateForm, updateRow]);

  // Autosave: só em rascunho, só com mudança real, um request por vez e só
  // depois de o dedo parar. `conflict` desliga o automatismo (insistir só
  // repetiria o 409) até a pessoa recarregar.
  useEffect(() => {
    if (!row || row.status !== 'draft' || conflict) return;
    if (encounterDraftKey(form) === lastSaved.current) return;
    const t = setTimeout(() => { void save({ silent: true }); }, ENCOUNTER_AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [form, row, conflict, save]);

  /** Fecha com alteração pendente: tenta salvar; se falhar, avisa (não engole). */
  const close = useCallback(async () => {
    const current = latest.current.row;
    if (current && current.status === 'draft' && encounterDraftKey(latest.current.form) !== lastSaved.current) {
      const ok = await save({ silent: true });
      if (!ok) {
        const keep = window.confirm('Não foi possível salvar o atendimento agora. Fechar mesmo assim e perder o que foi digitado?');
        if (!keep) return;
      }
    }
    onClose();
  }, [save, onClose]);

  /** Toda escrita de estado manda a revisão FRESCA do ref (nunca a do render). */
  async function transition(action: 'finalize' | 'reopen') {
    const current = latest.current.row;
    if (!current) return;
    setError(''); setSaved(''); setBusy(action);
    const res = await apiSend<{ encounter: EncounterRow }>('/api/encounters', 'PATCH', {
      businessId, id: current.id, action, expectedVersion: current.version,
    }, { scope: 'action', area: 'Atendimento' });
    setBusy('');
    if (!res.ok) { setConflict(res.status === 409); setError(res.message); return; }
    apply(res.data!.encounter);
    setConflict(false);
    if (action === 'finalize') {
      setSaved('Atendimento finalizado.');
      // O campo de instrução começa VAZIO: o retorno já anotado aparece como
      // contexto (placeholder) e só entra na nota da tarefa se ninguém
      // escrever nada diferente — nada de repetir o mesmo texto duas vezes.
      setFollowUpNote('');
      setFollowUpOpen(true);
    } else {
      setSaved('Registro reaberto para edição (a reabertura fica na auditoria).');
      setFollowUpOpen(false);
    }
    onChanged?.();
  }

  async function finalize() {
    if (!row) return;
    const check = canFinalize(form);
    if (!check.ok) { setError(check.error); return; }
    setError('');
    // Salvar antes de assinar: o documento final tem o texto que está na tela —
    // e a versão usada na assinatura é a que voltou do save, não a do render.
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    await transition('finalize');
  }

  /** "Pedir à recepção": cria uma TAREFA (o sistema que já existe). */
  async function askReception() {
    const current = latest.current.row;
    if (!current) return;
    // A instrução escrita e o retorno anotado compõem a MESMA nota — sem eco.
    const note = followUpTaskNote(current.followUp, followUpNote);
    if (!note) {
      setError('Escreva a instrução para a recepção (ex: ligar e marcar o retorno em 30 dias).');
      return;
    }
    setTaskBusy(true); setError('');
    const res = await apiSend<{ task: { id: string } }>('/api/tasks', 'POST', {
      businessId,
      title: followUpTaskTitle(current.customerName),
      note: note || current.followUp,
      contactId: current.contactId || undefined,
      bookingId: current.bookingId || undefined,
      encounterId: current.id,
    }, { scope: 'action', area: 'Atendimento' });
    setTaskBusy(false);
    if (!res.ok) { setError(res.message || 'Não foi possível pedir à recepção.'); return; }
    setTaskDone('Pedido registrado como tarefa para a recepção.');
    setFollowUpOpen(false);
    onChanged?.();
  }

  /** Imprime a VIA DO CLIENTE: só o que ele levou para casa. */
  function print() {
    document.body.classList.add('il-printing');
    const cleanup = () => {
      document.body.classList.remove('il-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    try { window.print(); } finally { setTimeout(cleanup, 1500); }
  }

  const statusDef = row ? ENCOUNTER_STATUS[row.status] : null;
  // A3.4 (teste humano): a via do cliente sai do que está VISÍVEL agora — não
  // do último payload que o autosave confirmou. Metadados seguem do registro.
  const printBlocks = row ? encounterFormPrintBlocks(form) : [];

  return (
    <Drawer
      open
      onClose={() => { void close(); }}
      title="Atendimento"
      subtitle={row ? `${formatDateBR(row.date)}${row.time ? ` · ${row.time}` : ''} · ${row.customerName || 'Cliente'}` : 'Registro do atendimento'}
      width="max-w-[620px]"
      footer={(
        <>
          {row && (
            <span className="mr-auto flex w-full min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--text-muted)] sm:w-auto">
              <Badge tone={statusDef!.tone}>{statusDef!.label}</Badge>
              {row.status === 'finalized' && <span>Finalizado por {encounterSignature(row)}</span>}
              {/* Indicador do autosave: discreto, no lugar onde a pessoa olha. */}
              {isDraft && autoState === 'saving' && <span>{ENCOUNTER_AUTOSAVE_LABELS.saving}</span>}
              {isDraft && autoState === 'saved' && !dirty && <span>{ENCOUNTER_AUTOSAVE_LABELS.saved}</span>}
              {isDraft && autoState === 'error'
                && <span className="text-[var(--danger-fg)]">{ENCOUNTER_AUTOSAVE_LABELS.error}</span>}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={print} disabled={!row} className="w-full sm:w-auto">
            <Icon n="printer" size={13} /> Imprimir via do cliente
          </Button>
          {editable && (
            <Button variant="secondary" size="sm" onClick={() => { void save(); }} disabled={!!busy || !dirty} className="w-full sm:w-auto">
              {busy === 'save' ? 'Salvando…' : 'Salvar'}
            </Button>
          )}
          {row && isDraft && (
            <Button variant="primary" size="sm" onClick={finalize} disabled={!!busy} className="w-full sm:w-auto">
              {busy === 'finalize' ? 'Finalizando…' : 'Finalizar atendimento'}
            </Button>
          )}
          {row && !isDraft && canReopen && (
            <Button variant="warning" size="sm" onClick={() => { void transition('reopen'); }} disabled={!!busy} className="w-full sm:w-auto">
              {busy === 'reopen' ? 'Reabrindo…' : 'Reabrir para editar'}
            </Button>
          )}
        </>
      )}
    >
      <div className="px-5 py-4 space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {saved && !error && <Notice tone="success">{saved}</Notice>}
        {taskDone && !error && <Notice tone="success">{taskDone}</Notice>}
        {loading && <p className="text-sm text-[var(--text-muted)]">Abrindo o atendimento…</p>}

        {row && (
          <>
            {conflict && (
              <Notice tone="warning" title="Esta versão ficou velha">
                {ENCOUNTER_VERSION_ERROR} O que você digitou continua na tela — recarregue o registro
                para ver o que a outra aba salvou antes de decidir o que fica.
                <button type="button" className="ml-1 underline font-semibold" onClick={() => { void reload(); }}>
                  Recarregar registro
                </button>
              </Notice>
            )}

            {row.status === 'finalized' && (
              <Notice tone="info" title="Registro finalizado">
                Este documento foi finalizado por {encounterSignature(row)}. Alterar exige reabrir — e a
                reabertura fica registrada na auditoria da unidade.
              </Notice>
            )}

            {/* ── Pós-atendimento: "como fica o acompanhamento?" ── */}
            {followUpOpen && row.status === 'finalized' && (
              <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 space-y-3">
                <p className="text-sm font-semibold text-[var(--text)]">Atendimento finalizado. Próximo passo:</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => { setFollowUpOpen(false); onClose(); }}>Encerrar</Button>
                  {onScheduleReturn && (
                    <Button size="sm" variant="secondary" onClick={() => {
                      onScheduleReturn({
                        encounterId: row.id, bookingId: row.bookingId, contactId: row.contactId,
                        customerName: row.customerName, customerPhone: row.customerPhone || '',
                        serviceId: row.serviceId, professionalId: row.professionalId, followUp: row.followUp,
                      });
                    }}>Agendar retorno</Button>
                  )}
                  <Button size="sm" variant="secondary" disabled={taskBusy} onClick={askReception}>
                    {taskBusy ? 'Pedindo…' : 'Pedir à recepção'}
                  </Button>
                </div>
                <Field label="O que a recepção deve fazer" hint="Ex: ligar em 30 dias e marcar o retorno; confirmar por telefone.">
                  <Input value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)}
                    placeholder={row.followUp || 'Ex: ligar e marcar o retorno em 30 dias'} maxLength={200} />
                </Field>
                <p className="text-xs text-[var(--text-muted)]">
                  Agendar retorno abre o agendamento já preenchido — nada é marcado sem você confirmar.
                  Pedir à recepção cria uma tarefa para a equipe.
                </p>
              </div>
            )}

            {isDraft && editable && (
              <p className="text-xs text-[var(--text-muted)]">
                Enquanto é rascunho, o texto é salvo sozinho um segundo depois de você parar de digitar.
              </p>
            )}
            {!isDraft && (
              <p className="text-xs text-[var(--text-muted)]">
                {canReopen
                  ? 'Registro finalizado é somente leitura. Para editar, use “Reabrir para editar” — e a reabertura fica na auditoria.'
                  : 'Você está vendo um registro finalizado. Só quem administra a unidade reabre para edição.'}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <Icon n="user" size={13} /> {row.customerName || 'Cliente'}
              </span>
              {row.serviceName && <span className="inline-flex items-center gap-1.5"><Icon n="fileText" size={13} /> {row.serviceName}</span>}
              {row.professionalName && <span className="inline-flex items-center gap-1.5"><Icon n="users" size={13} /> {row.professionalName}</span>}
              {row.bookingId && <span className="inline-flex items-center gap-1.5"><Icon n="calendar" size={13} /> veio de um agendamento</span>}
              {row.queueId && <span className="inline-flex items-center gap-1.5"><Icon n="clock" size={13} /> veio da fila do balcão</span>}
            </div>

            {/* ── Conteúdo do registro ── */}
            <Field label={ENCOUNTER_LABELS.complaint}>
              <Textarea value={form.complaint} disabled={!editable} maxLength={600}
                onChange={(e) => updateForm({ ...form, complaint: e.target.value })}
                placeholder="Ex: dor no dente do fundo do lado direito há dois dias" />
            </Field>
            <Field label={ENCOUNTER_LABELS.evolution} hint="O que foi feito neste atendimento — é o coração do registro.">
              <Textarea value={form.evolution} disabled={!editable} maxLength={4000}
                onChange={(e) => updateForm({ ...form, evolution: e.target.value })}
                placeholder="Ex: limpeza completa, aplicação de flúor; sem intercorrências" />
            </Field>
            <Field label={ENCOUNTER_LABELS.guidance} hint="Sai na via impressa que o cliente leva.">
              <Textarea value={form.guidance} disabled={!editable} maxLength={2000}
                onChange={(e) => updateForm({ ...form, guidance: e.target.value })}
                placeholder="Ex: evitar alimentos muito frios por 24h; escovar com pasta para sensibilidade" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={ENCOUNTER_LABELS.followUp}>
                <Input value={form.followUp} disabled={!editable} maxLength={200}
                  onChange={(e) => updateForm({ ...form, followUp: e.target.value })} placeholder="Ex: retorno em 30 dias" />
              </Field>
              <Field label="Etiquetas" hint="Separe por vírgula (procedimento, material, região…).">
                <Input value={form.tags} disabled={!editable}
                  onChange={(e) => updateForm({ ...form, tags: e.target.value })} placeholder="Ex: limpeza, flúor" />
              </Field>
            </div>
            <Field label={ENCOUNTER_LABELS.internalNote} hint="Fica só na unidade — não entra na via do cliente.">
              <Textarea value={form.internalNote} disabled={!editable} maxLength={2000}
                onChange={(e) => updateForm({ ...form, internalNote: e.target.value })}
                placeholder="Ex: cliente relatou sensibilidade; acompanhar no próximo retorno" />
            </Field>
          </>
        )}
      </div>

      {/* ── VIA DO CLIENTE (única coisa que a impressão enxerga) ── */}
      {row && typeof document !== 'undefined' && createPortal(
        /* Fica fora da tela durante o uso normal e é trazida para o papel pelo
           CSS de impressão (`body.il-printing`) — a via do cliente não é um
           segundo conteúdo, é o MESMO registro visto de outro jeito. */
        <div className="il-print-area" aria-hidden="true"
          style={{ position: 'absolute', left: -10000, top: 0, width: '100%' }}>
          <div className="max-w-[720px] mx-auto text-black">
            <div style={{ borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 16 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Registro de atendimento</h1>
              <p style={{ fontSize: 12, margin: '4px 0 0' }}>
                {row.customerName || 'Cliente'} · {formatDateBR(row.date)}{row.time ? ` às ${row.time}` : ''}
                {row.serviceName ? ` · ${row.serviceName}` : ''}
                {row.professionalName ? ` · ${row.professionalName}` : ''}
              </p>
            </div>
            {printBlocks.length === 0 && <p style={{ fontSize: 12 }}>Sem conteúdo registrado.</p>}
            {printBlocks.map((b) => (
              <section key={b.label} style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px' }}>{b.label}</h2>
                <p style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }}>{b.text}</p>
              </section>
            ))}
            {row.status === 'finalized' && (
              <p style={{ fontSize: 11, marginTop: 28 }}>
                Finalizado por {encounterSignature(row)}
                {row.finalizedAt ? ` em ${new Date(row.finalizedAt).toLocaleString('pt-BR')}` : ''}
              </p>
            )}
          </div>
        </div>, document.body
      )}
    </Drawer>
  );
}

/** Lista compacta de registros (usada no histórico do cliente). */
export function EncounterList({ rows, onOpen, empty }: {
  rows: EncounterRow[];
  onOpen: (row: EncounterRow) => void;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const def = ENCOUNTER_STATUS[row.status];
        return (
          <li key={row.id}>
            <button type="button" onClick={() => onOpen(row)}
              className="w-full text-left rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 hover:bg-[var(--surface-hover)]">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                  {formatDateBR(row.date)}{row.time ? ` ${row.time}` : ''}
                </span>
                <Badge tone={def.tone}>{def.label}</Badge>
                {row.professionalName && <span className="text-xs text-[var(--text-muted)]">{row.professionalName}</span>}
              </span>
              <span className="block text-sm text-[var(--text)] mt-1">{encounterSummary(row)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
