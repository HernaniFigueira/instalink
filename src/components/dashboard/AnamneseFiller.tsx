'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { Button, Input, Textarea, Select, Field, Switch, Notice, ListSkeleton } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import type { AnamneseField, AnamneseResponse, AnamneseTemplate } from '@/lib/types';

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

  useEffect(() => {
    if (!open || !templateId) return;
    setLoaded(false); setFieldErrors({}); setError('');
    apiGet<{ templates: AnamneseTemplate[] }>(`/api/anamnese?businessId=${businessId}`, { scope: 'area', area: 'Atendimento' })
      .then((res) => {
        if (!res.ok) { setError(res.message || 'Falha ao carregar a ficha.'); setLoaded(true); return; }
        const t = (res.data?.templates || []).find((x) => x.id === templateId) || null;
        setTemplate(t);
        setAnswers({});
        setLoaded(true);
      });
  }, [open, templateId, businessId]);

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
            <span className="text-[13px] font-bold text-[var(--text)] w-10 text-right">{String(answers[f.id] ?? f.scaleMin ?? 0)}</span>
          </div>
        )}
        {(f.type === 'text') && <Input {...common} value={String(answers[f.id] ?? '')} onChange={(e) => setAns(f, e.target.value)} />}
        {f.type === 'note' && <p className="text-[12.5px] text-[var(--text-muted)]">{f.help || 'Campo informativo.'}</p>}
      </Field>
    );
  };

  return (
    <WorkspaceSheet open={open} onClose={onClose} title={template?.name || 'Anamnese'} subtitle="Preencha e salve no histórico do paciente." icon="fileText" width="max-w-[640px]"
      footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="primary" onClick={save} disabled={busy || !template}>{busy ? 'Salvando…' : 'Salvar respostas'}</Button></div>}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!loaded ? <ListSkeleton rows={4} /> : !template ? <Notice tone="warning">Ficha não encontrada.</Notice> : (
        <div className="p-1 space-y-4">
          {template.description ? <p className="text-[12.5px] text-[var(--text-muted)]">{template.description}</p> : null}
          {template.fields.map(renderField)}
        </div>
      )}
    </WorkspaceSheet>
  );
}
