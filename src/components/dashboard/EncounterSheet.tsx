'use client';
// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 5 — REGISTRO DO ATENDIMENTO (painel lateral)
// ═══════════════════════════════════════════════════════════════
// Abre a partir do agendamento ("Atendimento") ou do histórico do cliente.
// O que a tela faz:
//   • rascunho: escrita livre, salva sem fechar;
//   • finalizar: exige conteúdo mínimo e ASSINA o registro (nome do
//     profissional) — depois disso o texto não muda em silêncio;
//   • reabrir: só quem administra a unidade (e fica na auditoria);
//   • imprimir: uma via do CLIENTE com o que ele levou para casa — a anotação
//     interna não entra no papel.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { Badge, Button, Drawer, Field, Input, Notice, Textarea } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import {
  ENCOUNTER_LABELS, ENCOUNTER_STATUS, canEditEncounter, canFinalize, encounterPrintBlocks,
  encounterSignature, encounterSummary,
} from '@/lib/encounters';
import { formatDateBR } from '@/lib/tz';
import type { Encounter } from '@/lib/types';

export interface EncounterRow extends Encounter {
  professionalName: string;
  serviceName: string;
  bookingStatus: string;
}

interface Props {
  businessId: string;
  /** Agendamento de origem (o registro é 1:1 com ele). */
  bookingId?: string;
  /** Pré-preenchimento quando o registro nasce de um agendamento. */
  seed?: { customerName?: string; serviceId?: string; professionalId?: string; date?: string; time?: string; contactId?: string; customerId?: string };
  /** Modelo de leitura (aberto pelo histórico do cliente, já existente). */
  existing?: EncounterRow | null;
  /** Quem manda na unidade: único que reabre registro finalizado. */
  canReopen?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

const EMPTY = {
  complaint: '', evolution: '', guidance: '', followUp: '', internalNote: '', tags: '',
};

export function EncounterSheet({ businessId, bookingId, seed, existing, canReopen = false, onClose, onChanged }: Props) {
  const [row, setRow] = useState<EncounterRow | null>(existing || null);
  const [form, setForm] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(!existing);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState('');

  const apply = useCallback((e: EncounterRow) => {
    setRow(e);
    setForm({
      complaint: e.complaint || '', evolution: e.evolution || '', guidance: e.guidance || '',
      followUp: e.followUp || '', internalNote: e.internalNote || '', tags: (e.tags || []).join(', '),
    });
  }, []);

  const open = useCallback(async (create = false) => {
    setError('');
    if (existing && !create) { apply(existing); setLoading(false); return; }
    setLoading(true);
    const query = bookingId ? `bookingId=${encodeURIComponent(bookingId)}` : '';
    const res = query
      ? await apiGet<{ encounter: EncounterRow | null }>(`/api/encounters?businessId=${businessId}&${query}`, { scope: 'area', area: 'Atendimento' })
      : null;
    if (res && !res.ok) { setError(res.message || 'Não foi possível abrir o atendimento.'); setLoading(false); return; }
    const found = res?.data?.encounter || null;
    if (found) { apply(found); setLoading(false); return; }
    // Ainda não existe: o registro nasce junto com o agendamento (rascunho).
    const created = await apiSend<{ encounter: EncounterRow }>('/api/encounters', 'POST', {
      businessId, bookingId,
      customerName: seed?.customerName || '', serviceId: seed?.serviceId || '',
      professionalId: seed?.professionalId || '', date: seed?.date || '', time: seed?.time || '',
      contactId: seed?.contactId || '', customerId: seed?.customerId || '',
    }, { scope: 'action', area: 'Atendimento' });
    setLoading(false);
    if (!created.ok) { setError(created.message || 'Não foi possível abrir o atendimento.'); return; }
    apply(created.data!.encounter);
  }, [apply, bookingId, businessId, existing, seed]);

  useEffect(() => { open(); }, [open]);

  const isDraft = row?.status === 'draft';
  const editable = row ? canEditEncounter(row, { canReopen }) : false;
  const dirty = useMemo(() => {
    if (!row) return false;
    return form.complaint !== (row.complaint || '')
      || form.evolution !== (row.evolution || '')
      || form.guidance !== (row.guidance || '')
      || form.followUp !== (row.followUp || '')
      || form.internalNote !== (row.internalNote || '')
      || form.tags !== (row.tags || []).join(', ');
  }, [form, row]);

  async function save() {
    if (!row) return;
    setBusy('save'); setError(''); setSaved('');
    const res = await apiSend<{ encounter: EncounterRow }>('/api/encounters', 'PATCH', {
      businessId, id: row.id,
      complaint: form.complaint, evolution: form.evolution, guidance: form.guidance,
      followUp: form.followUp, internalNote: form.internalNote,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    }, { scope: 'action', area: 'Atendimento' });
    setBusy('');
    if (!res.ok) { setError(res.message); return; }
    apply(res.data!.encounter);
    setSaved('Registro salvo.');
    onChanged?.();
  }

  async function finalize() {
    if (!row) return;
    const check = canFinalize(form);
    if (!check.ok) { setError(check.error); return; }
    setError('');
    // Salvar antes de assinar: o documento final tem o texto que está na tela.
    if (dirty) await save();
    setBusy('finalize');
    const res = await apiSend<{ encounter: EncounterRow }>('/api/encounters', 'PATCH', {
      businessId, id: row.id, action: 'finalize',
    }, { scope: 'action', area: 'Atendimento' });
    setBusy('');
    if (!res.ok) { setError(res.message); return; }
    apply(res.data!.encounter);
    setSaved('Atendimento finalizado e assinado.');
    onChanged?.();
  }

  async function reopen() {
    if (!row) return;
    setBusy('reopen'); setError('');
    const res = await apiSend<{ encounter: EncounterRow }>('/api/encounters', 'PATCH', {
      businessId, id: row.id, action: 'reopen',
    }, { scope: 'action', area: 'Atendimento' });
    setBusy('');
    if (!res.ok) { setError(res.message); return; }
    apply(res.data!.encounter);
    setSaved('Registro reaberto para edição (a reabertura fica na auditoria).');
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
  const printBlocks = row ? encounterPrintBlocks(row) : [];

  return (
    <Drawer
      open
      onClose={onClose}
      title="Atendimento"
      subtitle={row ? `${formatDateBR(row.date)}${row.time ? ` · ${row.time}` : ''} · ${row.customerName || 'Cliente'}` : 'Registro do atendimento'}
      width="max-w-[620px]"
      footer={(
        <>
          {row && (
            <span className="mr-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <Badge tone={statusDef!.tone}>{statusDef!.label}</Badge>
              {row.status === 'finalized' && <span>Assinado por {encounterSignature(row)}</span>}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={print} disabled={!row}>
            <Icon n="printer" size={13} /> Imprimir via do cliente
          </Button>
          {editable && (
            <Button variant="secondary" size="sm" onClick={save} disabled={!!busy || !dirty}>
              {busy === 'save' ? 'Salvando…' : 'Salvar'}
            </Button>
          )}
          {row && isDraft && (
            <Button variant="primary" size="sm" onClick={finalize} disabled={!!busy}>
              {busy === 'finalize' ? 'Finalizando…' : 'Finalizar e assinar'}
            </Button>
          )}
          {row && !isDraft && canReopen && (
            <Button variant="warning" size="sm" onClick={reopen} disabled={!!busy}>
              {busy === 'reopen' ? 'Reabrindo…' : 'Reabrir para editar'}
            </Button>
          )}
        </>
      )}
    >
      <div className="px-5 py-4 space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {saved && !error && <Notice tone="success">{saved}</Notice>}
        {loading && <p className="text-sm text-[var(--text-muted)]">Abrindo o atendimento…</p>}

        {row && (
          <>
            {row.status === 'finalized' && (
              <Notice tone="info" title="Registro finalizado">
                Este documento foi assinado por {encounterSignature(row)}. Alterar exige reabrir — e a
                reabertura fica registrada na auditoria da unidade.
              </Notice>
            )}
            {!editable && !isDraft && (
              <p className="text-xs text-[var(--text-muted)]">
                Você está vendo um registro finalizado. Só quem administra a unidade reabre para edição.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <Icon n="user" size={13} /> {row.customerName || 'Cliente'}
              </span>
              {row.serviceName && <span className="inline-flex items-center gap-1.5"><Icon n="tag" size={13} /> {row.serviceName}</span>}
              {row.professionalName && <span className="inline-flex items-center gap-1.5"><Icon n="users" size={13} /> {row.professionalName}</span>}
              {row.bookingId && <span className="inline-flex items-center gap-1.5"><Icon n="calendar" size={13} /> veio de um agendamento</span>}
            </div>

            {/* ── Conteúdo do registro ── */}
            <Field label={ENCOUNTER_LABELS.complaint}>
              <Textarea value={form.complaint} disabled={!editable} maxLength={600}
                onChange={(e) => setForm({ ...form, complaint: e.target.value })}
                placeholder="Ex: dor no dente do fundo do lado direito há dois dias" />
            </Field>
            <Field label={ENCOUNTER_LABELS.evolution} hint="O que foi feito neste atendimento — é o coração do registro.">
              <Textarea value={form.evolution} disabled={!editable} maxLength={4000}
                onChange={(e) => setForm({ ...form, evolution: e.target.value })}
                placeholder="Ex: limpeza completa, aplicação de flúor; sem intercorrências" />
            </Field>
            <Field label={ENCOUNTER_LABELS.guidance} hint="Sai na via impressa que o cliente leva.">
              <Textarea value={form.guidance} disabled={!editable} maxLength={2000}
                onChange={(e) => setForm({ ...form, guidance: e.target.value })}
                placeholder="Ex: evitar alimentos muito frios por 24h; escovar com pasta para sensibilidade" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={ENCOUNTER_LABELS.followUp}>
                <Input value={form.followUp} disabled={!editable} maxLength={200}
                  onChange={(e) => setForm({ ...form, followUp: e.target.value })} placeholder="Ex: retorno em 30 dias" />
              </Field>
              <Field label="Etiquetas" hint="Separe por vírgula (procedimento, material, região…).">
                <Input value={form.tags} disabled={!editable}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Ex: limpeza, flúor" />
              </Field>
            </div>
            <Field label={ENCOUNTER_LABELS.internalNote} hint="Fica só na unidade — não entra na via do cliente.">
              <Textarea value={form.internalNote} disabled={!editable} maxLength={2000}
                onChange={(e) => setForm({ ...form, internalNote: e.target.value })}
                placeholder="Ex: cliente relatou sensibilidade; acompanhar no próximo retorno" />
            </Field>
          </>
        )}
      </div>

      {/* ── VIA DO CLIENTE (única coisa que a impressão enxerga) ── */}
      {row && (
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
                Assinado por {encounterSignature(row)}
                {row.finalizedAt ? ` em ${new Date(row.finalizedAt).toLocaleString('pt-BR')}` : ''}
              </p>
            )}
          </div>
        </div>
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
