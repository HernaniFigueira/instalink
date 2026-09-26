'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { Button, Input, Textarea, Select, Field, Switch, Notice, ListSkeleton } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import type { AnamneseField, AnamneseResponse, AnamneseTemplate, Pet } from '@/lib/types';
import { PET_SPECIES_LABELS, petAge } from '@/lib/pets';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P4 — preencher uma ficha de anamnese e salvar a resposta.
// Reutilizável no atendimento (encounter) e avulso (paciente).
// ═══════════════════════════════════════════════════════════════
export function AnamneseFiller({
  open, onClose, businessId, templateId, contactId = '', petId = '', professionalId = '', encounterId = '', onSaved,
}: {
  open: boolean; onClose: () => void; businessId: string; templateId: string;
  contactId?: string; petId?: string; professionalId?: string; encounterId?: string;
  onSaved?: (r: AnamneseResponse) => void;
}) {
  const [template, setTemplate] = useState<AnamneseTemplate | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pet, setPet] = useState<Pet | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastResponse, setLastResponse] = useState<AnamneseResponse | null>(null);

  useEffect(() => {
    if (!open || !templateId) return;
    setLoaded(false); setFieldErrors({}); setError(''); setPet(null); setLastResponse(null); setHistoryOpen(false);
    apiGet<{ templates: AnamneseTemplate[]; responses?: AnamneseResponse[] }>(
      `/api/anamnese?businessId=${businessId}${contactId ? `&responsesFor=${encodeURIComponent(contactId)}` : ''}`,
      { scope: 'area', area: 'Atendimento' },
    )
      .then((res) => {
        if (!res.ok) { setError(res.message || 'Falha ao carregar a ficha.'); setLoaded(true); return; }
        const t = (res.data?.templates || []).find((x) => x.id === templateId) || null;
        setTemplate(t);
        setAnswers({});
        const rs = (res.data?.responses || []).filter((r) => !petId || !r.petId || r.petId === petId);
        setLastResponse(rs[0] || null);
        setLoaded(true);
      });
    // Contexto permanente do pet (espécie/raça/peso…) — só leitura.
    if (petId) {
      apiGet<{ pets?: Pet[] }>(`/api/pets?businessId=${businessId}`, { scope: 'area', area: 'Atendimento' })
        .then((res) => {
          const list = res.data?.pets || [];
          setPet(list.find((x) => x.id === petId) || null);
        })
        .catch(() => setPet(null));
    }
  }, [open, templateId, businessId, contactId, petId]);

  const setAns = (f: AnamneseField, v: unknown) => setAnswers((a) => ({ ...a, [f.id]: v }));

  async function save() {
    if (!template) return;
    setBusy(true); setFieldErrors({});
    const res = await apiSend<{ response: AnamneseResponse }>('/api/anamnese', 'POST', {
      action: 'response.save', businessId,
      response: { templateId: template.id, contactId, petId, professionalId, encounterId, answers },
    }, { scope: 'area', area: 'Atendimento' });
    setBusy(false);
    if (!res.ok) {
      const errs: Record<string, string> = {};
      for (const e of (res.data as any)?.fields || []) errs[e.fieldId] = e.message;
      setFieldErrors(errs);
      setError(res.ok ? '' : (errs && Object.keys(errs).length ? '' : (res.message || 'Não foi possível salvar.')));
      return;
    }
    onSaved?.(res.data!.response);
    onClose();
  }

  const renderField = (f: AnamneseField) => {
    const err = fieldErrors[f.id];
    const common = { id: `an_${f.id}`, 'aria-invalid': !!err };
    return (
      <Field key={f.id} label={f.label} required={f.required} error={err} htmlFor={`an_${f.id}`}>
        {f.type === 'textarea' && <Textarea {...common} rows={3} value={String(answers[f.id] ?? '')} onChange={(e) => setAns(f, e.target.value)} />}
        {f.type === 'boolean' && (
          <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            <Switch checked={answers[f.id] === true} label={f.label} onChange={(v) => setAns(f, v)} /> {answers[f.id] === true ? 'Sim' : 'Não'}
          </label>
        )}
        {f.type === 'select' && (
          <Select {...common} value={String(answers[f.id] ?? '')} onChange={(e) => setAns(f, e.target.value)}>
            <option value="">Selecione…</option>
            {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        )}
        {f.type === 'multiselect' && (
          <div className="flex flex-wrap gap-2">
            {(f.options || []).map((o) => {
              const arr = Array.isArray(answers[f.id]) ? (answers[f.id] as string[]) : [];
              const on = arr.includes(o);
              return (
                <button type="button" key={o} onClick={() => setAns(f, on ? arr.filter((x) => x !== o) : [...arr, o])}
                  className={`rounded-full border px-3 py-1 text-[12.5px] ${on ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-fg)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
                  {o}
                </button>
              );
            })}
          </div>
        )}
        {f.type === 'number' && <Input {...common} type="number" value={String(answers[f.id] ?? '')} onChange={(e) => setAns(f, e.target.value)} />}
        {f.type === 'date' && <Input {...common} type="date" value={String(answers[f.id] ?? '')} onChange={(e) => setAns(f, e.target.value)} />}
        {f.type === 'scale' && (
          <div className="flex items-center gap-3">
            <input type="range" min={f.scaleMin ?? 0} max={f.scaleMax ?? 10} value={Number(answers[f.id] ?? f.scaleMin ?? 0)} onChange={(e) => setAns(f, Number(e.target.value))} className="flex-1" />
            <span className="text-[13px] font-semibold text-[var(--text)] w-10 text-right">{String(answers[f.id] ?? f.scaleMin ?? 0)}</span>
          </div>
        )}
        {(f.type === 'text') && <Input {...common} value={String(answers[f.id] ?? '')} onChange={(e) => setAns(f, e.target.value)} />}
        {f.type === 'note' && <p className="text-[12.5px] text-[var(--text-muted)]">{f.help || 'Campo informativo.'}</p>}
      </Field>
    );
  };

  const petAgeLabel = pet?.birthDate ? `${petAge(pet.birthDate)} ano(s)` : '—';

  return (
    <WorkspaceSheet open={open} onClose={onClose} title={template?.name || 'Anamnese'} subtitle="Ficha clínica — episódio atual do paciente." icon="fileText" width="max-w-[640px]"
      footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="primary" onClick={save} disabled={busy || !template}>{busy ? 'Salvando…' : 'Salvar ficha'}</Button></div>}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!loaded ? <ListSkeleton rows={4} /> : !template ? <Notice tone="warning">Ficha não encontrada.</Notice> : (
        <div className="p-1 space-y-4">
          {/* HOMOLOGAÇÃO · dados PERMANENTES do pet = CONTEXTO (não se editam aqui). */}
          {pet && (
            <section data-testid="anamnese-pet-context" className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Contexto do paciente</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[12.5px]">
                <div><span className="text-[var(--text-muted)]">Espécie: </span>{PET_SPECIES_LABELS[pet.species] || pet.species || '—'}</div>
                <div><span className="text-[var(--text-muted)]">Raça: </span>{pet.breed || '—'}</div>
                <div><span className="text-[var(--text-muted)]">Sexo: </span>{pet.sex === 'M' ? 'Macho' : pet.sex === 'F' ? 'Fêmea' : '—'}</div>
                <div><span className="text-[var(--text-muted)]">Nascimento: </span>{pet.birthDate || '—'}</div>
                <div><span className="text-[var(--text-muted)]">Idade: </span>{petAgeLabel}</div>
                <div><span className="text-[var(--text-muted)]">Peso: </span>{pet.weightKg ? `${pet.weightKg} kg` : '—'}</div>
              </div>
              {pet.notes ? <p className="text-[12px] text-[var(--text-muted)] whitespace-pre-wrap"><span className="font-semibold">Observações permanentes: </span>{pet.notes}</p> : null}
            </section>
          )}

          {/* Histórico: só mostrar na demanda — nunca copiar automaticamente. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {lastResponse ? (
              <p className="text-[12px] text-[var(--text-muted)] tabular-nums">
                Última ficha: {formatDateShort(lastResponse.createdAt)}
              </p>
            ) : <span />}
            {lastResponse && (
              <button type="button" className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline"
                onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
                {historyOpen ? 'Ocultar histórico' : 'Ver histórico'}
              </button>
            )}
          </div>
          {historyOpen && lastResponse && (
            <section data-testid="anamnese-history" className="rounded-md border border-[var(--border)] px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Respostas anteriores (só leitura)</p>
              {Object.entries(lastResponse.answers || {}).map(([k, v]) => (
                <div key={k} className="text-[12.5px]"><span className="text-[var(--text-muted)]">{k}: </span>{String(v ?? '—')}</div>
              ))}
            </section>
          )}

          {template.description ? <p className="text-[12.5px] text-[var(--text-muted)]">{template.description}</p> : null}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Episódio atual</p>
          {template.fields.map(renderField)}
        </div>
      )}
    </WorkspaceSheet>
  );
}

/** Data curta BR (DD/MM/AAAA) a partir de ISO. */
function formatDateShort(iso: string): string {
  const d = (iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}
